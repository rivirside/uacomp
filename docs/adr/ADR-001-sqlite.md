# ADR-001 — SQLite over PostgreSQL
`ADR:001`

**Status:** Accepted
**Date:** 2024-02

## Context

The bot needs persistent relational storage for guilds, courses, cohorts, resources, links, events, quizzes, and groups. Options considered:

- **PostgreSQL** — full-featured, separate server process
- **MySQL / MariaDB** — similar story
- **SQLite** — embedded, single-file, no network

The bot runs as a single Node.js process on an M1 Mac Studio. There is no horizontal scaling requirement; all writes are serialized through one process.

## Decision

Use **SQLite via `better-sqlite3`** with WAL mode.

## Rationale

- **No separate server process** — one less thing to keep running (already managing Docker for ChromaDB and Ollama for the RAG layer).
- **Synchronous API** (`better-sqlite3`) — simpler code, no async/await waterfall for simple queries; aligns with Discord.js's event-loop model.
- **WAL mode** — allows concurrent reads while a write is in progress; suitable for our read-heavy workload.
- **Single file** — trivial to back up; `data/bot.db` can be copied anywhere.
- **`CREATE TABLE IF NOT EXISTS`** — schema is self-bootstrapping; no migration CLI needed for additive changes beyond named functions in `db/index.js`.

## Consequences

- Cannot trivially scale to multiple bot shards hitting the same DB. Acceptable for single-guild or small-multi-guild use.
- SQLite concurrent write throughput is lower than Postgres. Not a concern at Discord bot scales.
- We use `PRAGMA foreign_keys = ON` explicitly (SQLite disables it by default).

## References

- `db/schema.sql` — DDL
- `db/index.js` — `getDb()` singleton, WAL pragma, migrations
