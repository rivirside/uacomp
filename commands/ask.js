'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { queryRAG } = require('../rag/query');
const { RAG_DL_PREFIX } = require('../utils/constants');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask a question about uploaded documents (syllabi, calendars, handouts, etc.)')
    .addStringOption((opt) =>
      opt.setName('question').setDescription('Your question').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('course')
        .setDescription('Limit search to a specific course (optional)')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async execute(interaction, db) {
    const question   = interaction.options.getString('question', true);
    const courseSlug = interaction.options.getString('course')?.toLowerCase().trim() || undefined;

    await interaction.deferReply();

    try {
      const { answer, sources } = await queryRAG(question, interaction.guildId, { course: courseSlug });

      const title = question.length > 256 ? `${question.slice(0, 253)}...` : question;
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(answer.slice(0, 4096))
        .setColor(0x5865f2)
        .setTimestamp(new Date());

      if (sources.length > 0) {
        const sourceNames = sources.map((s) => s.filename).join(', ');
        embed.setFooter({ text: `Sources: ${sourceNames}` });
      }

      const components = [];
      // Add download buttons only for file sources (resourceId > 0)
      const fileSources = sources.filter((s) => s.resourceId > 0).slice(0, 5);
      if (fileSources.length > 0) {
        const row = new ActionRowBuilder();
        for (const src of fileSources) {
          const label = src.filename.length > 20 ? `${src.filename.slice(0, 17)}...` : src.filename;
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`${RAG_DL_PREFIX}${src.resourceId}`)
              .setLabel(`📄 ${label}`)
              .setStyle(ButtonStyle.Secondary)
          );
        }
        components.push(row);
      }

      await interaction.editReply({ embeds: [embed], components });
    } catch (err) {
      console.error('[RAG] /ask error:', err);
      await interaction.editReply('Could not get an answer — make sure Ollama is running and resources are indexed.');
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
