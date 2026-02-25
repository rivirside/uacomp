# Architecture Overview

This document is a prose guide to how the system fits together. It is meant to be read whole.
For searchable references, use the files listed under **Grep-able references** below.

---

## Grep-able references

| What you want to find | File to grep | Pattern |
|---|---|---|
| A DB table definition | `db/schema.sql` | `CREATE TABLE <name>` |
| A constant value | `utils/constants.js` | `<CONSTANT_NAME>` |
| A slash command handler | `commands/<cmd>.js` | `if (sub === '<subcommand>')` |
| A command's option schema | `commands/<cmd>.js` | `.setName('<subcommand>')` |
| An ADR | `docs/adr/` | `ADR-00N` |
| A command's full options | `docs/COMMANDS.md` | `### /command subcommand` |
| A table's columns | `docs/SCHEMA.md` | `### <table_name>` |
| Phase completion status | `STATUS.md` | `STATUS:Phase<N>` |
| Knowledge base files | `data/knowledge/` | any `.md` filename |
| People / CRM table | `docs/SCHEMA.md` | `### people` |
| Seed script for a data set | `scripts/` | `seed-*.js` |

---

## Runtime topology

```
Discord Gateway
      │
      ▼
index.js          ← Client, REST, auto-loads commands/*.js, routes interactions
      │
      ├── commands/*.js     one file per slash command
      │     ├── ask.js      RAG Q&A
      │     ├── calendar.js scoped events
      │     ├── group.js    small group management
      │     ├── resource.js file uploads
      │     └── ...13 total commands
      │
      ├── db/
      │     ├── schema.sql  DDL, CREATE TABLE IF NOT EXISTS
      │     └── index.js    getDb() singleton, WAL mode, migrations
      │
      ├── rag/
      │     ├── parsers.js   parseFile() → raw text (PDF/DOCX/TXT/MD/CSV/ICS/JSON)
      │     ├── indexer.js   indexGuildResources(), indexGuildLinks(), indexSingleResource()
      │     └── query.js     queryRAG(question, guildId, opts), retrieveChunks(question, guildId, opts)
      │
      ├── utils/
      │     ├── constants.js single source of truth for magic values
      │     ├── calendarUtils.js  ICS parsing, resolveEventScope
      │     ├── channelUtils.js   Discord channel helpers
      │     └── subscriptionPoller.js  poll ICS URLs → upsert events
      │
      └── scheduler/
            └── index.js    node-cron jobs: reminders, digest, day-before, sub poll
```

**Data directories** (not committed to git, created at runtime or by seed scripts):
```
resources/guilds/<guildId>/  ← uploaded files (resources table)
data/knowledge/              ← curated markdown knowledge base (committed)
data/student-orgs.md         ← 79 UAComp student org descriptions (committed)
scripts/seed-orgs.js         ← seeds orgs into links table
scripts/seed-site-content.js ← copies data/knowledge/ files into resources table
chroma_data/                 ← ChromaDB volume (gitignored)
```

**External services** (must be running before `npm start`):
- ChromaDB — `docker compose up -d` → port 8001
- Ollama — `ollama serve` → port 11434
  - `nomic-embed-text` (embeddings), `llama3.2:3b` (chat)

---

## Data flow

### Startup RAG indexing
```
client.once('clientReady') → for each guild:
  indexGuildResources(guildId, db)
    → resources table WHERE status='active'
    → skip if MD5 unchanged
    → parseFile(filepath) → chunkText → embedText → ChromaDB upsert
  indexGuildLinks(guildId, db)
    → links table WHERE active=1
    → skip if ChromaDB already has chunks for link_id
    → fetch(url) → strip HTML, fall back to title+description
    → chunkText → embedText → ChromaDB upsert
```
`indexGuildLinks` exists because seed scripts (`seed-orgs.js`, `seed-site-content.js`)
insert rows directly into the DB, bypassing the `/link add` flow that would normally
trigger indexing.

---

### @mention chatbot
```
messageCreate → bot @mentioned?
  → Promise.all([
      channel.messages.fetch(last 20),         ← conversation context
      retrieveChunks(userText, guildId, {topK:3}) ← RAG lookup (no LLM call)
    ])
  → build system prompt: school context + RAG excerpts (if any)
  → build message array: system + history (user/assistant roles) + current msg
  → Ollama /api/chat (single call, non-streaming)
  → message.reply (truncated to 2000 chars)
```
`retrieveChunks` is a thin wrapper around ChromaDB query that returns raw text
chunks without calling the LLM — avoids a double Ollama call vs. using `queryRAG`.

---

### Document Q&A (`/ask`)
```
/ask question → deferReply
  → queryRAG(question, guildId, { course? })
      → Ollama /api/embed (nomic-embed-text)
      → ChromaDB query(top-5, filter: guild_id [+ course])
      → Ollama /api/chat (llama3.2:3b, context = chunks)
  → EmbedBuilder (answer + source buttons)
```

### ICS upload (`/calendar upload`)
```
/calendar upload file scope group
  → downloadCalendarAttachment(url)
  → parseIcsEvents(raw) → events[] with uid, categories
  → if scope='auto': resolveEventScope per event from CATEGORIES slugs
  → upsertEvents / upsertEventsAuto → calendar_events (scope, group_id, external_uid)
```

### Subscription poll (every 6 h)
```
cron 0 */6 * * * → pollSubscriptions(db, guildId)
  → for each calendar_subscriptions row:
      → downloadCalendarAttachment(url)
      → parseIcsEvents → events[]
      → if sub.scope='auto': resolveEventScope per event
      → INSERT OR REPLACE keyed on external_uid UNIQUE index
      → UPDATE last_fetched, last_count
```

### Personal schedule (`/calendar today|week|my`)
```
/calendar today → queryPersonalSchedule(db, guildId, userId, startSec, endSec, limit)
  SQL: calendar_events WHERE scope='university'
                         OR scope='cohort'
                         OR (scope='group' AND group_id IN user's groups)
  → EmbedBuilder of upcoming events
```

### Weekly digest (Mon 08:00 UTC)
```
cron 0 8 * * 1 → sendWeeklyDigests(client, db)
  → notification_channels WHERE type='digest'
  → for each: query calendar_events for scope in [now, +7d]
  → buildDigestEmbed → channel.send
```

### Day-before reminders (daily 18:00 UTC)
```
cron 0 18 * * * → sendDayBeforeReminders(client, db)
  → notification_channels WHERE type='reminder' AND scope != 'group' → channel.send
  → calendar_events WHERE scope='group' AND start tomorrow
      → for each group_id: DM each group_members.user_id (silent fail)
```

---

## Command module interface

Every file in `commands/` must export:

```js
module.exports = {
  data,             // SlashCommandBuilder — defines options and subcommands
  execute(interaction, db),          // required
  autocomplete?(interaction, db),    // optional — for setAutocomplete(true) options
  handleButton?(interaction, db)     // optional — return true if claimed, false otherwise
};
```

`index.js` auto-discovers all `commands/*.js` files at startup and registers them with Discord's REST API for the configured guild.

---

## DB migration pattern

All schema is in `db/schema.sql` with `CREATE TABLE IF NOT EXISTS`.
Additive column migrations (ALTER TABLE) live as named functions in `db/index.js` and are called from `getDb()` after `db.exec(schema)`. They are idempotent: they check `PRAGMA table_info` before altering.

Current migrations (in order):
1. `migrateQuizScores` — imports legacy `data/quiz.json`
2. `migrateCalendars` — imports legacy `data/calendars/*.json`
3. `migrateCalendarScope` — adds `scope`, `group_id` to `calendar_events`; creates indexes

---

## Architecture Decision Records

| ADR | Decision |
|---|---|
| [ADR-001](adr/ADR-001-sqlite.md) | SQLite over PostgreSQL |
| [ADR-002](adr/ADR-002-local-rag.md) | Local RAG with ChromaDB + Ollama |
| [ADR-003](adr/ADR-003-command-discovery.md) | Auto-discovery of command modules |
| [ADR-004](adr/ADR-004-scoped-calendar.md) | Three-tier calendar scoping |
| [ADR-005](adr/ADR-005-external-uid.md) | ICS UID for deduplication |
