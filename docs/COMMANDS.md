# Command Reference

Grep-able: each command+subcommand has a unique `### /name subcommand` heading.
Use: `grep "### /" docs/COMMANDS.md` to list all subcommands.
Use: `grep "### /calendar" docs/COMMANDS.md` to find all calendar subcommands.

Permission legend: `[admin]` = requires ManageGuild. No tag = anyone.

---

## /ask
`CMD:ask`

### /ask question
Ask a question answered by uploaded documents (RAG).

| Option | Type | Required | Notes |
|---|---|---|---|
| `question` | string | yes | Natural language question |
| `course` | string | no | Autocomplete — filter to one course's resources |

Response: ephemeral embed with answer + source file buttons. Deferred (LLM takes time).

---

## /calendar
`CMD:calendar`

### /calendar upload `[admin]`
Import an `.ics` file into the calendar.

| Option | Type | Required | Notes |
|---|---|---|---|
| `year` | string | yes | Label, e.g. "Class of 2027" |
| `file` | attachment | yes | `.ics` file ≤ 2 MB |
| `scope` | choice | no | `university` (default) \| `cohort` \| `group` \| `auto` |
| `group` | string | no | Group slug (autocomplete). Required when `scope=group` |

When `scope=auto` the CATEGORIES field of each VEVENT is slugified and matched against group names, `university`, or `cohort`.

### /calendar next
Show upcoming events (legacy/admin view, not scope-filtered).

| Option | Type | Required | Notes |
|---|---|---|---|
| `year` | string | no | Calendar label (default: `default`) |
| `count` | integer | no | 1–10, default 5 |
| `filter` | string | no | Keyword filter on title/location/description/categories |

### /calendar add `[admin]`
Add a single event manually.

| Option | Type | Required | Notes |
|---|---|---|---|
| `year` | string | yes | Calendar label |
| `title` | string | yes | Event title |
| `start` | string | yes | `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` |
| `end` | string | no | Same format as start |
| `location` | string | no | |
| `description` | string | no | |
| `categories` | string | no | Comma-separated tags |
| `allday` | boolean | no | Default false |

### /calendar today
Your personal events for today UTC. Scope-filtered (university + cohort + your groups).

### /calendar week
Your personal events for the next 7 days. Scope-filtered.

### /calendar my
Your upcoming events for the next 14 days. Scope-filtered.

| Option | Type | Required | Notes |
|---|---|---|---|
| `count` | integer | no | 1–25, default 10 |

### /calendar subscribe `[admin]`
Subscribe to a public ICS URL (polled every 6 hours automatically).

| Option | Type | Required | Notes |
|---|---|---|---|
| `url` | string | yes | Public ICS URL |
| `scope` | choice | yes | `university` \| `cohort` \| `group` \| `auto` |
| `group` | string | no | Group slug. Required when `scope=group` |
| `year` | string | no | Year label for imported events |

Runs an immediate poll on save.

### /calendar set-channel `[admin]`
Configure where digest/reminder messages are posted.

| Option | Type | Required | Notes |
|---|---|---|---|
| `scope` | choice | yes | `university` \| `cohort` \| `group` |
| `channel` | channel | yes | Target channel |
| `type` | choice | yes | `digest` (weekly Mon 08:00 UTC) \| `reminder` (daily 18:00 UTC for tomorrow's events) |
| `group` | string | no | Group slug. Required when `scope=group` |

Group-scoped reminders are sent as DMs, not to a channel.

---

## /channel
`CMD:channel`

### /channel archive `[admin]`
Move current channel to archive category, lock it, tag original parent.

| Option | Type | Required | Notes |
|---|---|---|---|
| `reason` | string | no | Audit note |

### /channel reopen `[admin]`
Unlock and return channel to its original category.

| Option | Type | Required | Notes |
|---|---|---|---|
| `note` | string | no | Announcement note |

---

## /cohort
`CMD:cohort`

### /cohort add `[admin]`
### /cohort list
### /cohort set-active `[admin]`
### /cohort remove `[admin]`

---

## /course
`CMD:course`

### /course add `[admin]`
### /course list
### /course remove `[admin]`

---

## /group
`CMD:group`

### /group create `[admin]`
Create a new small group.

| Option | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Slug, e.g. `cbi-a` |
| `label` | string | yes | Display name, e.g. `CBI Group A` |
| `type` | choice | yes | `cbi` \| `anatomy` \| `doctoring` \| `other` |
| `lifespan` | choice | no | `permanent` (default) \| `course` \| `one-time` |
| `open` | boolean | no | Allow self-join? Default false |

### /group list
List all active groups, grouped by type.

### /group info
Show metadata and member count for a group.

| Option | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Autocomplete |

### /group join
Join an open group (self-service).

| Option | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Autocomplete — only shows open groups |

### /group leave
Leave a group you are in.

| Option | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Autocomplete |

### /group add-member `[admin]`
### /group remove-member `[admin]`

Both take `name` (autocomplete) + `user` (user mention).

### /group roster `[admin]`
Show member display names. Fetches up to 25 members via `guild.members.fetch`.

| Option | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Autocomplete |

### /group delete `[admin]`
Delete a group and cascade-delete its members and notification entries.

---

## /link
`CMD:link`

### /link add `[admin]`
### /link list
### /link remove `[admin]`

---

## /quiz
`CMD:quiz`

### /quiz start
Post a random clinical question from the question bank.

| Option | Type | Required | Notes |
|---|---|---|---|
| `topic` | string | no | Filter by topic tag |
| `points` | integer | no | Override point value |

### /quiz leaderboard
Show current week's standings.

| Option | Type | Required | Notes |
|---|---|---|---|
| `user` | user | no | Highlight a specific user's rank |

---

## /resource
`CMD:resource`

### /resource upload `[admin]`
### /resource list
### /resource get
### /resource archive `[admin]`
### /resource delete `[admin]`

---

## /role
`CMD:role`

### /role list
### /role assign
### /role remove

---

## /server
`CMD:server`

### /server setup `[admin]`
### /server reset `[admin]`

---

## /tutor
`CMD:tutor`

### /tutor request
### /tutor close

---

## /blocks
`CMD:blocks`

### /blocks activate `[admin]`
### /blocks deactivate `[admin]`

---

## /clerkships
`CMD:clerkships`

### /clerkships activate `[admin]`
### /clerkships deactivate `[admin]`
