'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits
} = require('discord.js');
const { TUTOR_TICKET_MARKER } = require('../utils/constants');
const config = require('../config.json');

// ---------------------------------------------------------------------------
// Metadata helpers (stored in channel topic as base64-encoded JSON)
// ---------------------------------------------------------------------------

function applyMetadata(topic, metadata) {
  const sanitized = topic ? topic.replace(new RegExp(`${TUTOR_TICKET_MARKER}[^ ]+\\s?`), '').trim() : '';
  const encoded   = Buffer.from(JSON.stringify(metadata)).toString('base64');
  return `${sanitized ? `${sanitized} ` : ''}${TUTOR_TICKET_MARKER}${encoded}`.trim();
}

function getMetadata(topic) {
  if (!topic) return null;
  const match = topic.match(new RegExp(`${TUTOR_TICKET_MARKER}([^ ]+)`));
  if (!match) return null;
  try { return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')); } catch { return null; }
}

function addClosedPrefix(name) {
  return (name.startsWith('closed-') ? name : `closed-${name}`).slice(0, 100);
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getTutorSettings() { return config.tutorSettings || null; }

function hasTutorRole(member) {
  const s = getTutorSettings();
  return s?.roleIds?.some((id) => member.roles.cache.has(id)) ?? false;
}

function hasTutorStaffRole(member) {
  const s = getTutorSettings();
  return s?.staffRoleIds?.some((id) => member.roles.cache.has(id)) ?? false;
}

function buildPermissions(guild, requesterId, settings) {
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: requesterId,
      allow: [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks
      ]
    }
  ];
  for (const roleId of (settings.roleIds || [])) {
    overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] });
  }
  for (const roleId of (settings.staffRoleIds || [])) {
    overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }
  return overwrites;
}

function buildTicketEmbed(user, subject, details) {
  return new EmbedBuilder()
    .setTitle('Tutor Request')
    .addFields({ name: 'Student', value: `${user}`, inline: true }, { name: 'Subject', value: subject, inline: true })
    .setDescription(details)
    .setColor(0xfee75c)
    .setTimestamp(new Date());
}

function buildButtonRow(metadata) {
  const acceptDisabled = metadata.status !== 'open';
  const closeDisabled  = metadata.status === 'closed';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('tutor_accept')
      .setLabel(metadata.status === 'open' ? 'Claim Ticket' : metadata.status === 'closed' ? 'Ticket Closed' : 'Claimed')
      .setStyle(ButtonStyle.Success)
      .setDisabled(acceptDisabled),
    new ButtonBuilder()
      .setCustomId('tutor_close')
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(closeDisabled)
  );
}

async function updateButtonRow(channel, metadata) {
  if (!metadata.messageId) return;
  try {
    const msg = await channel.messages.fetch(metadata.messageId);
    await msg.edit({ components: [buildButtonRow(metadata)] });
  } catch (err) { console.warn('Unable to update tutor buttons', err.message); }
}

async function logEvent(guild, content) {
  const s = getTutorSettings();
  if (!s?.logChannelId) return;
  const ch = guild.channels.cache.get(s.logChannelId) || await guild.channels.fetch(s.logChannelId).catch(() => null);
  if (ch?.isTextBased()) await ch.send(content).catch(() => {});
}

async function notifyUser(user, content) {
  if (!user) return;
  try { await user.send(content); } catch { /* ignore DM failures */ }
}

async function closeTutorTicket(channel, metadata, memberActor, note) {
  if (metadata.status === 'closed') throw new Error('Ticket already closed.');
  if (!memberActor) throw new Error('Unable to determine who is closing this ticket.');

  const actorId      = memberActor.user.id;
  const isRequester  = actorId === metadata.requesterId;
  if (!isRequester && !hasTutorRole(memberActor) && !hasTutorStaffRole(memberActor)) {
    throw new Error('Only the student, a tutor, or staff can close this ticket.');
  }

  metadata.status      = 'closed';
  metadata.closedById  = actorId;
  metadata.closedByTag = memberActor.user.tag;
  metadata.closedAt    = new Date().toISOString();

  await channel.setTopic(applyMetadata(channel.topic, metadata));
  await updateButtonRow(channel, metadata);

  const closedName = addClosedPrefix(channel.name);
  if (closedName !== channel.name) await channel.setName(closedName, `Closed by ${memberActor.user.tag}`);

  try {
    await channel.permissionOverwrites.edit(
      metadata.requesterId,
      { ViewChannel: false, SendMessages: false },
      { reason: `Ticket closed by ${memberActor.user.tag}` }
    );
  } catch (err) { console.warn('Unable to update student permissions on close', err.message); }

  await channel.send(`🔒 Ticket closed by ${memberActor}. ${note ? `Resolution note: ${note}` : 'Thanks for reaching out!'}`);
  await logEvent(channel.guild, `🔒 Tutor ticket in ${channel.name} closed by ${memberActor.user.tag}. Subject: **${metadata.subject || 'unknown'}**`);
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tutor')
    .setDescription('Tutor request workflow')
    .addSubcommand((sub) =>
      sub.setName('request').setDescription('Privately request a tutor')
        .addStringOption((opt) => opt.setName('subject').setDescription('Topic needing help').setRequired(true))
        .addStringOption((opt) => opt.setName('details').setDescription('Context for tutors').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub.setName('close').setDescription('Close the current tutor ticket')
        .addStringOption((opt) => opt.setName('note').setDescription('Optional resolution note').setRequired(false))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'request') {
      const settings = getTutorSettings();
      if (!settings?.categoryId || !settings.roleIds?.length) {
        return interaction.reply({ content: 'Tutor workflow not configured. Ask an admin to update config.json.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      try {
        const subject = interaction.options.getString('subject', true).trim();
        const details = interaction.options.getString('details') || '_No extra details provided._';
        const guild   = interaction.guild;

        const category = guild.channels.cache.get(settings.categoryId) ||
          await guild.channels.fetch(settings.categoryId).catch(() => null);
        if (!category || category.type !== ChannelType.GuildCategory) {
          throw new Error('Tutor category is missing. Update config.json or recreate the category.');
        }

        const prefix  = (settings.channelPrefix || 'tutor-ticket').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'tutor-ticket';
        const chName  = `${prefix}-${Date.now().toString(36)}`;
        const ticket  = await guild.channels.create({
          name: chName, type: ChannelType.GuildText, parent: category.id,
          permissionOverwrites: buildPermissions(guild, interaction.user.id, settings),
          reason: `Tutor request by ${interaction.user.tag}`
        });

        const metadata = {
          requesterId: interaction.user.id, requesterTag: interaction.user.tag,
          subject, status: 'open', createdAt: new Date().toISOString()
        };
        await ticket.setTopic(applyMetadata(ticket.topic, metadata));

        const mentionText = (settings.roleIds || []).filter(Boolean).map((id) => `<@&${id}>`).join(' ');
        const summary     = await ticket.send({
          content: mentionText ? `${mentionText} New tutor ticket from ${interaction.user}` : `New tutor ticket from ${interaction.user}`,
          embeds: [buildTicketEmbed(interaction.user, subject, details)],
          components: [buildButtonRow(metadata)],
          allowedMentions: { roles: settings.roleIds }
        });

        metadata.messageId = summary.id;
        await ticket.setTopic(applyMetadata(ticket.topic, metadata));
        await logEvent(guild, `📘 Tutor ticket created by ${interaction.user.tag} in ${ticket}. Subject: **${subject}**`);
        await interaction.editReply({ content: `Created a private tutor channel: ${ticket}. Tutors will be with you shortly.` });
      } catch (err) {
        console.error('Tutor request error', err);
        await interaction.editReply({ content: `Unable to create tutor ticket: ${err.message}` });
      }
      return;
    }

    if (sub === 'close') {
      const channel  = interaction.channel;
      if (!channel || channel.type !== ChannelType.GuildText) {
        return interaction.reply({ content: 'Run this inside the tutor ticket channel.', ephemeral: true });
      }
      const metadata = getMetadata(channel.topic);
      if (!metadata) return interaction.reply({ content: 'This channel is not a tutor ticket.', ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
      try {
        await closeTutorTicket(channel, metadata, interaction.member, interaction.options.getString('note'));
        await interaction.editReply({ content: 'Ticket closed.' });
      } catch (err) {
        console.error('Tutor close error', err);
        await interaction.editReply({ content: `Unable to close: ${err.message}` });
      }
    }
  },

  async handleButton(interaction) {
    if (interaction.customId !== 'tutor_accept' && interaction.customId !== 'tutor_close') return false;

    const channel  = interaction.channel;
    const metadata = channel ? getMetadata(channel.topic) : null;

    if (interaction.customId === 'tutor_accept') {
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: 'This button only works in tutor ticket channels.', ephemeral: true });
        return true;
      }
      if (!metadata) {
        await interaction.reply({ content: 'This channel is missing ticket metadata.', ephemeral: true });
        return true;
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!hasTutorRole(member)) {
        await interaction.reply({ content: 'Only tutors can claim tickets.', ephemeral: true });
        return true;
      }
      if (metadata.status !== 'open') {
        await interaction.reply({
          content: metadata.status === 'closed' ? 'Ticket already closed.' : 'Another tutor already claimed this.',
          ephemeral: true
        });
        return true;
      }

      metadata.status           = 'claimed';
      metadata.claimedTutorId   = interaction.user.id;
      metadata.claimedTutorTag  = interaction.user.tag;
      metadata.claimedAt        = new Date().toISOString();

      await channel.setTopic(applyMetadata(channel.topic, metadata));
      await updateButtonRow(channel, metadata);

      const student = await interaction.guild.members.fetch(metadata.requesterId).catch(() => null);
      await channel.send(`✅ ${interaction.user} claimed this ticket. ${student ? `${student}, a tutor will reach out to you.` : ''}`);
      await notifyUser(interaction.user, `You claimed ${channel}.\nStudent: ${student?.user.tag ?? 'Unknown'}`);
      if (student) await notifyUser(student.user, `Tutor **${interaction.user.tag}** claimed your request in ${channel}.`);
      await logEvent(interaction.guild, `✅ ${interaction.user.tag} claimed tutor ticket in ${channel}. Subject: **${metadata.subject || 'unknown'}**`);
      await interaction.reply({ content: 'You are now assigned to this student.', ephemeral: true });
      return true;
    }

    if (interaction.customId === 'tutor_close') {
      await interaction.deferReply({ ephemeral: true });
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.editReply({ content: 'This button only works inside tutor tickets.' });
        return true;
      }
      if (!metadata) {
        await interaction.editReply({ content: 'This channel is not a tutor ticket.' });
        return true;
      }
      try {
        await closeTutorTicket(channel, metadata, interaction.member, null);
        await interaction.editReply({ content: 'Ticket closed.' });
      } catch (err) {
        console.error('Tutor close button error', err);
        await interaction.editReply({ content: `Unable to close: ${err.message}` });
      }
      return true;
    }

    return false;
  }
};
