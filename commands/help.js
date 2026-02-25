'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// ---------------------------------------------------------------------------
// Introspect all other command modules at runtime so help is always in sync
// ---------------------------------------------------------------------------

function loadCommands() {
  return fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith('.js') && f !== 'help.js')
    .map((f) => {
      try { return require(path.join(__dirname, f)); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => a.data.name.localeCompare(b.data.name));
}

function getSubcommands(cmdJson) {
  return (cmdJson.options || []).filter(
    (o) => o.type === 1 /* SUB_COMMAND */ || o.type === 2 /* SUB_COMMAND_GROUP */
  );
}

function adminBadge(sub) {
  // Heuristic: description contains [admin]
  return sub.description?.includes('[admin]') ? ' `[admin]`' : '';
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all bot commands and features')
    .addStringOption((opt) =>
      opt.setName('command')
        .setDescription('Get detailed help for a specific command')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async execute(interaction) {
    const target  = interaction.options.getString('command');
    const allCmds = loadCommands();

    // -----------------------------------------------------------------------
    // Single-command detail view
    // -----------------------------------------------------------------------
    if (target) {
      const cmd = allCmds.find((c) => c.data.name === target);
      if (!cmd) {
        return interaction.reply({ content: `Unknown command: \`/${target}\``, ephemeral: true });
      }

      const json = cmd.data.toJSON();
      const subs = getSubcommands(json);

      const embed = new EmbedBuilder()
        .setTitle(`/${json.name}`)
        .setDescription(json.description)
        .setColor(0x5865f2);

      if (subs.length) {
        for (const sub of subs) {
          const opts = (sub.options || [])
            .map((o) => {
              const req = o.required ? '**required**' : 'optional';
              return `\`${o.name}\` *(${req})* — ${o.description}`;
            })
            .join('\n');
          embed.addFields({
            name:  `/${json.name} ${sub.name}${adminBadge(sub)}`,
            value: (sub.description || '—') + (opts ? '\n' + opts : '')
          });
        }
      } else {
        // Top-level options (no subcommands)
        const opts = (json.options || [])
          .map((o) => {
            const req = o.required ? '**required**' : 'optional';
            return `\`${o.name}\` *(${req})* — ${o.description}`;
          })
          .join('\n');
        if (opts) embed.addFields({ name: 'Options', value: opts });
      }

      embed.setFooter({ text: '[admin] = requires Manage Server permission' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // -----------------------------------------------------------------------
    // Full overview — one field per command
    // -----------------------------------------------------------------------
    const embed = new EmbedBuilder()
      .setTitle('Bot Commands')
      .setDescription(
        'Use `/help command:<name>` for detailed options on any command.\n' +
        'Mention me anywhere to chat — I have context from the conversation and the knowledge base.\n\n' +
        '`[admin]` = requires **Manage Server** permission.'
      )
      .setColor(0x5865f2);

    for (const cmd of allCmds) {
      const json = cmd.data.toJSON();
      const subs = getSubcommands(json);
      let value;

      if (subs.length) {
        value = subs
          .map((s) => `\`${s.name}\`${adminBadge(s)}`)
          .join('  ');
      } else {
        value = json.description;
      }

      embed.addFields({ name: `/${json.name}`, value: value || '—', inline: false });
    }

    // Chatbot feature isn't a slash command — add it manually
    embed.addFields({
      name:  '@mention',
      value: 'Chat with me directly — I use the last 20 messages as context plus a knowledge base search.',
      inline: false
    });

    embed.setFooter({ text: `${allCmds.length} commands loaded` });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },

  async autocomplete(interaction) {
    const term    = interaction.options.getFocused().toLowerCase();
    const allCmds = loadCommands();
    const matches = allCmds
      .filter((c) => c.data.name.includes(term))
      .map((c) => ({ name: `/${c.data.name} — ${c.data.description}`.slice(0, 100), value: c.data.name }));
    return interaction.respond(matches.slice(0, 25));
  }
};
