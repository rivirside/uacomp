'use strict';

/**
 * Tool definitions and executors for the Fred agentic chatbot.
 * Each tool maps to a live DB query or Discord API call so Fred can
 * answer questions about server state and take actions on behalf of users.
 */

const { retrieveChunks } = require('../rag/query');

// ---------------------------------------------------------------------------
// Tool definitions (Ollama / OpenAI function-calling format)
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'join_group',
      description: 'Add the requesting user to an open group or club. Use when a user says they want to join a group, club, interest group, or organization.',
      parameters: {
        type: 'object',
        properties: {
          group_name: { type: 'string', description: 'The group slug or display name, e.g. "cbi-a" or "Global Health"' }
        },
        required: ['group_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'leave_group',
      description: 'Remove the requesting user from a group they are currently in.',
      parameters: {
        type: 'object',
        properties: {
          group_name: { type: 'string', description: 'The group slug or display name' }
        },
        required: ['group_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_groups',
      description: 'List all available groups in the server with member counts. Use when someone asks what groups or clubs exist.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Optional filter by group type: cbi, anatomy, doctoring, other' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'my_events',
      description: "Get the requesting user's upcoming calendar events.",
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'How many days ahead to look (default 7, max 30)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_people',
      description: 'Search the student and faculty directory by name, email, department, or specialty.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name, email, department, specialty, or title to search for' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_resources',
      description: 'List uploaded study resources and documents, optionally filtered by course.',
      parameters: {
        type: 'object',
        properties: {
          course: { type: 'string', description: 'Optional course name or slug to filter by, e.g. "anatomy"' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_server_stats',
      description: 'Get member counts for Discord roles and small groups. Use when asked how many people are in a role, group, or class year.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'answer_question',
      description: 'Search the school knowledge base to answer questions about policies, funding, contacts, student orgs, courses, scheduling, or any school-related topic.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to look up' }
        },
        required: ['question']
      }
    }
  }
];

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

async function executeTool(name, args, ctx) {
  switch (name) {
    case 'join_group':      return joinGroup(args.group_name, ctx);
    case 'leave_group':     return leaveGroup(args.group_name, ctx);
    case 'list_groups':     return listGroups(args.type, ctx);
    case 'my_events':       return myEvents(args.days, ctx);
    case 'search_people':   return searchPeople(args.query, ctx);
    case 'list_resources':  return listResources(args.course, ctx);
    case 'get_server_stats': return getServerStats(ctx);
    case 'answer_question': return answerQuestion(args.question, ctx);
    default: return `Unknown tool: ${name}`;
  }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function joinGroup(groupName, { message, db, guildId }) {
  const group = db.prepare(`
    SELECT id, name, label, open FROM groups
    WHERE guild_id = ? AND active = 1
      AND (LOWER(name) = LOWER(?) OR LOWER(label) LIKE LOWER(?))
    LIMIT 1
  `).get(guildId, groupName, `%${groupName}%`);

  if (!group) return `No group found matching "${groupName}". Try list_groups to see what's available.`;

  if (!group.open) {
    return `**${group.label}** isn't open for self-join — an admin needs to add you with \`/group add-member\`.`;
  }

  const existing = db.prepare(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(group.id, message.author.id);

  if (existing) return `You're already in **${group.label}**.`;

  db.prepare(
    'INSERT INTO group_members (group_id, user_id, added_by) VALUES (?, ?, ?)'
  ).run(group.id, message.author.id, 'fred');

  return `Done! You've been added to **${group.label}**.`;
}

async function leaveGroup(groupName, { message, db, guildId }) {
  const group = db.prepare(`
    SELECT g.id, g.label FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE g.guild_id = ? AND g.active = 1 AND gm.user_id = ?
      AND (LOWER(g.name) = LOWER(?) OR LOWER(g.label) LIKE LOWER(?))
    LIMIT 1
  `).get(guildId, message.author.id, groupName, `%${groupName}%`);

  if (!group) return `You don't appear to be in any group matching "${groupName}".`;

  db.prepare(
    'DELETE FROM group_members WHERE group_id = ? AND user_id = ?'
  ).run(group.id, message.author.id);

  return `You've been removed from **${group.label}**.`;
}

function listGroups(type, { db, guildId }) {
  let sql = `
    SELECT name, label, type, open,
      (SELECT COUNT(*) FROM group_members WHERE group_id = groups.id) AS cnt
    FROM groups WHERE guild_id = ? AND active = 1
  `;
  const params = [guildId];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  sql += ' ORDER BY type, label';

  const rows = db.prepare(sql).all(...params);
  if (!rows.length) return 'No groups found.';

  return rows.map((r) =>
    `• **${r.label}** [${r.type}] — ${r.cnt} member${r.cnt !== 1 ? 's' : ''}${r.open ? ' *(open to join)*' : ''}`
  ).join('\n');
}

function myEvents(days, { message, db, guildId }) {
  const d   = Math.min(Math.max(Number(days) || 7, 1), 30);
  const now = Math.floor(Date.now() / 1000);
  const end = now + d * 86400;

  const rows = db.prepare(`
    SELECT DISTINCT ce.title, ce.start_at, ce.location
    FROM calendar_events ce
    WHERE ce.guild_id = ? AND ce.start_at >= ? AND ce.start_at <= ?
      AND (
        ce.scope = 'university' OR ce.scope = 'cohort'
        OR (ce.scope = 'group' AND ce.group_id IN (
          SELECT gm.group_id FROM group_members gm
          JOIN groups g ON gm.group_id = g.id
          WHERE gm.user_id = ? AND g.guild_id = ? AND g.active = 1
        ))
      )
    ORDER BY ce.start_at ASC LIMIT 15
  `).all(guildId, now, end, message.author.id, guildId);

  if (!rows.length) return `No events in the next ${d} days.`;

  return rows.map((r) => {
    const dt = new Date(r.start_at * 1000).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    return `• **${r.title}** — ${dt}${r.location ? ` @ ${r.location}` : ''}`;
  }).join('\n');
}

function searchPeople(query, { db, guildId }) {
  const rows = db.prepare(`
    SELECT name, type, email, title, department, specialty
    FROM people
    WHERE guild_id = ? AND active = 1
      AND (name LIKE ? OR email LIKE ? OR department LIKE ? OR specialty LIKE ? OR title LIKE ?)
    LIMIT 8
  `).all(guildId, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);

  if (!rows.length) return `No one found matching "${query}".`;

  return rows.map((r) => {
    const parts = [`**${r.name}** (${r.type})`];
    if (r.title)      parts.push(r.title);
    if (r.department) parts.push(r.department);
    if (r.email)      parts.push(r.email);
    return parts.join(' — ');
  }).join('\n');
}

function listResources(course, { db, guildId }) {
  let sql = `
    SELECT r.filename, r.title, r.type, c.label AS course_label
    FROM resources r
    LEFT JOIN courses c ON r.course_id = c.id
    WHERE r.guild_id = ? AND r.status = 'active'
      AND r.type != 'guide'
  `;
  const params = [guildId];

  if (course) {
    sql += ' AND (LOWER(c.name) = LOWER(?) OR LOWER(c.label) LIKE LOWER(?))';
    params.push(course, `%${course}%`);
  }

  sql += ' ORDER BY r.type, r.filename LIMIT 20';

  const rows = db.prepare(sql).all(...params);
  if (!rows.length) return course ? `No resources found for "${course}".` : 'No resources uploaded yet.';

  return rows.map((r) =>
    `• **${r.title || r.filename}** (${r.type})${r.course_label ? ` — ${r.course_label}` : ''}`
  ).join('\n');
}

async function getServerStats({ db, guildId, client }) {
  const lines = [];

  // Role counts from Discord
  const guild = client.guilds.cache.get(guildId);
  if (guild) {
    try {
      await guild.members.fetch();
      const topRoles = guild.roles.cache
        .filter((r) => r.name !== '@everyone' && r.members.size > 0)
        .sort((a, b) => b.members.size - a.members.size)
        .first(15);

      if (topRoles.length) {
        lines.push('**Discord Roles:**');
        for (const r of topRoles) {
          lines.push(`• ${r.name}: ${r.members.size} member${r.members.size !== 1 ? 's' : ''}`);
        }
      }
    } catch {
      lines.push('(Role counts unavailable — GuildMembers intent may be needed)');
    }
  }

  // Group counts from DB
  const groups = db.prepare(`
    SELECT g.label, g.type,
      (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS cnt
    FROM groups g WHERE g.guild_id = ? AND g.active = 1
    ORDER BY g.type, g.label
  `).all(guildId);

  if (groups.length) {
    lines.push('\n**Groups:**');
    for (const g of groups) {
      lines.push(`• ${g.label} (${g.type}): ${g.cnt} member${g.cnt !== 1 ? 's' : ''}`);
    }
  }

  return lines.length ? lines.join('\n') : 'No stats available.';
}

async function answerQuestion(question, { guildId }) {
  try {
    const chunks = await retrieveChunks(question, guildId, { topK: 3 });
    if (!chunks.length) return 'No relevant information found in the knowledge base for that question.';
    return chunks
      .map((c) => `[Source: ${c.filename}]\n${c.text.slice(0, 800)}`)
      .join('\n\n---\n\n');
  } catch {
    return 'Knowledge base is currently unavailable.';
  }
}

module.exports = { TOOL_DEFINITIONS, executeTool };
