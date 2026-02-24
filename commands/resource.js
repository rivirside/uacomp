'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs   = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { indexSingleResource, removeResourceFromIndex } = require('../rag/indexer');
const { SUPPORTED_EXTENSIONS } = require('../rag/parsers');
const { RAG_DL_PREFIX } = require('../utils/constants');

const GUILDS_BASE = path.join(__dirname, '..', 'resources', 'guilds');

function guildDir(guildId) {
  return path.join(GUILDS_BASE, guildId);
}

async function md5File(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('md5').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------
// Autocomplete helpers
// ---------------------------------------------------------------------------

function courseChoices(db, guildId, focused) {
  return db.prepare('SELECT id, name, label FROM courses WHERE guild_id = ? AND name LIKE ? LIMIT 25')
    .all(guildId, `%${focused}%`)
    .map((r) => ({ name: `${r.label} (${r.name})`, value: r.name }));
}

function cohortChoices(db, guildId, focused) {
  return db.prepare('SELECT id, name, label FROM cohorts WHERE guild_id = ? AND name LIKE ? LIMIT 25')
    .all(guildId, `%${focused}%`)
    .map((r) => ({ name: r.label, value: r.name }));
}

function resourceChoices(db, guildId, focused, statusFilter = 'active') {
  return db.prepare(
    'SELECT id, filename FROM resources WHERE guild_id = ? AND filename LIKE ? AND status = ? LIMIT 25'
  ).all(guildId, `%${focused}%`, statusFilter)
    .map((r) => ({ name: r.filename, value: String(r.id) }));
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resource')
    .setDescription('Manage resource library files')
    .addSubcommand((sub) =>
      sub.setName('upload').setDescription('Upload a file to the resource library')
        .addAttachmentOption((opt) => opt.setName('file').setDescription('File to upload').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('course').setDescription('Course tag (autocomplete)').setRequired(false).setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt.setName('cohort').setDescription('Cohort (autocomplete)').setRequired(false).setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt.setName('type').setDescription('Document type').setRequired(false)
            .addChoices(
              { name: 'Official (syllabus, schedule, handout)', value: 'official' },
              { name: 'Student resource (notes, study guides)', value: 'student-resource' }
            )
        )
        .addBooleanOption((opt) =>
          opt.setName('shareable').setDescription('Allow future cohorts to see this? (student resources only)').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Browse indexed resources')
        .addStringOption((opt) =>
          opt.setName('course').setDescription('Filter by course').setRequired(false).setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt.setName('status').setDescription('Filter by status').setRequired(false)
            .addChoices({ name: 'Active', value: 'active' }, { name: 'Archived', value: 'archived' })
        )
        .addStringOption((opt) =>
          opt.setName('type').setDescription('Filter by type').setRequired(false)
            .addChoices(
              { name: 'Official', value: 'official' },
              { name: 'Student resource', value: 'student-resource' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub.setName('get').setDescription('Download a resource file')
        .addStringOption((opt) =>
          opt.setName('file').setDescription('File to download').setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('archive').setDescription('Archive a resource (removes from search results)')
        .addStringOption((opt) =>
          opt.setName('file').setDescription('File to archive').setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('delete').setDescription('Permanently delete a resource (admin only)')
        .addStringOption((opt) =>
          opt.setName('file').setDescription('File to delete').setRequired(true).setAutocomplete(true)
        )
    ),

  async execute(interaction, db) {
    const sub = interaction.options.getSubcommand();

    // ── upload ───────────────────────────────────────────────────────────────
    if (sub === 'upload') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'Only admins can upload resources.', ephemeral: true });
      }

      const attachment  = interaction.options.getAttachment('file', true);
      const courseSlug  = interaction.options.getString('course')?.toLowerCase().trim() || null;
      const cohortName  = interaction.options.getString('cohort')?.trim() || null;
      const docType     = interaction.options.getString('type') || 'official';
      const shareable   = interaction.options.getBoolean('shareable') ? 1 : 0;
      const ext         = path.extname(attachment.name).toLowerCase();

      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        return interaction.reply({
          content: `Unsupported file type **${ext}**. Supported: ${[...SUPPORTED_EXTENSIONS].join(', ')}`,
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        // Look up course/cohort IDs
        const courseRow = courseSlug
          ? db.prepare('SELECT id FROM courses WHERE guild_id = ? AND name = ?').get(interaction.guildId, courseSlug)
          : null;
        const cohortRow = cohortName
          ? db.prepare('SELECT id FROM cohorts WHERE guild_id = ? AND name = ?').get(interaction.guildId, cohortName)
          : null;

        if (courseSlug && !courseRow) {
          await interaction.editReply({ content: `Course \`${courseSlug}\` not found. Use \`/course add\` first.` });
          return;
        }
        if (cohortName && !cohortRow) {
          await interaction.editReply({ content: `Cohort \`${cohortName}\` not found. Use \`/cohort add\` first.` });
          return;
        }

        // Reject duplicates
        const existing = db.prepare(
          'SELECT id FROM resources WHERE guild_id = ? AND filename = ? AND status = "active"'
        ).get(interaction.guildId, attachment.name);
        if (existing) {
          await interaction.editReply({ content: `**${attachment.name}** is already in the library. Archive the old version first if you want to replace it.` });
          return;
        }

        // Save file
        const dir      = guildDir(interaction.guildId);
        await fs.mkdir(dir, { recursive: true });
        const destPath = path.join(dir, attachment.name);

        const resp = await fetch(attachment.url);
        if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
        await fs.writeFile(destPath, Buffer.from(await resp.arrayBuffer()));

        const md5 = await md5File(destPath);

        // DB insert
        const result = db.prepare(`
          INSERT INTO resources (guild_id, course_id, cohort_id, filename, filepath, type, status, shareable, md5, uploaded_by)
          VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
        `).run(
          interaction.guildId,
          courseRow?.id ?? null,
          cohortRow?.id ?? null,
          attachment.name,
          destPath,
          docType,
          shareable,
          md5,
          interaction.user.id
        );

        const resourceRow = db.prepare('SELECT * FROM resources WHERE id = ?').get(result.lastInsertRowid);

        // Index
        try {
          const { chunks } = await indexSingleResource(resourceRow, db);
          await interaction.editReply({
            content: `✅ **${attachment.name}** uploaded and indexed (${chunks} chunk${chunks !== 1 ? 's' : ''}).`
          });
        } catch (err) {
          console.error('[RAG] Indexing error after upload:', err.message);
          await interaction.editReply({
            content: `✅ **${attachment.name}** saved to library but indexing failed — make sure Ollama and ChromaDB are running.`
          });
        }
      } catch (err) {
        console.error('[Resource] Upload error:', err);
        await interaction.editReply({ content: `Failed to upload: ${err.message}` });
      }
      return;
    }

    // ── list ──────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const courseFilter = interaction.options.getString('course')?.toLowerCase().trim() || null;
      const statusFilter = interaction.options.getString('status') || 'active';
      const typeFilter   = interaction.options.getString('type') || null;

      let query = `
        SELECT r.id, r.filename, r.type, r.status, r.shareable, r.uploaded_at,
               c.label AS course_label, c.name AS course_name, co.label AS cohort_label
        FROM resources r
        LEFT JOIN courses c  ON r.course_id  = c.id
        LEFT JOIN cohorts co ON r.cohort_id  = co.id
        WHERE r.guild_id = ? AND r.status = ?
      `;
      const params = [interaction.guildId, statusFilter];

      if (courseFilter) { query += ' AND c.name = ?'; params.push(courseFilter); }
      if (typeFilter)   { query += ' AND r.type = ?';  params.push(typeFilter); }
      query += ' ORDER BY r.uploaded_at DESC';

      const rows = db.prepare(query).all(...params);

      if (!rows.length) {
        return interaction.reply({ content: 'No resources found with those filters.', ephemeral: true });
      }

      const lines = rows.map((r) => {
        const date    = new Date(r.uploaded_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const course  = r.course_label ? ` \`${r.course_name}\`` : '';
        const cohort  = r.cohort_label ? ` *${r.cohort_label}*` : '';
        const typeTag = r.type === 'student-resource' ? ' 📝' : '';
        const share   = r.shareable ? ' 🔗' : '';
        return `**${r.id}.** ${r.filename}${course}${cohort}${typeTag}${share} — *${date}*`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`Resources — ${statusFilter}`)
        .setDescription(lines.join('\n').slice(0, 4096))
        .setColor(0x5865f2)
        .setFooter({ text: `${rows.length} file${rows.length !== 1 ? 's' : ''} • 📝 = student resource • 🔗 = shareable` });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── get ───────────────────────────────────────────────────────────────────
    if (sub === 'get') {
      const idStr = interaction.options.getString('file', true);
      const id    = parseInt(idStr, 10);
      await interaction.deferReply({ ephemeral: true });

      try {
        const row = isNaN(id)
          ? db.prepare('SELECT * FROM resources WHERE guild_id = ? AND filename = ? AND status = "active" LIMIT 1')
              .get(interaction.guildId, idStr)
          : db.prepare('SELECT * FROM resources WHERE id = ? AND guild_id = ?')
              .get(id, interaction.guildId);

        if (!row) return interaction.editReply({ content: 'Resource not found.' });
        await interaction.editReply({ files: [{ attachment: row.filepath, name: row.filename }] });
      } catch (err) {
        console.error('[Resource] Get error:', err);
        await interaction.editReply({ content: 'Failed to retrieve that file.' });
      }
      return;
    }

    // ── archive ───────────────────────────────────────────────────────────────
    if (sub === 'archive') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'Only admins can archive resources.', ephemeral: true });
      }

      const idStr = interaction.options.getString('file', true);
      const id    = parseInt(idStr, 10);
      const row   = isNaN(id)
        ? db.prepare('SELECT * FROM resources WHERE guild_id = ? AND filename = ? AND status = "active" LIMIT 1')
            .get(interaction.guildId, idStr)
        : db.prepare('SELECT * FROM resources WHERE id = ? AND guild_id = ?').get(id, interaction.guildId);

      if (!row) return interaction.reply({ content: 'Resource not found.', ephemeral: true });
      if (row.status === 'archived') return interaction.reply({ content: 'Already archived.', ephemeral: true });

      db.prepare('UPDATE resources SET status = "archived" WHERE id = ?').run(row.id);
      await removeResourceFromIndex(row.id);
      return interaction.reply({ content: `Archived **${row.filename}** and removed from search index.`, ephemeral: true });
    }

    // ── delete ────────────────────────────────────────────────────────────────
    if (sub === 'delete') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'Only admins can delete resources.', ephemeral: true });
      }

      const idStr = interaction.options.getString('file', true);
      const id    = parseInt(idStr, 10);
      const row   = isNaN(id)
        ? db.prepare('SELECT * FROM resources WHERE guild_id = ? AND filename = ? LIMIT 1').get(interaction.guildId, idStr)
        : db.prepare('SELECT * FROM resources WHERE id = ? AND guild_id = ?').get(id, interaction.guildId);

      if (!row) return interaction.reply({ content: 'Resource not found.', ephemeral: true });

      await removeResourceFromIndex(row.id);
      db.prepare('DELETE FROM resources WHERE id = ?').run(row.id);
      try { await fs.unlink(row.filepath); } catch {}

      return interaction.reply({ content: `Permanently deleted **${row.filename}**.`, ephemeral: true });
    }
  },

  async autocomplete(interaction, db) {
    const focused = interaction.options.getFocused(true);
    const value   = focused.value.toLowerCase();

    let choices = [];

    if (focused.name === 'course') {
      choices = courseChoices(db, interaction.guildId, value);
    } else if (focused.name === 'cohort') {
      choices = cohortChoices(db, interaction.guildId, value);
    } else if (focused.name === 'file') {
      choices = resourceChoices(db, interaction.guildId, value);
    }

    await interaction.respond(choices).catch(() => {});
  },

  async handleButton(interaction, db) {
    if (!interaction.customId.startsWith(RAG_DL_PREFIX)) return false;

    const payload    = interaction.customId.slice(RAG_DL_PREFIX.length);
    const resourceId = parseInt(payload, 10);

    await interaction.deferReply({ ephemeral: true });

    try {
      const row = isNaN(resourceId)
        ? null
        : db.prepare('SELECT * FROM resources WHERE id = ? AND guild_id = ?').get(resourceId, interaction.guildId);

      if (!row) {
        await interaction.editReply({ content: 'Could not find that file in the library.' });
        return true;
      }

      await interaction.editReply({ files: [{ attachment: row.filepath, name: row.filename }] });
    } catch (err) {
      console.error('[Resource] Download button error:', err);
      await interaction.editReply({ content: 'Failed to retrieve that file.' });
    }
    return true;
  }
};
