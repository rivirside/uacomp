# Role & Channel Management Bot

This bot gives your Discord server a few quality-of-life tools:

- Self-assignable interest roles via `/role assign` and `/role remove`
- One-touch channel archiving/reopening for moderators
- Optional auto-role assignment and welcome announcements for new members

## Setup

1. Install dependencies (already done once in this repo): `npm install`
2. Copy `.env.example` to `.env` and fill in your Discord bot token, the application client ID, and the guild (server) ID you want to manage.
3. Edit `config.json` with the role and channel IDs that match your server:
   - `assignableRoles`: list of roles users can toggle themselves.
   - `defaultRoleId`: (optional) role automatically granted to new members.
   - `welcomeChannelId`: (optional) channel ID where welcome embeds are posted.
   - `archiveCategoryId`: category to move archived channels into.
   - `activeCategoryId`: default category to send channels back to when reopened if we cannot determine the original parent.
   - `quizSettings`: tune the quiz module. `pointsPerCorrect` controls scoring and `questionFile` points to the JSON bank (defaults to `data/quiz-questions.json`).
4. Start the bot: `npm start`

### Getting Discord IDs

Enable Developer Mode in Discord → Advanced settings, then right-click a role or channel and choose **Copy ID**. Paste the value into `config.json`.

## Commands

| Command | Description |
| --- | --- |
| `/role list` | Displays all roles users can self-assign. |
| `/role assign <role>` | Grants the selected role to the user invoking the command. |
| `/role remove <role>` | Removes the selected role. |
| `/channel archive [reason]` | Moves the current text channel into the archive category, locks posting, and tags the original category for later. Requires `Manage Channels`. |
| `/channel reopen [note]` | Unlocks the channel and returns it to its original category (or `activeCategoryId` fallback). Requires `Manage Channels`. |
| `/server setup` | Creates the recommended UAComp med-school server layout from `config.json`. Requires `Manage Server`. |
| `/server reset confirm:true` | Deletes the categories defined in `config.json`. Requires `Manage Server`; `confirm` must be `true`. |
| `/blocks activate|deactivate <block>` | Unlocks or hides a specific pre-clinical block channel without touching the rest of the server. Requires `Manage Channels`. |
| `/clerkships activate|deactivate <rotation>` | Same idea for clerkship rotations. Channels are auto-created from the config if they do not already exist. Requires `Manage Channels`. |
| `/calendar upload year:<label> file:<ics>` | Admin-only importer that saves an `.ics` file to `data/calendars/<label>.json` for later viewing. Requires `Manage Server`. |
| `/calendar add year:<label> title:<...> start:<...>` | Adds a single event directly to the stored calendar (optional end/location/description/categories/all-day). Requires `Manage Server`. |
| `/calendar next [year] [count] [filter]` | Displays the next few events for the stored calendar (defaults to 5 events, responds in-channel so you can share the embed). Use `filter` to match keywords like `exam` or `patient panel`. |
| `/tutor request subject:<...>` | Creates a private tutor ticket channel where only the requester, tutors, and staff can view the conversation. Includes Claim/Close buttons for tutors. |
| `/tutor close [note]` | Run inside a tutor ticket to lock it once tutoring is finished (students or tutors can use it). |
| `/quiz start [topic] [points]` | Posts a multiple-choice clinical question pulled from the question bank file. First correct answer earns points. |
| `/quiz leaderboard [user]` | Shows the current week’s standings (resets automatically on Mondays). Pass `user` to highlight a specific person’s rank; otherwise it highlights you. |

### Default category template

`config.json` now ships with placeholders for the medical school server layout so `/server setup` can scaffold a brand-new cohort quickly:

- `Blocks`: Channels for every pre-clinical block (Anatomy, CV/Heme, Pulm/Renal/ABG, etc.) with a dedicated Doctoring space.
- `Clerkships`: Channels for IM, Peds, General Surgery, OB/GYN, Psych, Neuro, FM, EM, and electives.
- `Medical School`: Mirrors the existing catch-all category (general chat, Step 1, PLM, CSS capstones, pathways, global health, etc.) so `/server setup` can provision what you already run manually.
- `Social`: Events, Sports, Foodies, Housing, Marketplace, and Memes.
- `Admin`: Announcements, Student Gov, Student Org Ads, Certificates of Distinction, and Bot Logs.

Use the `key` property on each category entry to script future commands (e.g., `/blocks activate neuro`) without having to rework the JSON layout.

### Calendar uploads

- Export your class schedule as an `.ics` file (Google Calendar, Outlook, etc.).
- Run `/calendar upload` with the file attached and a label such as `Class of 2027`. The bot parses each `VEVENT` and writes a JSON cache to `data/calendars/<label>.json`. (Add the `data/` folder to `.gitignore` if you commit this repo.)
- For quick edits (e.g., adding a patient panel that wasn’t on the master file), run `/calendar add` with `start`, optional `end`, and any tags. These go into the same JSON cache so `/calendar next` shows them immediately.
- Anyone can run `/calendar next` with the same label to post an embed of the next few events. Add `filter:"patient panel"` or `filter:"exam"` to narrow the list. All-day events stay visible until their `DTEND` date.

### Tutor ticket workflow

- Configure `tutorSettings` in `config.json` with the category ID for housing tickets, the tutor role IDs, optional staff role IDs (mods who should see every ticket), a channel prefix, and an optional log channel.
- Students run `/tutor request subject:"Cardio block help"` to spawn a locked channel (visible only to them + tutors + staff). The bot posts an embed with Claim/Close buttons and pings the tutor roles.
- Tutors click **Claim Ticket** (or run `/tutor close`) inside the channel. Claiming pings the student and DMs both parties; closing locks/stashes the channel for audit purposes and sends a summary to the log channel if configured.

### Clinical quiz + leaderboard

- Add your question bank to `data/quiz-questions.json`. Each entry includes `question`, multiple-choice answers, the correct index, a short explanation, `topics`, and a structured `tags` object (`phase`, `systems`, `disciplines`). The repo ships with 100+ tagged questions spanning every major system for both preclinical and clerkship phases.
- `/quiz start topic:cardiology` posts a random question (buttons for A/B/C/D). First correct click earns the default `quizSettings.pointsPerCorrect` (override per question with the `points` option).
- The bot writes weekly scores to `data/quiz.json` and automatically resets every Monday (based on ISO week). `/quiz leaderboard` shows the current rankings; unanswered weeks just display an empty-state message. Pass `user:@someone` to highlight an individual’s rank/points.

## Running on macOS

Use a process runner like `pm2`, `forever`, or a LaunchAgent to keep the bot alive on your Mac Studio. For quick testing, leaving `npm start` running in a Terminal tab works fine; the process will reconnect automatically if Discord briefly drops the gateway connection.
