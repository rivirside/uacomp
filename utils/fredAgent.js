'use strict';

/**
 * Agentic runner for Fred. Handles the tool-calling loop:
 *   1. Send messages + tool definitions to Ollama
 *   2. If the model calls a tool → execute it → feed result back
 *   3. Repeat until the model returns a plain text answer (max 4 iterations)
 */

const { TOOL_DEFINITIONS, executeTool } = require('./fredTools');

const OLLAMA_URL         = process.env.OLLAMA_URL   || 'http://localhost:11434';
const CHAT_MODEL         = process.env.OLLAMA_MODEL  || 'llama3.2:3b';
const CHAT_HISTORY_LIMIT = 10;
const MAX_ITERATIONS     = 4;

const SYSTEM_PROMPT =
  'Your name is Fred. You are a friendly, helpful AI assistant for medical students ' +
  'at the University of Arizona College of Medicine – Phoenix.\n\n' +

  'TOOLS: You have tools available — use them whenever a user wants to DO something ' +
  '(join/leave a group, check their calendar, look up a person) or asks about live ' +
  'server data (member counts, group sizes). For questions about school policies, ' +
  'funding, contacts, orgs, or documents, use answer_question to search the knowledge base. ' +
  'Do not make up information — use tools to get accurate data.\n\n' +

  'ACTIONS: You can join or remove users from open groups directly. For admin-only ' +
  'actions (creating groups, uploading files, managing courses), tell the user the ' +
  'exact slash command they need.\n\n' +

  'TONE: Friendly, concise, first-name basis. Format lists with bullet points. ' +
  'Keep responses under 1800 characters.';

/**
 * Run the Fred agentic loop for a Discord message.
 *
 * @param {import('discord.js').Message} message
 * @param {import('better-sqlite3').Database} db
 * @param {import('discord.js').Client} client
 * @returns {Promise<string>} Final reply text
 */
async function runAgent(message, db, client) {
  const userText = message.content.replace(/<@!?\d+>/g, '').trim();
  const userName = message.member?.displayName || message.author.username;
  const guildId  = message.guildId;

  // Build conversation history from channel
  const fetched  = await message.channel.messages.fetch({ limit: CHAT_HISTORY_LIMIT, before: message.id });
  const history  = [...fetched.values()].reverse();

  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

  for (const msg of history) {
    if (msg.author.bot && msg.author.id === client.user.id) {
      messages.push({ role: 'assistant', content: msg.content });
    } else if (!msg.author.bot) {
      const name = msg.member?.displayName || msg.author.username;
      messages.push({ role: 'user', content: `${name}: ${msg.content.replace(/<@!?\d+>/g, '').trim()}` });
    }
  }

  messages.push({ role: 'user', content: `${userName}: ${userText}` });

  const ctx = { message, db, guildId, client };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: CHAT_MODEL, messages, tools: TOOL_DEFINITIONS, stream: false }),
      signal:  AbortSignal.timeout(60_000)
    });

    if (!resp.ok) throw new Error(`Ollama responded with ${resp.status}`);

    const data         = await resp.json();
    const assistantMsg = data.message;

    // No tool calls → final answer
    if (!assistantMsg.tool_calls?.length) {
      return assistantMsg.content?.trim() || "I couldn't generate a response.";
    }

    // Execute each tool call and collect results
    messages.push(assistantMsg);

    for (const tc of assistantMsg.tool_calls) {
      const toolName = tc.function?.name;
      const toolArgs = tc.function?.arguments || {};

      let result;
      try {
        result = await executeTool(toolName, toolArgs, ctx);
      } catch (err) {
        result = `Tool error: ${err.message}`;
      }

      console.log(`[Fred] Tool called: ${toolName}(${JSON.stringify(toolArgs)}) → ${String(result).slice(0, 80)}...`);
      messages.push({ role: 'tool', content: String(result) });
    }
  }

  return "I wasn't able to complete that — please try again or use a slash command directly.";
}

module.exports = { runAgent };
