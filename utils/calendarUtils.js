'use strict';

const { MAX_CALENDAR_SIZE_BYTES, MAX_REDIRECTS } = require('./constants');
const http  = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

// ---------------------------------------------------------------------------
// ICS parsing
// ---------------------------------------------------------------------------

function unfoldIcsLines(content) {
  const lines = content.split(/\r?\n/);
  const unfolded = [];
  for (const line of lines) {
    if (!line.length) continue;
    if (/^[ \t]/.test(line) && unfolded.length) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function parseIcsLine(line) {
  const sepIdx = line.indexOf(':');
  if (sepIdx === -1) return null;
  const left  = line.slice(0, sepIdx);
  const value = line.slice(sepIdx + 1).trim();
  const [rawKey, ...rest] = left.split(';');
  const params = {};
  for (const seg of rest) {
    const [k, v] = seg.split('=');
    if (k && v) params[k.toUpperCase()] = v;
  }
  return { key: rawKey.toUpperCase(), params, value };
}

function parseIcsDate(value, params = {}) {
  if (!value) return { date: null, allDay: false };
  const trimmed = value.trim();
  const isDateOnly = params.VALUE === 'DATE' || /^\d{8}$/.test(trimmed);

  if (isDateOnly) {
    const y = trimmed.slice(0, 4), m = trimmed.slice(4, 6), d = trimmed.slice(6, 8);
    return { date: new Date(`${y}-${m}-${d}T00:00:00Z`), allDay: true };
  }

  const isUtc = trimmed.endsWith('Z');
  const norm  = trimmed.replace(/Z$/, '');
  const match = norm.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    return { date: new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${isUtc ? 'Z' : ''}`), allDay: false };
  }

  return { date: new Date(trimmed), allDay: false };
}

function parseIcsEvents(icsContent) {
  if (!icsContent) return [];
  const lines  = unfoldIcsLines(icsContent);
  const events = [];
  let cur = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur && cur.start) {
        try {
          events.push({
            title:       cur.summary || 'Untitled event',
            uid:         cur.uid || null,
            start:       cur.start.toISOString(),
            end:         cur.end ? cur.end.toISOString() : null,
            allDay:      Boolean(cur.allDay),
            location:    cur.location || null,
            description: cur.description || null,
            categories:  cur.categories || []
          });
        } catch { /* skip bad dates */ }
      }
      cur = null;
      continue;
    }

    if (!cur) continue;
    const parsed = parseIcsLine(line);
    if (!parsed) continue;

    switch (parsed.key) {
      case 'SUMMARY':     cur.summary = parsed.value; break;
      case 'LOCATION':    cur.location = parsed.value; break;
      case 'DESCRIPTION': cur.description = parsed.value.replace(/\\n/g, '\n'); break;
      case 'UID':         cur.uid = parsed.value; break;
      case 'CATEGORIES':
        cur.categories = parsed.value.split(',').map((s) => s.replace(/\\,/g, ',').trim()).filter(Boolean);
        break;
      case 'DTSTART': { const r = parseIcsDate(parsed.value, parsed.params); cur.start = r.date; cur.allDay = r.allDay; break; }
      case 'DTEND':   { const r = parseIcsDate(parsed.value, parsed.params); cur.end = r.date; break; }
    }
  }

  return events.sort((a, b) => new Date(a.start) - new Date(b.start));
}

// ---------------------------------------------------------------------------
// Filtering / formatting
// ---------------------------------------------------------------------------

function isUpcomingEvent(event, referenceDate) {
  if (!event.startDate || Number.isNaN(event.startDate)) return false;
  if (event.allDay && event.endDate) return event.endDate >= referenceDate;
  return event.startDate >= referenceDate;
}

function matchesFilter(event, filterTerm) {
  if (!filterTerm) return true;
  const norm = filterTerm.toLowerCase();
  if ([event.title, event.location, event.description].some(
    (v) => typeof v === 'string' && v.toLowerCase().includes(norm)
  )) return true;
  if (Array.isArray(event.categories)) {
    return event.categories.some((c) => c.toLowerCase().includes(norm));
  }
  return false;
}

function formatCalendarLine(event) {
  const start = event.startDate || new Date(event.start);
  const fmt = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: event.allDay ? undefined : 'short'
  });
  let line = `**${fmt.format(start)}** — ${event.title}`;
  if (event.location) line += ` _( ${event.location} )_`;
  if (event.description) {
    const trimmed = event.description.length > 180 ? `${event.description.slice(0, 177)}…` : event.description;
    line += `\n${trimmed}`;
  }
  return line;
}

function sanitizeYearKey(value) {
  const norm = (value || 'default').toLowerCase().trim();
  return norm.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
}

function parseManualDate(input, treatAsAllDay) {
  if (!input) return null;
  const trimmed = input.trim();
  if (treatAsAllDay && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return new Date(`${trimmed}T00:00:00Z`);
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseCategoriesInput(raw) {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// HTTP download
// ---------------------------------------------------------------------------

async function downloadCalendarAttachment(url) {
  if (typeof fetch === 'function') {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Unable to download calendar (HTTP ${resp.status}).`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > MAX_CALENDAR_SIZE_BYTES) throw new Error('Calendar file exceeds the 2 MB limit.');
    return buf.toString('utf8');
  }
  const buf = await fetchBufferViaHttp(url);
  return buf.toString('utf8');
}

function fetchBufferViaHttp(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) return reject(new Error('Too many redirects.'));
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error('Invalid URL.')); }

    const impl = parsed.protocol === 'http:' ? http : https;
    const req  = impl.get(parsed, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        fetchBufferViaHttp(new URL(res.headers.location, parsed).toString(), redirectCount + 1)
          .then(resolve).catch(reject);
        return;
      }
      if (res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_CALENDAR_SIZE_BYTES) { req.destroy(new Error('File too large.')); return; }
        chunks.push(chunk);
      });
      res.on('end',   () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

function slugify(str) {
  return (str || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Given a list of category strings from an ICS CATEGORIES field, resolve the
 * appropriate scope and optional group_id for calendar event storage.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} guildId
 * @param {string[]} categories
 * @returns {{ scope: string, groupId: number|null }}
 */
function resolveEventScope(db, guildId, categories) {
  if (!Array.isArray(categories) || !categories.length) {
    return { scope: 'university', groupId: null };
  }

  const slugs = categories.map(slugify).filter(Boolean);

  if (slugs.includes('university')) return { scope: 'university', groupId: null };
  if (slugs.includes('cohort'))     return { scope: 'cohort',     groupId: null };

  for (const slug of slugs) {
    const group = db.prepare(
      'SELECT id FROM groups WHERE guild_id = ? AND name = ? AND active = 1'
    ).get(guildId, slug);
    if (group) return { scope: 'group', groupId: group.id };
  }

  return { scope: 'university', groupId: null };
}

module.exports = {
  parseIcsEvents,
  isUpcomingEvent,
  matchesFilter,
  formatCalendarLine,
  sanitizeYearKey,
  parseManualDate,
  parseCategoriesInput,
  downloadCalendarAttachment,
  resolveEventScope
};
