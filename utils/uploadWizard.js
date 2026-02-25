'use strict';

/**
 * Conversational upload wizard — triggered when a user @mentions the bot
 * with a file attachment. Guides them through tagging the file step by step,
 * then downloads, saves, and indexes it automatically.
 *
 * State is kept in memory (per userId+channelId). Entries expire after 10 min.
 */

const fs     = require('node:fs/promises');
const path   = require('node:path');
const crypto = require('node:crypto');
const { SUPPORTED_EXTENSIONS } = require('../rag/parsers');

// Lazy-require to avoid circular deps at module load time
function getIndexer() { return require('../rag/indexer'); }

const GUILDS_BASE = path.join(__dirname, '..', 'resources', 'guilds');

// ---------------------------------------------------------------------------
// In-memory state  key = `${userId}-${channelId}`
// ---------------------------------------------------------------------------

const pending = new Map();

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, s] of pending) {
    if (s.startedAt < cutoff) pending.delete(k);
  }
}, 60_000);

function stateKey(message) {
  return `${message.author.id}-${message.channelId}`;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseType(text) {
  const t = text.toLowerCase();
  if (/official|school|faculty|admin|handout|syllabus|schedule|lecture/.test(t)) return 'official';
  if (/student|notes?|study|guide|mine|personal|resource|shared/.test(t)) return 'student-resource';
  return null;
}

function parseSkip(text) {
  return /^(none|skip|no|n\/a|all|everyone|not sure)$/i.test(text.trim());
}

function parseConfirm(text) {
  const t = text.toLowerCase().trim();
  if (/^(yes|y|yeah|yep|yup|confirm|do it|upload|ok|okay|sure|go ahead)/.test(t)) return true;
  if (/^(no|n|nope|cancel|stop|abort|never|nah|quit)/.test(t)) return false;
  return null;
}

// ---------------------------------------------------------------------------
// Step: detect attachment and start wizard
// ---------------------------------------------------------------------------

async function startWizard(message, db) {
  const attachment = message.attachments.first();
  if (!attachment) return false;

  const ext = path.extname(attachment.name).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    await message.reply(
      `I can't index **${ext}** files. Supported types: ${[...SUPPORTED_EXTENSIONS].join(', ')}`
    );
    return true;
  }

  // Duplicate check
  const dupe = db.prepare(
    'SELECT id FROM resources WHERE guild_id = ? AND filename = ? AND status = "active"'
  ).get(message.guildId, attachment.name);

  if (dupe) {
    await message.reply(
      `**${attachment.name}** is already in the library. ` +
      `Use \`/resource archive file:${attachment.name}\` first if you want to replace it.`
    );
    return true;
  }

  pending.set(stateKey(message), {
    guildId:    message.guildId,
    attachment: { url: attachment.url, name: attachment.name },
    gathered:   { type: null, courseSlug: undefined, cohortName: undefined },
    step:       'type',
    startedAt:  Date.now()
  });

  await message.reply(
    `Got **${attachment.name}**! Let me help you log it properly.\n\n` +
    `First — is this an **official** school document *(syllabus, schedule, handout, lecture notes)* ` +
    `or a **student resource** *(personal notes, study guides)*?`
  );
  return true;
}

// ---------------------------------------------------------------------------
// Step handlers
// ---------------------------------------------------------------------------

async function stepType(message, db, state) {
  const type = parseType(message.content.replace(/<@!?\d+>/g, '').trim());
  if (!type) {
    await message.reply(
      `Hmm, I\'m not sure which category that falls into. ` +
      `Reply **official** (e.g. syllabus, handout) or **student resource** (e.g. notes, study guide).`
    );
    return;
  }

  state.gathered.type = type;
  state.step = 'course';

  const courses = db.prepare(
    'SELECT name, label FROM courses WHERE guild_id = ? ORDER BY label'
  ).all(state.guildId);

  const list = courses.length
    ? courses.map((c) => `• \`${c.name}\` — ${c.label}`).join('\n')
    : '_No courses set up yet._';

  await message.reply(
    `Got it — **${type}**.\n\n` +
    `Which course is this for?\n${list}\n\n` +
    `Reply with the course slug (e.g. \`anatomy\`) or \`none\` if it applies to everyone.`
  );
}

async function stepCourse(message, db, state) {
  const text = message.content.replace(/<@!?\d+>/g, '').trim();

  if (parseSkip(text)) {
    state.gathered.courseSlug = null;
  } else {
    const match = db.prepare(
      `SELECT name FROM courses
       WHERE guild_id = ? AND (LOWER(name) = LOWER(?) OR LOWER(label) LIKE LOWER(?))
       LIMIT 1`
    ).get(state.guildId, text, `%${text}%`);

    if (!match) {
      const courses = db.prepare('SELECT name FROM courses WHERE guild_id = ?').all(state.guildId);
      const opts    = courses.map((c) => `\`${c.name}\``).join(', ') || 'none yet';
      await message.reply(
        `I couldn't find a course matching **${text}**.\n` +
        `Available: ${opts}\n\nTry again, or type \`none\` to skip.`
      );
      return;
    }
    state.gathered.courseSlug = match.name;
  }

  state.step = 'cohort';

  const cohorts = db.prepare(
    'SELECT name, label FROM cohorts WHERE guild_id = ? ORDER BY name'
  ).all(state.guildId);

  const list = cohorts.length
    ? cohorts.map((c) => `• \`${c.name}\` — ${c.label || c.name}`).join('\n')
    : '_No cohorts set up yet._';

  await message.reply(
    `Is this for a specific cohort (class year)?\n${list}\n\n` +
    `Reply with the cohort (e.g. \`2027\`) or \`all\` for everyone.`
  );
}

async function stepCohort(message, db, state) {
  const text = message.content.replace(/<@!?\d+>/g, '').trim();

  if (parseSkip(text)) {
    state.gathered.cohortName = null;
  } else {
    const match = db.prepare(
      `SELECT name FROM cohorts
       WHERE guild_id = ? AND (LOWER(name) = LOWER(?) OR LOWER(label) LIKE LOWER(?))
       LIMIT 1`
    ).get(state.guildId, text, `%${text}%`);

    if (!match) {
      const cohorts = db.prepare('SELECT name FROM cohorts WHERE guild_id = ?').all(state.guildId);
      const opts    = cohorts.map((c) => `\`${c.name}\``).join(', ') || 'none yet';
      await message.reply(
        `Couldn't find cohort **${text}**.\n` +
        `Available: ${opts}\n\nTry again or type \`all\` for everyone.`
      );
      return;
    }
    state.gathered.cohortName = match.name;
  }

  // Build confirmation summary
  state.step = 'confirm';
  const { attachment, gathered, guildId } = state;

  const courseLabel = gathered.courseSlug
    ? db.prepare('SELECT label FROM courses WHERE guild_id = ? AND name = ?')
        .get(guildId, gathered.courseSlug)?.label || gathered.courseSlug
    : 'all courses';

  const cohortLabel = gathered.cohortName
    ? db.prepare('SELECT label FROM cohorts WHERE guild_id = ? AND name = ?')
        .get(guildId, gathered.cohortName)?.label || gathered.cohortName
    : 'all cohorts';

  await message.reply(
    `Here's what I've got — does this look right?\n\n` +
    `📄 **File:** \`${attachment.name}\`\n` +
    `📁 **Type:** ${gathered.type}\n` +
    `📚 **Course:** ${courseLabel}\n` +
    `🎓 **Cohort:** ${cohortLabel}\n\n` +
    `Reply **yes** to upload and index it, or **no** to cancel.`
  );
}

async function stepConfirm(message, db, state) {
  const text   = message.content.replace(/<@!?\d+>/g, '').trim();
  const answer = parseConfirm(text);
  const k      = stateKey(message);

  if (answer === null) {
    await message.reply('Just say **yes** to upload or **no** to cancel.');
    return;
  }

  pending.delete(k);

  if (!answer) {
    await message.reply('Upload cancelled. Nothing was saved.');
    return;
  }

  // ── Execute upload ────────────────────────────────────────────────────────
  await message.channel.sendTyping();
  const { attachment, gathered, guildId } = state;

  try {
    const courseRow = gathered.courseSlug
      ? db.prepare('SELECT id FROM courses WHERE guild_id = ? AND name = ?').get(guildId, gathered.courseSlug)
      : null;
    const cohortRow = gathered.cohortName
      ? db.prepare('SELECT id FROM cohorts WHERE guild_id = ? AND name = ?').get(guildId, gathered.cohortName)
      : null;

    // Download from Discord CDN
    const dir      = path.join(GUILDS_BASE, guildId);
    await fs.mkdir(dir, { recursive: true });
    const destPath = path.join(dir, attachment.name);

    const resp = await fetch(attachment.url);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    await fs.writeFile(destPath, Buffer.from(await resp.arrayBuffer()));

    const buf = await fs.readFile(destPath);
    const md5 = crypto.createHash('md5').update(buf).digest('hex');

    // DB insert
    const result = db.prepare(`
      INSERT INTO resources
        (guild_id, course_id, cohort_id, filename, filepath, type, status, shareable, md5, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)
    `).run(
      guildId,
      courseRow?.id ?? null,
      cohortRow?.id ?? null,
      attachment.name,
      destPath,
      gathered.type,
      md5,
      message.author.id
    );

    const resourceRow = db.prepare('SELECT * FROM resources WHERE id = ?').get(result.lastInsertRowid);

    // RAG index
    try {
      const { chunks } = await getIndexer().indexSingleResource(resourceRow, db);
      await message.reply(
        `✅ **${attachment.name}** uploaded and indexed into the knowledge base (${chunks} chunk${chunks !== 1 ? 's' : ''}).\n` +
        `Anyone can now ask me questions about it, or find it with \`/resource list\`.`
      );
    } catch (idxErr) {
      console.error('[UploadWizard] Indexing error:', idxErr.message);
      await message.reply(
        `✅ **${attachment.name}** saved to the library — but indexing failed. ` +
        `Make sure Ollama and ChromaDB are running, then restart the bot.`
      );
    }
  } catch (err) {
    console.error('[UploadWizard] Upload failed:', err);
    await message.reply(`Something went wrong: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Call from messageCreate. Returns true if the message was consumed by the
 * wizard (caller should not fall through to the normal chatbot flow).
 *
 * @param {import('discord.js').Message} message
 * @param {import('better-sqlite3').Database} db
 */
async function handleUploadMessage(message, db) {
  const k     = stateKey(message);
  const state = pending.get(k);

  // Cancel keyword always works, even mid-step
  const text = message.content.replace(/<@!?\d+>/g, '').trim().toLowerCase();
  if (state && /^(cancel|stop|quit|abort|nevermind|never mind)$/.test(text)) {
    pending.delete(k);
    await message.reply('Upload cancelled. Nothing was saved.');
    return true;
  }

  // Continue an in-progress wizard
  if (state) {
    if (state.step === 'type')    await stepType(message, db, state);
    if (state.step === 'course')  await stepCourse(message, db, state);
    if (state.step === 'cohort')  await stepCohort(message, db, state);
    if (state.step === 'confirm') await stepConfirm(message, db, state);
    return true;
  }

  // New message with file attached → start wizard
  if (message.attachments.size > 0) {
    return startWizard(message, db);
  }

  return false;
}

module.exports = { handleUploadMessage };
