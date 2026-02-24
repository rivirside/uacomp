'use strict';

const { ChromaClient } = require('chromadb');

const COLLECTION_NAME = 'medical_resources';
const OLLAMA_URL      = process.env.OLLAMA_URL  || 'http://localhost:11434';
const CHROMA_URL      = process.env.CHROMA_URL  || 'http://localhost:8000';
const EMBED_MODEL     = 'nomic-embed-text';
const CHAT_MODEL      = process.env.OLLAMA_MODEL || 'llama3.2:3b';
const TOP_K           = 5;

// Lazy singleton ChromaDB client
let _collection = null;
async function getCollection() {
  if (_collection) return _collection;
  const client = new ChromaClient({ path: CHROMA_URL });
  _collection  = await client.getOrCreateCollection({ name: COLLECTION_NAME });
  return _collection;
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

/**
 * Ask a RAG question, scoped to a guild and optionally a course.
 *
 * @param {string} question
 * @param {string} guildId
 * @param {{ course?: string, topK?: number }} [opts]
 * @returns {Promise<{ answer: string, sources: Array<{ filename: string, resourceId: number, url: string }> }>}
 */
async function queryRAG(question, guildId, opts = {}) {
  const { course, topK = TOP_K } = opts;

  // 1. Embed the question
  const queryEmbedding = await embedText(question);

  // 2. Build ChromaDB where clause
  const guildFilter = { guild_id: { $eq: guildId } };
  const where = course
    ? { $and: [guildFilter, { course: { $eq: course } }] }
    : guildFilter;

  // 3. Query ChromaDB — guard against empty collection
  const collection = await getCollection();

  let results;
  try {
    results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults:        topK,
      where,
      include:         ['documents', 'metadatas']
    });
  } catch (err) {
    // Collection may be empty or have fewer docs than topK
    if (err.message?.includes('no results') || err.message?.includes('empty')) {
      return {
        answer: "I don't have any indexed documents to answer from. Upload files with `/resource upload` first.",
        sources: []
      };
    }
    throw err;
  }

  const chunks = results.documents[0] || [];
  const metas  = results.metadatas[0]  || [];

  if (!chunks.length) {
    return {
      answer:  "I don't have any indexed documents to answer from. Upload files with `/resource upload` first.",
      sources: []
    };
  }

  // 4. Build context
  const context = chunks.map((chunk, i) => {
    const filename = metas[i]?.filename || 'unknown';
    return `[${filename}]\n${chunk}`;
  }).join('\n\n---\n\n');

  // 5. Build prompt
  const prompt = `You are a helpful assistant for a medical school Discord server.
Answer the question using only the context below.
If the answer is not in the context, say you don't have that information.

Context:
${context}

Question: ${question}`;

  // 6. Call Ollama chat (non-streaming)
  const chatResp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model:    CHAT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream:   false
    })
  });

  if (!chatResp.ok) throw new Error(`Ollama chat failed: ${chatResp.status} ${await chatResp.text()}`);

  const chatData = await chatResp.json();
  const answer   = chatData.message?.content?.trim() || 'No response from model.';

  // 7. Collect unique sources
  const seen    = new Set();
  const sources = [];
  for (const meta of metas) {
    const key = meta?.source_type === 'link' ? `link:${meta.link_id}` : `res:${meta.resource_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      filename:   meta?.filename   || 'unknown',
      resourceId: meta?.resource_id ?? 0,
      url:        meta?.url        || ''
    });
  }

  return { answer, sources };
}

module.exports = { queryRAG };
