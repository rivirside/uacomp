'use strict';

const fs     = require('node:fs/promises');
const path   = require('node:path');
const crypto = require('node:crypto');
const { ChromaClient } = require('chromadb');
const { parseFile, SUPPORTED_EXTENSIONS } = require('./parsers');

const COLLECTION_NAME = 'medical_resources';
const OLLAMA_URL      = process.env.OLLAMA_URL  || 'http://localhost:11434';
const CHROMA_URL      = process.env.CHROMA_URL  || 'http://localhost:8000';
const EMBED_MODEL     = 'nomic-embed-text';
const CHUNK_WORDS     = 500;
const CHUNK_OVERLAP   = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getCollection() {
  const client = new ChromaClient({ path: CHROMA_URL });
  return client.getOrCreateCollection({ name: COLLECTION_NAME });
}

async function md5File(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('md5').update(buf).digest('hex');
}

function chunkText(text) {
  const words  = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let start    = 0;
  while (start < words.length) {
    const end = Math.min(start + CHUNK_WORDS, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end === words.length) break;
    start += CHUNK_WORDS - CHUNK_OVERLAP;
  }
  return chunks;
}

async function embedText(text) {
  const resp = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text })
  });
  if (!resp.ok) throw new Error(`Ollama embed failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return data.embeddings[0];
}

// ChromaDB metadata values must be string | number | boolean — never null.
function safeMeta(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v === null || v === undefined) out[k] = typeof v === 'number' ? 0 : '';
    else out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Index a single resource (file) — called after upload or at startup
// ---------------------------------------------------------------------------

/**
 * Index a single resource row into ChromaDB.
 * Looks up course/cohort names from DB by ID.
 *
 * @param {{ id: number, guild_id: string, filename: string, filepath: string,
 *           md5: string|null, course_id: number|null, cohort_id: number|null,
 *           type: string, status: string }} resourceRow
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<{ chunks: number }>}
 */
async function indexSingleResource(resourceRow, db) {
  const collection = await getCollection();

  // Look up course and cohort names
  const courseRow  = resourceRow.course_id
    ? db.prepare('SELECT name FROM courses WHERE id = ?').get(resourceRow.course_id)
    : null;
  const cohortRow  = resourceRow.cohort_id
    ? db.prepare('SELECT name FROM cohorts WHERE id = ?').get(resourceRow.cohort_id)
    : null;

  const courseName = courseRow?.name  || '';
  const cohortName = cohortRow?.name  || '';

  // Remove any existing chunks for this resource
  await collection.delete({ where: { resource_id: { $eq: resourceRow.id } } });

  // Parse and chunk
  const { text } = await parseFile(resourceRow.filepath);
  if (!text) {
    console.warn(`[RAG] No text extracted from ${resourceRow.filename} — skipping.`);
    return { chunks: 0 };
  }

  const chunks = chunkText(text);
  const ids        = [];
  const embeddings = [];
  const documents  = [];
  const metadatas  = [];

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedText(chunks[i]);
    ids.push(`res_${resourceRow.id}_${i}`);
    embeddings.push(embedding);
    documents.push(chunks[i]);
    metadatas.push(safeMeta({
      resource_id:  resourceRow.id,
      link_id:      0,
      source_type:  'file',
      guild_id:     resourceRow.guild_id,
      course:       courseName,
      cohort:       cohortName,
      type:         resourceRow.type,
      filename:     resourceRow.filename,
      url:          '',
      chunk_index:  i
    }));
  }

  await collection.upsert({ ids, embeddings, documents, metadatas });

  // Update MD5 in DB
  const currentMd5 = await md5File(resourceRow.filepath);
  db.prepare('UPDATE resources SET md5 = ? WHERE id = ?').run(currentMd5, resourceRow.id);

  return { chunks: chunks.length };
}

// ---------------------------------------------------------------------------
// Index all active resources for a guild — called at startup
// ---------------------------------------------------------------------------

/**
 * Index all active resources for a guild, skipping unchanged files.
 *
 * @param {string} guildId
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<{ indexed: number, skipped: number, removed: number }>}
 */
async function indexGuildResources(guildId, db) {
  const collection = await getCollection();

  const rows = db.prepare(`
    SELECT r.*, c.name AS course_name, co.name AS cohort_name
    FROM resources r
    LEFT JOIN courses c  ON r.course_id  = c.id
    LEFT JOIN cohorts co ON r.cohort_id  = co.id
    WHERE r.guild_id = ? AND r.status = 'active'
  `).all(guildId);

  let indexed = 0;
  let skipped = 0;
  let removed = 0;

  for (const row of rows) {
    // Check if file still exists
    let fileExists = true;
    try { await fs.access(row.filepath); } catch { fileExists = false; }

    if (!fileExists) {
      // File removed from disk — clean up DB and ChromaDB
      await collection.delete({ where: { resource_id: { $eq: row.id } } });
      db.prepare('UPDATE resources SET status = ? WHERE id = ?').run('archived', row.id);
      removed++;
      console.log(`[RAG] Archived missing file: ${row.filename}`);
      continue;
    }

    // Check MD5
    const currentMd5 = await md5File(row.filepath);
    if (row.md5 === currentMd5) { skipped++; continue; }

    // Re-index
    const courseName = row.course_name || '';
    const cohortName = row.cohort_name || '';

    await collection.delete({ where: { resource_id: { $eq: row.id } } });

    let text = '';
    try { const result = await parseFile(row.filepath); text = result.text; } catch (err) {
      console.warn(`[RAG] Failed to parse ${row.filename}: ${err.message}`);
      continue;
    }
    if (!text) { skipped++; continue; }

    const chunks     = chunkText(text);
    const ids        = [];
    const embeddings = [];
    const documents  = [];
    const metadatas  = [];

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await embedText(chunks[i]);
      ids.push(`res_${row.id}_${i}`);
      embeddings.push(embedding);
      documents.push(chunks[i]);
      metadatas.push(safeMeta({
        resource_id: row.id,
        link_id:     0,
        source_type: 'file',
        guild_id:    guildId,
        course:      courseName,
        cohort:      cohortName,
        type:        row.type,
        filename:    row.filename,
        url:         '',
        chunk_index: i
      }));
    }

    await collection.upsert({ ids, embeddings, documents, metadatas });
    db.prepare('UPDATE resources SET md5 = ? WHERE id = ?').run(currentMd5, row.id);
    indexed++;
    console.log(`[RAG] Indexed ${row.filename} (${chunks.length} chunks)`);
  }

  console.log(`[RAG] Guild ${guildId}: indexed ${indexed}, skipped ${skipped}, removed ${removed}`);
  return { indexed, skipped, removed };
}

// ---------------------------------------------------------------------------
// Remove a resource from ChromaDB
// ---------------------------------------------------------------------------

/**
 * Remove all ChromaDB chunks for a resource.
 *
 * @param {number} resourceId
 * @returns {Promise<void>}
 */
async function removeResourceFromIndex(resourceId) {
  const collection = await getCollection();
  await collection.delete({ where: { resource_id: { $eq: resourceId } } });
}

/**
 * Remove all ChromaDB chunks for a link.
 *
 * @param {number} linkId
 * @returns {Promise<void>}
 */
async function removeLinkFromIndex(linkId) {
  const collection = await getCollection();
  await collection.delete({ where: { link_id: { $eq: linkId } } });
}

// ---------------------------------------------------------------------------
// Index a link's page content
// ---------------------------------------------------------------------------

/**
 * Index a link's fetched page content into ChromaDB.
 *
 * @param {{ id: number, guild_id: string, url: string, title: string,
 *           description: string|null, course_id: number|null }} linkRow
 * @param {string} pageText
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<{ chunks: number }>}
 */
async function indexLink(linkRow, pageText, db) {
  if (!pageText || pageText.trim().length < 50) return { chunks: 0 };

  const collection = await getCollection();

  const courseRow  = linkRow.course_id
    ? db.prepare('SELECT name FROM courses WHERE id = ?').get(linkRow.course_id)
    : null;
  const courseName = courseRow?.name || '';

  // Remove old chunks for this link
  await collection.delete({ where: { link_id: { $eq: linkRow.id } } });

  const chunks     = chunkText(pageText);
  const ids        = [];
  const embeddings = [];
  const documents  = [];
  const metadatas  = [];

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedText(chunks[i]);
    ids.push(`link_${linkRow.id}_${i}`);
    embeddings.push(embedding);
    documents.push(chunks[i]);
    metadatas.push(safeMeta({
      resource_id: 0,
      link_id:     linkRow.id,
      source_type: 'link',
      guild_id:    linkRow.guild_id,
      course:      courseName,
      cohort:      '',
      type:        'link',
      filename:    linkRow.title,
      url:         linkRow.url,
      chunk_index: i
    }));
  }

  await collection.upsert({ ids, embeddings, documents, metadatas });
  return { chunks: chunks.length };
}

module.exports = { indexGuildResources, indexSingleResource, removeResourceFromIndex, indexLink, removeLinkFromIndex };
