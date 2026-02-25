'use strict';

const { downloadCalendarAttachment, parseIcsEvents, sanitizeYearKey, resolveEventScope } = require('./calendarUtils');

/**
 * Poll all calendar subscriptions for a guild and upsert their events.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} guildId
 */
async function pollSubscriptions(db, guildId) {
  const subs = db.prepare(
    'SELECT * FROM calendar_subscriptions WHERE guild_id = ?'
  ).all(guildId);

  if (!subs.length) return;

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO calendar_events
      (guild_id, year_key, year_label, title, start_at, end_at, all_day,
       location, description, categories, source, external_uid, scope, group_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ics', ?, ?, ?)
  `);

  const updateSub = db.prepare(
    'UPDATE calendar_subscriptions SET last_fetched = ?, last_count = ? WHERE id = ?'
  );

  for (const sub of subs) {
    try {
      const raw    = await downloadCalendarAttachment(sub.url);
      const events = parseIcsEvents(raw);

      const yearKey   = sub.year_key   || 'subscribed';
      const yearLabel = sub.year_label || 'Subscribed';

      const run = db.transaction(() => {
        let count = 0;
        for (const ev of events) {
          let scope   = sub.scope;
          let groupId = sub.group_id;

          if (scope === 'auto') {
            const resolved = resolveEventScope(db, guildId, ev.categories);
            scope   = resolved.scope;
            groupId = resolved.groupId;
          }

          const startAt = Math.floor(new Date(ev.start).getTime() / 1000);
          const endAt   = ev.end ? Math.floor(new Date(ev.end).getTime() / 1000) : null;

          upsert.run(
            guildId, yearKey, yearLabel,
            ev.title, startAt, endAt,
            ev.allDay ? 1 : 0,
            ev.location   || null,
            ev.description || null,
            ev.categories?.length ? JSON.stringify(ev.categories) : null,
            ev.uid || null,
            scope,
            groupId
          );
          count++;
        }
        return count;
      });

      const count = run();
      updateSub.run(Math.floor(Date.now() / 1000), count, sub.id);
      console.log(`[Poller] ${guildId} sub#${sub.id}: upserted ${count} events from ${sub.url}`);
    } catch (err) {
      console.error(`[Poller] Failed to poll sub#${sub.id} (${sub.url}):`, err.message);
    }
  }
}

module.exports = { pollSubscriptions };
