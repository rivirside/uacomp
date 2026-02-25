'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { VALID_GROUP_TYPES, VALID_GROUP_LIFESPANS, MAX_ROSTER_DISPLAY } = require('../utils/constants');

// ---------------------------------------------------------------------------
// Slash command builder
// ---------------------------------------------------------------------------

const data = new SlashCommandBuilder()
  .setName('group')
  .setDescription('Manage small groups (CBI, anatomy labs, doctoring groups, etc.)')
  .addSubcommand((sub) =>
    sub.setName('create').setDescription('Create a new group (admin)')
      .addStringOption((opt) => opt.setName('name').setDescription('Slug (e.g. cbi-a)').setRequired(true))
      .addStringOption((opt) => opt.setName('label').setDescription('Display name (e.g. CBI Group A)').setRequired(true))
      .addStringOption((opt) =>
        opt.setName('type').setDescription('Group type').setRequired(true)
          .addChoices(
            { name: 'CBI',       value: 'cbi' },
            { name: 'Anatomy',   value: 'anatomy' },
            { name: 'Doctoring', value: 'doctoring' },
            { name: 'Other',     value: 'other' }
          )
      )
      .addStringOption((opt) =>
        opt.setName('lifespan').setDescription('Lifespan of the group').setRequired(false)
          .addChoices(
            { name: 'Permanent',  value: 'permanent' },
            { name: 'Course',     value: 'course' },
            { name: 'One-time',   value: 'one-time' }
          )
      )
      .addBooleanOption((opt) => opt.setName('open').setDescription('Allow self-join?').setRequired(false))
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('List all active groups')
  )
  .addSubcommand((sub) =>
    sub.setName('info').setDescription('Show info about a group')
      .addStringOption((opt) =>
        opt.setName('name').setDescription('Group slug').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('join').setDescription('Join an open group')
      .addStringOption((opt) =>
        opt.setName('name').setDescription('Group slug').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('leave').setDescription('Leave a group you are in')
      .addStringOption((opt) =>
        opt.setName('name').setDescription('Group slug').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('add-member').setDescription('Add a member to a group (admin)')
      .addStringOption((opt) =>
        opt.setName('name').setDescription('Group slug').setRequired(true).setAutocomplete(true)
      )
      .addUserOption((opt) => opt.setName('user').setDescription('User to add').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub.setName('remove-member').setDescription('Remove a member from a group (admin)')
      .addStringOption((opt) =>
        opt.setName('name').setDescription('Group slug').setRequired(true).setAutocomplete(true)
      )
      .addUserOption((opt) => opt.setName('user').setDescription('User to remove').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub.setName('roster').setDescription('Show group roster (admin)')
      .addStringOption((opt) =>
        opt.setName('name').setDescription('Group slug').setRequired(true).setAutocomplete(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('delete').setDescription('Delete a group (admin)')
      .addStringOption((opt) =>
        opt.setName('name').setDescription('Group slug').setRequired(true).setAutocomplete(true)
      )
  );

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(str) {
  return (str || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function requireAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function getGroup(db, guildId, name) {
  return db.prepare('SELECT * FROM groups WHERE guild_id = ? AND name = ?').get(guildId, name);
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

async function execute(interaction, db) {
  const sub     = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  // ── create ────────────────────────────────────────────────────────────────
  if (sub === 'create') {
    if (!requireAdmin(interaction)) {
      return interaction.reply({ content: 'You need Manage Server permissions.', ephemeral: true });
    }

    const rawName = interaction.options.getString('name', true);
    const label   = interaction.options.getString('label', true).trim();
    const type    = interaction.options.getString('type', true);
    const lifespan = interaction.options.getString('lifespan') || 'permanent';
    const open    = interaction.options.getBoolean('open') ? 1 : 0;
    const name    = slugify(rawName);

    if (!name) {
      return interaction.reply({ content: 'Invalid group name. Use letters, numbers, and hyphens.', ephemeral: true });
    }

    try {
      db.prepare(
        'INSERT INTO groups (guild_id, name, label, type, open, lifespan) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(guildId, name, label, type, open, lifespan);
      return interaction.reply({ content: `Group **${label}** (\`${name}\`) created.`, ephemeral: true });
    } catch (err) {
      if (err.message?.includes('UNIQUE')) {
        return interaction.reply({ content: `A group named \`${name}\` already exists.`, ephemeral: true });
      }
      console.error('[group create]', err);
      return interaction.reply({ content: 'Failed to create group.', ephemeral: true });
    }
  }

  // ── list ──────────────────────────────────────────────────────────────────
  if (sub === 'list') {
    const rows = db.prepare(
      'SELECT * FROM groups WHERE guild_id = ? AND active = 1 ORDER BY type, name'
    ).all(guildId);

    if (!rows.length) {
      return interaction.reply({ content: 'No active groups found.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('Active Groups')
      .setColor(0x5865f2)
      .setTimestamp(new Date());

    const byType = {};
    for (const g of rows) {
      (byType[g.type] = byType[g.type] || []).push(g);
    }

    for (const [type, groups] of Object.entries(byType)) {
      const lines = groups.map((g) => `**${g.label}** (\`${g.name}\`) — ${g.open ? 'open' : 'closed'}`);
      embed.addFields({ name: type.toUpperCase(), value: lines.join('\n') });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── info ──────────────────────────────────────────────────────────────────
  if (sub === 'info') {
    const name  = interaction.options.getString('name', true);
    const group = getGroup(db, guildId, name);

    if (!group) {
      return interaction.reply({ content: `No group \`${name}\` found.`, ephemeral: true });
    }

    const memberCount = db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?').get(group.id).n;

    const embed = new EmbedBuilder()
      .setTitle(group.label)
      .setColor(0x57f287)
      .addFields(
        { name: 'Slug',     value: group.name,              inline: true },
        { name: 'Type',     value: group.type,              inline: true },
        { name: 'Lifespan', value: group.lifespan,          inline: true },
        { name: 'Open',     value: group.open ? 'Yes' : 'No', inline: true },
        { name: 'Members',  value: String(memberCount),     inline: true },
        { name: 'Active',   value: group.active ? 'Yes' : 'No', inline: true }
      )
      .setTimestamp(new Date());

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── join ──────────────────────────────────────────────────────────────────
  if (sub === 'join') {
    const name  = interaction.options.getString('name', true);
    const group = getGroup(db, guildId, name);

    if (!group || !group.active) {
      return interaction.reply({ content: `No active group \`${name}\` found.`, ephemeral: true });
    }
    if (!group.open) {
      return interaction.reply({ content: `**${group.label}** is not open for self-join. Ask an admin to add you.`, ephemeral: true });
    }

    try {
      db.prepare(
        'INSERT OR IGNORE INTO group_members (group_id, user_id, added_by) VALUES (?, ?, ?)'
      ).run(group.id, interaction.user.id, interaction.user.id);
      return interaction.reply({ content: `You have joined **${group.label}**.`, ephemeral: true });
    } catch (err) {
      console.error('[group join]', err);
      return interaction.reply({ content: 'Failed to join group.', ephemeral: true });
    }
  }

  // ── leave ─────────────────────────────────────────────────────────────────
  if (sub === 'leave') {
    const name  = interaction.options.getString('name', true);
    const group = getGroup(db, guildId, name);

    if (!group) {
      return interaction.reply({ content: `No group \`${name}\` found.`, ephemeral: true });
    }

    const result = db.prepare(
      'DELETE FROM group_members WHERE group_id = ? AND user_id = ?'
    ).run(group.id, interaction.user.id);

    if (result.changes === 0) {
      return interaction.reply({ content: `You are not a member of **${group.label}**.`, ephemeral: true });
    }
    return interaction.reply({ content: `You have left **${group.label}**.`, ephemeral: true });
  }

  // ── add-member ────────────────────────────────────────────────────────────
  if (sub === 'add-member') {
    if (!requireAdmin(interaction)) {
      return interaction.reply({ content: 'You need Manage Server permissions.', ephemeral: true });
    }

    const name   = interaction.options.getString('name', true);
    const target = interaction.options.getUser('user', true);
    const group  = getGroup(db, guildId, name);

    if (!group) {
      return interaction.reply({ content: `No group \`${name}\` found.`, ephemeral: true });
    }

    try {
      db.prepare(
        'INSERT OR IGNORE INTO group_members (group_id, user_id, added_by) VALUES (?, ?, ?)'
      ).run(group.id, target.id, interaction.user.id);
      return interaction.reply({ content: `Added ${target} to **${group.label}**.`, ephemeral: true });
    } catch (err) {
      console.error('[group add-member]', err);
      return interaction.reply({ content: 'Failed to add member.', ephemeral: true });
    }
  }

  // ── remove-member ─────────────────────────────────────────────────────────
  if (sub === 'remove-member') {
    if (!requireAdmin(interaction)) {
      return interaction.reply({ content: 'You need Manage Server permissions.', ephemeral: true });
    }

    const name   = interaction.options.getString('name', true);
    const target = interaction.options.getUser('user', true);
    const group  = getGroup(db, guildId, name);

    if (!group) {
      return interaction.reply({ content: `No group \`${name}\` found.`, ephemeral: true });
    }

    const result = db.prepare(
      'DELETE FROM group_members WHERE group_id = ? AND user_id = ?'
    ).run(group.id, target.id);

    if (result.changes === 0) {
      return interaction.reply({ content: `${target} is not a member of **${group.label}**.`, ephemeral: true });
    }
    return interaction.reply({ content: `Removed ${target} from **${group.label}**.`, ephemeral: true });
  }

  // ── roster ────────────────────────────────────────────────────────────────
  if (sub === 'roster') {
    if (!requireAdmin(interaction)) {
      return interaction.reply({ content: 'You need Manage Server permissions.', ephemeral: true });
    }

    const name  = interaction.options.getString('name', true);
    const group = getGroup(db, guildId, name);

    if (!group) {
      return interaction.reply({ content: `No group \`${name}\` found.`, ephemeral: true });
    }

    const members = db.prepare(
      'SELECT user_id FROM group_members WHERE group_id = ? ORDER BY added_at ASC LIMIT ?'
    ).all(group.id, MAX_ROSTER_DISPLAY);

    if (!members.length) {
      return interaction.reply({ content: `**${group.label}** has no members yet.`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    let lines;
    try {
      const ids = members.map((m) => m.user_id);
      const fetched = await interaction.guild.members.fetch({ user: ids });
      lines = ids.map((id) => {
        const m = fetched.get(id);
        return m ? `${m.displayName} (${m.user.tag})` : `<@${id}>`;
      });
    } catch {
      lines = members.map((m) => `<@${m.user_id}>`);
    }

    const embed = new EmbedBuilder()
      .setTitle(`${group.label} — Roster`)
      .setDescription(lines.join('\n'))
      .setColor(0x5865f2)
      .setFooter({ text: `${lines.length} member${lines.length !== 1 ? 's' : ''}` })
      .setTimestamp(new Date());

    return interaction.editReply({ embeds: [embed] });
  }

  // ── delete ────────────────────────────────────────────────────────────────
  if (sub === 'delete') {
    if (!requireAdmin(interaction)) {
      return interaction.reply({ content: 'You need Manage Server permissions.', ephemeral: true });
    }

    const name  = interaction.options.getString('name', true);
    const group = getGroup(db, guildId, name);

    if (!group) {
      return interaction.reply({ content: `No group \`${name}\` found.`, ephemeral: true });
    }

    db.prepare('DELETE FROM groups WHERE id = ?').run(group.id);
    return interaction.reply({ content: `Group **${group.label}** deleted.`, ephemeral: true });
  }
}

// ---------------------------------------------------------------------------
// Autocomplete — all `name` options query the groups table
// ---------------------------------------------------------------------------

async function autocomplete(interaction, db) {
  const focused  = interaction.options.getFocused();
  const guildId  = interaction.guildId;
  const sub      = interaction.options.getSubcommand(false);

  // For join, only show open groups
  let rows;
  if (sub === 'join') {
    rows = db.prepare(
      `SELECT name, label FROM groups WHERE guild_id = ? AND active = 1 AND open = 1
       AND (name LIKE ? OR label LIKE ?) ORDER BY name LIMIT 25`
    ).all(guildId, `%${focused}%`, `%${focused}%`);
  } else {
    rows = db.prepare(
      `SELECT name, label FROM groups WHERE guild_id = ? AND active = 1
       AND (name LIKE ? OR label LIKE ?) ORDER BY name LIMIT 25`
    ).all(guildId, `%${focused}%`, `%${focused}%`);
  }

  await interaction.respond(rows.map((r) => ({ name: `${r.label} (${r.name})`, value: r.name })));
}

module.exports = { data, execute, autocomplete };
