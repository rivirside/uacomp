'use strict';

/**
 * Auto-seeds the built-in knowledge-base markdown files for a guild on
 * startup. Safe to call every time — existing DB rows are left alone; only
 * missing ones are inserted. Files are copied to resources/guilds/<guildId>/
 * so the RAG indexer finds them on the same startup pass.
 */

const fs   = require('node:fs');
const path = require('node:path');

const ROOT       = path.join(__dirname, '..');
const KNOWLEDGE  = path.join(ROOT, 'data', 'knowledge');
const DATA_DIR   = path.join(ROOT, 'data');
const GUILDS_BASE = path.join(ROOT, 'resources', 'guilds');

// All files that should be available to RAG for every guild
const KNOWLEDGE_FILES = [
  {
    filename:    'ig-funding-information.md',
    dir:         KNOWLEDGE,
    title:       'IG Funding Information',
    description: 'How to request funding for Interest Group events: forms, step-by-step process, deadlines, vendor coordination, and finance subcommittee rules.',
    type:        'guide',
  },
  {
    filename:    'student-resources.md',
    dir:         KNOWLEDGE,
    title:       'Student Resources',
    description: 'Directory of student resources: academic portals, wellness, financial aid, library, absence forms, credentialing, and administrative contacts.',
    type:        'guide',
  },
  {
    filename:    'medical-student-government.md',
    dir:         KNOWLEDGE,
    title:       'Medical Student Government (MSG)',
    description: 'MSG overview, executive board roster, curriculum committee representatives, honor code committee members, GPSC reps, and class representatives.',
    type:        'guide',
  },
  {
    filename:    'chip.md',
    dir:         KNOWLEDGE,
    title:       'Community Health Initiative – Phoenix (CHIP)',
    description: 'CHIP service learning program: clinical care, health education, and mentoring for underserved populations. Leadership and event submission links.',
    type:        'guide',
  },
  {
    filename:    'learning-specialists.md',
    dir:         KNOWLEDGE,
    title:       'Student Development & Learning Specialists',
    description: 'Learning strategy consultations, STEP prep support, peer tutoring, wellness programming, and how to schedule appointments with learning specialists.',
    type:        'guide',
  },
  {
    filename:    'org-leader-resources.md',
    dir:         KNOWLEDGE,
    title:       'Student Org Leader Resources',
    description: 'How to reserve a room, submit events to the calendar, request food/supplies funding, plan a sim center event, complete the student event checklist, and register a club.',
    type:        'guide',
  },
  {
    filename:    'wellness.md',
    dir:         KNOWLEDGE,
    title:       'Wellness Program',
    description: 'Wellness program overview: four pillars, mentorship structure (physician, resident, peer mentors), program goals, and wellness resources.',
    type:        'guide',
  },
  {
    filename:    'contacts.md',
    dir:         KNOWLEDGE,
    title:       'Key Contacts',
    description: 'Quick-reference contact list: MSG executive board, event planning contacts, sim center, Student Affairs, and who to contact for funding, rooms, calendar, CHIP, tutoring, and more.',
    type:        'guide',
  },
  {
    filename:    'command-workflows.md',
    dir:         KNOWLEDGE,
    title:       'Bot Command Workflows',
    description: 'Step-by-step guides for common tasks: uploading resources, reserving rooms, requesting event funding, adding calendar events, planning sim events, sending announcements, and more.',
    type:        'guide',
  },
  {
    filename:    'student-orgs.md',
    dir:         DATA_DIR,
    title:       'UAComp Student Interest Groups & Organizations',
    description: 'Full directory of all 79 UAComp student interest groups with descriptions, organized by category: Medical Specialty, Community & Advocacy, Research, Faith & Culture, Wellness, and more.',
    type:        'guide',
  },
];

/**
 * Ensure all knowledge-base files are registered in the DB for this guild.
 * Copies missing files into resources/guilds/<guildId>/ and inserts DB rows
 * with md5=NULL so the RAG indexer knows to index them.
 *
 * @param {string} guildId
 * @param {import('better-sqlite3').Database} db
 * @returns {{ seeded: number, skipped: number }}
 */
function seedGuildKnowledge(guildId, db) {
  const destDir = path.join(GUILDS_BASE, guildId);
  fs.mkdirSync(destDir, { recursive: true });

  let seeded = 0;
  let skipped = 0;

  for (const meta of KNOWLEDGE_FILES) {
    const src  = path.join(meta.dir, meta.filename);
    const dest = path.join(destDir, meta.filename);

    if (!fs.existsSync(src)) {
      console.warn(`[KnowledgeSeed] Source not found, skipping: ${src}`);
      continue;
    }

    const existing = db.prepare(
      'SELECT id FROM resources WHERE guild_id = ? AND filename = ?'
    ).get(guildId, meta.filename);

    if (existing) {
      skipped++;
      continue;
    }

    fs.copyFileSync(src, dest);

    db.prepare(`
      INSERT INTO resources (guild_id, filename, filepath, title, description, type, status, md5)
      VALUES (?, ?, ?, ?, ?, ?, 'active', NULL)
    `).run(guildId, meta.filename, dest, meta.title, meta.description, meta.type);

    seeded++;
  }

  if (seeded > 0) {
    console.log(`[KnowledgeSeed] Guild ${guildId}: seeded ${seeded} knowledge file(s), skipped ${skipped} already registered.`);
  }

  return { seeded, skipped };
}

module.exports = { seedGuildKnowledge };
