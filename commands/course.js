'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('course')
    .setDescription('Manage courses for resource organisation')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName('add').setDescription('Add a course')
        .addStringOption((opt) => opt.setName('name').setDescription('Slug (e.g. anatomy)').setRequired(true))
        .addStringOption((opt) => opt.setName('label').setDescription('Display name (e.g. Gross Anatomy)').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('year').setDescription('Year level').setRequired(false)
            .addChoices(
              { name: 'MS1', value: 'MS1' },
              { name: 'MS2', value: 'MS2' },
              { name: 'MS3', value: 'MS3' },
              { name: 'MS4', value: 'MS4' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List all courses for this server')
    )
    .addSubcommand((sub) =>
      sub.setName('remove').setDescription('Remove a course (resources become untagged)')
        .addIntegerOption((opt) => opt.setName('id').setDescription('Course ID from /course list').setRequired(true))
    ),

  async execute(interaction, db) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const name  = interaction.options.getString('name', true).toLowerCase().trim().replace(/[^a-z0-9-]/g, '-');
      const label = interaction.options.getString('label', true).trim();
      const year  = interaction.options.getString('year') || null;

      const existing = db.prepare('SELECT id FROM courses WHERE guild_id = ? AND name = ?').get(interaction.guildId, name);
      if (existing) {
        return interaction.reply({ content: `A course with slug \`${name}\` already exists.`, ephemeral: true });
      }

      db.prepare('INSERT INTO courses (guild_id, name, label, year_level) VALUES (?, ?, ?, ?)').run(
        interaction.guildId, name, label, year
      );
      return interaction.reply({ content: `✅ Added course **${label}** (\`${name}\`)${year ? ` — ${year}` : ''}.`, ephemeral: true });
    }

    if (sub === 'list') {
      const rows = db.prepare('SELECT * FROM courses WHERE guild_id = ? ORDER BY year_level, name').all(interaction.guildId);
      if (!rows.length) {
        return interaction.reply({ content: 'No courses added yet. Use `/course add` to create one.', ephemeral: true });
      }

      const lines = rows.map((r) => `**${r.id}.** \`${r.name}\` — ${r.label}${r.year_level ? ` *(${r.year_level})*` : ''}`);
      const embed = new EmbedBuilder()
        .setTitle('Courses')
        .setDescription(lines.join('\n'))
        .setColor(0x5865f2);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'remove') {
      const id  = interaction.options.getInteger('id', true);
      const row = db.prepare('SELECT label FROM courses WHERE id = ? AND guild_id = ?').get(id, interaction.guildId);
      if (!row) return interaction.reply({ content: `No course with ID ${id} found.`, ephemeral: true });

      db.prepare('DELETE FROM courses WHERE id = ?').run(id);
      return interaction.reply({
        content: `Removed **${row.label}**. Associated resources are now untagged.`,
        ephemeral: true
      });
    }
  }
};
