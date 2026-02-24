# UAComp Discord Bot

A Discord bot for medical school servers. Manages courses, cohorts, and a resource library with local AI-powered document Q&A (RAG), plus study tools (quiz, flashcards), tutor tickets, calendar events, and server scaffolding.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [First-time Setup](#first-time-setup)
- [Running the Bot](#running-the-bot)
- [Configuration Reference](#configuration-reference)
- [Commands](#commands)
  - [Resource Library](#resource-library)
  - [Document Q&A (Ask)](#document-qa-ask)
  - [Courses & Cohorts](#courses--cohorts)
  - [Links](#links)
  - [Calendar](#calendar)
  - [Quiz & Leaderboard](#quiz--leaderboard)
  - [Tutor Tickets](#tutor-tickets)
  - [Roles](#roles)
  - [Channels & Server](#channels--server)
- [Project Structure](#project-structure)

---

## Prerequisites

| Tool | Notes |
|---|---|
| **Node.js 18+** | Required by discord.js v14 |
| **Ollama** | Local LLM runner — [ollama.com](https://ollama.com) |
| **Docker Desktop** | For ChromaDB vector database |
| **Discord bot token** | [Discord Developer Portal](https://discord.com/developers/applications) |

---

## First-time Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/YOUR_ORG/uacomp.git
cd uacomp
npm install
```

### 2. Create your `.env` file

Copy the template below and fill in your values. **Never commit this file.**

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id
GUILD_ID=your_discord_server_id

OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
CHROMA_URL=http://localhost:8001
```

To get Discord IDs: enable **Developer Mode** in Discord (Settings → Advanced), then right-click any server, channel, or role and choose **Copy ID**.

### 3. Pull Ollama models

Open a terminal and run:

```bash
ollama pull nomic-embed-text   # embedding model (required for RAG)
ollama pull llama3.2:3b        # chat model (required for /ask)
```

### 4. Start ChromaDB

```bash
docker compose up -d
```

This starts ChromaDB on port 8001. Data is persisted in `chroma_data/` (gitignored). To stop it: `docker compose down`.

### 5. Edit `config.json`

Open `config.json` and set the IDs that match your Discord server:

| Key | Description |
|---|---|
| `assignableRoles` | Roles users can self-assign with `/role assign` |
| `defaultRoleId` | Role automatically given to new members (optional) |
| `welcomeChannelId` | Channel where welcome messages are posted (optional) |
| `archiveCategoryId` | Category channels are moved to when archived |
| `activeCategoryId` | Fallback category when reopening archived channels |
| `quizSettings.pointsPerCorrect` | Default points per correct quiz answer |
| `quizSettings.questionFile` | Path to question bank JSON |
| `tutorSettings` | Ticket category, tutor role IDs, log channel, etc. |

---

## Running the Bot

You need **three things running** before starting the bot:

**Window 1 — Ollama:**
```bash
ollama serve
```

**Window 2 — ChromaDB (if not already running):**
```bash
docker compose up -d
```

**Window 3 — Bot:**
```bash
npm start
```

On startup the bot will:
1. Register all slash commands with Discord
2. Index any new or changed resource files for each guild (logged to console)
3. Start the scheduler for reminders and weekly quiz resets

---

## Configuration Reference

### `.env` variables

| Variable | Default | Description |
|---|---|---|
| `DISCORD_TOKEN` | *(required)* | Bot token from the Developer Portal |
| `CLIENT_ID` | *(required)* | Application ID from the Developer Portal |
| `GUILD_ID` | *(required)* | Your server's ID |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_MODEL` | `llama3.2:3b` | Chat model used for `/ask` |
| `CHROMA_URL` | `http://localhost:8001` | ChromaDB base URL |

---

## Commands

### Resource Library

Admins upload files; everyone can browse and download. Files are stored in `resources/guilds/<guild_id>/` and indexed automatically for `/ask`.

| Command | Who | Description |
|---|---|---|
| `/resource upload file:<attachment>` | Admin | Upload a PDF, DOCX, TXT, MD, CSV, or ICS file. Optional `course`, `cohort`, `type` (official / student-resource), and `shareable` flag. |
| `/resource list` | Everyone | Browse indexed files. Filter by `course`, `status` (active / archived), or `type`. |
| `/resource get file:<name>` | Everyone | Download a file directly in Discord. Autocompletes by filename. |
| `/resource archive file:<name>` | Admin | Mark a file as archived — removes it from `/ask` search results but keeps it in the database. |
| `/resource delete file:<name>` | Admin | Permanently delete a file from disk, the database, and the search index. |

**File types supported:** `.pdf`, `.docx`, `.txt`, `.md`, `.csv`, `.ics`, `.json`

**Document types:**
- `official` — syllabi, schedules, handouts distributed by the school
- `student-resource` — notes, study guides created by students

**Shareable flag:** when checked on a student resource, it will remain visible to future cohorts even after the current cohort's resources are archived.

---

### Document Q&A (Ask)

Uses local AI (Ollama) to answer questions based on uploaded documents. No data leaves your machine.

| Command | Description |
|---|---|
| `/ask question:<text>` | Ask a question. The bot searches indexed documents and generates an answer with source citations. Optionally filter by `course`. |

Responses include:
- An embed with the AI-generated answer
- A footer listing which documents were used as sources
- Download buttons to retrieve the source files directly

**Requirements:** Ollama must be running and at least one document must be uploaded and indexed.

---

### Courses & Cohorts

These organize resources and scope RAG search results. All commands are admin-only.

**Courses** represent subjects (e.g., Anatomy, Cardiology):

| Command | Description |
|---|---|
| `/course add name:<slug> label:<display name>` | Add a course. `name` is a short slug (e.g. `anatomy`). Optional `year` (MS1–MS4). |
| `/course list` | List all courses in this server. |
| `/course remove id:<id>` | Remove a course (resources become untagged, not deleted). |

**Cohorts** represent class years (e.g., Class of 2027):

| Command | Description |
|---|---|
| `/cohort add name:<id> label:<display name>` | Add a cohort. `name` is a short identifier (e.g. `2027`). |
| `/cohort list` | List all cohorts and which is currently active. |
| `/cohort set-active name:<id>` | Mark a cohort as the current active one. |
| `/cohort remove id:<id>` | Remove a cohort. |

---

### Links

Curate a library of external URLs (course websites, reference tools, Sketchy, etc.) that are also indexed for `/ask`.

| Command | Description |
|---|---|
| `/link add url:<url> title:<text>` | Add a link. Optional `description` and `course` tag. The bot fetches the page content to include in the search index. |
| `/link list` | Browse all links. Filter by `course`. |
| `/link remove id:<id>` | Remove a link (admin only). Clears it from the search index. |

---

### Calendar

| Command | Who | Description |
|---|---|---|
| `/calendar upload year:<label> file:<ics>` | Admin | Import an `.ics` calendar export into the database. |
| `/calendar add year:<label> title:<text> start:<date>` | Admin | Manually add a single event. Optional `end`, `location`, `description`, `categories`, `all-day`. |
| `/calendar next` | Everyone | Show upcoming events. Optional `year`, `count` (default 5), and `filter` (keyword search, e.g. `exam`). |

**Date format for `/calendar add`:** `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`

---

### Quiz & Leaderboard

Clinical multiple-choice questions pulled from `data/quiz-questions.json`.

| Command | Description |
|---|---|
| `/quiz start [topic] [points]` | Post a random question. First correct button click earns points. |
| `/quiz leaderboard [user]` | Show this week's standings. Resets every Monday automatically. |

Questions in the bank include `question`, choices, the correct index, an explanation, `topics`, and structured `tags` (phase, system, discipline).

---

### Tutor Tickets

| Command | Description |
|---|---|
| `/tutor request subject:<text>` | Opens a private ticket channel visible only to the requester, tutors, and staff. Posts Claim/Close buttons. |
| `/tutor close [note]` | Close the ticket from inside the channel (tutors or the requester). |

Configure `tutorSettings` in `config.json` with your ticket category ID, tutor role IDs, optional staff role IDs, and an optional log channel.

---

### Roles

| Command | Description |
|---|---|
| `/role list` | Show all self-assignable roles. |
| `/role assign <role>` | Give yourself a role from the list. |
| `/role remove <role>` | Remove a role from yourself. |

Roles available for self-assignment are defined in `assignableRoles` in `config.json`.

---

### Channels & Server

| Command | Who | Description |
|---|---|---|
| `/channel archive [reason]` | Admin | Move the current channel to the archive category and lock it. |
| `/channel reopen [note]` | Admin | Unlock the channel and return it to its original category. |
| `/server setup` | Admin | Scaffold the full server layout (categories and channels) from `config.json`. |
| `/server reset confirm:true` | Admin | Delete the categories defined in `config.json`. Irreversible — requires `confirm:true`. |
| `/blocks activate <block>` | Admin | Unlock a pre-clinical block channel. |
| `/blocks deactivate <block>` | Admin | Hide a pre-clinical block channel. |
| `/clerkships activate <rotation>` | Admin | Unlock a clerkship channel (creates it if it doesn't exist). |
| `/clerkships deactivate <rotation>` | Admin | Hide a clerkship channel. |

---

## Project Structure

```
uacomp/
├── index.js              # Entry point — loads commands, registers slash commands, routes interactions
├── config.json           # Server structure, roles, quiz and tutor settings
├── docker-compose.yml    # ChromaDB service (port 8001)
├── .env                  # Secrets — never commit (see .gitignore)
│
├── commands/             # One file per slash command
│   ├── ask.js            # /ask — RAG document Q&A
│   ├── resource.js       # /resource — upload, list, get, archive, delete
│   ├── course.js         # /course — add, list, remove
│   ├── cohort.js         # /cohort — add, list, set-active, remove
│   ├── link.js           # /link — add, list, remove (with indexing)
│   ├── calendar.js       # /calendar — upload, add, next
│   ├── quiz.js           # /quiz — start, leaderboard
│   ├── tutor.js          # /tutor — request, close
│   ├── role.js           # /role — list, assign, remove
│   ├── channel.js        # /channel — archive, reopen
│   ├── server.js         # /server — setup, reset
│   ├── blocks.js         # /blocks — activate, deactivate
│   └── clerkships.js     # /clerkships — activate, deactivate
│
├── db/
│   ├── schema.sql        # SQLite table definitions
│   └── index.js          # getDb() singleton with WAL mode and migrations
│
├── rag/
│   ├── parsers.js        # parseFile() — extracts text from PDF, DOCX, TXT, MD, CSV, ICS, JSON
│   ├── indexer.js        # Chunk, embed, and upsert documents into ChromaDB
│   └── query.js          # queryRAG(question, guildId, opts) — retrieve + generate answer
│
├── scheduler/
│   └── index.js          # node-cron: fire reminders every minute, reset quiz weekly
│
├── utils/
│   ├── constants.js      # Shared string constants (button prefixes, markers)
│   ├── channelUtils.js   # Helpers for creating and resolving Discord channels
│   └── calendarUtils.js  # ICS parsing, event formatting
│
├── resources/
│   ├── README.md         # Drop files here (legacy flat mode)
│   └── guilds/           # Per-guild uploaded files (gitignored)
│
└── data/
    ├── quiz-questions.json   # Question bank
    └── quiz.json             # Legacy quiz scores (migrated to SQLite on first run)
```

---

## Keeping the Bot Running

For development, `npm start` in a terminal window is fine. For production on macOS, use `pm2`:

```bash
npm install -g pm2
pm2 start index.js --name uacomp-bot
pm2 save
pm2 startup   # follow the printed instructions to auto-start on login
```
