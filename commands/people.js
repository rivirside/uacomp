'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function buildPersonEmbed(person, groups) {
  const isStudent = person.type === 'student';
  const color     = isStudent ? 0x5865f2 : 0x57f287;

  const embed = new EmbedBuilder()
    .setTitle(person.name)
    .setColor(color)
    .addFields({ name: 'Type', value: isStudent ? 'Student' : 'Faculty', inline: true });

  if (person.title)      embed.addFields({ name: 'Title',       value: person.title,      inline: true });
  if (person.department) embed.addFields({ name: 'Department',  value: person.department, inline: true });
  if (person.specialty)  embed.addFields({ name: 'Specialty',   value: person.specialty,  inline: true });
  if (person.email)      embed.addFields({ name: 'Email',       value: person.email,      inline: true });
  if (person.phone)      embed.addFields({ name: 'Phone',       value: person.phone,      inline: true });
  if (person.year)       embed.addFields({ name: 'Class Year',  value: person.year,       inline: true });
  if (person.cohort_label) embed.addFields({ name: 'Cohort',   value: person.cohort_label, inline: true });
  if (person.discord_id) embed.addFields({ name: 'Discord',    value: `<@${person.discord_id}>`, inline: true });

  if (groups?.length) {
    embed.addFields({ name: 'Groups', value: groups.map((g) => g.label).join(', ') });
  }

  if (person.notes) embed.addFields({ name: 'Notes', value: person.notes });

  return embed;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

module.exports = {
  data: new SlashCommandBuilder()
    .setName('people')
    .setDescription('Student and faculty directory')

    // --- add ---
    .addSubcommand((sub) =>
      sub.setName('add').setDescription('Add a person to the directory [admin]')
        .addStringOption((opt) =>
          opt.setName('type').setDescription('Student or faculty').setRequired(true)
            .addChoices({ name: 'Student', value: 'student' }, { name: 'Faculty', value: 'faculty' })
        )
        .addStringOption((opt) => opt.setName('name').setDescription('Full name').setRequired(true))
        .addStringOption((opt) => opt.setName('email').setDescription('Email address').setRequired(false))
        .addUserOption((opt)   => opt.setName('discord').setDescription('Discord account (students)').setRequired(false))
        .addStringOption((opt) => opt.setName('title').setDescription('e.g. Associate Professor').setRequired(false))
        .addStringOption((opt) => opt.setName('department').setDescription('Department or division').setRequired(false))
        .addStringOption((opt) => opt.setName('specialty').setDescription('Specialty or interest area').setRequired(false))
        .addStringOption((opt) => opt.setName('phone').setDescription('Phone number').setRequired(false))
        .addStringOption((opt) => opt.setName('year').setDescription('Class year e.g. CO 2027').setRequired(false))
        .addStringOption((opt) =>
          opt.setName('cohort').setDescription('Cohort (autocomplete)').setRequired(false).setAutocomplete(true)
        )
        .addStringOption((opt) => opt.setName('notes').setDescription('Internal notes').setRequired(false))
    )

    // --- search ---
    .addSubcommand((sub) =>
      sub.setName('search').setDescription('Search the directory by name, email, or department')
        .addStringOption((opt) => opt.setName('query').setDescription('Search term').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('type').setDescription('Filter by type').setRequired(false)
            .addChoices({ name: 'Students only', value: 'student' }, { name: 'Faculty only', value: 'faculty' })
        )
    )

    // --- info ---
    .addSubcommand((sub) =>
      sub.setName('info').setDescription('Show full details for a person')
        .addStringOption((opt) =>
          opt.setName('person').setDescription('Name to look up (autocomplete)').setRequired(true).setAutocomplete(true)
        )
    )

    // --- edit ---
    .addSubcommand((sub) =>
      sub.setName('edit').setDescription('Edit a person\'s record [admin]')
        .addStringOption((opt) =>
          opt.setName('person').setDescription('Person to edit (autocomplete)').setRequired(true).setAutocomplete(true)
        )
        .addStringOption((opt) => opt.setName('name').setDescription('New name').setRequired(false))
        .addStringOption((opt) => opt.setName('email').setDescription('New email').setRequired(false))
        .addUserOption((opt)   => opt.setName('discord').setDescription('Link/update Discord account').setRequired(false))
        .addStringOption((opt) => opt.setName('title').setDescription('New title').setRequired(false))
        .addStringOption((opt) => opt.setName('department').setDescription('New department').setRequired(false))
        .addStringOption((opt) => opt.setName('specialty').setDescription('New specialty').setRequired(false))
        .addStringOption((opt) => opt.setName('phone').setDescription('New phone').setRequired(false))
        .addStringOption((opt) => opt.setName('year').setDescription('New class year').setRequired(false))
        .addStringOption((opt) => opt.setName('notes').setDescription('New notes').setRequired(false))
    )

    // --- remove ---
    .addSubcommand((sub) =>
      sub.setName('remove').setDescription('Remove a person from the directory [admin]')
        .addStringOption((opt) =>
          opt.setName('person').setDescription('Person to remove (autocomplete)').setRequired(true).setAutocomplete(true)
        )
    ),

  // -------------------------------------------------------------------------
  // Execute
  // -------------------------------------------------------------------------

  async execute(interaction, db) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    // --- ADD ---
    if (sub === 'add') {
      if (!requireAdmin(interaction)) {
        return interaction.reply({ content: 'You need **Manage Server** to add people.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });

      const type       = interaction.options.getString('type');
      const name       = interaction.options.getString('name');
      const email      = interaction.options.getString('email')      || null;
      const discordUser = interaction.options.getUser('discord')     || null;
      const title      = interaction.options.getString('title')      || null;
      const department = interaction.options.getString('department') || null;
      const specialty  = interaction.options.getString('specialty')  || null;
      const phone      = interaction.options.getString('phone')      || null;
      const year       = interaction.options.getString('year')       || null;
      const notes      = interaction.options.getString('notes')      || null;
      const cohortSlug = interaction.options.getString('cohort')     || null;

      const cohort = cohortSlug
        ? db.prepare('SELECT id FROM cohorts WHERE guild_id = ? AND name = ?').get(guildId, cohortSlug)
        : null;

      const { lastInsertRowid } = db.prepare(`
        INSERT INTO people
          (guild_id, type, name, discord_id, email, phone, title, department, specialty, cohort_id, year, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(guildId, type, name, discordUser?.id ?? null, email, phone, title, department, specialty,
             cohort?.id ?? null, year, notes);

      return interaction.editReply({
        content: `Added **${name}** (${type}) to the directory. ID: \`${lastInsertRowid}\``
      });
    }

    // --- SEARCH ---
    if (sub === 'search') {
      await interaction.deferReply({ ephemeral: true });

      const query      = interaction.options.getString('query');
      const typeFilter = interaction.options.getString('type');
      const term       = `%${query}%`;

      let sql = `
        SELECT p.*, co.label AS cohort_label
        FROM people p
        LEFT JOIN cohorts co ON p.cohort_id = co.id
        WHERE p.guild_id = ? AND p.active = 1
          AND (p.name LIKE ? OR p.email LIKE ? OR p.department LIKE ? OR p.specialty LIKE ? OR p.title LIKE ?)
      `;
      const params = [guildId, term, term, term, term, term];

      if (typeFilter) { sql += ' AND p.type = ?'; params.push(typeFilter); }
      sql += ' ORDER BY p.name LIMIT 10';

      const rows = db.prepare(sql).all(...params);
      if (!rows.length) {
        return interaction.editReply({ content: `No results for **${query}**.` });
      }

      const lines = rows.map((r) => {
        const tag   = r.type === 'faculty' ? r.title || 'Faculty' : r.year || 'Student';
        const disc  = r.discord_id ? ` <@${r.discord_id}>` : '';
        const email = r.email ? ` · ${r.email}` : '';
        return `**${r.name}** *(${tag})*${disc}${email}`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`Directory — "${query}" (${rows.length} result${rows.length === 1 ? '' : 's'})`)
        .setDescription(lines.join('\n'))
        .setColor(0x5865f2);

      return interaction.editReply({ embeds: [embed] });
    }

    // --- INFO ---
    if (sub === 'info') {
      await interaction.deferReply({ ephemeral: true });

      const personId = interaction.options.getString('person');
      const person   = db.prepare(`
        SELECT p.*, co.label AS cohort_label
        FROM people p LEFT JOIN cohorts co ON p.cohort_id = co.id
        WHERE p.id = ? AND p.guild_id = ?
      `).get(personId, guildId);

      if (!person) return interaction.editReply({ content: 'Person not found.' });

      // Fetch their groups (students only)
      const groups = person.discord_id
        ? db.prepare(`
            SELECT g.label FROM group_members gm
            JOIN groups g ON gm.group_id = g.id
            WHERE gm.user_id = ? AND g.guild_id = ? AND g.active = 1
          `).all(person.discord_id, guildId)
        : [];

      return interaction.editReply({ embeds: [buildPersonEmbed(person, groups)] });
    }

    // --- EDIT ---
    if (sub === 'edit') {
      if (!requireAdmin(interaction)) {
        return interaction.reply({ content: 'You need **Manage Server** to edit records.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });

      const personId   = interaction.options.getString('person');
      const person     = db.prepare('SELECT * FROM people WHERE id = ? AND guild_id = ?').get(personId, guildId);
      if (!person) return interaction.editReply({ content: 'Person not found.' });

      const updates = {};
      const name       = interaction.options.getString('name');
      const email      = interaction.options.getString('email');
      const discordUser = interaction.options.getUser('discord');
      const title      = interaction.options.getString('title');
      const department = interaction.options.getString('department');
      const specialty  = interaction.options.getString('specialty');
      const phone      = interaction.options.getString('phone');
      const year       = interaction.options.getString('year');
      const notes      = interaction.options.getString('notes');

      if (name)        updates.name        = name;
      if (email)       updates.email       = email;
      if (discordUser) updates.discord_id  = discordUser.id;
      if (title)       updates.title       = title;
      if (department)  updates.department  = department;
      if (specialty)   updates.specialty   = specialty;
      if (phone)       updates.phone       = phone;
      if (year)        updates.year        = year;
      if (notes)       updates.notes       = notes;

      if (!Object.keys(updates).length) {
        return interaction.editReply({ content: 'No fields provided to update.' });
      }

      updates.updated_at = Math.floor(Date.now() / 1000);
      const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE people SET ${setClauses} WHERE id = ?`)
        .run(...Object.values(updates), personId);

      return interaction.editReply({ content: `Updated **${person.name}**.` });
    }

    // --- REMOVE ---
    if (sub === 'remove') {
      if (!requireAdmin(interaction)) {
        return interaction.reply({ content: 'You need **Manage Server** to remove people.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });

      const personId = interaction.options.getString('person');
      const person   = db.prepare('SELECT * FROM people WHERE id = ? AND guild_id = ?').get(personId, guildId);
      if (!person) return interaction.editReply({ content: 'Person not found.' });

      db.prepare('UPDATE people SET active = 0 WHERE id = ?').run(personId);
      return interaction.editReply({ content: `Removed **${person.name}** from the directory.` });
    }
  },

  // -------------------------------------------------------------------------
  // Autocomplete
  // -------------------------------------------------------------------------

  async autocomplete(interaction, db) {
    const focused  = interaction.options.getFocused(true);
    const guildId  = interaction.guildId;
    const term     = focused.value;

    // person autocomplete (info, edit, remove)
    if (focused.name === 'person') {
      const rows = db.prepare(`
        SELECT id, name, type, title, year FROM people
        WHERE guild_id = ? AND active = 1 AND name LIKE ?
        ORDER BY name LIMIT 25
      `).all(guildId, `%${term}%`);

      return interaction.respond(rows.map((r) => {
        const tag = r.type === 'faculty' ? r.title || 'Faculty' : r.year || 'Student';
        return { name: `${r.name} (${tag})`.slice(0, 100), value: String(r.id) };
      }));
    }

    // cohort autocomplete (add)
    if (focused.name === 'cohort') {
      const rows = db.prepare(
        'SELECT name, label FROM cohorts WHERE guild_id = ? AND name LIKE ? LIMIT 25'
      ).all(guildId, `%${term}%`);
      return interaction.respond(rows.map((r) => ({ name: r.label || r.name, value: r.name })));
    }

    return interaction.respond([]);
  }
};
