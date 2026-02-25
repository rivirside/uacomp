# ADR-004 — Three-Tier Calendar Scoping
`ADR:004`

**Status:** Accepted
**Date:** 2025-02 (Phase 3)

## Context

The medical school has events at three audience levels:

1. **University-wide** — all students (grand rounds, school holidays, major exams)
2. **Cohort-wide** — one graduating class (MS1 block schedule, cohort-specific orientation)
3. **Group** — small assigned or self-formed groups (CBI sections, anatomy labs, doctoring groups)

Initially all events were unscoped. We needed to:
- Show users only the events relevant to them
- Support ICS upload/subscription per audience level
- Support scheduled digests and reminders per audience level

Options considered:
- **Separate tables per scope** — clean but duplicates schema; cross-scope queries become UNIONs.
- **`scope` column + `group_id` FK** — single table; personal view via one SQL query with a subquery.
- **Tags/categories only** — too loose; hard to enforce; CATEGORIES field already has a semantic meaning in ICS.

## Decision

Add `scope TEXT` (`university` | `cohort` | `group`) and `group_id INTEGER REFERENCES groups(id)` columns to `calendar_events` via migration.

Personal schedule query filters in one pass:

```sql
WHERE scope = 'university'
   OR scope = 'cohort'
   OR (scope = 'group' AND group_id IN (
     SELECT group_id FROM group_members
     JOIN groups ON group_members.group_id = groups.id
     WHERE user_id = ? AND guild_id = ? AND active = 1
   ))
```

ICS files with `scope=auto` resolve scope per-event via `resolveEventScope()`:
1. Slugify each CATEGORIES entry
2. If any slug = `university` → university scope
3. If any slug = `cohort` → cohort scope
4. If any slug matches a `groups.name` → group scope
5. Default: university

## Consequences

- Existing events (pre-migration) default to `scope='university'`, which is the safe fallback.
- The `external_uid` UNIQUE index (`idx_calendar_uid`) enables `INSERT OR REPLACE` dedup for subscription polling across scope changes.
- Group-scoped events in the scheduler deliver via **DM** (not channel) — the notification_channels table stores a channel_id that is ignored for group scope.
- `scope='auto'` is valid for uploads and subscriptions but never stored in `calendar_events` itself.

## References

- `db/schema.sql` — `groups`, `group_members`, `calendar_subscriptions`, `notification_channels` tables
- `db/index.js` — `migrateCalendarScope()`
- `utils/calendarUtils.js` — `resolveEventScope()`
- `commands/calendar.js` — `queryPersonalSchedule()`, `upsertEventsAuto()`
- `utils/subscriptionPoller.js` — per-subscription scope resolution
- `scheduler/index.js` — `sendWeeklyDigests()`, `sendDayBeforeReminders()`
- `docs/SCHEMA.md` — `### calendar_events`, `### notification_channels`
