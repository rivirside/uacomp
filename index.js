'use strict';

require('dotenv').config();

const fs   = require('node:fs');
const path = require('node:path');
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder, REST, Routes
} = require('discord.js');

const { getDb }                = require('./db');
const { indexGuildResources, indexGuildLinks } = require('./rag/indexer');
const { retrieveChunks }       = require('./rag/query');
const { startScheduler }       = require('./scheduler');
const config             = require('./config.json');

const {
  DISCORD_TOKEN: token,
  CLIENT_ID:     applicationId,
  GUILD_ID:      guildId
} = process.env;

if (!token || !applicationId || !guildId) {
  throw new Error('DISCORD_TOKEN, CLIENT_ID, and GUILD_ID must be set in your .env file.');
}

// ---------------------------------------------------------------------------
// Load command modules from ./commands/
// ---------------------------------------------------------------------------

const commands     = new Map();  // name -> module
const commandData  = [];

for (const file of fs.readdirSync(path.join(__dirname, 'commands')).filter((f) => f.endsWith('.js'))) {
  const cmd = require(`./commands/${file}`);
  commands.set(cmd.data.name, cmd);
  commandData.push(cmd.data.toJSON());
}

// ---------------------------------------------------------------------------
// Discord client
// ---------------------------------------------------------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.GuildMember, Partials.Channel, Partials.Message]
});

const rest = new REST({ version: '10' }).setToken(token);

async function registerCommands() {
  await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: commandData });
}

// ---------------------------------------------------------------------------
// Ready
// ---------------------------------------------------------------------------

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const db = getDb();

  try {
    await registerCommands();
    console.log('Slash commands registered.');
  } catch (err) {
    console.error('Unable to register slash commands:', err);
  }

  for (const [gid] of client.guilds.cache) {
    try {
      await indexGuildResources(gid, db);
    } catch (err) {
      console.error(`[RAG] Resource indexing failed for guild ${gid}:`, err.message);
    }
    try {
      await indexGuildLinks(gid, db);
    } catch (err) {
      console.error(`[RAG] Link indexing failed for guild ${gid}:`, err.message);
    }
  }

  startScheduler(client, db);
});

// ---------------------------------------------------------------------------
// Member join
// ---------------------------------------------------------------------------

client.on('guildMemberAdd', async (member) => {
  try {
    if (config.defaultRoleId) {
      await member.roles.add(config.defaultRoleId, 'Auto assigned default role');
    }

    if (config.welcomeChannelId) {
      const channel = await member.client.channels.fetch(config.welcomeChannelId);
      if (channel?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('Welcome!')
          .setDescription(`Say hello to ${member}!\nPick some interests with \`/role assign\`.`)
          .setColor(0x5865f2)
          .setTimestamp(new Date());
        await channel.send({ embeds: [embed] });
      }
    }
  } catch (err) {
    console.error('Error handling new member:', err);
  }
});

// ---------------------------------------------------------------------------
// Chat — respond when @mentioned, using recent channel history as context
// ---------------------------------------------------------------------------

const OLLAMA_URL  = process.env.OLLAMA_URL  || 'http://localhost:11434';
const CHAT_MODEL  = process.env.OLLAMA_MODEL || 'llama3.2:3b';
const CHAT_HISTORY_LIMIT = 20;

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;

  await message.channel.sendTyping();

  // Strip @mention tokens to get the plain question
  const userText = message.content.replace(/<@!?\d+>/g, '').trim();
  const userName = message.member?.displayName || message.author.username;
  const guildId  = message.guildId;

  try {
    // Fetch channel history and RAG chunks in parallel
    const [fetched, ragChunks] = await Promise.all([
      message.channel.messages.fetch({ limit: CHAT_HISTORY_LIMIT, before: message.id }),
      userText ? retrieveChunks(userText, guildId, { topK: 3 }) : Promise.resolve([])
    ]);

    const history = [...fetched.values()].reverse(); // oldest → newest

    // Build system prompt — inject RAG chunks if found
    let systemContent =
      'Your name is Fred. You are a friendly, helpful AI assistant for medical students ' +
      'at the University of Arizona College of Medicine – Phoenix.\n\n' +

      'WIZARD BEHAVIOR: When a user wants to DO something (upload a file, reserve a room, ' +
      'request funding, add an event, send an announcement, etc.), do NOT dump all the ' +
      'instructions at once. Instead, ask one or two clarifying questions at a time to ' +
      'gather the information you need, then present the exact command or steps they should ' +
      'take — ready to copy and run. Keep the conversation natural and short. Once you have ' +
      'enough info, give them the precise `/command option:value` string they need.\n\n' +

      'TONE: Friendly, concise, first-name basis. Sign off with the exact command or next ' +
      'step clearly formatted in a code block so it is easy to copy.\n\n' +

      'YOUR SLASH COMMANDS:\n' +
      '/ask — RAG Q&A against uploaded documents and the knowledge base\n' +
      '/announce — admin broadcast to university, cohort, or group (DMs members)\n' +
      '/calendar — upload/add/delete events; today/week/my for personal schedule; subscribe to ICS URLs\n' +
      '/channel — archive or reopen channels\n' +
      '/cohort — manage student cohorts\n' +
      '/course — manage courses\n' +
      '/group — create/manage small groups (CBI, anatomy, doctoring, etc.); join/leave open groups\n' +
      '/help — show all commands; use /help command:<name> for details on any command\n' +
      '/link — add/list/remove URLs (indexed into knowledge base)\n' +
      '/people — student and faculty directory; search/info/add/edit/remove\n' +
      '/quiz — post a clinical quiz question; leaderboard; add/list/remove questions\n' +
      '/resource — upload/list/get/archive/delete files (indexed into knowledge base)\n' +
      '/role — assign/remove/list Discord roles\n' +
      '/server — setup/reset server configuration\n' +
      '/tutor — request or close a tutoring ticket\n' +
      '/blocks and /clerkships — activate/deactivate curriculum phases\n' +
      '@mention Fred to chat — searches the knowledge base and uses recent channel messages as context.';

    if (ragChunks.length) {
      const knowledgeBlock = ragChunks
        .map((c) => `[${c.filename}]\n${c.text}`)
        .join('\n\n---\n\n');
      systemContent +=
        '\n\nYou also have access to the following relevant knowledge base excerpts — ' +
        'use them to answer school-specific questions:\n\n' + knowledgeBlock;
    }

    // Build Ollama message array: system + channel history + current message
    const ollamaMessages = [{ role: 'system', content: systemContent }];

    for (const msg of history) {
      if (msg.author.bot && msg.author.id === client.user.id) {
        ollamaMessages.push({ role: 'assistant', content: msg.content });
      } else if (!msg.author.bot) {
        const name = msg.member?.displayName || msg.author.username;
        ollamaMessages.push({ role: 'user', content: `${name}: ${msg.content}` });
      }
    }

    ollamaMessages.push({ role: 'user', content: `${userName}: ${userText}` });

    const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: CHAT_MODEL, messages: ollamaMessages, stream: false }),
      signal:  AbortSignal.timeout(60_000)
    });

    if (!resp.ok) throw new Error(`Ollama responded with ${resp.status}`);
    const data  = await resp.json();
    const reply = data.message?.content?.trim() || "I couldn't generate a response.";

    await message.reply(reply.slice(0, 2000));
  } catch (err) {
    console.error('[Chat]', err.message);
    await message.reply('Sorry, I couldn\'t respond right now — make sure Ollama is running.').catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

client.on('interactionCreate', async (interaction) => {
  const db = getDb();

  try {
    // Autocomplete
    if (interaction.isAutocomplete()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd?.autocomplete) await cmd.autocomplete(interaction, db);
      return;
    }

    // Slash commands
    if (interaction.isChatInputCommand()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd) await cmd.execute(interaction, db);
      return;
    }

    // Buttons — try each command's handleButton until one claims it
    if (interaction.isButton()) {
      for (const cmd of commands.values()) {
        if (cmd.handleButton) {
          const handled = await cmd.handleButton(interaction, db);
          if (handled) return;
        }
      }
      return;
    }
  } catch (err) {
    console.error('Error handling interaction:', err);
    const payload = { content: 'Something went wrong. Please try again.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

client.login(token);
