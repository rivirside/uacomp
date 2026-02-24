'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { ARCHIVE_MARKER } = require('../utils/constants');
const config = require('../config.json');

function applyArchiveMarker(topic, parentId) {
  const sanitized = topic ? topic.replace(new RegExp(`${ARCHIVE_MARKER}[^ ]+\\s?`), '').trim() : '';
  return `${sanitized ? `${sanitized} ` : ''}${ARCHIVE_MARKER}${parentId || 'none'}`.trim();
}

function getArchiveOrigin(topic) {
  if (!topic) return null;
  const idx = topic.indexOf(ARCHIVE_MARKER);
  if (idx === -1) return null;
  const [id] = topic.slice(idx + ARCHIVE_MARKER.length).split(' ');
  return id === 'none' ? null : id;
}

function removeArchiveMarker(topic) {
  if (!topic) return null;
  const cleaned = topic.replace(new RegExp(`${ARCHIVE_MARKER}[^ ]+\\s?`), '').trim();
  return cleaned.length ? cleaned : null;
}

function stripArchivePrefix(name) {
  return name.startsWith('archived-') ? name.replace(/^archived-/, '') : name;
}

function addArchivePrefix(name) {
  return (name.startsWith('archived-') ? name : `archived-${name}`).slice(0, 100);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Utility commands for the current channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) =>
      sub.setName('archive').setDescription('Archive the current channel')
        .addStringOption((opt) => opt.setName('reason').setDescription('Why is it being archived?'))
    )
    .addSubcommand((sub) =>
      sub.setName('reopen').setDescription('Re-open an archived channel')
        .addStringOption((opt) => opt.setName('note').setDescription('Optional context'))
    ),

  async execute(interaction) {
    const channel = interaction.channel;
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
      return interaction.reply({ content: 'This command only works in text channels.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'archive') {
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const originParentId = channel.parentId;
      const updates = [];

      if (config.archiveCategoryId && channel.parentId !== config.archiveCategoryId) {
        updates.push(channel.setParent(config.archiveCategoryId, {
          lockPermissions: false,
          reason: `Archived by ${interaction.user.tag}: ${reason}`
        }));
      }

      updates.push(channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: false, CreatePublicThreads: false, CreatePrivateThreads: false },
        { reason: `Archived by ${interaction.user.tag}: ${reason}` }
      ));

      updates.push(channel.setName(addArchivePrefix(channel.name), `Archived by ${interaction.user.tag}`));

      const newTopic = applyArchiveMarker(channel.topic, originParentId);
      updates.push(channel.setTopic(newTopic));

      await Promise.all(updates);
      return interaction.reply({ content: `Channel archived. Reason: ${reason}` });
    }

    if (sub === 'reopen') {
      const note = interaction.options.getString('note') || 'No note provided';
      const originParentId = getArchiveOrigin(channel.topic);
      const updates = [];

      updates.push(channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: null, CreatePublicThreads: null, CreatePrivateThreads: null },
        { reason: `Reopened by ${interaction.user.tag}: ${note}` }
      ));

      updates.push(channel.setName(stripArchivePrefix(channel.name), `Reopened by ${interaction.user.tag}: ${note}`));
      updates.push(channel.setTopic(removeArchiveMarker(channel.topic)));

      if (originParentId && originParentId !== channel.parentId) {
        updates.push(channel.setParent(originParentId, {
          reason: `Reopened by ${interaction.user.tag}: ${note}`,
          lockPermissions: false
        }));
      }

      await Promise.all(updates);
      return interaction.reply({ content: 'Channel unlocked and re-opened.' });
    }
  }
};
