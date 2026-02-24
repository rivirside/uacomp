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

const blockChoices = (() => {
  const cat = findCategoryConfigByKey('blocks');
  if (!cat || !Array.isArray(cat.channels)) return [];
  return cat.channels.slice(0, 25).map((ch) => ({ name: formatChoiceLabel(ch.name), value: ch.name }));
})();

const categoryConfig = findCategoryConfigByKey('blocks');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blocks')
    .setDescription('Control visibility of pre-clinical block channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) =>
      sub.setName('activate').setDescription('Unlock a block channel')
        .addStringOption((opt) => {
          opt.setName('block').setDescription('Block to unlock').setRequired(true);
          if (blockChoices.length) opt.addChoices(...blockChoices);
          return opt;
        })
    )
    .addSubcommand((sub) =>
      sub.setName('deactivate').setDescription('Hide a block channel')
        .addStringOption((opt) => {
          opt.setName('block').setDescription('Block to hide').setRequired(true);
          if (blockChoices.length) opt.addChoices(...blockChoices);
          return opt;
        })
    ),

  async execute(interaction) {
    const sub         = interaction.options.getSubcommand();
    const channelName = interaction.options.getString('block', true);
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
      console.error('Error updating block channel', err);
      await interaction.editReply({ content: `Unable to update: ${err.message}` });
    }
  }
};
