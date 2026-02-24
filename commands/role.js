'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config.json');

const assignableRoleChoices = config.assignableRoles.map((r) => ({ name: r.label, value: r.id }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Self-service role management')
    .addSubcommand((sub) => sub.setName('list').setDescription('List self-assignable roles'))
    .addSubcommand((sub) =>
      sub.setName('assign').setDescription('Assign yourself a role')
        .addStringOption((opt) =>
          opt.setName('role').setDescription('Role to assign').setRequired(true).addChoices(...assignableRoleChoices)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('remove').setDescription('Remove a role from yourself')
        .addStringOption((opt) =>
          opt.setName('role').setDescription('Role to remove').setRequired(true).addChoices(...assignableRoleChoices)
        )
    ),

  async execute(interaction) {
    const sub    = interaction.options.getSubcommand();
    const roleId = interaction.options.getString('role');

    if (sub === 'list') {
      const embed = new EmbedBuilder()
        .setTitle('Self-assignable roles')
        .setColor(0x57f287)
        .setDescription(
          config.assignableRoles.map((r) => `• **${r.label}** – <@&${r.id}>\n${r.description}`).join('\n\n')
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (!config.assignableRoles.some((r) => r.id === roleId)) {
      return interaction.reply({ content: "That role isn't managed by this command.", ephemeral: true });
    }

    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: "I don't have permission to manage roles right now.", ephemeral: true });
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);

    if (sub === 'assign') {
      if (member.roles.cache.has(roleId)) return interaction.reply({ content: 'You already have that role.', ephemeral: true });
      await member.roles.add(roleId, `Self-assigned by ${interaction.user.tag}`);
      return interaction.reply({ content: `Added <@&${roleId}> to you.`, ephemeral: true });
    }

    if (sub === 'remove') {
      if (!member.roles.cache.has(roleId)) return interaction.reply({ content: "You don't have that role.", ephemeral: true });
      await member.roles.remove(roleId, `Self-removed by ${interaction.user.tag}`);
      return interaction.reply({ content: `Removed <@&${roleId}> from you.`, ephemeral: true });
    }
  }
};
