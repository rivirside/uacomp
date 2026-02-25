'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Broadcast a message to a scoped audience')
    .addSubcommand((sub) =>
      sub.setName('send').setDescription('Send an announcement [admin]')
        .addStringOption((opt) =>
          opt.setName('scope').setDescription('Who receives this').setRequired(true)
            .addChoices(
              { name: 'University — post to a channel',  value: 'university' },
              { name: 'Cohort — post to a channel',      value: 'cohort'     },
              { name: 'Group — DM all members',          value: 'group'      }
            )
        )
        .addStringOption((opt) =>
          opt.setName('message').setDescription('Announcement text (markdown supported)').setRequired(true)
        )
        .addChannelOption((opt) =>
          opt.setName('channel').setDescription('Channel to post to (required for university/cohort)').setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('group').setDescription('Group slug — required when scope is group').setRequired(false)
            .setAutocomplete(true)
        )
        .addBooleanOption((opt) =>
          opt.setName('embed').setDescription('Send as embed? Default: true').setRequired(false)
        )
    ),

  async execute(interaction, db) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'You need the **Manage Server** permission to send announcements.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const scope     = interaction.options.getString('scope');
    const message   = interaction.options.getString('message');
    const channel   = interaction.options.getChannel('channel');
    const groupSlug = interaction.options.getString('group');
    const asEmbed   = interaction.options.getBoolean('embed') ?? true;
    const guildId   = interaction.guildId;

    // -----------------------------------------------------------------------
    // Group — DM every member
    // -----------------------------------------------------------------------
    if (scope === 'group') {
      if (!groupSlug) {
        return interaction.editReply({ content: 'You must specify a **group** when scope is "group".' });
      }

      const group = db.prepare(
        'SELECT id, label FROM groups WHERE guild_id = ? AND name = ? AND active = 1'
      ).get(guildId, groupSlug);
      if (!group) {
        return interaction.editReply({ content: `Group \`${groupSlug}\` not found.` });
      }

      const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(group.id);
      if (!members.length) {
        return interaction.editReply({ content: `**${group.label}** has no members.` });
      }

      const payload = buildPayload(message, asEmbed, interaction.user, `Announcement — ${group.label}`);
      let sent = 0, failed = 0;

      for (const { user_id } of members) {
        try {
          const user = await interaction.client.users.fetch(user_id);
          await user.send(payload);
          sent++;
        } catch {
          failed++;
        }
      }

      return interaction.editReply({
        content: `Sent to **${sent}** member(s) of **${group.label}**` +
                 (failed ? ` (${failed} couldn't receive DMs)` : '') + '.'
      });
    }

    // -----------------------------------------------------------------------
    // University / Cohort — post to a channel
    // -----------------------------------------------------------------------
    if (!channel) {
      return interaction.editReply({ content: 'You must specify a **channel** when scope is "university" or "cohort".' });
    }
    if (!channel.isTextBased()) {
      return interaction.editReply({ content: 'That channel does not support text messages.' });
    }

    const label   = scope === 'university' ? 'University' : 'Cohort';
    const payload = buildPayload(message, asEmbed, interaction.user, `${label} Announcement`);

    await channel.send(payload);
    return interaction.editReply({ content: `Announcement posted to ${channel}.` });
  },

  async autocomplete(interaction, db) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'group') return interaction.respond([]);

    const rows = db.prepare(
      `SELECT name, label FROM groups WHERE guild_id = ? AND active = 1 AND (name LIKE ? OR label LIKE ?) LIMIT 25`
    ).all(interaction.guildId, `%${focused.value}%`, `%${focused.value}%`);

    return interaction.respond(rows.map((r) => ({ name: r.label, value: r.name })));
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPayload(message, asEmbed, author, title) {
  if (!asEmbed) return { content: message };
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(message)
        .setColor(0x5865f2)
        .setFooter({ text: `Sent by ${author.tag}` })
        .setTimestamp(new Date())
    ]
  };
}
