# ADR-005 — ICS UID for Deduplication
`ADR:005`

**Status:** Accepted
**Date:** 2025-02 (Phase 3)

## Context

ICS subscriptions are polled every 6 hours. On each poll we fetch all events from the URL. Without deduplication, every poll would create duplicate rows. Options:

- **Delete all + re-insert per year_key** — simple, but loses any manual edits; also wrong when one subscription covers multiple scopes (via `scope=auto`).
- **Hash each event** (title + start_at + end_at) as synthetic key — collision-prone; two events with the same title/time but different UIDs would collide.
- **ICS UID field** (`external_uid`) — the RFC 5545 UID property is required to be globally unique per event and stable across updates to the same event.

## Decision

Capture the `UID` field from each VEVENT into `event.uid` during parsing, store it in `calendar_events.external_uid`, and enforce a partial UNIQUE index:

```sql
CREATE UNIQUE INDEX idx_calendar_uid
  ON calendar_events(guild_id, external_uid)
  WHERE external_uid IS NOT NULL;
```

Use `INSERT OR REPLACE` for subscription-polled events. Events without a UID (manual adds, legacy imports) are never subject to this constraint.

## Rationale

- **RFC-correct** — UID is the standard key for ICS event identity. Updating an event's time or title in the source calendar preserves its UID, so `INSERT OR REPLACE` correctly updates the existing row.
- **Partial index** — only rows with a non-null `external_uid` participate in the uniqueness constraint, so manual events (`external_uid IS NULL`) are unaffected.
- **Per-guild scoping** — `(guild_id, external_uid)` prevents one server's subscription from colliding with another server's.

## Consequences

- If a source calendar reuses UIDs (non-RFC-compliant), events may be incorrectly overwritten. Acceptable trade-off; RFC-compliant sources are the norm.
- Manual events added via `/calendar add` have `external_uid = NULL` and are never overwritten by subscription polls.
- The `scope` column is part of the replaced row — if a subscription changes `scope=auto` resolution for an event (e.g., the CATEGORIES field changes), the row updates correctly on the next poll.

## References

- `utils/calendarUtils.js` — `parseIcsEvents()` — `case 'UID': cur.uid = parsed.value`
- `db/index.js` — `migrateCalendarScope()` — creates `idx_calendar_uid`
- `utils/subscriptionPoller.js` — `INSERT OR REPLACE` upsert
- `commands/calendar.js` — `upsertEventsAuto()` — same upsert for `scope=auto` uploads
- `docs/SCHEMA.md` — `### calendar_events` — `external_uid` column notes
