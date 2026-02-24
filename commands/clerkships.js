'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ensureChannelFromConfig } = require('../utils/channelUtils');
const config = require('../config.json');

function findCategoryConfigByKey(key) {
  return config.serverStructure.find((cat) => cat.key === key) || null;
}

function formatChoiceLabel(name) {
  return name.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

const clerkshipChoices = (() => {
  const cat = findCategoryConfigByKey('clerkships');
  if (!cat || !Array.isArray(cat.channels)) return [];
  return cat.channels.slice(0, 25).map((ch) => ({ name: formatChoiceLabel(ch.name), value: ch.name }));
})();

const categoryConfig = findCategoryConfigByKey('clerkships');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clerkships')
    .setDescription('Control visibility of clerkship channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) =>
      sub.setName('activate').setDescription('Unlock a clerkship channel')
        .addStringOption((opt) => {
          opt.setName('rotation').setDescription('Clerkship to unlock').setRequired(true);
          if (clerkshipChoices.length) opt.addChoices(...clerkshipChoices);
          return opt;
        })
    )
    .addSubcommand((sub) =>
      sub.setName('deactivate').setDescription('Hide a clerkship channel')
        .addStringOption((opt) => {
          opt.setName('rotation').setDescription('Clerkship to hide').setRequired(true);
          if (clerkshipChoices.length) opt.addChoices(...clerkshipChoices);
          return opt;
        })
    ),

  async execute(interaction) {
    const sub         = interaction.options.getSubcommand();
    const channelName = interaction.options.getString('rotation', true);
    const makeVisible = sub === 'activate';

    await interaction.deferReply({ ephemeral: true });
    try {
      const { channel, categoryChannel } = await ensureChannelFromConfig(
        interaction.guild, categoryConfig, channelName, interaction.user.tag
      );
      await channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { ViewChannel: makeVisible ? null : false },
        { reason: `${makeVisible ? 'Activated' : 'Deactivated'} by ${interaction.user.tag}` }
      );
      await interaction.editReply({
        content: `${makeVisible ? 'Unlocked' : 'Locked'} #${channel.name} under **${categoryChannel.name}**.`
      });
    } catch (err) {
      console.error('Error updating clerkship channel', err);
      await interaction.editReply({ content: `Unable to update: ${err.message}` });
    }
  }
};
