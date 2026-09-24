// Pure GitHub — Review Bot (Model B, 2026-09-21)
//
// The new lightweight bot. Two triggers:
//   1. From Discovery (executeWorkflowTrigger) — the Discovery workflow calls
//      this workflow via Execute Workflow and passes the chosen posts. For
//      each post we send ONE Telegram message:
//        - caption + model verdict (verdict/reason are part of the payload)
//        - «باز کردن پنل بازبینی» — web_app button opening the Mini App
//          (MINIAPP_URL/post/:id), Model B review lives inside the app
//        - «حذف از لیست» — callback del:<post_id> removes ONLY the posts row
//          (DELETE FROM posts), the repository row is never touched.
//          Works for status draft AND approved (undo approval = free the repo).
//   2. Bot Updates (telegramTrigger) — handles
//        - callback del:<id>  → delete post + edit the message + ack
//        - text «/start»         → reply «سلام، ربات روشن است»
//        - text «شروع دیسکاوری»  → reply «دیسکاوری شروع شد» + run Discovery
//        - any other text        → reply «دستور ناشناخته است»
//
// «همین الان بفرست» deliberately lives ONLY in the Mini App (final list),
// never as a bot button — decided 2026-09-21.
//
// Discovery is launched by the bot via Execute Workflow (inputSource passthrough
// is NOT needed by the bot itself — it passes the whole input it received).
// The old 59-node review bot stays untouched.

import {
  workflow, trigger, node, sticky, switchCase, splitInBatches, nextBatch, expr,
} from '@n8n/workflow-sdk';

const OWNER_CHAT = '5622960785';
const TELEGRAM_CRED = { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' };
const PG_CRED = { id: 'AGFlith4Bqghumgo', name: 'Postgres account' };
const DISCOVERY_WF_ID = 'hHSwbbOBKRIWStRU'; // Pure GitHub — Discovery
const MINIAPP_URL = 'https://department-resolve-training-arabic.trycloudflare.com'; // dev tunnel; production uses puregh-app.style.dev

// ---------------------------------------------------------------------------
// Trigger 1 — called by Discovery via Execute Workflow after it selected posts
// ---------------------------------------------------------------------------
const fromDiscovery = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'From Discovery',
    position: [0, 0],
    parameters: { inputSource: 'passthrough' }, // accept whatever Discovery sent
  },
});

// Loop over the received posts, one message per post.
const loopPosts = splitInBatches({
  version: 3,
  config: {
    name: 'Loop Posts',
    position: [240, 0],
    parameters: { batchSize: 1, options: {} },
  },
});

// Send the review message: caption + model verdict + (pending notice) + two buttons.
const sendReview = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Send Review',
    position: [560, -48],
    parameters: {
      resource: 'message',
      operation: 'sendMessage',
      chatId: OWNER_CHAT,
      replyMarkup: 'inlineKeyboard',
      inlineKeyboard: {
        rows: [
          {
            row: {
              buttons: [
                { text: '📋 باز کردن پنل بازبینی', additionalFields: { web_app: { url: expr("{{ '" + MINIAPP_URL + "/post/' + $json.post_id }}") } } },
                { text: '🗑 حذف از لیست', additionalFields: { callback_data: expr('{{ "del:" + $json.post_id }}') } },
              ],
            },
          },
        ],
      },
      text: expr(
        '={{ $json.caption\n'
          + "  + '\\n\\n'\n"
          + "  + '🧠 نظر مدل: ' + ({ strong: 'قوی ✅', maybe: 'محتمل 🟡', reject: 'ضعیف ❌' }[$json.verdict] ?? $json.verdict ?? '—')\n"
          + "  + ($json.reason ? '\\n' + $json.reason : '')\n"
          + "  + '\\n\\n'\n"
          + "  + ($json.publish_at ? '🕒 زمان انتشار: ' + new Date($json.publish_at).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '\\n' : '')\n"
          + "  + '🕒 لیست انتظار — پست تا تایید و تنظیم زمان در پنل بازبینی منتشر نمی‌شود.' }}",
      ),
      additionalFields: {
        appendAttribution: false,
        disable_web_page_preview: true,
        parse_mode: 'HTML',
      },
    },
    credentials: { telegramApi: TELEGRAM_CRED },
  },
});

// Record message ids back on the post row (for the del button to edit it).
const saveBotMessage = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Save Bot Message',
    position: [560, 64],
    parameters: {
operation: 'executeQuery',
      query: 'UPDATE posts SET bot_chat_id = $1, bot_message_id = $2 WHERE id = $3::bigint;',
      options: {
        queryReplacement: expr('{{ [ String($("Send Review").first().json.result.chat.id), Number($("Send Review").first().json.result.message_id), $("From Discovery").first().json.post_id ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: PG_CRED },
  },
});

// ---------------------------------------------------------------------------
// Trigger 2 — Telegram updates (del button + «شروع دیسکاوری»)
// ---------------------------------------------------------------------------
const botUpdates = trigger({
  type: 'n8n-nodes-base.telegramTrigger',
  version: 1.5,
  config: {
    name: 'Bot Updates',
    position: [0, 480],
    parameters: {
      updates: ['message', 'callback_query'],
      additionalFields: { chatIds: OWNER_CHAT },
    },
  },
});

const parseUpdate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse Update',
    position: [240, 480],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: "const u = $json;\n"
        + "const cb = u.callback_query ?? null;\n"
        + "const msg = u.message ?? null;\n"
        + "let kind = 'ignored', text = null, queryId = null, callbackData = null;\n"
        + "if (cb) {\n"
        + "  kind = 'callback';\n"
        + "  queryId = cb.id;\n"
        + "  callbackData = cb.data ?? null;\n"
        + "} else if (msg && typeof msg.text === 'string' && msg.text.trim()) {\n"
        + "  kind = 'text';\n"
        + "  text = msg.text.trim();\n"
        + "}\n"
        + "return [{ json: { kind, text, queryId, callbackData, chatId: String(msg?.chat?.id ?? cb?.message?.chat?.id ?? '') } }];",
    },
  },
});

// Route Update — output 0 callback, output 1 text, output 2 ignored (dropped)
const routeUpdate = switchCase({
  version: 3.4,
  config: {
    name: 'Route Update',
    position: [480, 480],
    parameters: {
      rules: {
        values: [
          { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.kind }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'callback' }], combinator: 'and' } },
          { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.kind }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'text' }], combinator: 'and' } },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Ignored' },
    },
  },
});

// Parse Callback — output 0 del, output 1 start, fallback=Unknown
const parseCallback = switchCase({
  version: 3.4,
  config: {
    name: 'Parse Callback',
    position: [720, 336],
    parameters: {
      rules: {
        values: [
          { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.callbackData.split(":")[0] }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'del' }], combinator: 'and' } },
          { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.callbackData.split(":")[0] }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'start' }], combinator: 'and' } },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Unknown' },
    },
  },
});

// DEL branch — remove ONLY the post row. The repo is deliberately untouched.
// We need bot_chat_id/bot_message_id to edit the message AFTER the delete.
const loadDelPost = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Del Post',
    position: [960, 216],
    parameters: {
      operation: 'executeQuery',
      query: 'SELECT id, status, bot_chat_id, bot_message_id FROM posts WHERE id = $1::bigint;',
      options: {
        queryReplacement: expr('{{ [ Number($("Parse Update").first().json.callbackData.split(":")[1] ?? 0) ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: PG_CRED },
  },
});

// Only pending + approved posts can be removed; published/rejected are left alone.
const gateDelStatus = switchCase({
  version: 3.4,
  config: {
    name: 'Gate Del Status',
    position: [1184, 216],
    parameters: {
      rules: {
        values: [
          { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [
            { leftValue: expr('{{ $json.status }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'draft' },
            { leftValue: expr('{{ $json.status }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'approved' },
          ], combinator: 'or' } },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Not Draft' },
    },
  },
});

const deleteDelPost = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Delete Del Post',
    position: [1424, 0],
    parameters: {
      operation: 'executeQuery',
      query: 'DELETE FROM posts WHERE id = $1::bigint AND status IN (\'draft\', \'approved\');',
      options: {
        queryReplacement: expr('{{ [ $json.id ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: PG_CRED },
  },
});

const answerDel = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Answer Del',
    position: [1664, -96],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'callback',
      operation: 'answerQuery',
      queryId: expr('{{ $("Parse Update").first().json.queryId }}'),
      additionalFields: { text: 'حذف شد 🗑 پست از لیست حذف شد (ریپو دست‌نخورده).' },
    },
    credentials: { telegramApi: TELEGRAM_CRED },
  },
});

const editDelMessage = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Edit Del Message',
    position: [1664, 48],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'editMessageText',
      messageType: 'message',
      chatId: expr('{{ $("Load Del Post").first().json.bot_chat_id }}'),
      messageId: expr('{{ String($("Load Del Post").first().json.bot_message_id) }}'),
      text: '🗑 <b>از لیست حذف شد</b> — این پست دیگر منتشر نمی‌شود.',
      replyMarkup: 'none',
      additionalFields: { appendAttribution: false, parse_mode: 'HTML' },
    },
    credentials: { telegramApi: TELEGRAM_CRED },
  },
});

const answerDelNotFound = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Answer Del Not Draft',
    position: [1424, 336],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'callback',
      operation: 'answerQuery',
      queryId: expr('{{ $("Parse Update").first().json.queryId }}'),
      additionalFields: { text: 'این پست دیگر در لیست انتظار نیست.' },
    },
    credentials: { telegramApi: TELEGRAM_CRED },
  },
});

// START branch — launch Discovery via Execute Workflow.
const answerStart = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Answer Start',
    position: [960, 480],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'callback',
      operation: 'answerQuery',
      queryId: expr('{{ $json.queryId }}'),
      additionalFields: { text: 'دیسکاوری شروع شد 🔄' },
    },
    credentials: { telegramApi: TELEGRAM_CRED },
  },
});

const runDiscovery = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Run Discovery',
    position: [1184, 480],
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: DISCOVERY_WF_ID },
      options: { waitForSubWorkflow: false },
    },
  },
});

// TEXT branch — route plain text messages:
//   /start               → «سلام، ربات روشن است»
//   شروع دیسکاوری        → «دیسکاوری شروع شد» + launch Discovery
//   anything else        → «دستور ناشناخته است»
const routeText = switchCase({
  version: 3.4,
  config: {
    name: 'Route Text',
    position: [720, 672],
    parameters: {
      rules: {
        values: [
          { conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'string' }, conditions: [{ leftValue: expr('{{ $json.text }}'), operator: { type: 'string', operation: 'equals' }, rightValue: '/start' }], combinator: 'and' } },
          { conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'string' }, conditions: [{ leftValue: expr('{{ $json.text }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'شروع دیسکاوری' }], combinator: 'and' } },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Unknown' },
    },
  },
});

const sendHello = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Send Hello',
    position: [944, 672],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'sendMessage',
      chatId: expr('{{ $("Parse Update").first().json.chatId }}'),
      text: 'سلام، ربات روشن است',
      additionalFields: { appendAttribution: false },
    },
    credentials: { telegramApi: TELEGRAM_CRED },
  },
});

const sendDiscoveryStarted = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Send Discovery Started',
    position: [944, 768],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'sendMessage',
      chatId: expr('{{ $("Parse Update").first().json.chatId }}'),
      text: 'دیسکاوری شروع شد',
      additionalFields: { appendAttribution: false },
    },
    credentials: { telegramApi: TELEGRAM_CRED },
  },
});

const sendUnknown = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Send Unknown',
    position: [944, 864],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'sendMessage',
      chatId: expr('{{ $("Parse Update").first().json.chatId }}'),
      text: 'دستور ناشناخته است',
      additionalFields: { appendAttribution: false },
    },
    credentials: { telegramApi: TELEGRAM_CRED },
  },
});

const answerUnknown = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Answer Unknown',
    position: [1424, 672],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'callback',
      operation: 'answerQuery',
      queryId: expr('{{ $("Parse Update").first().json.queryId }}'),
      additionalFields: { text: 'این دکمه هنوز فعال نیست.' },
    },
    credentials: { telegramApi: TELEGRAM_CRED },
  },
});

const note = sticky(
  '## Pure GitHub — Review Bot\n\nModel B: Discovery posts arrive here via Execute Workflow; each post gets a message with caption + model verdict line + a web_app open-app button + a «حذف از لیست» button (posts-only delete; works for draft & approved). «همین الان بفرست» is Mini-App-only. Text commands: «/start» → «سلام، ربات روشن است»; «شروع دیسکاوری» → «دیسکاوری شروع شد» + runs Discovery; anything else → «دستور ناشناخته است».\n\nThe old 59-node bot stays untouched.',
  [fromDiscovery],
  { color: 5 },
);

export default workflow('puregh-review-bot', 'Pure GitHub — Review Bot')
  .add(note)
  // --- Trigger 1: from Discovery (executeWorkflowTrigger) ---
  .add(fromDiscovery)
  .to(loopPosts
    .onEachBatch(sendReview.to(saveBotMessage).to(nextBatch(loopPosts))))
  // --- Trigger 2: Telegram updates ---
  .add(botUpdates)
  .to(parseUpdate)
  .to(routeUpdate
    .onCase(0, parseCallback
      // del (parseCallback output 0)
      .onCase(0, loadDelPost.to(gateDelStatus
        .onCase(0, deleteDelPost.to(answerDel).to(editDelMessage))
        .onCase(2, answerDelNotFound)))
      // start (parseCallback output 1)
      .onCase(1, answerStart.to(runDiscovery))
      // unknown callback prefix (parseCallback output 2)
      .onCase(2, answerUnknown))
    // text (routeUpdate output 1)
    .onCase(1, routeText
      .onCase(0, sendHello)
      .onCase(1, sendDiscoveryStarted.to(runDiscovery))
      .onCase(2, sendUnknown)));
