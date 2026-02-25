# ADR-003 — Auto-discovery of Command Modules
`ADR:003`

**Status:** Accepted
**Date:** 2024-02

## Context

The bot started as a single `index.js` monolith with all command handlers inline. As the command count grew past 10, the file became unwieldy. Options:

- **Centralized registry** — one file lists all commands; must be updated when adding a command.
- **Auto-discovery** — `index.js` reads `commands/*.js` at startup; adding a file is enough.

## Decision

Auto-discover all `*.js` files in `commands/` at startup. Each file must export a standard interface.

```js
// index.js (simplified)
for (const file of fs.readdirSync('./commands').filter(f => f.endsWith('.js'))) {
  const cmd = require(`./commands/${file}`);
  commands.set(cmd.data.name, cmd);
  commandData.push(cmd.data.toJSON());
}
```

### Required export shape

```js
module.exports = {
  data,                            // SlashCommandBuilder
  execute(interaction, db),        // required
  autocomplete?(interaction, db),  // optional
  handleButton?(interaction, db)   // optional — return true if claimed
};
```

## Rationale

- **Low friction** — adding a command = creating one file. No registry to update.
- **Isolation** — each command file is independently readable and testable.
- **Button routing** — `index.js` iterates all commands calling `handleButton` until one returns `true`; commands own their own button ID namespaces.
- **Autocomplete routing** — dispatched by `interaction.commandName` — no extra wiring needed.

## Consequences

- All commands are registered to a single guild (configured in `.env`). Not suitable for global commands without changing `registerCommands()`.
- Command files must not crash on `require()` — any init errors will prevent the bot from starting.
- File names are arbitrary; the Discord command name comes from `data.name`.

## References

- `index.js:30–37` — discovery loop
- `index.js:119–153` — interaction routing
- `utils/constants.js` — shared constants available to all commands
