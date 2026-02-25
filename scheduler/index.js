'use strict';

const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const { pollSubscriptions } = require('../utils/subscriptionPoller');

/**
 * Start scheduled jobs.
 * @param {import('discord.js').Client} client
 * @param {import('better-sqlite3').Database} db
 */
function startScheduler(client, db) {
  // ── Existing: fire per-event reminders every minute ────────────────────────
  cron.schedule('* * * * *', () => {
    try {
      fireReminders(client, db);
    } catch (err) {
      console.error('[Scheduler] Reminder error:', err);
    }
  });

  // ── Existing: quiz leaderboard reset note every Monday ─────────────────────
  cron.schedule('0 0 * * 1', () => {
    console.log('[Scheduler] New week started — quiz scores will accumulate fresh.');
  });

  // ── New: subscription poll every 6 hours ───────────────────────────────────
  cron.schedule('0 */6 * * *', async () => {
    console.log('[Scheduler] Polling calendar subscriptions...');
    for (const [gid] of client.guilds.cache) {
      try {
        await pollSubscriptions(db, gid);
      } catch (err) {
        console.error(`[Scheduler] Poll failed for guild ${gid}:`, err.message);
      }
    }
  });

  // ── New: weekly digest — Monday 08:00 UTC ──────────────────────────────────
  cron.schedule('0 8 * * 1', async () => {
    console.log('[Scheduler] Sending weekly digests...');
    try {
      await sendWeeklyDigests(client, db);
    } catch (err) {
      console.error('[Scheduler] Weekly digest error:', err);
    }
  });

  // ── New: day-before reminders — daily 18:00 UTC ────────────────────────────
  cron.schedule('0 18 * * *', async () => {
    console.log('[Scheduler] Sending day-before reminders...');
    try {
      await sendDayBeforeReminders(client, db);
    } catch (err) {
      console.error('[Scheduler] Day-before reminder error:', err);
    }
  });

  console.log('[Scheduler] Started.');
}

// ---------------------------------------------------------------------------
// Existing: per-event reminders
// ---------------------------------------------------------------------------

function fireReminders(client, db) {
  const nowSec = Math.floor(Date.now() / 1000);

  const due = db.prepare(
    'SELECT r.*, e.title AS event_title FROM reminders r JOIN calendar_events e ON r.event_id = e.id WHERE r.sent = 0 AND r.remind_at <= ?'
  ).all(nowSec);

  if (!due.length) return;

  const markSent = db.prepare('UPDATE reminders SET sent = 1 WHERE id = ?');

  for (const reminder of due) {
    markSent.run(reminder.id);

    const channel = client.channels.cache.get(reminder.channel_id);
    if (!channel?.isTextBased()) continue;

    const eventDate = new Date(reminder.remind_at * 1000).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    channel.send(`Reminder: **${reminder.event_title}** is coming up — ${eventDate}`).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// New: weekly digest
// ---------------------------------------------------------------------------

async function sendWeeklyDigests(client, db) {
  const notifRows = db.prepare(
    "SELECT * FROM notification_channels WHERE type = 'digest'"
  ).all();

  if (!notifRows.length) return;

  const nowSec  = Math.floor(Date.now() / 1000);
  const endSec  = nowSec + 7 * 86400;

  for (const notif of notifRows) {
    try {
      const channel = client.channels.cache.get(notif.channel_id);
      if (!channel?.isTextBased()) continue;

      let rows;
      if (notif.scope === 'group' && notif.group_id) {
        rows = db.prepare(
          `SELECT * FROM calendar_events
           WHERE guild_id = ? AND scope = 'group' AND group_id = ?
             AND start_at >= ? AND start_at <= ?
           ORDER BY start_at ASC LIMIT 20`
        ).all(notif.guild_id, notif.group_id, nowSec, endSec);
      } else {
        rows = db.prepare(
          `SELECT * FROM calendar_events
           WHERE guild_id = ? AND scope = ?
             AND start_at >= ? AND start_at <= ?
           ORDER BY start_at ASC LIMIT 20`
        ).all(notif.guild_id, notif.scope, nowSec, endSec);
      }

      if (!rows.length) continue;

      const title = notif.scope === 'group'
        ? `Weekly Digest — Group ${notif.group_id}`
        : `Weekly Digest — ${notif.scope.charAt(0).toUpperCase() + notif.scope.slice(1)}`;

      const embed = buildDigestEmbed(title, rows);
      await channel.send({ embeds: [embed] });
    } catch (err) {
      console.error(`[Scheduler] Digest failed for notif#${notif.id}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// New: day-before reminders
// ---------------------------------------------------------------------------

async function sendDayBeforeReminders(client, db) {
  const now       = new Date();
  const tomorrow  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const startSec  = Math.floor(tomorrow.getTime() / 1000);
  const endSec    = startSec + 86400 - 1;

  // University / cohort → post to notification channel
  const notifRows = db.prepare(
    "SELECT * FROM notification_channels WHERE type = 'reminder'"
  ).all();

  for (const notif of notifRows) {
    try {
      if (notif.scope === 'group') continue; // handled via DM below

      const channel = client.channels.cache.get(notif.channel_id);
      if (!channel?.isTextBased()) continue;

      const rows = db.prepare(
        `SELECT * FROM calendar_events
         WHERE guild_id = ? AND scope = ?
           AND start_at >= ? AND start_at <= ?
         ORDER BY start_at ASC LIMIT 20`
      ).all(notif.guild_id, notif.scope, startSec, endSec);

      if (!rows.length) continue;

      const text = buildReminderText(rows);
      await channel.send(text);
    } catch (err) {
      console.error(`[Scheduler] Channel reminder failed for notif#${notif.id}:`, err.message);
    }
  }

  // Group events → DM each group member (aggregate per user across guilds)
  for (const [gid, guild] of client.guilds.cache) {
    try {
      const groupEvents = db.prepare(
        `SELECT ce.*, g.id AS grp_id FROM calendar_events ce
         JOIN groups g ON ce.group_id = g.id
         WHERE ce.guild_id = ? AND ce.scope = 'group'
           AND ce.start_at >= ? AND ce.start_at <= ?
         ORDER BY ce.start_at ASC`
      ).all(gid, startSec, endSec);

      if (!groupEvents.length) continue;

      // Gather unique group_ids in these events
      const groupIds = [...new Set(groupEvents.map((e) => e.group_id).filter(Boolean))];

      for (const groupId of groupIds) {
        const members = db.prepare(
          'SELECT user_id FROM group_members WHERE group_id = ?'
        ).all(groupId);

        const eventsForGroup = groupEvents.filter((e) => e.group_id === groupId);
        if (!eventsForGroup.length || !members.length) continue;

        const text = buildReminderText(eventsForGroup);

        for (const { user_id } of members) {
          try {
            const member = await guild.members.fetch(user_id).catch(() => null);
            if (!member) continue;
            await member.user.send(text).catch(() => {}); // silent fail if DMs disabled
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      console.error(`[Scheduler] Group DM reminder failed for guild ${gid}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Embed / message builders
// ---------------------------------------------------------------------------

function buildDigestEmbed(title, rows) {
  const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  const lines = rows.slice(0, 15).map((row) => {
    const start = new Date(row.start_at * 1000);
    const allDay = Boolean(row.all_day);
    const datePart = allDay
      ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(start)
      : fmt.format(start);
    let line = `**${datePart}** — ${row.title}`;
    if (row.location) line += ` _(${row.location})_`;
    return line;
  });

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setColor(0x5865f2)
    .setTimestamp(new Date());

  if (rows.length > 15) {
    embed.setFooter({ text: `+${rows.length - 15} more events this week` });
  }

  return embed;
}

function buildReminderText(events) {
  const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const lines = events.map((row) => {
    const start = new Date(row.start_at * 1000);
    const allDay = Boolean(row.all_day);
    const datePart = allDay
      ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(start)
      : fmt.format(start);
    let line = `• **${row.title}** — ${datePart}`;
    if (row.location) line += ` (${row.location})`;
    return line;
  });

  return `**Upcoming tomorrow:**\n${lines.join('\n')}`;
}

module.exports = { startScheduler };
