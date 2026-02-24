'use strict';

const cron = require('node-cron');

/**
 * Start scheduled jobs.
 * @param {import('discord.js').Client} client
 * @param {import('better-sqlite3').Database} db
 */
function startScheduler(client, db) {
  // Check every minute for reminders that are due
  cron.schedule('* * * * *', () => {
    try {
      fireReminders(client, db);
    } catch (err) {
      console.error('[Scheduler] Reminder error:', err);
    }
  });

  // Reset quiz leaderboard every Monday at midnight UTC
  cron.schedule('0 0 * * 1', () => {
    console.log('[Scheduler] New week started — quiz scores will accumulate fresh.');
    // Scores are week-keyed in the DB, so no deletion needed.
    // Old weeks are retained for history.
  });

  console.log('[Scheduler] Started.');
}

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

    const eventTime = reminder.remind_at;
    const eventDate = new Date(eventTime * 1000).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

    channel.send(`🔔 Reminder: **${reminder.event_title}** is coming up — ${eventDate}`).catch(() => {});
  }
}

module.exports = { startScheduler };
