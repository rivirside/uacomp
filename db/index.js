'use strict';

const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'bot.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let _db = null;

function getDb() {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  _db.exec(schema);

  migrateQuizScores(_db);
  migrateCalendars(_db);
  migrateCalendarScope(_db);

  return _db;
}

// ---------------------------------------------------------------------------
// One-time migrations from legacy JSON files
// ---------------------------------------------------------------------------

function migrateQuizScores(db) {
  const quizPath = path.join(__dirname, '..', 'data', 'quiz.json');
  if (!fs.existsSync(quizPath)) return;

  // Only migrate if quiz_scores table is empty
  const count = db.prepare('SELECT COUNT(*) AS n FROM quiz_scores').get().n;
  if (count > 0) return;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(quizPath, 'utf8'));
  } catch {
    return;
  }

  const weekKey = data.weekKey || '';
  const insert = db.prepare(
    'INSERT OR IGNORE INTO quiz_scores (guild_id, user_id, week_key, points, tag) VALUES (?, ?, ?, ?, ?)'
  );

  const run = db.transaction(() => {
    for (const [guildId, users] of Object.entries(data.scores || {})) {
      for (const [userId, info] of Object.entries(users)) {
        insert.run(guildId, userId, weekKey, info.points ?? 0, info.tag ?? null);
      }
    }
  });

  run();
  console.log('[DB] Migrated quiz scores from quiz.json');
}

function migrateCalendars(db) {
  const calendarsDir = path.join(__dirname, '..', 'data', 'calendars');
  if (!fs.existsSync(calendarsDir)) return;

  // Only migrate if calendar_events table is empty
  const count = db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get().n;
  if (count > 0) return;

  const files = fs.readdirSync(calendarsDir).filter((f) => f.endsWith('.json'));
  if (!files.length) return;

  const insert = db.prepare(`
    INSERT INTO calendar_events
      (guild_id, year_key, year_label, title, start_at, end_at, all_day, location, description, categories, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ics')
  `);

  // We don't know the guild_id at migration time — use a placeholder.
  // Events will be correctly associated when the calendar command runs per-guild.
  const MIGRATION_GUILD = 'migrated';

  const run = db.transaction(() => {
    for (const file of files) {
      let payload;
      try {
        payload = JSON.parse(fs.readFileSync(path.join(calendarsDir, file), 'utf8'));
      } catch {
        continue;
      }

      const yearKey = payload.key || file.replace('.json', '');
      const yearLabel = payload.label || yearKey;

      for (const event of payload.events || []) {
        const startAt = event.start ? Math.floor(new Date(event.start).getTime() / 1000) : null;
        const endAt = event.end ? Math.floor(new Date(event.end).getTime() / 1000) : null;
        if (!startAt) continue;

        insert.run(
          MIGRATION_GUILD,
          yearKey,
          yearLabel,
          event.title || 'Untitled',
          startAt,
          endAt,
          event.allDay ? 1 : 0,
          event.location || null,
          event.description || null,
          event.categories ? JSON.stringify(event.categories) : null
        );
      }
    }
  });

  run();
  console.log('[DB] Migrated calendar events from JSON files');
}

function migrateCalendarScope(db) {
  const cols = db.prepare('PRAGMA table_info(calendar_events)').all().map((c) => c.name);
  if (!cols.includes('scope')) {
    db.exec("ALTER TABLE calendar_events ADD COLUMN scope TEXT NOT NULL DEFAULT 'university'");
  }
  if (!cols.includes('group_id')) {
    db.exec('ALTER TABLE calendar_events ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL');
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_calendar_scope
    ON calendar_events(guild_id, scope, group_id, start_at)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_uid
    ON calendar_events(guild_id, external_uid) WHERE external_uid IS NOT NULL`);
  console.log('[DB] Calendar scope migration done.');
}

module.exports = { getDb };
