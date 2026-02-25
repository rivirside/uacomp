'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  parseIcsEvents, isUpcomingEvent, matchesFilter, formatCalendarLine,
  sanitizeYearKey, parseManualDate, parseCategoriesInput, downloadCalendarAttachment,
  resolveEventScope
} = require('../utils/calendarUtils');
const {
  DEFAULT_CALENDAR_EVENT_LIMIT, MAX_CALENDAR_SIZE_BYTES,
  DIGEST_WINDOW_DAYS
} = require('../utils/constants');

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/**
 * Upsert events for a specific scope+group_id by deleting then re-inserting.
 * For auto-scope uploads we use INSERT OR REPLACE keyed on external_uid instead.
 */
function upsertEvents(db, guildId, yearKey, yearLabel, events, scope = 'university', groupId = null) {
  // Delete existing events for this year_key + scope + group_id
  db.prepare(
    'DELETE FROM calendar_events WHERE guild_id = ? AND year_key = ? AND scope = ? AND (group_id IS ? OR group_id = ?)'
  ).run(guildId, yearKey, scope, groupId, groupId);

  const insert = db.prepare(`
    INSERT INTO calendar_events
      (guild_id, year_key, year_label, title, start_at, end_at, all_day,
       location, description, categories, source, external_uid, scope, group_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const run = db.transaction(() => {
    for (const ev of events) {
      const startAt = Math.floor(new Date(ev.start).getTime() / 1000);
      const endAt   = ev.end ? Math.floor(new Date(ev.end).getTime() / 1000) : null;
      insert.run(
        guildId, yearKey, yearLabel,
        ev.title, startAt, endAt,
        ev.allDay ? 1 : 0,
        ev.location || null,
        ev.description || null,
        ev.categories?.length ? JSON.stringify(ev.categories) : null,
        'ics',
        ev.uid || null,
        scope,
        groupId
      );
    }
  });
  run();
}

/**
 * Upsert events using INSERT OR REPLACE keyed on external_uid.
 * Used when scope='auto' or when polling subscriptions.
 */
function upsertEventsAuto(db, guildId, yearKey, yearLabel, events) {
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO calendar_events
      (guild_id, year_key, year_label, title, start_at, end_at, all_day,
       location, description, categories, source, external_uid, scope, group_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const run = db.transaction(() => {
    for (const ev of events) {
      const startAt = Math.floor(new Date(ev.start).getTime() / 1000);
      const endAt   = ev.end ? Math.floor(new Date(ev.end).getTime() / 1000) : null;
      upsert.run(
        guildId, yearKey, yearLabel,
        ev.title, startAt, endAt,
        ev.allDay ? 1 : 0,
        ev.location || null,
        ev.description || null,
        ev.categories?.length ? JSON.stringify(ev.categories) : null,
        'ics',
        ev.uid || null,
        ev._scope || 'university',
        ev._groupId || null
      );
    }
  });
  run();
}

function insertEvent(db, guildId, yearKey, yearLabel, ev, scope = 'university', groupId = null) {
  db.prepare(`
    INSERT INTO calendar_events
      (guild_id, year_key, year_label, title, start_at, end_at, all_day,
       location, description, categories, source, scope, group_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)
  `).run(
    guildId, yearKey, yearLabel,
    ev.title,
    Math.floor(new Date(ev.start).getTime() / 1000),
    ev.end ? Math.floor(new Date(ev.end).getTime() / 1000) : null,
    ev.allDay ? 1 : 0,
    ev.location || null,
    ev.description || null,
    ev.categories?.length ? JSON.stringify(ev.categories) : null,
    scope,
    groupId
  );
}

function getUpdatedAt(db, guildId, yearKey) {
  const row = db.prepare(
    'SELECT MAX(created_at) AS ts FROM calendar_events WHERE guild_id = ? AND year_key = ?'
  ).get(guildId, yearKey);
  return row?.ts ? new Date(row.ts * 1000) : new Date();
}

function getYearLabel(db, guildId, yearKey) {
  const row = db.prepare(
    'SELECT year_label FROM calendar_events WHERE guild_id = ? AND year_key = ? LIMIT 1'
  ).get(guildId, yearKey);
  return row?.year_label || yearKey;
}

function rowToEvent(row) {
  return {
    title:       row.title,
    start:       new Date(row.start_at * 1000).toISOString(),
    end:         row.end_at ? new Date(row.end_at * 1000).toISOString() : null,
    allDay:      Boolean(row.all_day),
    location:    row.location || null,
    description: row.description || null,
    categories:  row.categories ? JSON.parse(row.categories) : []
  };
}

// Personal schedule SQL — respects user's group memberships
const PERSONAL_SCHEDULE_SQL = `
  SELECT DISTINCT ce.*
  FROM calendar_events ce
  WHERE ce.guild_id = ?
    AND ce.start_at <= ?
    AND (ce.end_at IS NULL OR ce.end_at >= ?)
    AND ce.start_at >= ?
    AND (
      ce.scope = 'university'
      OR ce.scope = 'cohort'
      OR (ce.scope = 'group' AND ce.group_id IN (
        SELECT gm.group_id FROM group_members gm
        JOIN groups g ON gm.group_id = g.id
        WHERE gm.user_id = ? AND g.guild_id = ? AND g.active = 1
      ))
    )
  ORDER BY ce.start_at ASC LIMIT ?
`;

function queryPersonalSchedule(db, guildId, userId, startSec, endSec, limit) {
  return db.prepare(PERSONAL_SCHEDULE_SQL).all(guildId, endSec, startSec, startSec, userId, guildId, limit);
}

// ---------------------------------------------------------------------------
// Slash command builder
// ---------------------------------------------------------------------------

module.exports = {
  data: new SlashCommandBuilder()
    .setName('calendar')
    .setDescription('Upload or view class calendars')

    // ── upload ──────────────────────────────────────────────────────────────
    .addSubcommand((sub) =>
      sub.setName('upload').setDescription('Upload an .ics file')
        .addStringOption((opt) => opt.setName('year').setDescription('Label (e.g. Class of 2027)').setRequired(true))
        .addAttachmentOption((opt) => opt.setName('file').setDescription('ICS calendar file').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('scope').setDescription('Audience scope').setRequired(false)
            .addChoices(
              { name: 'University (everyone)',  value: 'university' },
              { name: 'Cohort (active cohort)', value: 'cohort' },
              { name: 'Group (specific group)', value: 'group' },
              { name: 'Auto (from CATEGORIES)', value: 'auto' }
            )
        )
        .addStringOption((opt) =>
          opt.setName('group').setDescription('Group slug (required when scope=group)').setRequired(false).setAutocomplete(true)
        )
    )

    // ── next ────────────────────────────────────────────────────────────────
    .addSubcommand((sub) =>
      sub.setName('next').setDescription('Show upcoming events')
        .addStringOption((opt) => opt.setName('year').setDescription('Calendar label (default if omitted)').setRequired(false))
        .addIntegerOption((opt) =>
          opt.setName('count').setDescription('Number of events').setRequired(false).setMinValue(1).setMaxValue(10)
        )
        .addStringOption((opt) => opt.setName('filter').setDescription('Filter by keyword or category').setRequired(false))
    )

    // ── add ─────────────────────────────────────────────────────────────────
    .addSubcommand((sub) =>
      sub.setName('add').setDescription('Add a single event')
        .addStringOption((opt) => opt.setName('year').setDescription('Calendar label to modify').setRequired(true))
        .addStringOption((opt) => opt.setName('title').setDescription('Event title').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('start').setDescription('Start date/time (YYYY-MM-DD or YYYY-MM-DDTHH:MM)').setRequired(true)
        )
        .addStringOption((opt) => opt.setName('end').setDescription('End date/time (optional)').setRequired(false))
        .addStringOption((opt) => opt.setName('location').setDescription('Location (optional)').setRequired(false))
        .addStringOption((opt) => opt.setName('description').setDescription('Notes (optional)').setRequired(false))
        .addStringOption((opt) =>
          opt.setName('categories').setDescription('Comma-separated tags (optional)').setRequired(false)
        )
        .addBooleanOption((opt) => opt.setName('allday').setDescription('All-day event?').setRequired(false))
    )

    // ── today ───────────────────────────────────────────────────────────────
    .addSubcommand((sub) =>
      sub.setName('today').setDescription('Your events for today (personal view)')
    )

    // ── week ────────────────────────────────────────────────────────────────
    .addSubcommand((sub) =>
      sub.setName('week').setDescription(`Your events for the next ${DIGEST_WINDOW_DAYS} days (personal view)`)
    )

    // ── my ──────────────────────────────────────────────────────────────────
    .addSubcommand((sub) =>
      sub.setName('my').setDescription('Your upcoming events (personal view)')
        .addIntegerOption((opt) =>
          opt.setName('count').setDescription('Max events to show (default 10)').setRequired(false).setMinValue(1).setMaxValue(25)
        )
    )

    // ── subscribe ────────────────────────────────────────────────────────────
    .addSubcommand((sub) =>
      sub.setName('subscribe').setDescription('Subscribe to an ICS URL (admin)')
        .addStringOption((opt) => opt.setName('url').setDescription('Public ICS URL').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('scope').setDescription('Audience scope').setRequired(true)
            .addChoices(
              { name: 'University', value: 'university' },
              { name: 'Cohort',     value: 'cohort' },
              { name: 'Group',      value: 'group' },
              { name: 'Auto',       value: 'auto' }
            )
        )
        .addStringOption((opt) =>
          opt.setName('group').setDescription('Group slug (required when scope=group)').setRequired(false).setAutocomplete(true)
        )
        .addStringOption((opt) => opt.setName('year').setDescription('Year label (optional)').setRequired(false))
    )

    // ── set-channel ──────────────────────────────────────────────────────────
    .addSubcommand((sub) =>
      sub.setName('set-channel').setDescription('Configure digest/reminder channel (admin)')
        .addStringOption((opt) =>
          opt.setName('scope').setDescription('Audience scope').setRequired(true)
            .addChoices(
              { name: 'University', value: 'university' },
              { name: 'Cohort',     value: 'cohort' },
              { name: 'Group',      value: 'group' }
            )
        )
        .addChannelOption((opt) => opt.setName('channel').setDescription('Channel to post to').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('type').setDescription('Notification type').setRequired(true)
            .addChoices(
              { name: 'Weekly digest',    value: 'digest' },
              { name: 'Day-before reminder', value: 'reminder' }
            )
        )
        .addStringOption((opt) =>
          opt.setName('group').setDescription('Group slug (required when scope=group)').setRequired(false).setAutocomplete(true)
        )
    ),

  // ──────────────────────────────────────────────────────────────────────────
  // Execute
  // ──────────────────────────────────────────────────────────────────────────

  async execute(interaction, db) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    // ── upload ──────────────────────────────────────────────────────────────
    if (sub === 'upload') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need Manage Server permissions to upload calendars.', ephemeral: true });
      }

      const yearLabel  = interaction.options.getString('year', true).trim();
      const attachment = interaction.options.getAttachment('file', true);
      const scope      = interaction.options.getString('scope') || 'university';
      const groupSlug  = interaction.options.getString('group');

      let groupId = null;
      if (scope === 'group') {
        if (!groupSlug) {
          return interaction.reply({ content: 'You must specify a group when scope=group.', ephemeral: true });
        }
        const group = db.prepare('SELECT id FROM groups WHERE guild_id = ? AND name = ?').get(guildId, groupSlug);
        if (!group) {
          return interaction.reply({ content: `Group \`${groupSlug}\` not found.`, ephemeral: true });
        }
        groupId = group.id;
      }

      await interaction.deferReply({ ephemeral: true });
      try {
        if (attachment.size && attachment.size > MAX_CALENDAR_SIZE_BYTES) throw new Error('File exceeds 2 MB limit.');
        const rawText = await downloadCalendarAttachment(attachment.url);
        const events  = parseIcsEvents(rawText);
        if (!events.length) throw new Error('No events found in that file.');

        const yearKey = sanitizeYearKey(yearLabel);

        if (scope === 'auto') {
          // Resolve per-event scope from CATEGORIES field
          const tagged = events.map((ev) => {
            const resolved = resolveEventScope(db, guildId, ev.categories);
            return { ...ev, _scope: resolved.scope, _groupId: resolved.groupId };
          });
          upsertEventsAuto(db, guildId, yearKey, yearLabel, tagged);
        } else {
          upsertEvents(db, guildId, yearKey, yearLabel, events, scope, groupId);
        }

        await interaction.editReply({ content: `Imported **${events.length}** events for **${yearLabel}** (scope: ${scope}).` });
      } catch (err) {
        console.error('Calendar upload error', err);
        await interaction.editReply({ content: `Unable to process calendar: ${err.message}` });
      }
      return;
    }

    // ── next ─────────────────────────────────────────────────────────────────
    if (sub === 'next') {
      const yearInput  = interaction.options.getString('year') || 'default';
      const count      = interaction.options.getInteger('count') || DEFAULT_CALENDAR_EVENT_LIMIT;
      const filterTerm = (interaction.options.getString('filter') || '').trim();
      const yearKey    = sanitizeYearKey(yearInput);

      await interaction.deferReply();
      try {
        const nowSec = Math.floor(Date.now() / 1000);
        const rows   = db.prepare(
          'SELECT * FROM calendar_events WHERE guild_id = ? AND year_key = ? AND start_at >= ? ORDER BY start_at ASC'
        ).all(guildId, yearKey, nowSec);

        if (!rows.length) {
          await interaction.editReply({ content: `No upcoming events for **${yearInput}**.` });
          return;
        }

        const now = new Date();
        const upcoming = rows
          .map((r) => ({ ...rowToEvent(r), startDate: new Date(r.start_at * 1000), endDate: r.end_at ? new Date(r.end_at * 1000) : null }))
          .filter((ev) => isUpcomingEvent(ev, now))
          .filter((ev) => matchesFilter(ev, filterTerm))
          .slice(0, count);

        if (!upcoming.length) {
          await interaction.editReply({ content: `No matching events found for **${yearInput}**.` });
          return;
        }

        const label     = getYearLabel(db, guildId, yearKey);
        const updatedAt = getUpdatedAt(db, guildId, yearKey);
        const embed = new EmbedBuilder()
          .setTitle(`Upcoming events (${label})`)
          .setDescription(upcoming.map(formatCalendarLine).join('\n\n'))
          .setColor(0xfee75c)
          .setFooter({ text: `Last updated ${updatedAt.toLocaleString()}` })
          .setTimestamp(new Date());

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error('Calendar next error', err);
        await interaction.editReply({ content: `Unable to load calendar: ${err.message}` });
      }
      return;
    }

    // ── add ──────────────────────────────────────────────────────────────────
    if (sub === 'add') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need Manage Server permissions to add events.', ephemeral: true });
      }

      const yearInput   = interaction.options.getString('year', true);
      const title       = interaction.options.getString('title', true).trim();
      const startInput  = interaction.options.getString('start', true);
      const endInput    = interaction.options.getString('end');
      const location    = interaction.options.getString('location');
      const description = interaction.options.getString('description');
      const categories  = parseCategoriesInput(interaction.options.getString('categories'));
      const allDay      = interaction.options.getBoolean('allday') || false;

      await interaction.deferReply({ ephemeral: true });
      try {
        const startDate = parseManualDate(startInput, allDay);
        if (!startDate) throw new Error('Unable to parse start time. Use YYYY-MM-DD or YYYY-MM-DDTHH:MM.');

        let endDate = endInput ? parseManualDate(endInput, allDay) : null;
        if (endInput && !endDate) throw new Error('Unable to parse end time.');
        if (!endDate) endDate = new Date(startDate.getTime() + (allDay ? 86400000 : 3600000));

        const yearKey   = sanitizeYearKey(yearInput);
        const yearLabel = getYearLabel(db, guildId, yearKey) || yearInput;

        insertEvent(db, guildId, yearKey, yearLabel, {
          title, start: startDate.toISOString(), end: endDate.toISOString(),
          allDay, location, description, categories
        });

        await interaction.editReply({ content: `Added **${title}** on ${startDate.toLocaleString()} to **${yearLabel}**.` });
      } catch (err) {
        console.error('Calendar add error', err);
        await interaction.editReply({ content: `Unable to add event: ${err.message}` });
      }
      return;
    }

    // ── today ─────────────────────────────────────────────────────────────────
    if (sub === 'today') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const now        = new Date();
        const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const endOfDay   = new Date(startOfDay.getTime() + 86400000 - 1);
        const startSec   = Math.floor(startOfDay.getTime() / 1000);
        const endSec     = Math.floor(endOfDay.getTime() / 1000);

        const rows = queryPersonalSchedule(db, guildId, interaction.user.id, startSec, endSec, 25);

        if (!rows.length) {
          await interaction.editReply({ content: 'You have no events today.' });
          return;
        }

        const events = rows.map((r) => ({ ...rowToEvent(r), startDate: new Date(r.start_at * 1000) }));
        const embed  = new EmbedBuilder()
          .setTitle("Today's Schedule")
          .setDescription(events.map(formatCalendarLine).join('\n\n'))
          .setColor(0x57f287)
          .setTimestamp(now);

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error('Calendar today error', err);
        await interaction.editReply({ content: `Unable to load schedule: ${err.message}` });
      }
      return;
    }

    // ── week ─────────────────────────────────────────────────────────────────
    if (sub === 'week') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const now      = new Date();
        const startSec = Math.floor(now.getTime() / 1000);
        const endSec   = startSec + DIGEST_WINDOW_DAYS * 86400;

        const rows = queryPersonalSchedule(db, guildId, interaction.user.id, startSec, endSec, 25);

        if (!rows.length) {
          await interaction.editReply({ content: `You have no events in the next ${DIGEST_WINDOW_DAYS} days.` });
          return;
        }

        const events = rows.map((r) => ({ ...rowToEvent(r), startDate: new Date(r.start_at * 1000) }));
        const embed  = new EmbedBuilder()
          .setTitle(`Your Next ${DIGEST_WINDOW_DAYS} Days`)
          .setDescription(events.map(formatCalendarLine).join('\n\n'))
          .setColor(0x5865f2)
          .setTimestamp(now);

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error('Calendar week error', err);
        await interaction.editReply({ content: `Unable to load schedule: ${err.message}` });
      }
      return;
    }

    // ── my ────────────────────────────────────────────────────────────────────
    if (sub === 'my') {
      const count = interaction.options.getInteger('count') || 10;
      await interaction.deferReply({ ephemeral: true });
      try {
        const startSec = Math.floor(Date.now() / 1000);
        const endSec   = startSec + 14 * 86400;

        const rows = queryPersonalSchedule(db, guildId, interaction.user.id, startSec, endSec, count);

        if (!rows.length) {
          await interaction.editReply({ content: 'You have no upcoming events in the next 14 days.' });
          return;
        }

        const events = rows.map((r) => ({ ...rowToEvent(r), startDate: new Date(r.start_at * 1000) }));
        const embed  = new EmbedBuilder()
          .setTitle('Your Upcoming Events')
          .setDescription(events.map(formatCalendarLine).join('\n\n'))
          .setColor(0xfee75c)
          .setTimestamp(new Date());

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error('Calendar my error', err);
        await interaction.editReply({ content: `Unable to load schedule: ${err.message}` });
      }
      return;
    }

    // ── subscribe ─────────────────────────────────────────────────────────────
    if (sub === 'subscribe') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need Manage Server permissions.', ephemeral: true });
      }

      const url      = interaction.options.getString('url', true).trim();
      const scope    = interaction.options.getString('scope', true);
      const groupSlug= interaction.options.getString('group');
      const yearInput= interaction.options.getString('year');

      let groupId = null;
      if (scope === 'group') {
        if (!groupSlug) {
          return interaction.reply({ content: 'You must specify a group when scope=group.', ephemeral: true });
        }
        const group = db.prepare('SELECT id FROM groups WHERE guild_id = ? AND name = ?').get(guildId, groupSlug);
        if (!group) {
          return interaction.reply({ content: `Group \`${groupSlug}\` not found.`, ephemeral: true });
        }
        groupId = group.id;
      }

      const yearLabel = yearInput?.trim() || null;
      const yearKey   = yearLabel ? sanitizeYearKey(yearLabel) : null;

      await interaction.deferReply({ ephemeral: true });
      try {
        db.prepare(`
          INSERT OR REPLACE INTO calendar_subscriptions
            (guild_id, url, scope, group_id, year_key, year_label)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(guildId, url, scope, groupId, yearKey, yearLabel);

        // Immediate poll
        const { pollSubscriptions } = require('../utils/subscriptionPoller');
        await pollSubscriptions(db, guildId);

        const sub2 = db.prepare('SELECT * FROM calendar_subscriptions WHERE guild_id = ? AND url = ?').get(guildId, url);
        await interaction.editReply({
          content: `Subscribed to calendar. Imported **${sub2?.last_count ?? 0}** events (scope: ${scope}).`
        });
      } catch (err) {
        console.error('Calendar subscribe error', err);
        await interaction.editReply({ content: `Unable to subscribe: ${err.message}` });
      }
      return;
    }

    // ── set-channel ───────────────────────────────────────────────────────────
    if (sub === 'set-channel') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need Manage Server permissions.', ephemeral: true });
      }

      const scope     = interaction.options.getString('scope', true);
      const channel   = interaction.options.getChannel('channel', true);
      const type      = interaction.options.getString('type', true);
      const groupSlug = interaction.options.getString('group');

      let groupId = null;
      if (scope === 'group') {
        if (!groupSlug) {
          return interaction.reply({ content: 'You must specify a group when scope=group.', ephemeral: true });
        }
        const group = db.prepare('SELECT id FROM groups WHERE guild_id = ? AND name = ?').get(guildId, groupSlug);
        if (!group) {
          return interaction.reply({ content: `Group \`${groupSlug}\` not found.`, ephemeral: true });
        }
        groupId = group.id;
      }

      try {
        db.prepare(`
          INSERT OR REPLACE INTO notification_channels
            (guild_id, scope, group_id, channel_id, type)
          VALUES (?, ?, ?, ?, ?)
        `).run(guildId, scope, groupId, channel.id, type);

        await interaction.reply({
          content: `${type === 'digest' ? 'Weekly digest' : 'Day-before reminder'}s for **${scope}** will be posted to ${channel}.`,
          ephemeral: true
        });
      } catch (err) {
        console.error('Calendar set-channel error', err);
        await interaction.reply({ content: `Failed to save channel config: ${err.message}`, ephemeral: true });
      }
      return;
    }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Autocomplete — group option
  // ──────────────────────────────────────────────────────────────────────────

  async autocomplete(interaction, db) {
    const focused  = interaction.options.getFocused(true);
    if (focused.name !== 'group') return;

    const guildId = interaction.guildId;
    const rows = db.prepare(
      `SELECT name, label FROM groups WHERE guild_id = ? AND active = 1
       AND (name LIKE ? OR label LIKE ?) ORDER BY name LIMIT 25`
    ).all(guildId, `%${focused.value}%`, `%${focused.value}%`);

    await interaction.respond(rows.map((r) => ({ name: `${r.label} (${r.name})`, value: r.name })));
  }
};
