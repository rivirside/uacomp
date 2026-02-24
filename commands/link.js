'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { indexLink, removeLinkFromIndex } = require('../rag/indexer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Manage curated resource links (course websites, tools, references)')
    .addSubcommand((sub) =>
      sub.setName('add').setDescription('Add a link to the resource directory')
        .addStringOption((opt) => opt.setName('url').setDescription('URL').setRequired(true))
        .addStringOption((opt) => opt.setName('title').setDescription('Display title').setRequired(true))
        .addStringOption((opt) => opt.setName('description').setDescription('What is this link?').setRequired(false))
        .addStringOption((opt) =>
          opt.setName('course').setDescription('Course tag (autocomplete)').setRequired(false).setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Browse links')
        .addStringOption((opt) =>
          opt.setName('course').setDescription('Filter by course (autocomplete)').setRequired(false).setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('remove').setDescription('Remove a link (admin only)')
        .addIntegerOption((opt) => opt.setName('id').setDescription('Link ID from /link list').setRequired(true))
    ),

  async execute(interaction, db) {
    const sub = interaction.options.getSubcommand();

    // ── add ──────────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const url         = interaction.options.getString('url', true).trim();
      const title       = interaction.options.getString('title', true).trim();
      const description = interaction.options.getString('description')?.trim() || null;
      const courseSlug  = interaction.options.getString('course')?.trim().toLowerCase() || null;

      // Basic URL validation
      try { new URL(url); } catch {
        return interaction.reply({ content: 'That does not look like a valid URL.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      let courseId = null;
      if (courseSlug) {
        const row = db.prepare('SELECT id FROM courses WHERE guild_id = ? AND name = ?').get(interaction.guildId, courseSlug);
        courseId = row?.id ?? null;
      }

      const result = db.prepare(
        'INSERT INTO links (guild_id, course_id, url, title, description, added_by) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(interaction.guildId, courseId, url, title, description, interaction.user.id);

      const linkRow = db.prepare('SELECT * FROM links WHERE id = ?').get(result.lastInsertRowid);

      // Build page text: try fetching the URL, fall back to title + description
      let pageText = [title, description].filter(Boolean).join('\n\n');
      try {
        const pageResp = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (pageResp.ok) {
          const html = await pageResp.text();
          const stripped = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/\s{2,}/g, ' ')
            .trim();
          if (stripped.length > pageText.length) pageText = stripped;
        }
      } catch { /* use title+description fallback */ }

      try {
        const { chunks } = await indexLink(linkRow, pageText, db);
        await interaction.editReply({
          content: `✅ Added **${title}**${courseSlug ? ` under \`${courseSlug}\`` : ''} and indexed (${chunks} chunk${chunks !== 1 ? 's' : ''}).`
        });
      } catch (err) {
        console.error('[RAG] Link indexing error:', err.message);
        await interaction.editReply({
          content: `✅ Added **${title}** but indexing failed — make sure Ollama and ChromaDB are running.`
        });
      }
      return;
    }

    // ── list ─────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const courseFilter = interaction.options.getString('course')?.trim().toLowerCase() || null;

      let rows;
      if (courseFilter) {
        rows = db.prepare(`
          SELECT l.id, l.url, l.title, l.description, c.name AS course
          FROM links l LEFT JOIN courses c ON l.course_id = c.id
          WHERE l.guild_id = ? AND c.name = ?
          ORDER BY l.added_at DESC
        `).all(interaction.guildId, courseFilter);
      } else {
        rows = db.prepare(`
          SELECT l.id, l.url, l.title, l.description, c.name AS course
          FROM links l LEFT JOIN courses c ON l.course_id = c.id
          WHERE l.guild_id = ?
          ORDER BY l.added_at DESC
        `).all(interaction.guildId);
      }

      if (!rows.length) {
        return interaction.reply({ content: 'No links found.', ephemeral: true });
      }

      const lines = rows.map((r) => {
        let line = `**[${r.title}](${r.url})**`;
        if (r.course) line += ` \`${r.course}\``;
        if (r.description) line += `\n${r.description}`;
        line += ` *(ID: ${r.id})*`;
        return line;
      });

      // Discord embed description limit: 4096 chars
      const chunks  = [];
      let current   = '';
      for (const line of lines) {
        if ((current + '\n\n' + line).length > 4000) { chunks.push(current); current = line; }
        else { current = current ? `${current}\n\n${line}` : line; }
      }
      if (current) chunks.push(current);

      const embed = new EmbedBuilder()
        .setTitle(`Resource Links${courseFilter ? ` — ${courseFilter}` : ''}`)
        .setDescription(chunks[0])
        .setColor(0x5865f2)
        .setFooter({ text: `${rows.length} link${rows.length !== 1 ? 's' : ''}` });

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── remove ────────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'Only admins can remove links.', ephemeral: true });
      }

      const id  = interaction.options.getInteger('id', true);
      const row = db.prepare('SELECT title FROM links WHERE id = ? AND guild_id = ?').get(id, interaction.guildId);
      if (!row) return interaction.reply({ content: `No link found with ID ${id}.`, ephemeral: true });

      await removeLinkFromIndex(id);
      db.prepare('DELETE FROM links WHERE id = ?').run(id);
      return interaction.reply({ content: `Removed **${row.title}** and cleared from search index.`, ephemeral: true });
    }
  },

  async autocomplete(interaction, db) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'course') return interaction.respond([]);

    const choices = db.prepare(
      'SELECT name, label FROM courses WHERE guild_id = ? AND name LIKE ? LIMIT 25'
    ).all(interaction.guildId, `%${focused.value.toLowerCase()}%`)
      .map((r) => ({ name: `${r.label} (${r.name})`, value: r.name }));

    await interaction.respond(choices).catch(() => {});
  }
};
