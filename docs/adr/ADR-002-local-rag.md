# ADR-002 — Local RAG with ChromaDB + Ollama
`ADR:002`

**Status:** Accepted
**Date:** 2024-02

## Context

Students need to ask questions against uploaded medical school documents (syllabi, lecture slides exported as PDFs, ICS calendars). Options:

- **OpenAI Embeddings + GPT-4** — external API, per-token cost, student data leaves the institution.
- **Pinecone / Weaviate cloud** — managed vector DB, still external.
- **ChromaDB (local) + Ollama (local)** — runs entirely on the M1 Mac Studio already hosting the bot.

The machine has 32 GB unified memory and Metal GPU support; local inference is fast enough for a Discord bot (seconds, not minutes).

## Decision

Use **ChromaDB** (Docker, port 8001) as the vector store and **Ollama** (native) for both embeddings and chat inference.

- Embedding model: `nomic-embed-text` (768-dim, fast on Metal)
- Chat model: `llama3.2:3b` (≈2 GB, good instruction following)

## Rationale

- **Data privacy** — medical school student data never leaves the local network.
- **Zero cost** — no per-token charges.
- **Offline capable** — bot works without internet after initial model pulls.
- **ChromaDB JS client** (`chromadb@1.10.5`) — official client, stable REST API, persistent volume via Docker.
- **Ollama** — already installed on the host, Metal-accelerated, trivial model management.

## Consequences

- Requires Docker running and `ollama serve` before `npm start`. Documented in README.
- ChromaDB runs on port 8001 (not default 8000) due to Castopod conflict on the host.
- `chroma_data/` volume is gitignored — vector store is derived data, rebuilt from source files.
- Chunk IDs: `res_{resourceId}_{chunkIndex}` for files, `link_{linkId}_{chunkIndex}` for links.
- All queries filter by `{ guild_id: { $eq: guildId } }` to prevent cross-guild data leakage.

## References

- `docker-compose.yml` — ChromaDB service definition
- `rag/parsers.js` — `parseFile()` — text extraction per format
- `rag/indexer.js` — `indexGuildResources()`, chunking, embedding, upsert
- `rag/query.js` — `queryRAG()` — embed question → retrieve → generate
- `commands/ask.js` — `/ask` command
