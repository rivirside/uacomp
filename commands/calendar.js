'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  parseIcsEvents, isUpcomingEvent, matchesFilter, formatCalendarLine,
  sanitizeYearKey, parseManualDate, parseCategoriesInput, downloadCalendarAttachment
} = require('../utils/calendarUtils');
const { DEFAULT_CALENDAR_EVENT_LIMIT, MAX_CALENDAR_SIZE_BYTES } = require('../utils/constants');

// ---------------------------------------------------------------------------
// DB helpers — store calendar events in SQLite
// ---------------------------------------------------------------------------

function upsertEvents(db, guildId, yearKey, yearLabel, events) {
  // Delete existing events for this year_key in this guild, then re-insert
  db.prepare('DELETE FROM calendar_events WHERE guild_id = ? AND year_key = ?').run(guildId, yearKey);

  const insert = db.prepare(`
    INSERT INTO calendar_events (guild_id, year_key, year_label, title, start_at, end_at, all_day, location, description, categories, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        'ics'
      );
    }
  });
  run();
}

function insertEvent(db, guildId, yearKey, yearLabel, ev) {
  db.prepare(`
    INSERT INTO calendar_events (guild_id, year_key, year_label, title, start_at, end_at, all_day, location, description, categories, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')
  `).run(
    guildId, yearKey, yearLabel,
    ev.title,
    Math.floor(new Date(ev.start).getTime() / 1000),
    ev.end ? Math.floor(new Date(ev.end).getTime() / 1000) : null,
    ev.allDay ? 1 : 0,
    ev.location || null,
    ev.description || null,
    ev.categories?.length ? JSON.stringify(ev.categories) : null
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
    title:      row.title,
    start:      new Date(row.start_at * 1000).toISOString(),
    end:        row.end_at ? new Date(row.end_at * 1000).toISOString() : null,
    allDay:     Boolean(row.all_day),
    location:   row.location || null,
    description:row.description || null,
    categories: row.categories ? JSON.parse(row.categories) : []
  };
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

module.exports = {
  data: new SlashCommandBuilder()
    .setName('calendar')
    .setDescription('Upload or view class calendars')
    .addSubcommand((sub) =>
      sub.setName('upload').setDescription('Upload an .ics file for a class year')
        .addStringOption((opt) => opt.setName('year').setDescription('Label (e.g. Class of 2027)').setRequired(true))
        .addAttachmentOption((opt) => opt.setName('file').setDescription('ICS calendar file').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('next').setDescription('Show upcoming events')
        .addStringOption((opt) => opt.setName('year').setDescription('Calendar label (default if omitted)').setRequired(false))
        .addIntegerOption((opt) =>
          opt.setName('count').setDescription('Number of events').setRequired(false).setMinValue(1).setMaxValue(10)
        )
        .addStringOption((opt) => opt.setName('filter').setDescription('Filter by keyword or category').setRequired(false))
    )
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
    ),

  async execute(interaction, db) {
    const sub = interaction.options.getSubcommand();

    // ── upload ──────────────────────────────────────────────────────────────
    if (sub === 'upload') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need Manage Server permissions to upload calendars.', ephemeral: true });
      }

      const yearLabel  = interaction.options.getString('year', true).trim();
      const attachment = interaction.options.getAttachment('file', true);

      await interaction.deferReply({ ephemeral: true });
      try {
        if (attachment.size && attachment.size > MAX_CALENDAR_SIZE_BYTES) throw new Error('File exceeds 2 MB limit.');
        const rawText = await downloadCalendarAttachment(attachment.url);
        const events  = parseIcsEvents(rawText);
        if (!events.length) throw new Error('No events found in that file.');

        const yearKey = sanitizeYearKey(yearLabel);
        upsertEvents(db, interaction.guildId, yearKey, yearLabel, events);
        await interaction.editReply({ content: `Imported **${events.length}** events for **${yearLabel}**.` });
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
        ).all(interaction.guildId, yearKey, nowSec);

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

        const label     = getYearLabel(db, interaction.guildId, yearKey);
        const updatedAt = getUpdatedAt(db, interaction.guildId, yearKey);
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

      const yearInput  = interaction.options.getString('year', true);
      const title      = interaction.options.getString('title', true).trim();
      const startInput = interaction.options.getString('start', true);
      const endInput   = interaction.options.getString('end');
      const location   = interaction.options.getString('location');
      const description= interaction.options.getString('description');
      const categories = parseCategoriesInput(interaction.options.getString('categories'));
      const allDay     = interaction.options.getBoolean('allday') || false;

      await interaction.deferReply({ ephemeral: true });
      try {
        const startDate = parseManualDate(startInput, allDay);
        if (!startDate) throw new Error('Unable to parse start time. Use YYYY-MM-DD or YYYY-MM-DDTHH:MM.');

        let endDate = endInput ? parseManualDate(endInput, allDay) : null;
        if (endInput && !endDate) throw new Error('Unable to parse end time.');
        if (!endDate) endDate = new Date(startDate.getTime() + (allDay ? 86400000 : 3600000));

        const yearKey   = sanitizeYearKey(yearInput);
        const yearLabel = getYearLabel(db, interaction.guildId, yearKey) || yearInput;

        insertEvent(db, interaction.guildId, yearKey, yearLabel, {
          title, start: startDate.toISOString(), end: endDate.toISOString(),
          allDay, location, description, categories
        });

        await interaction.editReply({ content: `Added **${title}** on ${startDate.toLocaleString()} to **${yearLabel}**.` });
      } catch (err) {
        console.error('Calendar add error', err);
        await interaction.editReply({ content: `Unable to add event: ${err.message}` });
      }
    }
  }
};
