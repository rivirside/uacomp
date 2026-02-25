# Project Status

> Grep anchor: `STATUS:<phase>` — e.g. `grep "STATUS:Phase" STATUS.md`

## Phase 1 — Local RAG Pipeline ✅ COMPLETE
`STATUS:Phase1`

| Item | Status |
|---|---|
| ChromaDB via Docker (`docker-compose.yml`) | done |
| Ollama embedding (`nomic-embed-text`) + chat (`llama3.2:3b`) | done |
| File parsers: PDF, DOCX, TXT, MD, CSV, ICS, JSON | done |
| Hash-based change detection (`data/rag-manifest.json`) | done |
| Guild-scoped indexing on startup | done |
| `/ask question:<text> [course:<name>]` slash command | done |
| Source attribution (file downloads via button) | done |

Key files: `rag/parsers.js`, `rag/indexer.js`, `rag/query.js`, `commands/ask.js`

---

## Phase 2 — Modular Command Architecture ✅ COMPLETE
`STATUS:Phase2`

| Item | Status |
|---|---|
| SQLite DB via `better-sqlite3`, WAL mode | done |
| Schema migrations in `db/index.js` | done |
| Auto-discovery of `commands/*.js` modules | done |
| `/ask` — RAG Q&A with course filter | done |
| `/resource` — upload / list / get / archive / delete | done |
| `/course` — add / list / remove (admin) | done |
| `/cohort` — add / list / set-active / remove (admin) | done |
| `/link` — add / list / remove (with RAG indexing) | done |
| `/calendar` — upload / next / add | done |
| `/quiz` — start / leaderboard | done |
| `/tutor` — request / close (ticket system) | done |
| `/role` — assign / remove / list | done |
| `/channel` — archive / reopen | done |
| `/server` — setup / reset | done |
| `/blocks` — activate / deactivate | done |
| `/clerkships` — activate / deactivate | done |
| Scheduler: per-event reminders, weekly quiz reset | done |

Key files: `db/schema.sql`, `db/index.js`, `commands/`, `scheduler/index.js`

---

## Phase 3 — Groups, Scoped Calendar & Notifications ✅ COMPLETE
`STATUS:Phase3`

| Item | Status |
|---|---|
| DB tables: `groups`, `group_members`, `calendar_subscriptions`, `notification_channels` | done |
| `scope` + `group_id` columns on `calendar_events` | done |
| `/group` — create / list / info / join / leave / add-member / remove-member / roster / delete | done |
| `/calendar upload scope:<...> [group:<name>]` | done |
| `/calendar upload scope:auto` (CATEGORIES → scope resolution) | done |
| `/calendar today` / `week` / `my` — personal scoped schedule | done |
| `/calendar subscribe url:<...> scope:<...>` | done |
| `/calendar set-channel scope:<...> channel:<#ch> type:<digest\|reminder>` | done |
| `utils/subscriptionPoller.js` — poll ICS URLs every 6 h | done |
| Scheduler: weekly digest (Mon 08:00 UTC) | done |
| Scheduler: day-before reminders — channel for university/cohort, DM for group | done |
| `resolveEventScope` via ICS CATEGORIES slugs | done |
| ICS UID captured → `external_uid` for dedup | done |

Key files: `commands/group.js`, `commands/calendar.js`, `utils/subscriptionPoller.js`, `scheduler/index.js`

---

## Phase 3 Addendum — Calendar Quick Wins & Knowledge Base ✅ COMPLETE
`STATUS:Phase3b`

| Item | Status |
|---|---|
| `/calendar delete` — autocomplete by title, shows date+scope, hard-deletes | done |
| `/calendar add scope/group` — scoped single-event creation | done |
| `data/student-orgs.md` — 79 UAComp student interest groups with descriptions | done |
| `scripts/seed-orgs.js` — seeds orgs into `links` table for RAG indexing | done |
| `data/knowledge/` — 8 curated markdown files (funding, resources, MSG, CHIP, learning, org leader guide, wellness, contacts) | done |
| `scripts/seed-site-content.js` — seeds knowledge files as resources | done |
| `indexGuildLinks()` — startup indexer for seed-script links (fixes orgs not being searchable) | done |

Key files: `commands/calendar.js`, `data/knowledge/`, `scripts/`, `rag/indexer.js`

---

## Phase 4 — Announce & Quiz Bank ✅ COMPLETE
`STATUS:Phase4`

| Item | Status |
|---|---|
| `/announce send scope:university\|cohort channel:#ch message:text` — posts embed to channel | done |
| `/announce send scope:group group:<slug> message:text` — DMs all group members | done |
| `/quiz add` — admin adds question (correct + wrongs shuffled, optional topic/explanation) | done |
| `/quiz list [topic]` — browse question bank, up to 25 shown | done |
| `/quiz remove` — admin removes question via autocomplete | done |

Key files: `commands/announce.js`, `commands/quiz.js`, `docs/COMMANDS.md`

---

## Phase 5 — Planned
`STATUS:Phase5`

- `/ask` feedback loop (thumbs up/down → log good/bad answers)
- Onboarding flow (auto-role, welcome DM, cohort prompt on join)
- Points/attendance system
- Rate limiting / abuse prevention

---

## Architecture & Decisions

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for system overview.
See [`docs/adr/`](docs/adr/) for individual Architecture Decision Records.
See [`docs/COMMANDS.md`](docs/COMMANDS.md) for full command reference (grep-able).
See [`docs/SCHEMA.md`](docs/SCHEMA.md) for DB table reference (grep-able).
