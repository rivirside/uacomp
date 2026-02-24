'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { channelTypeFromConfig, channelSupportsTopic, resolveSupportedChannelType } = require('../utils/channelUtils');
const config = require('../config.json');

async function provisionServerStructure(guild, actorTag) {
  const report = [];
  for (const categoryConfig of config.serverStructure) {
    let cat = guild.channels.cache.find(
      (ch) => ch.type === ChannelType.GuildCategory && ch.name.toLowerCase() === categoryConfig.name.toLowerCase()
    );
    let created = false;
    if (!cat) {
      cat = await guild.channels.create({ name: categoryConfig.name, type: ChannelType.GuildCategory, reason: `Setup by ${actorTag}` });
      created = true;
    }
    report.push(`${created ? 'Created' : 'Found'} category **${cat.name}**`);
    if (!Array.isArray(categoryConfig.channels)) continue;

    for (const chConf of categoryConfig.channels) {
      const desiredType = channelTypeFromConfig(chConf.type);
      const { type, note } = resolveSupportedChannelType(guild, desiredType);
      const existing = guild.channels.cache.find(
        (ch) => ch.parentId === cat.id && ch.name.toLowerCase() === chConf.name.toLowerCase()
      );
      if (existing) { report.push(`• #${existing.name} already exists`); continue; }
      const opts = { name: chConf.name, type, parent: cat.id, reason: `Setup by ${actorTag}` };
      if (channelSupportsTopic(desiredType) && chConf.topic) opts.topic = chConf.topic;
      if (chConf.slowmode) opts.rateLimitPerUser = chConf.slowmode;
      await guild.channels.create(opts);
      report.push(`• Created #${chConf.name}${note ? ` (${note})` : ''}`);
    }
  }
  return report.join('\n');
}

async function resetServerStructure(guild, actorTag) {
  const catNames = new Set(config.serverStructure.map((c) => c.name.toLowerCase()));
  const chNames  = new Set(
    config.serverStructure.flatMap((c) => (c.channels || []).map((ch) => ch.name.toLowerCase()))
  );

  const catsToDelete = guild.channels.cache.filter(
    (ch) => ch.type === ChannelType.GuildCategory && catNames.has(ch.name.toLowerCase())
  );
  const chsToDelete = guild.channels.cache.filter(
    (ch) => ch.type !== ChannelType.GuildCategory &&
      (chNames.has(ch.name.toLowerCase()) || (ch.parentId && catsToDelete.has(ch.parentId)))
  );

  if (!catsToDelete.size && !chsToDelete.size) return 'No matching channels found to delete.';

  const report = [];
  for (const ch of chsToDelete.values())  { report.push(`Deleted #${ch.name}`);        await ch.delete(`Reset by ${actorTag}`); }
  for (const cat of catsToDelete.values()) { report.push(`Deleted **${cat.name}**`); await cat.delete(`Reset by ${actorTag}`); }
  return report.join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Server setup utilities')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName('setup').setDescription('Create the recommended channel layout'))
    .addSubcommand((sub) =>
      sub.setName('reset').setDescription('Delete categories/channels defined in config.json')
        .addBooleanOption((opt) =>
          opt.setName('confirm').setDescription('Must be true to proceed').setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (!Array.isArray(config.serverStructure) || !config.serverStructure.length) {
      return interaction.reply({ content: 'Server structure not defined in config.json.', ephemeral: true });
    }

    if (sub === 'setup') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const summary = await provisionServerStructure(interaction.guild, interaction.user.tag);
        await interaction.editReply({ content: `Server structure ensured:\n${summary}` });
      } catch (err) {
        console.error('Error provisioning server', err);
        await interaction.editReply({ content: 'Unable to create layout. Check logs.' });
      }
      return;
    }

    if (sub === 'reset') {
      if (!interaction.options.getBoolean('confirm')) {
        return interaction.reply({ content: 'Reset aborted — pass `true` to confirm.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        const summary = await resetServerStructure(interaction.guild, interaction.user.tag);
        await interaction.editReply({ content: `Server structure removed:\n${summary}` });
      } catch (err) {
        console.error('Error resetting server', err);
        await interaction.editReply({ content: 'Unable to delete layout. Check logs.' });
      }
    }
  }
};
