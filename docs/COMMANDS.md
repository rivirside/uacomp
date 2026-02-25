# Command Reference

Grep-able: each command+subcommand has a unique `### /name subcommand` heading.
Use: `grep "### /" docs/COMMANDS.md` to list all subcommands.
Use: `grep "### /calendar" docs/COMMANDS.md` to find all calendar subcommands.

Permission legend: `[admin]` = requires ManageGuild. No tag = anyone.

---

## /announce
`CMD:announce`

### /announce send `[admin]`
Broadcast a message to a scoped audience.

| Option | Type | Required | Notes |
|---|---|---|---|
| `scope` | choice | yes | `university` (post to channel) \| `cohort` (post to channel) \| `group` (DM all members) |
| `message` | string | yes | Markdown supported |
| `channel` | channel | no | Required when scope is `university` or `cohort` |
| `group` | string | no | Autocomplete. Required when scope is `group` |
| `embed` | boolean | no | Post as embed? Default true |

University/cohort posts to the specified channel. Group scope DMs every member of the group; reports how many were reached vs. failed (DMs disabled).

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
| `title` | string | yes | Event title |
| `start` | string | yes | `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` |
| `scope` | choice | no | `university` (default) \| `cohort` \| `group` |
| `group` | string | no | Group slug (autocomplete). Required when `scope=group` |
| `year` | string | no | Calendar label (default: `default`) |
| `end` | string | no | Same format as start |
| `location` | string | no | |
| `description` | string | no | |
| `categories` | string | no | Comma-separated tags |
| `allday` | boolean | no | Default false |

### /calendar delete `[admin]`
Delete a single event. Autocomplete searches by title and shows date + scope to disambiguate.

| Option | Type | Required | Notes |
|---|---|---|---|
| `event` | string | yes | Autocomplete — type title to search, shows date and scope |

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

### /quiz add `[admin]`
Add a question to the question bank.

| Option | Type | Required | Notes |
|---|---|---|---|
| `question` | string | yes | Question text |
| `correct` | string | yes | Correct answer |
| `wrong1` | string | yes | Wrong answer |
| `wrong2` | string | yes | Wrong answer |
| `wrong3` | string | no | Optional 4th choice |
| `topic` | string | no | Topic tag (e.g. `cardiology`) |
| `explanation` | string | no | Shown to channel after answer |

Correct answer is shuffled into a random position among the wrong answers. Writes to `data/quiz-questions.json`.

### /quiz list
List questions in the bank.

| Option | Type | Required | Notes |
|---|---|---|---|
| `topic` | string | no | Filter by topic tag |

Shows up to 25 questions (truncated). Use `topic` to narrow results.

### /quiz remove `[admin]`
Remove a question from the bank.

| Option | Type | Required | Notes |
|---|---|---|---|
| `question` | string | yes | Autocomplete — search by question text |

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
