'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const { channelTypeFromConfig, channelSupportsTopic, resolveSupportedChannelType } = require('../utils/channelUtils');
const config = require('../config.json');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

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

async function syncConfig(guild, opts) {
  // Read fresh copy from disk so we don't operate on the cached require() object
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const cfg = JSON.parse(raw);
  const report = { matched: [], auto: [], set: [], missing: [] };

  await guild.roles.fetch();
  await guild.channels.fetch();

  // ── Assignable roles — match by label ──────────────────────────────────────
  for (const entry of cfg.assignableRoles) {
    const role = guild.roles.cache.find(
      (r) => r.name.toLowerCase() === entry.label.toLowerCase()
    );
    if (role) {
      entry.id = role.id;
      report.matched.push(`${entry.label} → <@&${role.id}>`);
    } else {
      report.missing.push(`Assignable role not found: **${entry.label}**`);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  const findChannel = (type, ...names) =>
    guild.channels.cache.find(
      (c) => c.type === type && names.includes(c.name.toLowerCase())
    );
  const findChannelContains = (type, substr) =>
    guild.channels.cache.find(
      (c) => c.type === type && c.name.toLowerCase().includes(substr)
    );
  const findRole = (...names) =>
    guild.roles.cache.find((r) => names.includes(r.name.toLowerCase()));
  const findRoleContains = (substr) =>
    guild.roles.cache.find((r) => r.name.toLowerCase().includes(substr));

  // ── Singleton IDs — explicit options take priority, then auto-detect ───────
  cfg.tutorSettings = cfg.tutorSettings || {};

  // defaultRoleId
  if (opts.defaultRole) {
    cfg.defaultRoleId = opts.defaultRole.id;
    report.set.push(`defaultRoleId → <@&${opts.defaultRole.id}>`);
  } else {
    const r = findRole('member', 'members', 'student', 'students');
    if (r) { cfg.defaultRoleId = r.id; report.auto.push(`defaultRoleId → <@&${r.id}> (matched "${r.name}")`); }
    else    { report.missing.push('defaultRoleId — no role named member/student found; pass `default-role` option'); }
  }

  // welcomeChannelId
  if (opts.welcomeChannel) {
    cfg.welcomeChannelId = opts.welcomeChannel.id;
    report.set.push(`welcomeChannelId → <#${opts.welcomeChannel.id}>`);
  } else {
    const ch = findChannel(ChannelType.GuildText, 'general-chat', 'general', 'welcome', 'welcome-chat');
    if (ch) { cfg.welcomeChannelId = ch.id; report.auto.push(`welcomeChannelId → <#${ch.id}> (matched "#${ch.name}")`); }
    else    { report.missing.push('welcomeChannelId — no #general-chat/#general/#welcome found; pass `welcome-channel` option'); }
  }

  // archiveCategoryId
  if (opts.archiveCategory) {
    cfg.archiveCategoryId = opts.archiveCategory.id;
    report.set.push(`archiveCategoryId → **${opts.archiveCategory.name}**`);
  } else {
    const cat = findChannelContains(ChannelType.GuildCategory, 'archive');
    if (cat) { cfg.archiveCategoryId = cat.id; report.auto.push(`archiveCategoryId → **${cat.name}** (auto)`); }
    else     { report.missing.push('archiveCategoryId — no category containing "archive" found; pass `archive-category` option or create an "Archive" category'); }
  }

  // tutorSettings.categoryId
  if (opts.tutorCategory) {
    cfg.tutorSettings.categoryId = opts.tutorCategory.id;
    report.set.push(`tutorSettings.categoryId → **${opts.tutorCategory.name}**`);
  } else {
    const cat = findChannelContains(ChannelType.GuildCategory, 'tutor');
    if (cat) { cfg.tutorSettings.categoryId = cat.id; report.auto.push(`tutorSettings.categoryId → **${cat.name}** (auto)`); }
  }

  // tutorSettings.roleIds
  if (opts.tutorRole) {
    cfg.tutorSettings.roleIds = [opts.tutorRole.id];
    report.set.push(`tutorSettings.roleIds → <@&${opts.tutorRole.id}>`);
  } else {
    const r = findRoleContains('tutor');
    if (r) { cfg.tutorSettings.roleIds = [r.id]; report.auto.push(`tutorSettings.roleIds → <@&${r.id}> (matched "${r.name}")`); }
  }

  // tutorSettings.logChannelId
  if (opts.tutorLog) {
    cfg.tutorSettings.logChannelId = opts.tutorLog.id;
    report.set.push(`tutorSettings.logChannelId → <#${opts.tutorLog.id}>`);
  } else {
    const ch = findChannel(ChannelType.GuildText, 'bot-logs', 'tutor-log', 'tutor-logs', 'logs');
    if (ch) { cfg.tutorSettings.logChannelId = ch.id; report.auto.push(`tutorSettings.logChannelId → <#${ch.id}> (matched "#${ch.name}")`); }
  }

  // Write back to disk
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

  return report;
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
    )
    .addSubcommand((sub) =>
      sub.setName('sync')
        .setDescription('Read this server\'s roles/channels and update config.json IDs automatically')
        .addRoleOption((opt) =>
          opt.setName('default-role').setDescription('Role auto-assigned to new members on join')
        )
        .addChannelOption((opt) =>
          opt.setName('welcome-channel').setDescription('Channel where welcome messages are posted')
            .addChannelTypes(ChannelType.GuildText)
        )
        .addChannelOption((opt) =>
          opt.setName('archive-category').setDescription('Category where archived channels are moved')
            .addChannelTypes(ChannelType.GuildCategory)
        )
        .addRoleOption((opt) =>
          opt.setName('tutor-role').setDescription('Role assigned to tutors (for ticket system)')
        )
        .addChannelOption((opt) =>
          opt.setName('tutor-category').setDescription('Category where tutor ticket channels are created')
            .addChannelTypes(ChannelType.GuildCategory)
        )
        .addChannelOption((opt) =>
          opt.setName('tutor-log').setDescription('Channel where tutor ticket logs are posted')
            .addChannelTypes(ChannelType.GuildText)
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
      return;
    }

    if (sub === 'sync') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const opts = {
          defaultRole:     interaction.options.getRole('default-role'),
          welcomeChannel:  interaction.options.getChannel('welcome-channel'),
          archiveCategory: interaction.options.getChannel('archive-category'),
          tutorRole:       interaction.options.getRole('tutor-role'),
          tutorCategory:   interaction.options.getChannel('tutor-category'),
          tutorLog:        interaction.options.getChannel('tutor-log'),
        };

        const report = await syncConfig(interaction.guild, opts);

        const embed = new EmbedBuilder()
          .setTitle('Server Sync — config.json updated')
          .setColor(0x57f287)
          .setDescription('Changes take effect after the next bot restart.')
          .setTimestamp();

        if (report.matched.length) {
          embed.addFields({ name: `✅ Roles matched by name (${report.matched.length})`, value: report.matched.join('\n').slice(0, 1024) });
        }
        if (report.auto.length) {
          embed.addFields({ name: '✅ Auto-detected from server', value: report.auto.join('\n').slice(0, 1024) });
        }
        if (report.set.length) {
          embed.addFields({ name: '✅ Set from command options', value: report.set.join('\n').slice(0, 1024) });
        }
        if (report.missing.length) {
          embed.addFields({
            name: '⚠️ Could not auto-detect',
            value: report.missing.join('\n').slice(0, 1024)
          });
        }
        if (!report.matched.length && !report.auto.length && !report.set.length) {
          embed.setDescription('Nothing was updated. Ensure role names in Discord match the labels in config.json, or pass the options manually.');
        }

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error('Error syncing config', err);
        await interaction.editReply({ content: `Sync failed: ${err.message}` });
      }
    }
  }
};
