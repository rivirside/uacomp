'use strict';

require('dotenv').config();

const fs   = require('node:fs');
const path = require('node:path');
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder, REST, Routes
} = require('discord.js');

const { getDb }                = require('./db');
const { indexGuildResources, indexGuildLinks } = require('./rag/indexer');
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

const SYSTEM_PROMPT =
  'You are a helpful AI assistant for medical students at the University of ' +
  'Arizona College of Medicine – Phoenix. You have context from the recent ' +
  'Discord channel conversation shown below. Answer questions concisely and ' +
  'helpfully. If you are unsure about something school-specific, say so clearly.';

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;

  await message.channel.sendTyping();

  try {
    // Fetch recent channel history for context (before this message)
    const fetched  = await message.channel.messages.fetch({ limit: CHAT_HISTORY_LIMIT, before: message.id });
    const history  = [...fetched.values()].reverse(); // oldest → newest

    // Build Ollama message array
    const ollamaMessages = [{ role: 'system', content: SYSTEM_PROMPT }];

    for (const msg of history) {
      if (msg.author.bot && msg.author.id === client.user.id) {
        // Previous bot reply
        ollamaMessages.push({ role: 'assistant', content: msg.content });
      } else if (!msg.author.bot) {
        const name = msg.member?.displayName || msg.author.username;
        ollamaMessages.push({ role: 'user', content: `${name}: ${msg.content}` });
      }
    }

    // Add the triggering message (strip @mention tokens)
    const userText = message.content.replace(/<@!?\d+>/g, '').trim();
    const userName = message.member?.displayName || message.author.username;
    ollamaMessages.push({ role: 'user', content: `${userName}: ${userText}` });

    const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: CHAT_MODEL, messages: ollamaMessages, stream: false }),
      signal:  AbortSignal.timeout(60_000)
    });

    if (!resp.ok) throw new Error(`Ollama responded with ${resp.status}`);
    const data    = await resp.json();
    const reply   = data.message?.content?.trim() || "I couldn't generate a response.";

    // Discord message limit is 2000 chars
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
