# UAComp Medical School Discord Bot

A Discord bot for a medical school server — RAG-powered document Q&A, scoped calendars, group management, quiz/leaderboard, tutor tickets, and server scaffolding.

For detailed documentation, see:

- **[STATUS.md](STATUS.md)** — feature completion by phase (grep `STATUS:Phase<N>`)
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — system overview, data flow, module map
- **[docs/COMMANDS.md](docs/COMMANDS.md)** — full command reference (grep `### /command`)
- **[docs/SCHEMA.md](docs/SCHEMA.md)** — DB table reference (grep `### table_name`)
- **[docs/adr/](docs/adr/)** — Architecture Decision Records

---

## Quick start

### Prerequisites

| Service | How to start |
|---|---|
| ChromaDB | `docker compose up -d` |
| Ollama | `ollama serve` (separate terminal) |
| Models | `ollama pull nomic-embed-text && ollama pull llama3.2:3b` |

### Setup

1. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`
2. Edit `config.json` with your server's channel/role IDs (see comments inside)
3. `npm install`
4. `npm start`

The bot registers all slash commands on startup, indexes any files in `resources/guilds/<guildId>/`, and starts the scheduler.

---

## Commands overview

| Category | Commands |
|---|---|
| Q&A | `/ask` |
| Calendar | `/calendar upload \| next \| add \| today \| week \| my \| subscribe \| set-channel` |
| Groups | `/group create \| list \| info \| join \| leave \| add-member \| remove-member \| roster \| delete` |
| Resources | `/resource upload \| list \| get \| archive \| delete` |
| Courses | `/course add \| list \| remove` |
| Cohorts | `/cohort add \| list \| set-active \| remove` |
| Links | `/link add \| list \| remove` |
| Quiz | `/quiz start \| leaderboard` |
| Tutor | `/tutor request \| close` |
| Roles | `/role assign \| remove \| list` |
| Channels | `/channel archive \| reopen` |
| Server | `/server setup \| reset` |
| Curriculum | `/blocks activate \| deactivate`, `/clerkships activate \| deactivate` |

See **[docs/COMMANDS.md](docs/COMMANDS.md)** for full option details.

---

## Project structure

```
index.js              ← entry point — loads commands, routes interactions
commands/             ← one file per slash command (auto-discovered)
db/
  schema.sql          ← DDL — grep CREATE TABLE to find table definitions
  index.js            ← getDb() singleton, WAL mode, additive migrations
rag/
  parsers.js          ← parseFile() for PDF/DOCX/TXT/MD/CSV/ICS/JSON
  indexer.js          ← indexGuildResources(), chunk + embed + upsert to ChromaDB
  query.js            ← queryRAG() — embed → retrieve → generate
utils/
  constants.js        ← single source of truth for magic values
  calendarUtils.js    ← ICS parsing, resolveEventScope()
  channelUtils.js     ← Discord channel helpers
  subscriptionPoller.js ← poll ICS URLs → upsert calendar_events
scheduler/
  index.js            ← node-cron jobs: reminders, weekly digest, day-before DMs
resources/
  guilds/<guildId>/   ← uploaded files stored here
chroma_data/          ← ChromaDB persistent volume (gitignored)
data/
  bot.db              ← SQLite database (gitignored)
docs/
  ARCHITECTURE.md     ← system overview and data flows (read whole)
  COMMANDS.md         ← command reference (grep-able)
  SCHEMA.md           ← DB table reference (grep-able)
  adr/                ← Architecture Decision Records
```

---

## Running in production (macOS)

```sh
# Keep the bot alive with pm2
npm install -g pm2
pm2 start index.js --name uacomp-bot
pm2 save
pm2 startup
```

Docker and Ollama need to auto-start separately (Docker Desktop has a login item; Ollama installs a menu bar agent by default).
