'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cohort')
    .setDescription('Manage class cohorts')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName('add').setDescription('Add a cohort')
        .addStringOption((opt) => opt.setName('name').setDescription('Short name (e.g. 2027)').setRequired(true))
        .addStringOption((opt) => opt.setName('label').setDescription('Display name (e.g. Class of 2027)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List all cohorts')
    )
    .addSubcommand((sub) =>
      sub.setName('set-active').setDescription('Mark a cohort as the active one')
        .addStringOption((opt) => opt.setName('name').setDescription('Cohort name').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('remove').setDescription('Remove a cohort')
        .addIntegerOption((opt) => opt.setName('id').setDescription('Cohort ID from /cohort list').setRequired(true))
    ),

  async execute(interaction, db) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const name  = interaction.options.getString('name', true).trim();
      const label = interaction.options.getString('label')?.trim() || `Class of ${name}`;

      const existing = db.prepare('SELECT id FROM cohorts WHERE guild_id = ? AND name = ?').get(interaction.guildId, name);
      if (existing) return interaction.reply({ content: `Cohort \`${name}\` already exists.`, ephemeral: true });

      db.prepare('INSERT INTO cohorts (guild_id, name, label) VALUES (?, ?, ?)').run(interaction.guildId, name, label);
      return interaction.reply({ content: `✅ Added cohort **${label}** (\`${name}\`).`, ephemeral: true });
    }

    if (sub === 'list') {
      const rows = db.prepare('SELECT * FROM cohorts WHERE guild_id = ? ORDER BY name').all(interaction.guildId);
      if (!rows.length) return interaction.reply({ content: 'No cohorts added yet. Use `/cohort add`.', ephemeral: true });

      const lines = rows.map((r) =>
        `**${r.id}.** \`${r.name}\` — ${r.label}${r.active ? ' ✅ active' : ''}`
      );
      const embed = new EmbedBuilder()
        .setTitle('Cohorts')
        .setDescription(lines.join('\n'))
        .setColor(0x5865f2);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'set-active') {
      const name = interaction.options.getString('name', true).trim();
      const row  = db.prepare('SELECT id FROM cohorts WHERE guild_id = ? AND name = ?').get(interaction.guildId, name);
      if (!row) return interaction.reply({ content: `No cohort found with name \`${name}\`.`, ephemeral: true });

      db.prepare('UPDATE cohorts SET active = 0 WHERE guild_id = ?').run(interaction.guildId);
      db.prepare('UPDATE cohorts SET active = 1 WHERE id = ?').run(row.id);
      return interaction.reply({ content: `✅ **${name}** is now the active cohort.`, ephemeral: true });
    }

    if (sub === 'remove') {
      const id  = interaction.options.getInteger('id', true);
      const row = db.prepare('SELECT label FROM cohorts WHERE id = ? AND guild_id = ?').get(id, interaction.guildId);
      if (!row) return interaction.reply({ content: `No cohort with ID ${id} found.`, ephemeral: true });

      db.prepare('DELETE FROM cohorts WHERE id = ?').run(id);
      return interaction.reply({ content: `Removed cohort **${row.label}**.`, ephemeral: true });
    }
  }
};
