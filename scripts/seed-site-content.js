'use strict';

/**
 * Seed script: copy curated knowledge-base markdown files into the guild's
 * resources directory and register them in the DB so the RAG indexer picks
 * them up on next startup.
 *
 * Usage:
 *   GUILD_ID=<your-guild-id> node scripts/seed-site-content.js
 *
 * Re-running is safe — existing rows are updated in place (INSERT OR REPLACE).
 */

const fs   = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const GUILD_ID = process.env.GUILD_ID;
if (!GUILD_ID) {
  console.error('Error: GUILD_ID environment variable is required.');
  console.error('Usage: GUILD_ID=<id> node scripts/seed-site-content.js');
  process.exit(1);
}

// Resolve paths relative to repo root
const ROOT       = path.resolve(__dirname, '..');
const KNOWLEDGE  = path.join(ROOT, 'data', 'knowledge');
const DEST_DIR   = path.join(ROOT, 'resources', 'guilds', GUILD_ID);

// Ensure destination directory exists
fs.mkdirSync(DEST_DIR, { recursive: true });

// Load the DB
const { getDb } = require('../db');
const db = getDb();

// Files to seed — each corresponds to a .md file in data/knowledge/
const FILES = [
  {
    filename:    'ig-funding-information.md',
    title:       'IG Funding Information',
    description: 'How to request funding for Interest Group events: forms, step-by-step process, deadlines, vendor coordination, and finance subcommittee rules.',
    type:        'guide',
  },
  {
    filename:    'student-resources.md',
    title:       'Student Resources',
    description: 'Directory of student resources: academic portals, wellness, financial aid, library, absence forms, credentialing, and administrative contacts.',
    type:        'guide',
  },
  {
    filename:    'medical-student-government.md',
    title:       'Medical Student Government (MSG)',
    description: 'MSG overview, executive board roster, curriculum committee representatives, honor code committee members, GPSC reps, and class representatives.',
    type:        'guide',
  },
  {
    filename:    'chip.md',
    title:       'Community Health Initiative – Phoenix (CHIP)',
    description: 'CHIP service learning program: clinical care, health education, and mentoring for underserved populations. Leadership and event submission links.',
    type:        'guide',
  },
  {
    filename:    'learning-specialists.md',
    title:       'Student Development & Learning Specialists',
    description: 'Learning strategy consultations, STEP prep support, peer tutoring, wellness programming, and how to schedule appointments with learning specialists.',
    type:        'guide',
  },
];

let seeded = 0;

for (const meta of FILES) {
  const src  = path.join(KNOWLEDGE, meta.filename);
  const dest = path.join(DEST_DIR, meta.filename);

  if (!fs.existsSync(src)) {
    console.warn(`Warning: source file not found — ${src}`);
    continue;
  }

  // Copy file to guild resources directory
  fs.copyFileSync(src, dest);

  // Compute MD5 so the indexer knows it needs indexing (null = force re-index)
  const buf = fs.readFileSync(dest);
  const md5 = crypto.createHash('md5').update(buf).digest('hex');

  // Upsert into resources table
  // Using INSERT OR REPLACE keyed on (guild_id, filename) via the UNIQUE
  // constraint. If no UNIQUE constraint exists, INSERT OR IGNORE + UPDATE.
  const existing = db.prepare(
    'SELECT id FROM resources WHERE guild_id = ? AND filename = ?'
  ).get(GUILD_ID, meta.filename);

  if (existing) {
    db.prepare(`
      UPDATE resources
      SET filepath = ?, title = ?, description = ?, type = ?, md5 = NULL, status = 'active'
      WHERE id = ?
    `).run(dest, meta.title, meta.description, meta.type, existing.id);
    console.log(`Updated: ${meta.filename}`);
  } else {
    db.prepare(`
      INSERT INTO resources (guild_id, filename, filepath, title, description, type, status, md5)
      VALUES (?, ?, ?, ?, ?, ?, 'active', NULL)
    `).run(GUILD_ID, meta.filename, dest, meta.title, meta.description, meta.type);
    console.log(`Inserted: ${meta.filename}`);
  }

  seeded++;
}

console.log(`\nDone. ${seeded} knowledge files seeded for guild ${GUILD_ID}.`);
console.log('Restart the bot to trigger RAG indexing of these files.');
