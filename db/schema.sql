PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS guilds (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  created_at  INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS courses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  name        TEXT NOT NULL,   -- slug e.g. "anatomy"
  label       TEXT NOT NULL,   -- display e.g. "Gross Anatomy"
  year_level  TEXT,            -- MS1 | MS2 | MS3 | MS4
  created_at  INTEGER DEFAULT (unixepoch()),
  UNIQUE(guild_id, name)
);

CREATE TABLE IF NOT EXISTS cohorts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  name        TEXT NOT NULL,   -- e.g. "2027"
  label       TEXT,            -- e.g. "Class of 2027"
  active      INTEGER DEFAULT 1,
  created_at  INTEGER DEFAULT (unixepoch()),
  UNIQUE(guild_id, name)
);

CREATE TABLE IF NOT EXISTS resources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  course_id   INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  cohort_id   INTEGER REFERENCES cohorts(id) ON DELETE SET NULL,
  filename    TEXT NOT NULL,
  filepath    TEXT NOT NULL,
  type        TEXT DEFAULT 'official',      -- official | student-resource
  status      TEXT DEFAULT 'active',        -- active | archived
  shareable   INTEGER DEFAULT 0,
  md5         TEXT,
  uploaded_by TEXT,
  uploaded_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  course_id   INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  url         TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  added_by    TEXT,
  added_at    INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  cohort_id    INTEGER REFERENCES cohorts(id) ON DELETE CASCADE,
  year_key     TEXT,              -- e.g. "default", "class-of-2027"
  year_label   TEXT,              -- e.g. "Class of 2027"
  title        TEXT NOT NULL,
  start_at     INTEGER NOT NULL,  -- unix timestamp (seconds)
  end_at       INTEGER,
  all_day      INTEGER DEFAULT 0,
  location     TEXT,
  description  TEXT,
  categories   TEXT,              -- JSON array
  source       TEXT DEFAULT 'manual',  -- manual | ics
  external_uid TEXT,
  created_at   INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_calendar_guild_start
  ON calendar_events(guild_id, start_at);

CREATE TABLE IF NOT EXISTS reminders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  event_id    INTEGER REFERENCES calendar_events(id) ON DELETE CASCADE,
  channel_id  TEXT,
  remind_at   INTEGER NOT NULL,  -- unix timestamp
  sent        INTEGER DEFAULT 0,
  created_at  INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS quiz_scores (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  week_key  TEXT NOT NULL,
  points    INTEGER DEFAULT 0,
  tag       TEXT,
  UNIQUE(guild_id, user_id, week_key)
);

CREATE TABLE IF NOT EXISTS flashcards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  course_id   INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  created_by  TEXT,
  front       TEXT NOT NULL,
  back        TEXT NOT NULL,
  created_at  INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS flashcard_progress (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  flashcard_id  INTEGER NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  next_review   INTEGER,
  interval      INTEGER DEFAULT 1,
  ease_factor   REAL DEFAULT 2.5,
  reviews       INTEGER DEFAULT 0,
  UNIQUE(flashcard_id, user_id)
);

CREATE TABLE IF NOT EXISTS groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  course_id  INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  label      TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'other',
  open       INTEGER NOT NULL DEFAULT 0,
  lifespan   TEXT NOT NULL DEFAULT 'permanent',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(guild_id, name)
);

CREATE TABLE IF NOT EXISTS group_members (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL,
  added_by TEXT,
  added_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(group_id, user_id)
);

CREATE TABLE IF NOT EXISTS calendar_subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  url          TEXT NOT NULL,
  scope        TEXT NOT NULL DEFAULT 'university',
  group_id     INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  year_key     TEXT,
  year_label   TEXT,
  last_fetched INTEGER,
  last_count   INTEGER DEFAULT 0,
  created_at   INTEGER DEFAULT (unixepoch()),
  UNIQUE(guild_id, url)
);

CREATE TABLE IF NOT EXISTS notification_channels (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  scope      TEXT NOT NULL,
  group_id   INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'digest',
  UNIQUE(guild_id, scope, group_id, type)
);

-- People CRM: students (linked to Discord) and faculty (contact-only)
CREATE TABLE IF NOT EXISTS people (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'student',  -- student | faculty
  name        TEXT NOT NULL,
  discord_id  TEXT,           -- student Discord user ID (NULL for faculty)
  email       TEXT,
  phone       TEXT,
  title       TEXT,           -- faculty: "Associate Professor of Anatomy"
  department  TEXT,           -- faculty: "Basic Sciences"
  specialty   TEXT,           -- faculty specialty or student interest
  cohort_id   INTEGER REFERENCES cohorts(id) ON DELETE SET NULL,
  year        TEXT,           -- e.g. "CO 2027"
  notes       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER DEFAULT (unixepoch()),
  updated_at  INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_people_guild_type
  ON people(guild_id, type, active);
CREATE INDEX IF NOT EXISTS idx_people_discord
  ON people(discord_id) WHERE discord_id IS NOT NULL;
