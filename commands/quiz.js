'use strict';

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const fs   = require('node:fs/promises');
const path = require('node:path');
const { QUIZ_ANSWER_PREFIX } = require('../utils/constants');
const config = require('../config.json');

const QUIZ_QUESTIONS_PATH = path.join(
  __dirname, '..', config.quizSettings?.questionFile || path.join('data', 'quiz-questions.json')
);

// In-memory quiz state (per bot process)
const activeQuizzes = new Map();

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function getWeekKey(date) {
  const temp   = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = temp.getUTCDay() || 7;
  temp.setUTCDate(temp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
  const weekNum   = Math.ceil(((temp - yearStart) / 86400000 + 1) / 7);
  return `${temp.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function awardPoints(db, guildId, userId, tag, amount) {
  const weekKey = getWeekKey(new Date());
  db.prepare(`
    INSERT INTO quiz_scores (guild_id, user_id, week_key, points, tag) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id, week_key) DO UPDATE SET points = points + excluded.points, tag = excluded.tag
  `).run(guildId, userId, weekKey, amount, tag);

  return db.prepare('SELECT points FROM quiz_scores WHERE guild_id = ? AND user_id = ? AND week_key = ?')
    .get(guildId, userId, weekKey)?.points ?? amount;
}

function getLeaderboard(db, guildId) {
  const weekKey = getWeekKey(new Date());
  return db.prepare(
    'SELECT user_id, points, tag FROM quiz_scores WHERE guild_id = ? AND week_key = ? ORDER BY points DESC LIMIT 10'
  ).all(guildId, weekKey);
}

// ---------------------------------------------------------------------------
// Question helpers
// ---------------------------------------------------------------------------

let questionCache = null;

async function loadQuizQuestions() {
  if (questionCache) return questionCache;
  try {
    const raw    = await fs.readFile(QUIZ_QUESTIONS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Quiz file must be an array.');
    questionCache = parsed;
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') { console.warn('Quiz question file not found:', QUIZ_QUESTIONS_PATH); return []; }
    throw err;
  }
}

function collectTokens(q) {
  const tokens = [];
  if (q.topic) tokens.push(q.topic);
  if (Array.isArray(q.topics)) tokens.push(...q.topics);
  if (q.tags) {
    if (typeof q.tags.phase === 'string') tokens.push(q.tags.phase);
    if (Array.isArray(q.tags.systems)) tokens.push(...q.tags.systems);
    if (Array.isArray(q.tags.disciplines)) tokens.push(...q.tags.disciplines);
  }
  return [...new Set(tokens.map((t) => t.toString().trim()).filter(Boolean))];
}

async function pickQuestion({ topic, phase } = {}) {
  let qs = await loadQuizQuestions();
  if (!qs.length) return null;
  if (topic) { const n = topic.toLowerCase(); qs = qs.filter((q) => collectTokens(q).some((t) => t.toLowerCase().includes(n))); }
  if (phase) { qs = qs.filter((q) => q.tags?.phase?.toLowerCase() === phase.toLowerCase()); }
  if (!qs.length) return null;
  return qs[Math.floor(Math.random() * qs.length)];
}

// ---------------------------------------------------------------------------
// Embed / component builders
// ---------------------------------------------------------------------------

function buildQuizEmbed(question, points) {
  const labels    = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const choicesBlock = question.choices.map((c, i) => `**${labels[i]}.** ${c}`).join('\n');
  const topicLabel   = collectTokens(question).join(', ');
  return new EmbedBuilder()
    .setTitle(`Clinical Quiz${topicLabel ? ` – ${topicLabel}` : ''}`)
    .setDescription(`**Q:** ${question.question}\n\n${choicesBlock}`)
    .addFields({ name: 'How to play', value: `Click a button to answer. First correct response earns **${points}** point(s)!` })
    .setColor(0x5865f2)
    .setFooter({ text: 'Leaderboard resets every Monday' })
    .setTimestamp(new Date());
}

function buildComponents(choiceCount, messageId) {
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const rows   = [];
  let row      = new ActionRowBuilder();
  for (let i = 0; i < choiceCount; i++) {
    if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${QUIZ_ANSWER_PREFIX}${messageId}:${i}`)
        .setLabel(labels[i] || String.fromCharCode(65 + i))
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (row.components.length) rows.push(row);
  return rows;
}

function markResolved(quizState, quizMessage) {
  const embed  = EmbedBuilder.from(quizMessage.embeds[0] || {});
  const choice = quizState.question.choices[quizState.correctIndex];
  const expl   = quizState.question.explanation ? `\n\n**Explanation:** ${quizState.question.explanation}` : '';
  embed.setColor(0x57f287)
    .addFields({ name: 'Answer', value: `${String.fromCharCode(65 + quizState.correctIndex)}. ${choice}${expl}` })
    .setFooter({ text: 'Quiz closed' });
  return embed;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quiz')
    .setDescription('Weekly clinical quiz challenge')
    .addSubcommand((sub) =>
      sub.setName('start').setDescription('Post a multiple-choice question')
        .addStringOption((opt) =>
          opt.setName('topic').setDescription('Optional topic to draw from').setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('phase').setDescription('preclinical or clinical').setRequired(false)
            .addChoices({ name: 'Preclinical', value: 'preclinical' }, { name: 'Clinical', value: 'clinical' })
        )
        .addIntegerOption((opt) =>
          opt.setName('points').setDescription('Override points for this question').setRequired(false)
            .setMinValue(1).setMaxValue(50)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('leaderboard').setDescription('Show current weekly standings')
        .addUserOption((opt) => opt.setName('user').setDescription('User to highlight').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub.setName('add').setDescription('Add a question to the bank [admin]')
        .addStringOption((opt) => opt.setName('question').setDescription('Question text').setRequired(true))
        .addStringOption((opt) => opt.setName('correct').setDescription('Correct answer').setRequired(true))
        .addStringOption((opt) => opt.setName('wrong1').setDescription('Wrong answer 1').setRequired(true))
        .addStringOption((opt) => opt.setName('wrong2').setDescription('Wrong answer 2').setRequired(true))
        .addStringOption((opt) => opt.setName('wrong3').setDescription('Wrong answer 3 (optional)').setRequired(false))
        .addStringOption((opt) => opt.setName('topic').setDescription('Topic/tag (e.g. cardiology)').setRequired(false))
        .addStringOption((opt) => opt.setName('explanation').setDescription('Explanation shown after answer').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List questions in the bank')
        .addStringOption((opt) => opt.setName('topic').setDescription('Filter by topic').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub.setName('remove').setDescription('Remove a question from the bank [admin]')
        .addStringOption((opt) =>
          opt.setName('question').setDescription('Question to remove').setRequired(true).setAutocomplete(true)
        )
    ),

  async execute(interaction, db) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
      const channel = interaction.channel;
      if (!channel?.isTextBased()) {
        return interaction.reply({ content: 'Quizzes can only be started in text channels.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        const question = await pickQuestion({
          topic: interaction.options.getString('topic'),
          phase: interaction.options.getString('phase')
        });
        if (!question) throw new Error('No questions found for those filters.');

        const settings = config.quizSettings || {};
        const points   = interaction.options.getInteger('points') ?? settings.pointsPerCorrect ?? 5;
        const embed    = buildQuizEmbed(question, points);
        const posted   = await channel.send({ embeds: [embed] });
        await posted.edit({ components: buildComponents(question.choices.length, posted.id) });

        activeQuizzes.set(posted.id, {
          messageId: posted.id, channelId: posted.channelId, guildId: interaction.guildId,
          question, points, correctIndex: question.answerIndex,
          answered: new Set(), resolved: false, createdAt: Date.now()
        });
        setTimeout(() => activeQuizzes.delete(posted.id), 30 * 60 * 1000);

        await interaction.editReply({ content: `Posted a quiz worth **${points}** point(s).` });
      } catch (err) {
        console.error('Quiz start error', err);
        await interaction.editReply({ content: `Unable to start quiz: ${err.message}` });
      }
      return;
    }

    if (sub === 'leaderboard') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const rows = getLeaderboard(db, interaction.guildId);
        if (!rows.length) {
          await interaction.editReply({ content: 'No one has scored points this week yet!' });
          return;
        }

        const highlightUser  = interaction.options.getUser('user') || interaction.user;
        const sorted         = db.prepare(
          'SELECT user_id, points FROM quiz_scores WHERE guild_id = ? AND week_key = ? ORDER BY points DESC'
        ).all(interaction.guildId, getWeekKey(new Date()));
        const highlightIndex = sorted.findIndex((r) => r.user_id === highlightUser.id);
        const userRank       = highlightIndex !== -1 ? highlightIndex + 1 : null;
        const userPoints     = userRank ? sorted[highlightIndex].points : 0;

        const medals = ['🥇', '🥈', '🥉'];
        const lines  = rows.map((r, i) => `${medals[i] ?? `#${i + 1}`} <@${r.user_id}> — **${r.points}** pts`);

        const embed = new EmbedBuilder()
          .setTitle('Weekly Quiz Leaderboard')
          .setDescription(lines.join('\n'))
          .setColor(0x57f287)
          .setFooter({ text: `Week of ${getWeekKey(new Date())}` })
          .setTimestamp(new Date());

        embed.addFields(userRank
          ? { name: `Your rank (${highlightUser.tag})`, value: `#${userRank} with **${userPoints}** point(s)` }
          : { name: highlightUser.tag, value: 'No points this week yet.' }
        );

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error('Leaderboard error', err);
        await interaction.editReply({ content: `Unable to load leaderboard: ${err.message}` });
      }
      return;
    }

    if (sub === 'add') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need **Manage Server** to add questions.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        const questionText = interaction.options.getString('question');
        const correct      = interaction.options.getString('correct');
        const wrongs       = [
          interaction.options.getString('wrong1'),
          interaction.options.getString('wrong2'),
          interaction.options.getString('wrong3')
        ].filter(Boolean);
        const topic       = interaction.options.getString('topic') || null;
        const explanation = interaction.options.getString('explanation') || null;

        // Shuffle correct answer into a random position
        const choices = [...wrongs];
        const insertAt = Math.floor(Math.random() * (choices.length + 1));
        choices.splice(insertAt, 0, correct);

        const newQuestion = {
          question:    questionText,
          choices,
          answerIndex: insertAt,
          ...(topic       && { topic }),
          ...(explanation && { explanation })
        };

        const questions = await loadQuizQuestions();
        questions.push(newQuestion);
        await fs.writeFile(QUIZ_QUESTIONS_PATH, JSON.stringify(questions, null, 2), 'utf8');
        questionCache = questions;

        await interaction.editReply({
          content: `Question added. Bank now has **${questions.length}** question(s).`
        });
      } catch (err) {
        console.error('Quiz add error', err);
        await interaction.editReply({ content: `Failed to add question: ${err.message}` });
      }
      return;
    }

    if (sub === 'list') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const topicFilter = interaction.options.getString('topic')?.toLowerCase();
        let questions = await loadQuizQuestions();
        if (topicFilter) {
          questions = questions.filter((q) =>
            collectTokens(q).some((t) => t.toLowerCase().includes(topicFilter))
          );
        }
        if (!questions.length) {
          return interaction.editReply({ content: topicFilter ? `No questions found for topic **${topicFilter}**.` : 'The question bank is empty.' });
        }
        const lines = questions.slice(0, 25).map((q, i) => {
          const tags = collectTokens(q).join(', ') || 'no topic';
          return `**${i + 1}.** ${q.question.slice(0, 80)}${q.question.length > 80 ? '…' : ''} *(${tags})*`;
        });
        const embed = new EmbedBuilder()
          .setTitle(`Quiz Bank${topicFilter ? ` — ${topicFilter}` : ''} (${questions.length} question${questions.length === 1 ? '' : 's'})`)
          .setDescription(lines.join('\n'))
          .setColor(0x5865f2)
          .setFooter({ text: questions.length > 25 ? 'Showing first 25 — use topic filter to narrow results' : '' });
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error('Quiz list error', err);
        await interaction.editReply({ content: `Failed to list questions: ${err.message}` });
      }
      return;
    }

    if (sub === 'remove') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need **Manage Server** to remove questions.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        const key       = interaction.options.getString('question');
        const questions = await loadQuizQuestions();
        const idx       = questions.findIndex((q) => q.question === key);
        if (idx === -1) {
          return interaction.editReply({ content: 'Question not found — it may have already been removed.' });
        }
        const [removed] = questions.splice(idx, 1);
        await fs.writeFile(QUIZ_QUESTIONS_PATH, JSON.stringify(questions, null, 2), 'utf8');
        questionCache = questions;
        await interaction.editReply({
          content: `Removed: *${removed.question.slice(0, 100)}*\nBank now has **${questions.length}** question(s).`
        });
      } catch (err) {
        console.error('Quiz remove error', err);
        await interaction.editReply({ content: `Failed to remove question: ${err.message}` });
      }
      return;
    }
  },

  async handleButton(interaction, db) {
    if (!interaction.customId.startsWith(QUIZ_ANSWER_PREFIX)) return false;

    const parts = interaction.customId.split(':');
    if (parts.length !== 3) {
      await interaction.reply({ content: 'Malformed quiz button.', ephemeral: true });
      return true;
    }

    const [, messageId, choiceIndexRaw] = parts;
    const choiceIndex = parseInt(choiceIndexRaw, 10);
    const state       = activeQuizzes.get(messageId);

    if (!state) {
      await interaction.reply({ content: 'This quiz has expired or was already graded.', ephemeral: true });
      return true;
    }
    if (state.resolved) {
      await interaction.reply({ content: 'This quiz is already closed. Watch for the next one!', ephemeral: true });
      return true;
    }
    if (state.answered.has(interaction.user.id)) {
      await interaction.reply({ content: 'You already submitted an answer.', ephemeral: true });
      return true;
    }

    state.answered.add(interaction.user.id);

    if (choiceIndex !== state.correctIndex) {
      await interaction.reply({ content: 'Not quite right. Watch for the explanation!', ephemeral: true });
      return true;
    }

    state.resolved = true;
    activeQuizzes.set(messageId, state);

    try {
      const totalPoints = awardPoints(db, state.guildId, interaction.user.id, interaction.user.tag, state.points);
      const channel     = await interaction.client.channels.fetch(state.channelId);
      if (channel?.isTextBased()) {
        await channel.send(`🎉 ${interaction.user} answered correctly and earns **${state.points}** point(s)! Total: **${totalPoints}** pts.`);
        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (msg) await msg.edit({ embeds: [markResolved(state, msg)], components: [] });
      }
    } catch (err) {
      console.error('Error updating quiz points', err);
    }

    activeQuizzes.delete(messageId);
    await interaction.reply({ content: `Correct! You earned **${state.points}** point(s).`, ephemeral: true });
    return true;
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'question') return interaction.respond([]);

    const questions = await loadQuizQuestions().catch(() => []);
    const term      = focused.value.toLowerCase();
    const matches   = questions
      .filter((q) => q.question.toLowerCase().includes(term))
      .slice(0, 25)
      .map((q) => ({
        name:  q.question.slice(0, 100),
        value: q.question  // used as lookup key in remove handler
      }));

    return interaction.respond(matches);
  }
};
