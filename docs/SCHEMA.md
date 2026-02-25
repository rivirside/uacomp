# Database Schema Reference

Grep-able: each table has a unique `### <table_name>` heading.
Use: `grep "### " docs/SCHEMA.md` to list all tables.

The canonical DDL is in `db/schema.sql` — grep `CREATE TABLE <name>` there to see exact column types and constraints.
Additive migrations (ALTER TABLE) live in `db/index.js` as named functions.

---

### guilds
Registered Discord servers.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Discord guild snowflake |
| `name` | TEXT | |
| `created_at` | INTEGER | unixepoch |

---

### courses
Academic courses (slugged, per guild).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `guild_id` | TEXT | |
| `name` | TEXT | slug, e.g. `anatomy` — UNIQUE per guild |
| `label` | TEXT | display, e.g. `Gross Anatomy` |
| `year_level` | TEXT | MS1 \| MS2 \| MS3 \| MS4 |
| `created_at` | INTEGER | |

---

### cohorts
Class cohorts (one active per guild at a time).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `guild_id` | TEXT | |
| `name` | TEXT | e.g. `2027` — UNIQUE per guild |
| `label` | TEXT | e.g. `Class of 2027` |
| `active` | INTEGER | 1 = active |
| `created_at` | INTEGER | |

---

### groups
Small groups (CBI sections, anatomy labs, doctoring groups, etc.).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `guild_id` | TEXT | |
| `course_id` | INTEGER | FK → courses, nullable |
| `name` | TEXT | slug — UNIQUE per guild |
| `label` | TEXT | display name |
| `type` | TEXT | `cbi` \| `anatomy` \| `doctoring` \| `other` |
| `open` | INTEGER | 1 = self-joinable |
| `lifespan` | TEXT | `permanent` \| `course` \| `one-time` |
| `active` | INTEGER | 1 = active |
| `created_at` | INTEGER | |

---

### group_members
Membership join table.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `group_id` | INTEGER | FK → groups CASCADE |
| `user_id` | TEXT | Discord user snowflake |
| `added_by` | TEXT | user snowflake of admin (or self for self-join) |
| `added_at` | INTEGER | |

UNIQUE: `(group_id, user_id)`

---

### resources
Uploaded files per guild/course/cohort.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `guild_id` | TEXT | |
| `course_id` | INTEGER | FK → courses, nullable |
| `cohort_id` | INTEGER | FK → cohorts, nullable |
| `filename` | TEXT | |
| `filepath` | TEXT | path on disk |
| `type` | TEXT | `official` \| `student-resource` |
| `status` | TEXT | `active` \| `archived` |
| `shareable` | INTEGER | 1 = can share link |
| `md5` | TEXT | for change detection |
| `uploaded_by` | TEXT | user snowflake |
| `uploaded_at` | INTEGER | |

---

### links
External URLs (also indexed in RAG).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `guild_id` | TEXT | |
| `course_id` | INTEGER | FK → courses, nullable |
| `url` | TEXT | |
| `title` | TEXT | |
| `description` | TEXT | |
| `added_by` | TEXT | |
| `added_at` | INTEGER | |

---

### calendar_events
All calendar events, scoped by audience.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `guild_id` | TEXT | |
| `cohort_id` | INTEGER | FK → cohorts, legacy nullable |
| `year_key` | TEXT | slug, e.g. `class-of-2027` |
| `year_label` | TEXT | display label |
| `title` | TEXT | |
| `start_at` | INTEGER | unix timestamp (seconds) |
| `end_at` | INTEGER | nullable |
| `all_day` | INTEGER | 0/1 |
| `location` | TEXT | nullable |
| `description` | TEXT | nullable |
| `categories` | TEXT | JSON array of strings |
| `source` | TEXT | `manual` \| `ics` |
| `external_uid` | TEXT | from ICS UID field; UNIQUE per guild when non-null |
| `scope` | TEXT | `university` \| `cohort` \| `group` — added via migration |
| `group_id` | INTEGER | FK → groups; set when scope=`group` |
| `created_at` | INTEGER | |

Indexes:
- `idx_calendar_guild_start` on `(guild_id, start_at)`
- `idx_calendar_scope` on `(guild_id, scope, group_id, start_at)`
- `idx_calendar_uid` UNIQUE on `(guild_id, external_uid) WHERE external_uid IS NOT NULL`

---

### calendar_subscriptions
ICS URLs to poll on a schedule (every 6 h).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `guild_id` | TEXT | |
| `url` | TEXT | UNIQUE per guild |
| `scope` | TEXT | `university` \| `cohort` \| `group` \| `auto` |
| `group_id` | INTEGER | FK → groups, nullable |
| `year_key` | TEXT | label slug for imported events |
| `year_label` | TEXT | |
| `last_fetched` | INTEGER | unixepoch of last successful poll |
| `last_count` | INTEGER | events upserted on last poll |
| `created_at` | INTEGER | |

---

### notification_channels
Where to post digest/reminder messages.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `guild_id` | TEXT | |
| `scope` | TEXT | `university` \| `cohort` \| `group` |
| `group_id` | INTEGER | FK → groups, nullable |
| `channel_id` | TEXT | Discord channel snowflake |
| `type` | TEXT | `digest` (weekly) \| `reminder` (day-before) |

UNIQUE: `(guild_id, scope, group_id, type)`

Group-scoped reminders (`scope=group`) deliver via DM to each `group_members` user, ignoring `channel_id`.

---

### reminders
Per-event reminders for the legacy scheduler.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `guild_id` | TEXT | |
| `event_id` | INTEGER | FK → calendar_events CASCADE |
| `channel_id` | TEXT | Discord channel snowflake |
| `remind_at` | INTEGER | unix timestamp |
| `sent` | INTEGER | 0/1 |
| `created_at` | INTEGER | |

---

### quiz_scores
Weekly accumulated points per user.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `guild_id` | TEXT | |
| `user_id` | TEXT | |
| `week_key` | TEXT | ISO week string, e.g. `2025-W08` |
| `points` | INTEGER | |
| `tag` | TEXT | optional display tag |

UNIQUE: `(guild_id, user_id, week_key)`

---

### flashcards
Spaced-repetition cards.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `guild_id` | TEXT | |
| `course_id` | INTEGER | FK → courses, nullable |
| `created_by` | TEXT | user snowflake |
| `front` | TEXT | |
| `back` | TEXT | |
| `created_at` | INTEGER | |

---

### flashcard_progress
Per-user SM-2 review state.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `flashcard_id` | INTEGER | FK → flashcards CASCADE |
| `user_id` | TEXT | |
| `next_review` | INTEGER | unix timestamp |
| `interval` | INTEGER | days |
| `ease_factor` | REAL | SM-2 ease factor (default 2.5) |
| `reviews` | INTEGER | total review count |

UNIQUE: `(flashcard_id, user_id)`
