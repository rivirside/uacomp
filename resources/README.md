# Resources Directory

Drop any of the following file types here and they will be automatically indexed when the bot starts:

- **PDF** (`.pdf`) — syllabi, handouts, lecture slides
- **Word** (`.docx`) — documents, study guides
- **Text / Markdown** (`.txt`, `.md`) — notes, outlines
- **CSV** (`.csv`) — schedules, rosters, spreadsheet exports
- **Calendar** (`.ics`) — Outlook/Google Calendar exports
- **JSON** (`.json`) — structured data files

## How it works

1. When the bot starts, it scans this folder recursively.
2. Each file is hashed — unchanged files are skipped automatically.
3. New or modified files are chunked, embedded with `nomic-embed-text`, and stored in ChromaDB.
4. Members can query the indexed content in Discord with `/ask question:<your question>`.

## Notes

- Subdirectories are supported; you can organise files into folders.
- Removing a file from this directory will delete its chunks from the index on the next restart.
- The vector store lives in `chroma_data/` (gitignored) and persists across restarts.
