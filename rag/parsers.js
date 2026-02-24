'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Parse a file and return { text, metadata }.
 * @param {string} filePath  Absolute or relative path to the file.
 * @returns {Promise<{ text: string, metadata: { filename: string, filepath: string } }>}
 */
async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);
  const metadata = { filename, filepath: filePath };

  let text = '';

  switch (ext) {
    case '.txt':
    case '.md': {
      text = await fs.readFile(filePath, 'utf8');
      break;
    }

    case '.pdf': {
      const pdfParse = require('pdf-parse');
      const buffer = await fs.readFile(filePath);
      const data = await pdfParse(buffer);
      text = data.text;
      break;
    }

    case '.docx': {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      text = result.value;
      break;
    }

    case '.csv': {
      const raw = await fs.readFile(filePath, 'utf8');
      // Split rows, join cells with spaces, rows with newlines — readable plain text
      text = raw
        .split('\n')
        .map((row) =>
          row
            .split(',')
            .map((cell) => cell.trim().replace(/^"|"$/g, ''))
            .filter(Boolean)
            .join(' ')
        )
        .filter(Boolean)
        .join('\n');
      break;
    }

    case '.ics': {
      const raw = await fs.readFile(filePath, 'utf8');
      text = parseIcs(raw);
      break;
    }

    case '.json': {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      text = JSON.stringify(parsed, null, 2);
      break;
    }

    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }

  return { text: text.trim(), metadata };
}

/**
 * Extract human-readable text from an ICS file.
 * Collects SUMMARY, DESCRIPTION, DTSTART, LOCATION per VEVENT.
 */
function parseIcs(raw) {
  const lines = [];
  let inEvent = false;
  let current = {};

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      current = {};
      continue;
    }

    if (line === 'END:VEVENT') {
      inEvent = false;
      const parts = [];
      if (current.SUMMARY) parts.push(`Event: ${current.SUMMARY}`);
      if (current.DTSTART) parts.push(`Start: ${current.DTSTART}`);
      if (current.DTEND) parts.push(`End: ${current.DTEND}`);
      if (current.LOCATION) parts.push(`Location: ${current.LOCATION}`);
      if (current.DESCRIPTION) parts.push(`Description: ${current.DESCRIPTION}`);
      if (parts.length) lines.push(parts.join(' | '));
      continue;
    }

    if (!inEvent) continue;

    // ICS property lines look like "KEY;params:value" or "KEY:value"
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const keyPart = line.slice(0, colonIdx).split(';')[0].toUpperCase();
    const value = line.slice(colonIdx + 1).replace(/\\n/g, ' ').replace(/\\,/g, ',');

    if (['SUMMARY', 'DESCRIPTION', 'DTSTART', 'DTEND', 'LOCATION'].includes(keyPart)) {
      current[keyPart] = value;
    }
  }

  return lines.join('\n');
}

/**
 * Returns the supported file extensions.
 */
const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.docx', '.csv', '.ics', '.json']);

module.exports = { parseFile, SUPPORTED_EXTENSIONS };
