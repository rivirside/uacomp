'use strict';

module.exports = {
  ARCHIVE_MARKER: 'ARCHIVE_ORIGIN=',
  TUTOR_TICKET_MARKER: 'TUTOR_TICKET=',
  QUIZ_ANSWER_PREFIX: 'quiz_answer:',
  RAG_DL_PREFIX: 'rag_dl:',
  MAX_CALENDAR_SIZE_BYTES: 2 * 1024 * 1024,
  MAX_REDIRECTS: 3,
  DEFAULT_CALENDAR_EVENT_LIMIT: 5,
  VALID_EVENT_SCOPES:    ['university', 'cohort', 'group'],
  VALID_GROUP_TYPES:     ['cbi', 'anatomy', 'doctoring', 'other'],
  VALID_GROUP_LIFESPANS: ['permanent', 'course', 'one-time'],
  DIGEST_WINDOW_DAYS:    7,
  MAX_ROSTER_DISPLAY:    25
};
