// Pure GitHub — Telegram Bot (section 5, phase 1)
// Handles the review bot's private chat: 4 inline buttons (ok/rej/regen/manual),
// waiting-list command, add-to-list command, manual caption replies.
// One Telegram Trigger per bot (Telegram limitation) — this workflow owns the bot.

import { workflow, node, trigger, sticky, switchCase, expr } from '@n8n/workflow-sdk';

const OWNER_CHAT = '5622960785';

const botTrigger = trigger({
  type: 'n8n-nodes-base.telegramTrigger',
  version: 1.5,
  config: {
    name: 'Bot Updates',
    position: [-300, 0],
    parameters: {
      updates: ["message", "callback_query"],
      additionalFields: { chatIds: OWNER_CHAT },
    },
  },
});

// Parse Update — normalise every Telegram update into ONE shape:
// { kind: 'callback'|'text'|'ignored', text, queryId, callbackData, chatId }
const parseUpdate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse Update',
    position: [-80, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const u = $json;
const cb = u.callback_query ?? null;
const msg = u.message ?? null;
let kind = 'ignored', text = null, queryId = null, callbackData = null;
if (cb) {
  kind = 'callback';
  queryId = cb.id;
  callbackData = cb.data ?? null;
} else if (msg && typeof msg.text === 'string' && msg.text.trim()) {
  kind = 'text';
  text = msg.text.trim();
}
const chatId = String(msg?.chat?.id ?? cb?.message?.chat?.id ?? '');
return [{ json: { kind, text, queryId, callbackData, chatId } }];`,
    },
  },
});

// Route Update — output 0 callback, output 1 text, output 2 ignored (dropped)
const routeUpdate = switchCase({
  version: 3.4,
  config: {
    name: 'Route Update',
    position: [140, 0],
    parameters: {
      rules: {
        values: [
          { outputKey: 'callback', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.kind }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'callback' }], combinator: 'and' } },
          { outputKey: 'text', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.kind }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'text' }], combinator: 'and' } },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Ignored' },
    },
  },
});

// Parse Callback — split "ok:123" prefixes into branches.
const parseCallback = switchCase({
  version: 3.4,
  config: {
    name: 'Parse Callback',
    position: [400, -100],
    parameters: {
      rules: {
        values: [
          { outputKey: 'ok', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.callbackData.split(":")[0] }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'ok' }], combinator: 'and' } },
          { outputKey: 'rej', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.callbackData.split(":")[0] }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'rej' }], combinator: 'and' } },
          { outputKey: 'regen', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.callbackData.split(":")[0] }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'regen' }], combinator: 'and' } },
          { outputKey: 'manual', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.callbackData.split(":")[0] }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'manual' }], combinator: 'and' } },
          { outputKey: 'sched', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.callbackData.split(":")[0] }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'sched' }], combinator: 'and' } },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Unknown' },
    },
  },
});

// ---- OK branch: the post stays in the waiting list untouched (publisher
// workflow sends it at publish_at anyway). Only acknowledge.
const answerOk = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Answer OK',
    position: [660, -300],
    parameters: {
      resource: 'callback',
      operation: 'answerQuery',
      queryId: expr('{{ $json.queryId }}'),
      additionalFields: { text: 'تایید شد ✅ همین کپشن در زمان مقرر منتشر می‌شود.' },
    },
    credentials: { telegramApi: { name: 'Telegram account' } },
  },
});

// ---- REJ branch: remove from waiting list, edit the message, drop buttons.
const answerRej = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Answer Reject',
    position: [660, -180],
    parameters: {
      resource: 'callback',
      operation: 'answerQuery',
      queryId: expr('{{ $json.queryId }}'),
      additionalFields: { text: 'رد شد ❌ پست از لیست انتظار حذف شد.' },
    },
    credentials: { telegramApi: { name: 'Telegram account' } },
  },
});

const rejectPost = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Reject Post',
    position: [860, -180],
    parameters: {
      operation: 'executeQuery',
      query: `UPDATE posts SET status = 'rejected', reject_reason = 'bot-reject', decided_at = now()
WHERE id = $1::bigint AND status = 'draft';`,
      options: {
        queryReplacement: expr('{{ [ Number($("Parse Update").first().json.callbackData.split(":")[1] ?? 0) ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { name: 'Postgres account' } },
  },
});

const loadRejectedPost = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Rejected Post',
    position: [1060, -180],
    parameters: {
      operation: 'executeQuery',
      // No status filter: we need bot_chat_id/bot_message_id after the reject
      // to edit the review message in place.
      query: 'SELECT id, status, bot_chat_id, bot_message_id FROM posts WHERE id = $1::bigint;',
      options: {
        queryReplacement: expr('{{ [ Number($("Parse Update").first().json.callbackData.split(":")[1] ?? 0) ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { name: 'Postgres account' } },
  },
});

const editRejected = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Edit Message Rejected',
    position: [1260, -180],
    parameters: {
      resource: 'message',
      operation: 'editMessageText',
      messageType: 'message',
      chatId: expr('{{ $json.bot_chat_id }}'),
      messageId: expr('{{ String($json.bot_message_id) }}'),
      text: '❌ <b>رد شد</b> — این پست از لیست انتظار حذف شد.',
      replyMarkup: 'none',
      additionalFields: { appendAttribution: false, parse_mode: 'HTML' },
    },
    credentials: { telegramApi: { name: 'Telegram account' } },
  },
});

// Unknown callback prefix — acknowledge so no endless spinner.
const answerUnknown = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Answer Unknown',
    position: [660, 60],
    parameters: {
      resource: 'callback',
      operation: 'answerQuery',
      queryId: expr('{{ $json.queryId }}'),
      additionalFields: { text: 'این دکمه هنوز فعال نیست.' },
    },
    credentials: { telegramApi: { name: 'Telegram account' } },
  },
});

const note = sticky('## Pure GitHub — Telegram Bot — فاز ۱: تایید، رد، دکمه‌ی ناشناخته. شاخه‌های بعدی گام‌به‌گام اضافه می‌شوند.', [botTrigger], { color: 5 });

export default workflow('puregh-telegram-bot', 'Pure GitHub — Telegram Bot')
  .add(note)
  .add(botTrigger)
  .to(parseUpdate)
  .to(routeUpdate
    .onCase(0, parseCallback
      .onCase(0, answerOk)
      .onCase(1, answerRej.to(rejectPost).to(loadRejectedPost).to(editRejected))
      .onCase(5, answerUnknown)));
