'use strict';

require('dotenv').config();

const fs   = require('node:fs');
const path = require('node:path');
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder, REST, Routes
} = require('discord.js');

const { getDb }                = require('./db');
const { indexGuildResources }  = require('./rag/indexer');
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
      console.error(`[RAG] Indexing failed for guild ${gid}:`, err.message);
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
