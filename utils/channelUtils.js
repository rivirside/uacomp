'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');

function channelTypeFromConfig(type = 'text') {
  switch (type) {
    case 'announcement': return ChannelType.GuildAnnouncement;
    case 'forum':        return ChannelType.GuildForum;
    case 'voice':        return ChannelType.GuildVoice;
    case 'stage':        return ChannelType.GuildStageVoice;
    default:             return ChannelType.GuildText;
  }
}

function channelSupportsTopic(type) {
  return [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(type);
}

function resolveSupportedChannelType(guild, desiredType) {
  const features = guild.features || [];
  if (desiredType === ChannelType.GuildAnnouncement && !features.includes('NEWS')) {
    return { type: ChannelType.GuildText, note: 'converted announcement to text (no NEWS feature)' };
  }
  if (desiredType === ChannelType.GuildForum && !features.includes('COMMUNITY')) {
    return { type: ChannelType.GuildText, note: 'converted forum to text (Community not enabled)' };
  }
  return { type: desiredType };
}

function normalizeName(value) {
  return (value || '').toLowerCase();
}

async function ensureCategoryExists(guild, categoryConfig, actorTag) {
  let cat = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildCategory && normalizeName(ch.name) === normalizeName(categoryConfig.name)
  );
  if (!cat) {
    cat = await guild.channels.create({
      name: categoryConfig.name,
      type: ChannelType.GuildCategory,
      reason: `Auto-created by ${actorTag}`
    });
  }
  return cat;
}

async function ensureChannelFromConfig(guild, categoryConfig, channelName, actorTag) {
  if (!categoryConfig) throw new Error('Category not found in config.');
  if (!Array.isArray(categoryConfig.channels)) throw new Error('No channels defined for that category.');

  const channelConfig = categoryConfig.channels.find(
    (entry) => normalizeName(entry.name) === normalizeName(channelName)
  );
  if (!channelConfig) throw new Error(`Channel "${channelName}" not defined in config.`);

  const categoryChannel = await ensureCategoryExists(guild, categoryConfig, actorTag);

  let channel = guild.channels.cache.find(
    (ch) => ch.parentId === categoryChannel.id && normalizeName(ch.name) === normalizeName(channelConfig.name)
  );

  if (!channel) {
    const desiredType = channelTypeFromConfig(channelConfig.type);
    const { type } = resolveSupportedChannelType(guild, desiredType);
    const opts = {
      name: channelConfig.name,
      type,
      parent: categoryChannel.id,
      reason: `Auto-provisioned by ${actorTag}`
    };
    if (channelSupportsTopic(desiredType) && channelConfig.topic) opts.topic = channelConfig.topic;
    if (channelConfig.slowmode) opts.rateLimitPerUser = channelConfig.slowmode;
    channel = await guild.channels.create(opts);
  }

  return { categoryChannel, channel, channelConfig };
}

module.exports = {
  channelTypeFromConfig,
  channelSupportsTopic,
  resolveSupportedChannelType,
  normalizeName,
  ensureCategoryExists,
  ensureChannelFromConfig
};
