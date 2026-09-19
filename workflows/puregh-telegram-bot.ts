// Pure GitHub — Telegram Bot (section 5, phases 1–8 + UX rework 2026-09-14)
//
// The review bot's private chat. Four inline buttons per draft post
// (ok / rej / regen / manual), plus text commands:
//   «لیست انتظار»  — waiting list with dynamic keyboard (sched:<id> buttons)
//   a github.com link — «انتخاب کنید:» message with two buttons
//                    (addgen → LLM caption / addmanual → user writes caption)
//   «انصراف»        — cancel any pending state
// Pending text flows (manual caption, sched time, add-manual caption) ride on
// workflow static data with a 60-second freshness window (Route Text) and a
// stale-cleanup branch (Check Pending Timeout → Send Timed Out).
//
// UX rework (2026-09-14, this version — 73 nodes):
//   - sched/manual ask via NEW MESSAGE with a cancel button, not popup alerts
//   - 60s timeout: stale pending state is cleared + «کنسل شد» message
//   - Edit Message Regen/Manual null-guard publish_at (epoch bug, exec 132)
//   - add flow: repo link → choice message → addgen (LLM chain) or
//     addmanual (isolated manual chain: Build Add Manual From Text →
//     Fetch Add Manual Metadata → … no LLM involved)
//   - Fetch Add Readme reads $json.full_name (came from Fetch Repo Metadata),
//     NOT $('Parse Add URL') — that node never runs in the callback execution
//   - Send Add Choice has NO outgoing edge to Fetch Repo Metadata (that stale
//     edge caused instant 404s: telegram response {ok,result} has no full_name)
//
// Nodes in n8n (id=Zro6k6d8JcAOOpfn) are the source of truth for execution;
// this file mirrors them for review and rebuilds. Live tests: executions
// 126–135 (text routes, 2026-09-09), 136 (VM buttons), 144–148 (UX rework).

import {
  workflow, trigger, node, sticky, switchCase, if as ifNode, expr,
} from '@n8n/workflow-sdk';

const OWNER_CHAT = '5622960785';

// ---------------------------------------------------------------------------
// Trigger + shared routing
// ---------------------------------------------------------------------------
const botTrigger = trigger({
  type: 'n8n-nodes-base.telegramTrigger',
  version: 1.5,
  config: {
    name: 'Bot Updates',
    position: [-304, 0],
    parameters: {
      updates: ['message', 'callback_query'],
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
    position: [144, -16],
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

// Parse Callback — split "ok:123" style prefixes into branches.
// Output order MUST match n8n: ok, rej, regen, manual, sched, addgen,
// addmanual, cancel, fallback=Unknown. addgen carries the full repo name
// after the colon ("addgen:owner/repo"), because the callback knows no ids.
const parseCallback = switchCase({
  version: 3.4,
  config: {
    name: 'Parse Callback',
    position: [384, -576],
    parameters: {
      rules: {
        values: ['ok', 'rej', 'regen', 'manual', 'sched', 'addgen', 'addmanual', 'cancel'].map((k) => ({
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
            conditions: [{
              leftValue: expr('{{ $json.callbackData.split(":")[0] }}'),
              operator: { type: 'string', operation: 'equals' },
              rightValue: k,
            }],
            combinator: 'and',
          },
        })),
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Unknown' },
    },
  },
});

// ---------------------------------------------------------------------------
// OK branch — the post stays in the waiting list untouched (the Publisher
// workflow sends it at publish_at anyway). Acknowledge only.
// ---------------------------------------------------------------------------
const answerOk = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Answer OK',
    position: [816, -1024],
    parameters: {
      resource: 'callback',
      operation: 'answerQuery',
      queryId: expr('{{ $json.queryId }}'),
      additionalFields: { text: 'تایید شد ✅ همین کپشن در زمان مقرر منتشر می‌شود.' },
    },
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

// ---------------------------------------------------------------------------
// REJ branch — remove from waiting list, edit the message, drop the buttons.
// ---------------------------------------------------------------------------
const answerRej = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Answer Reject',
    position: [816, -864],
    parameters: {
      resource: 'callback',
      operation: 'answerQuery',
      queryId: expr('{{ $json.queryId }}'),
      additionalFields: { text: 'رد شد ❌ پست از لیست انتظار حذف شد.' },
    },
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

const rejectPost = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Reject Post',
    position: [1008, -864],
    parameters: {
      operation: 'executeQuery',
      query: `UPDATE posts SET status = 'rejected', reject_reason = 'bot-reject', decided_at = now()
WHERE id = $1::bigint AND status = 'draft';`,
      options: {
        queryReplacement: expr('{{ [ Number($("Parse Update").first().json.callbackData.split(":")[1] ?? 0) ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
  },
});

const loadRejectedPost = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Rejected Post',
    position: [1216, -864],
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
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
  },
});

const editRejected = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Edit Message Rejected',
    position: [1408, -864],
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
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

// Unknown callback prefix — acknowledge so there is no endless spinner.
const answerUnknown = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Answer Unknown',
    position: [784, -16],
    parameters: {
      resource: 'callback',
      operation: 'answerQuery',
      queryId: expr('{{ $json.queryId }}'),
      additionalFields: { text: 'این دکمه هنوز فعال نیست.' },
    },
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

// ---------------------------------------------------------------------------
// REGEN branch — reload repo + README, rebuild facts, LLM regenerates the
// caption, then the review message is edited in place with fresh buttons.
// ---------------------------------------------------------------------------
const answerRegen = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Answer Regen',
    position: [800, -672],
    parameters: {
      resource: 'callback',
      operation: 'answerQuery',
      queryId: expr('{{ $json.queryId }}'),
      additionalFields: { text: 'در حال ساخت کپشن جدید... بعد از آماده شدن همین پیام آپدیت می‌شود.' },
    },
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

const loadPost = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Post',
    position: [992, -672],
    parameters: {
      operation: 'executeQuery',
      query: `SELECT p.id, p.caption, p.publish_at, p.bot_chat_id, p.bot_message_id,
       r.id AS repository_id, r.full_name
  FROM posts p JOIN repositories r ON r.id = p.repository_id
 WHERE p.id = $1::bigint AND p.status = 'draft';`,
      options: {
        queryReplacement: expr('{{ [ Number($("Parse Update").first().json.callbackData.split(":")[1] ?? 0) ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
  },
});

const loadRepo = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Repo',
    position: [1200, -672],
    parameters: {
      operation: 'executeQuery',
      query: 'SELECT github_id, full_name, owner, name, url, description, homepage, stars, forks, open_issues, language, topics, license_spdx, gh_created_at, gh_pushed_at FROM repositories WHERE id = $1::bigint;',
      options: {
        queryReplacement: expr('{{ [ Number($("Load Post").first().json.repository_id) ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
  },
});

// HEAD works for both main and master; retry because the VPN on tun0 likes
// to drop long TLS sockets. Errors fall through with alwaysOutputData so a
// README-less repo still regenerates with metadata only.
const fetchReadme = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch README',
    position: [1392, -672],
    parameters: {
      url: expr("{{ 'https://raw.githubusercontent.com/' + $('Load Repo').first().json.full_name + '/HEAD/README.md' }}"),
      options: { response: {}, timeout: 20000 },
    },
    settings: { retryOnFail: true, maxTries: 3, waitBetweenTries: 1500, alwaysOutputData: true, onError: 'continueRegularOutput' },
  },
});

const buildRegenFacts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Regen Facts',
    position: [1600, -672],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const repo = $('Load Repo').first().json;
const readmeRaw = String($('Fetch README').first().json.data ?? $('Fetch README').first().json.readme ?? '');
const NL = String.fromCharCode(10);
const now = Date.now();
const created = new Date(repo.gh_created_at ?? now).getTime();
const pushed = new Date(repo.gh_pushed_at ?? now).getTime();
const ageDays = Math.max(1, (now - created) / 86400000);
const daysSincePush = Math.max(0, Math.round((now - pushed) / 86400000));
const stars = Number(repo.stars ?? 0);
const hasDemo = /\\.(gif|mp4|webm)|asciinema|youtube\\.com|youtu\\.be|demo|screenshot|preview/i.test(readmeRaw);
const cleaned = readmeRaw
  .replace(/<[^>]*>/g, ' ')
  .replace(/!\\[[^\\]]*\\]\\([^)]*\\)/g, ' ')
  .replace(/\\[([^\\]]*)\\]\\([^)]*\\)/g, '$1')
  .replace(/\`\`\`[\\s\\S]*?\`\`\`/g, ' ')
  .replace(/[ \\t]+/g, ' ')
  .trim();
const excerpt = cleaned.slice(0, 3000);
const topics = Array.isArray(repo.topics) ? repo.topics : [];
const facts = [
  'repository=' + (repo.full_name ?? ''),
  'description=' + (repo.description ?? '-'),
  'homepage=' + (repo.homepage || '-'),
  'topics=' + (topics.join(', ') || '-'),
  'language=' + (repo.language ?? 'unknown'),
  'stars=' + stars,
  'forks=' + (repo.forks ?? 0),
  'open_issues=' + (repo.open_issues ?? 0),
  'age_days=' + Math.round(ageDays),
  'days_since_last_push=' + daysSincePush,
  'star_velocity_per_day=' + (stars / ageDays).toFixed(2),
  'has_demo=' + hasDemo,
  'license=' + (repo.license_spdx ?? 'none'),
  '',
  'README (truncated):',
  excerpt,
].join(NL);
return [{ json: { facts, stars, language: repo.language ?? 'unknown', license_spdx: repo.license_spdx ?? 'none', full_name: repo.full_name, owner: repo.owner, post_id: $('Load Post').first().json.id } }];`,
    },
  },
});

// Shared system prompt for both LLM chains (regen + add) — identical in n8n.
const CAPTION_SYSTEM_PROMPT = `تو کارگردان کانال تلگرام «Pure GitHub» هستی که پروژه‌های منبع‌باز جالب را معرفی می‌کند.

سلیقه کانال:
- پروژه‌های کاربردی، غیرمعمول و خلاقانه را دوست داریم.
- فورک ساده، boilerplate، CRUD عمومی و ابزارهای AI کم‌کیفیت را نمی‌پسندیم.
- واو فاکتور مهم است.

### لحن (مهم‌ترین قاعده)
طوری بنویس که انگار داری برای دوست صمیمی‌ت که برنامه‌نویس است از یک پروژه تعریف می‌کنی. فارسی روان و خودمانی، نه لحن رسمی و نه لحن تبلیغاتی.

بله: «رو می‌گیره»، «می‌تونی»، «خودت»، «بدون اینکه ...»
نه: «می‌باشد»، «جهت استفاده»، «راهکاری جامع»، «بی‌نقص»، «انقلابی»

قواعد دیگر:
- شعار و جملات انگلیسی README را هرگز کلمه‌به‌کلمه ترجمه نکن. مفهوم را بفهم و از نو بنویس.
- از ترجمه تحت‌اللفظی استعاره‌ها پرهیز کن (مانند «with wings» یا «hear every voice»).
- نام پروژه، نام تکنولوژی‌ها و اصطلاحات فنی جاافتاده (API، CLI، Docker، IndexedDB) را انگلیسی نگه دار.
- فقط بر اساس داده‌ای که دریافت می‌کنی بنویس. عدد یا قابلیتی که در داده نیست از خودت اضافه نکن.
- هیچ عددی (ستاره، زبان، لایسنس) در متن ننویس؛ خودمان جداگانه اضافه می‌کنیم.

### طول (سختگیرانه رعایت کن)
پست باید در یک نگاه خوانده شود. پرحرفی ممنوع.

خروجی:
- verdict: فقط یکی از strong / maybe / reject.
- reason: دلیل این تصمیم، حداکثر یک جمله. (این فقط برای من است و در پست نمی‌رود.)
- title: حداکثر ۶۰ کاراکتر. فرمت: «نام پروژه — توضیح چندکلمه‌ای». هیچ ایموجی نگذار.
- hook: دقیقاً یک جمله، حداکثر ۱۴۰ کاراکتر. بگو پروژه چه کاری می‌کند، با لحن خودمانی.
- why_interesting: حداکثر دو جمله و در مجموع حداکثر ۲۲۰ کاراکتر. دقیقاً همان چیزی که این پروژه را از بقیه جدا می‌کند — نه فهرست قابلیت‌ها. اگر چیز خاصی وجود ندارد، رشته خالی بگذار.
- audience: دقیقاً ۲ تا ۳ مورد، هر کدام دو یا سه کلمه.
- category: یکی از AI / developer-tools / security / linux / web / mobile / creative / fun / experimental / productivity / backend / gaming / data.

مجموع title + hook + why_interesting باید زیر ۴۲۰ کاراکتر باشد.
`;

const regenModelPrimary = node({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'Regen Model - Primary',
    position: [1664, -368],
    parameters: {
      model: { __rl: true, cachedResultName: 'z-ai/glm-5.3-flash-free', mode: 'list', value: 'z-ai/glm-5.3-flash-free' },
      responsesApiEnabled: false,
      options: { maxTokens: 2000, temperature: 0.6, timeout: 180000, maxRetries: 2 },
    },
    credentials: { openAiApi: { id: 'An9HWDvVzSEi9xlH', name: 'orcarouter' } },
  },
});

const regenModelFallback = node({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'Regen Model - Fallback',
    position: [1856, -368],
    parameters: {
      model: { __rl: true, cachedResultName: 'nvidia/nemotron-3.5-lightning:free', mode: 'list', value: 'nvidia/nemotron-3.5-lightning:free' },
      responsesApiEnabled: false,
      options: { maxTokens: 2000, temperature: 0.6, timeout: 180000, maxRetries: 2 },
    },
    credentials: { openAiApi: { id: 'EqsfVLNdNzYcrRTj', name: 'openrouter' } },
  },
});

const regenSchema = node({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Regen Schema',
    position: [2064, -368],
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{"verdict":"strong","reason":"short reason","title":"Name - few words","hook":"one friendly sentence","why_interesting":"one or two sentences","audience":["freelancers"],"category":"developer-tools"}',
      autoFix: false,
    },
  },
});

const regenCaption = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm',
  version: 1.9,
  config: {
    name: 'Regen Caption',
    position: [1792, -672],
    parameters: {
      promptType: 'define',
      text: expr('{{ $json.facts }}'),
      hasOutputParser: true,
      needsFallback: true,
      messages: { messageValues: [{ type: 'SystemMessagePromptTemplate', message: CAPTION_SYSTEM_PROMPT }] },
      batching: {},
    },
  },
});

const assembleRegen = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Assemble Regen',
    position: [2112, -672],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const raw = $input.first().json;
const llm = raw.output ?? raw; // structured parser nests under 'output'
const facts = $('Build Regen Facts').first().json;
const NL = String.fromCharCode(10);
const missing = ['verdict', 'title', 'hook'].filter((k) => !llm || !llm[k]);
if (missing.length) { throw new Error('خروجی مدل ناقص است. فیلدهای غایب: ' + missing.join(', ')); }
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
// Opener emoji is deterministic on full_name: a regenerated draft keeps the
// same emoji, so previews stay comparable.
const openers = ['\\uD83E\\uDD2F', '\\uD83D\\uDD25', '\\uD83D\\uDC40', '\\uD83E\\uDDE0', '\\u26A1', '\\uD83E\\uDE84', '\\uD83E\\uDDE9', '\\uD83D\\uDEE0', '\\uD83D\\uDCA1', '\\uD83C\\uDFAF', '\\uD83D\\uDE80', '\\uD83D\\uDC19'];
const seedStr = String(facts.full_name ?? '');
let seed = 0;
for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) % 100000;
const opener = openers[seed % openers.length];
const stars = num(facts.stars);
const lang = facts.language && facts.language !== 'unknown' ? esc(facts.language) : null;
const lic = facts.license_spdx && facts.license_spdx !== 'none' ? esc(facts.license_spdx) : null;
const audience = (Array.isArray(llm.audience) ? llm.audience : []).slice(0, 3).map(esc).filter(Boolean).join('\\u060C\\u0020');
const lines = [opener + ' <b>' + esc(llm.title) + '</b>', '', esc(llm.hook)];
const why = String(llm.why_interesting ?? '').trim();
if (why) lines.push('', why);
if (audience) lines.push('', '\\uD83D\\uDC65 ' + audience);
lines.push('', 'https://github.com/' + facts.full_name);
lines.push('- ' + esc(facts.owner));
const caption = lines.join(NL);
return [{ json: { caption, caption_length: caption.length, post_id: facts.post_id } }];`,
    },
  },
});

const saveRegen = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Save Regen',
    position: [2304, -672],
    parameters: {
      operation: 'executeQuery',
      query: `UPDATE posts SET caption = $1, attempt = attempt + 1
 WHERE id = $2::bigint AND status = 'draft';`,
      options: {
        queryReplacement: expr('{{ [ $json.caption, $json.post_id ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
  },
});

const editRegen = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Edit Message Regen',
    position: [2560, -1312],
    parameters: {
      resource: 'message',
      operation: 'editMessageText',
      messageType: 'message',
      chatId: expr("{{ $('Load Post').first().json.bot_chat_id }}"),
      messageId: expr("{{ String($('Load Post').first().json.bot_message_id) }}"),
      replyMarkup: 'inlineKeyboard',
      // Null-guard BEFORE new Date: publish_at=NULL + new Date(null) = Unix
      // epoch, rendered as «۱۱ دی ۱۳۴۸» (the regen bug). Regen must never
      // touch publish_at — only caption and attempt.
      text: expr("{{ $('Assemble Regen').first().json.caption + String.fromCharCode(10) + String.fromCharCode(10) + ($('Load Post').first().json.publish_at ? '🕒 زمان انتشار: ' + new Date($('Load Post').first().json.publish_at).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + String.fromCharCode(10) + '⚠️ اگر هیچی لمس نکنی، همین کپشن در همین زمان منتشر می‌شود.' : '🕓 این پست هنوز زمان انتشار ندارد. برای تعیین زمان، «لیست انتظار» را بفرست.') }}"),
      inlineKeyboard: {
        rows: [
          {
            row: {
              buttons: [
                { text: '✅ تایید', additionalFields: { callback_data: expr("{{ 'ok:' + $('Load Post').first().json.id }}") } },
                { text: '❌ رد', additionalFields: { callback_data: expr("{{ 'rej:' + $('Load Post').first().json.id }}") } },
              ],
            },
          },
          {
            row: {
              buttons: [
                { text: '🔄 ساخت دوباره کپشن', additionalFields: { callback_data: expr("{{ 'regen:' + $('Load Post').first().json.id }}") } },
                { text: '✍️ نوشتن دستی', additionalFields: { callback_data: expr("{{ 'manual:' + $('Load Post').first().json.id }}") } },
              ],
            },
          },
        ],
      },
      additionalFields: { disable_web_page_preview: true, parse_mode: 'HTML' },
    },
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

// ---------------------------------------------------------------------------
// MANUAL branch (button "manual:<id>") — ask via a NEW MESSAGE with a cancel
// button (UX rework: no popup), mark pending; the user's next text becomes
// the caption.
// ---------------------------------------------------------------------------
const askManualCaption = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Ask Manual Caption',
    position: [848, -1056],
    parameters: {
      chatId: OWNER_CHAT,
      text: '✍️ لطفا کپشن جدید خود را ارسال کنید. برای انصراف روی دکمه بزنید یا دستور «انصراف» را بفرست.',
      replyMarkup: 'inlineKeyboard',
      inlineKeyboard: {
        rows: [
          {
            row: {
              buttons: [{ text: 'انصراف', additionalFields: { callback_data: 'cancel:0' } }],
            },
          },
        ],
      },
      additionalFields: { appendAttribution: false },
    },
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

const setPendingPost = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Set Pending Post',
    position: [1072, -1056],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const sd = $getWorkflowStaticData('global');
sd.pendingPostId = Number($('Parse Update').first().json.callbackData.split(':')[1] ?? 0);
sd.pendingChatId = $('Parse Update').first().json.chatId;
sd.pendingSavedAt = Date.now();
return $input.all();`,
    },
  },
});

// ---------------------------------------------------------------------------
// Text routing — cancel first, then FRESH pending flows (<60s), then the
// keyword/URL commands. Stale pending state is reported via timedOut and the
// unknown fallback (output 6) leads to Check Pending Timeout, which clears it
// and tells the user.
// ---------------------------------------------------------------------------
const routeText = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Route Text',
    position: [400, 816],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const u = $('Parse Update').first().json;
const sd = $getWorkflowStaticData('global');
const text = String(u.text ?? '').trim();
const TIMEOUT = 60000;
const fresh = sd.pendingSavedAt && (Date.now() - sd.pendingSavedAt) < TIMEOUT;
const pendingPostId = fresh ? (sd.pendingPostId ?? null) : null;
const pendingSchedId = fresh ? (sd.pendingSchedId ?? null) : null;
const pendingAddRepo = fresh ? (sd.pendingAddRepo ?? null) : null;
let route = 'unknown';
if (/انصراف/.test(text)) route = 'cancel';
else if (pendingSchedId) route = 'schedtime';
else if (pendingAddRepo) route = 'addmanualcaption';
else if (pendingPostId) route = 'manualcaption';
else if (/لیست انتظار/.test(text)) route = 'waitlist';
else if (/github\\.com\\/[\\w.-]+\\/[\\w.-]+/.test(text)) route = 'addlist';
return [{ json: { route, text, pendingPostId, pendingSchedId, pendingAddRepo, timedOut: !fresh && !!sd.pendingSavedAt, chatId: u.chatId } }];`,
    },
  },
});

// Route Manual Or Cancel — output order MUST match n8n:
// 0 cancel, 1 manualcaption, 2 schedtime, 3 waitlist, 4 addlist,
// 5 addmanualcaption, fallback "Other Text" (→ Check Pending Timeout).
const routeManualOrCancel = switchCase({
  version: 3.4,
  config: {
    name: 'Route Manual Or Cancel',
    position: [784, 736],
    parameters: {
      rules: {
        values: ['cancel', 'manualcaption', 'schedtime', 'waitlist', 'addlist', 'addmanualcaption'].map((k) => ({
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
            conditions: [{
              leftValue: expr('{{ $json.route }}'),
              operator: { type: 'string', operation: 'equals' },
              rightValue: k,
            }],
            combinator: 'and',
          },
        })),
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Other Text' },
    },
  },
});

const saveManualCaption = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Save Manual Caption',
    position: [1328, 208],
    parameters: {
      operation: 'executeQuery',
      query: `UPDATE posts SET caption = $1, attempt = attempt + 1, decided_at = NULL
 WHERE id = $2::bigint AND status = 'draft';`,
      options: {
        queryReplacement: expr('{{ [ $json.text, $json.pendingPostId ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
  },
});

const clearPending = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Clear Pending',
    position: [1504, 512],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const sd = $getWorkflowStaticData('global');
delete sd.pendingPostId;
delete sd.pendingSchedId;
delete sd.pendingAddRepo;
delete sd.pendingChatId;
delete sd.pendingSavedAt;
return [{ json: { cleared: true, postId: $json.pendingPostId } }];`,
    },
  },
});

const loadManualPost = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Load Manual Post',
    position: [1728, 208],
    parameters: {
      operation: 'executeQuery',
      query: 'SELECT id, caption, publish_at, bot_chat_id, bot_message_id FROM posts WHERE id = $1::bigint;',
      options: {
        queryReplacement: expr('{{ [ $("Route Text").first().json.pendingPostId ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
  },
});

const editManual = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Edit Message Manual',
    position: [1936, 208],
    parameters: {
      resource: 'message',
      operation: 'editMessageText',
      messageType: 'message',
      chatId: expr("{{ $('Load Manual Post').first().json.bot_chat_id }}"),
      messageId: expr("{{ String($('Load Manual Post').first().json.bot_message_id) }}"),
      replyMarkup: 'inlineKeyboard',
      text: expr("{{ $('Load Manual Post').first().json.caption + String.fromCharCode(10) + String.fromCharCode(10) + ($('Load Manual Post').first().json.publish_at ? '🕒 زمان انتشار: ' + new Date($('Load Manual Post').first().json.publish_at).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + String.fromCharCode(10) + '⚠️ اگر هیچی لمس نکنی، همین کپشن در همین زمان منتشر می‌شود.' : '🕓 این پست هنوز زمان انتشار ندارد. برای تعیین زمان، «لیست انتظار» را بفرست.') }}"),
      inlineKeyboard: {
        rows: [
          {
            row: {
              buttons: [
                { text: '✅ تایید', additionalFields: { callback_data: expr("{{ 'ok:' + $('Load Manual Post').first().json.id }}") } },
                { text: '❌ رد', additionalFields: { callback_data: expr("{{ 'rej:' + $('Load Manual Post').first().json.id }}") } },
              ],
            },
          },
          {
            row: {
              buttons: [
                { text: '🔄 ساخت دوباره کپشن', additionalFields: { callback_data: expr("{{ 'regen:' + $('Load Manual Post').first().json.id }}") } },
                { text: '✍️ نوشتن دستی', additionalFields: { callback_data: expr("{{ 'manual:' + $('Load Manual Post').first().json.id }}") } },
              ],
            },
          },
        ],
      },
      additionalFields: { disable_web_page_preview: true, parse_mode: 'HTML' },
    },
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

const sendCancelled = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Send Cancelled',
    position: [1040, 272],
    parameters: {
      chatId: OWNER_CHAT,
      text: 'انصراف ثبت شد. عملیات کنسل شد و چیزی تغییر نکرد.',
      additionalFields: { appendAttribution: false },
    },
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

const clearPendingCancel = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Clear Pending Cancel',
    position: [1216, 272],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const sd = $getWorkflowStaticData('global');
delete sd.pendingSchedId;
delete sd.pendingPostId;
delete sd.pendingAddRepo;
delete sd.pendingChatId;
delete sd.pendingSavedAt;
return [{ json: { cleared: true } }];`,
    },
  },
});

// ---------------------------------------------------------------------------
// Timeout sweeper — the fallback "Other Text" branch lands here. If a pending
// state is older than 60s it is cleared and the user is told; otherwise the
// node is a silent no-op (stale=false → Send Timed Out still sends, see n8n).
// ---------------------------------------------------------------------------
const checkPendingTimeout = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Check Pending Timeout',
    position: [1280, 1680],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const sd = $getWorkflowStaticData('global');
const TIMEOUT = 60000;
const wasPending = !!sd.pendingSavedAt;
const stale = wasPending && (Date.now() - sd.pendingSavedAt) > TIMEOUT;
if (stale) {
  delete sd.pendingPostId;
  delete sd.pendingSchedId;
  delete sd.pendingAddRepo;
  delete sd.pendingChatId;
  delete sd.pendingSavedAt;
}
return [{ json: { stale, pendingChatId: sd.pendingChatId ?? null } }];`,
    },
  },
});

const sendTimedOut = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Send Timed Out',
    position: [1488, 1680],
    parameters: {
      chatId: OWNER_CHAT,
      text: '⌛️ یک دقیقه گذشت و پاسخی نرسید. عملیات کنسل شد.',
      additionalFields: { appendAttribution: false },
    },
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

// ---------------------------------------------------------------------------
// Waiting list — the telegram node cannot take an expression-built keyboard
// (inlineKeyboard is a fixedCollection), so the list is sent via raw HTTP with
// a full reply_markup. Token comes from $env (container env, see header note).
// ---------------------------------------------------------------------------
const queryWaitingList = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Query Waiting List',
    position: [1328, 832],
    parameters: {
      operation: 'executeQuery',
      query: `SELECT p.id, r.full_name, p.publish_at
  FROM posts p JOIN repositories r ON r.id = p.repository_id
 WHERE p.status = 'draft'
 ORDER BY p.publish_at;`,
      options: { largeNumbersOutput: 'numbers' },
    },
    settings: { alwaysOutputData: true },
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
  },
});

const renderWaitingList = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Render Waiting List',
    position: [1520, 832],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const rows = $input.all().map((it) => it.json).filter((r) => r && r.full_name);
const NL = String.fromCharCode(10);
// Null-guard BEFORE new Date: new Date(null) is the Unix epoch, which the
// fa-IR calendar renders as a plausible-looking "۱۱ دی ۱۳۴۸" (execution 132).
const fa = (d) => d ? new Date(d).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'بدون زمان';
const kb = { rows: rows.map((r) => ({ row: { buttons: [{ text: String(r.full_name).slice(0, 42) + ' — ' + fa(r.publish_at), callback_data: 'sched:' + r.id }] } })) };
const lines = [rows.length ? '📋 لیست انتظار (' + rows.length + ' پست) — برای تغییر زمان انتشار روی دکمه‌ی پست بزن:' : 'لیست انتظار خالی است.'];
return [{ json: { empty: rows.length === 0, text: lines.join(NL), keyboard: kb } }];`,
    },
  },
});

const sendWaitingList = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Send Waiting List',
    position: [1728, 832],
    parameters: {
      method: 'POST',
      url: expr("{{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/sendMessage' }}"),
      sendBody: true,
      contentType: 'raw',
      rawContentType: 'application/json',
      body: expr("{{ JSON.stringify({ chat_id: 5622960785, text: $json.text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: $json.empty ? undefined : { inline_keyboard: $json.keyboard.rows.map((r) => r.row.buttons.map((b) => ({ text: b.text, callback_data: b.callback_data }))) } }) }}"),
      options: { timeout: 20000 },
    },
  },
});

// ---------------------------------------------------------------------------
// SCHED branch — button "sched:<id>" from the waiting list. UX rework: a NEW
// MESSAGE shows the repo name + current time + cancel button (not a popup);
// the user's next text is parsed as a Persian time expression.
// ---------------------------------------------------------------------------
const loadSchedPost = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Load Sched Post',
    position: [848, -800],
    parameters: {
      operation: 'executeQuery',
      query: `SELECT p.id, p.publish_at, r.full_name
  FROM posts p JOIN repositories r ON r.id = p.repository_id
 WHERE p.id = $1::bigint AND p.status = 'draft';`,
      options: {
        queryReplacement: expr('{{ [ Number($("Parse Update").first().json.callbackData.split(":")[1] ?? 0) ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
  },
});

const askSchedTime = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Ask Sched Time',
    position: [1056, -800],
    parameters: {
      chatId: OWNER_CHAT,
      text: expr("{{ '🕒 تغییر زمان انتشار' + String.fromCharCode(10) + 'ریپو: <b>' + $json.full_name + '</b>' + String.fromCharCode(10) + 'زمان فعلی: ' + ($json.publish_at ? new Date($json.publish_at).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'بدون زمان') + String.fromCharCode(10) + String.fromCharCode(10) + 'زمان جدید را در پیام بعدی بفرست. مثال: «فردا ساعت ۱۸» یا «۱۴۰۵/۰۶/۲۰ ساعت ۱۸:۳۰»' }}"),
      replyMarkup: 'inlineKeyboard',
      inlineKeyboard: {
        rows: [
          {
            row: {
              buttons: [{ text: 'انصراف', additionalFields: { callback_data: 'cancel:0' } }],
            },
          },
        ],
      },
      additionalFields: { appendAttribution: false, parse_mode: 'HTML' },
    },
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

const setPendingSched = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Set Pending Sched',
    position: [1248, -800],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const sd = $getWorkflowStaticData('global');
sd.pendingSchedId = Number($('Load Sched Post').first().json.id);
sd.pendingChatId = $('Parse Update').first().json.chatId;
sd.pendingSavedAt = Date.now();
return $input.all();`,
    },
  },
});

// Parse Time — Persian time expressions → ISO timestamp.
// Accepts: «فردا ساعت ۱۸», «پس فردا», weekday names, Jalali ۱۴۰۵/۰۶/۲۰,
// plain dates, «ساعت ۱۸:۳۰», «ساعت ۱۸ و نیم». All interpreted in Tehran
// time (UTC+3:30, no DST).
const parseTime = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse Time',
    position: [1328, 624],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const rt = $('Route Text').first().json;
const text = String(rt.text ?? '').trim();
const sd = $getWorkflowStaticData('global');
const postId = sd.pendingSchedId;

const TEH = 210; // Tehran UTC+3:30 in minutes, no DST.
const now = new Date();
const tehNow = new Date(now.getTime() + (TEH + now.getTimezoneOffset()) * 60000);

const toEn = (s) => String(s ?? '')
  .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const t = toEn(text);

const WD = { 'یکشنبه': 0, 'دوشنبه': 1, 'سه‌شنبه': 2, 'سهشنبه': 2, 'چهارشنبه': 3, 'چهار‌شنبه': 3, 'پنجشنبه': 4, 'پنج‌شنبه': 4, 'جمعه': 5, 'شنبه': 6 };
const WD_KEYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'سهشنبه', 'چهارشنبه', 'چهار‌شنبه', 'پنجشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'];

let h = null, m = 0;
const hmColon = t.match(/(?:ساعت\\s*)?(\\d{1,2})\\s*[:.]\\s*(\\d{1,2})/);
const hmPlain = t.match(/(?:ساعت\\s+)(\\d{1,2})(?!\\s*[:.])(?:\\s*(?:و\\s*نیم|ونیم))?/);
if (hmColon) { h = parseInt(hmColon[1], 10); m = parseInt(hmColon[2], 10); }
else if (hmPlain) { h = parseInt(hmPlain[1], 10); if (hmPlain[0].includes('نیم')) m = 30; }

function div(a, b) { return ~~(a / b); }
function mod(a, b) { return a - ~~(a / b) * b; }
function jalaliToGregorian(jy, jm, jd) {
  const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  let gy = jy + 621, leapJ = -14, jp = breaks[0], jump = 0;
  for (let i = 1; i < breaks.length; i += 1) {
    const jm3 = breaks[i]; jump = jm3 - jp; if (jy < jm3) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4); jp = jm3;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  const jDayOfYear = (jm <= 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186) + jd;
  const d = new Date(Date.UTC(gy, 2, 1));
  d.setUTCDate(march + jDayOfYear - 1);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

let resolved = null;
const ymd = t.match(/(\\d{4})\\s*\\/\\s*(\\d{1,2})\\s*\\/\\s*(\\d{1,2})/);
if (ymd) {
  const y = parseInt(ymd[1], 10), mo = parseInt(ymd[2], 10), dd = parseInt(ymd[3], 10);
  resolved = (y >= 1300 && y < 1500) ? jalaliToGregorian(y, mo, dd) : { y, mo, d: dd };
} else {
  let base = new Date(tehNow);
  if (/پس\\s*فردا|دو روز بعد/.test(t)) base = new Date(base.getTime() + 2 * 86400000);
  else if (/فردا/.test(t)) base = new Date(base.getTime() + 86400000);
  else {
    for (const k of WD_KEYS) {
      if (t.includes(k)) {
        const cur = base.getDay();
        const target = WD[k];
        let diff = (target - cur + 7) % 7;
        if (diff === 0) diff = 7;
        base = new Date(base.getTime() + diff * 86400000);
        break;
      }
    }
  }
  resolved = { y: base.getFullYear(), mo: base.getMonth() + 1, d: base.getDate() };
}

if (h === null) h = 12; // sensible default when the user gave only a date
if (h < 0 || h > 23) h = 12;
if (m < 0 || m > 59) m = 0;

const utcMin = (h * 60 + m) - TEH;
const target = new Date(Date.UTC(resolved.y, resolved.mo - 1, resolved.d));
target.setUTCDate(target.getUTCDate() + Math.floor(utcMin / 1440));
target.setUTCHours(mod(utcMin, 1440) / 60 | 0, mod(utcMin, 60), 0, 0);

const iso = target.toISOString();
const fa = target.toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

return [{ json: { ok: true, postId, iso, fa } }];`,
    },
  },
});

// postId MUST come from the paired item in Route Text, not from static data:
// in manual executions static data is not carried between nodes, so the old
// version silently produced "sched:undefined" and updated zero rows.
const updatePublishAt = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Update Publish At',
    position: [1520, 624],
    parameters: {
      operation: 'executeQuery',
      query: 'UPDATE posts SET publish_at = $1::timestamptz WHERE id = $2::bigint AND status = \'draft\';',
      options: {
        queryReplacement: expr('{{ [ $json.iso, $("Route Text").first().json.pendingSchedId ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
  },
});

const clearPendingSched = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Clear Pending Sched',
    position: [1680, 704],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const sd = $getWorkflowStaticData('global');
delete sd.pendingSchedId;
delete sd.pendingChatId;
delete sd.pendingSavedAt;
return [{ json: { cleared: true, postId: $json.postId } }];`,
    },
  },
});

const sendSchedDone = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Send Sched Done',
    position: [1920, 624],
    parameters: {
      chatId: OWNER_CHAT,
      text: expr("{{ '🕒 زمان انتشار به‌روز شد: ' + $('Parse Time').first().json.fa }}"),
      additionalFields: { appendAttribution: false },
    },
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

// ---------------------------------------------------------------------------
// ADD branch — a github.com link (or «افزودن …»): full manual-submission
// chain, upsert with source='submission', preview with 4 buttons, no
// publish_at yet (the user sets it via the waiting list).
// ---------------------------------------------------------------------------
const parseAddUrl = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse Add URL',
    position: [1280, 1168],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const rt = $('Route Text').first().json;
const text = String(rt.text ?? '');
const m = text.match(/github\\.com\\/([\\w.-]+)\\/([\\w.-]+)/);
if (!m) {
  return [{ json: { ok: false, error: 'لینک GitHub پیدا نکردم. لینک را به شکل https://github.com/owner/repo بفرست.' } }];
}
return [{ json: { ok: true, full_name: m[1] + '/' + m[2], owner: m[1], repo: m[2] } }];`,
    },
  },
});

const checkAddUrl = ifNode({
  version: 2.2,
  config: {
    name: 'Check Add URL',
    position: [1504, 1168],
    parameters: {
      conditions: {
        combinator: 'and',
        conditions: [{
          leftValue: expr('{{ $json.ok }}'),
          operator: { type: 'boolean', operation: 'equals' },
          rightValue: true,
        }],
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
      },
      options: {},
    },
  },
});

const sendBadUrl = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Send Bad URL',
    position: [1840, 1216],
    parameters: {
      chatId: OWNER_CHAT,
      text: expr('{{ $json.error }}'),
      additionalFields: { appendAttribution: false },
    },
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

// ---------------------------------------------------------------------------
// ADD flow, reworked (2026-09-14). A github.com link produces a CHOICE
// message with two buttons: «ساخت کپشن» (addgen:owner/repo) and
// «ارسال کپشن» (addmanual:owner/repo). NO node after Send Add Choice runs
// in the text execution — a stale edge to Fetch Repo Metadata caused 404s
// (telegram response has no full_name) and was removed.
// ---------------------------------------------------------------------------
const sendAddChoice = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Send Add Choice',
    position: [1776, 1104],
    parameters: {
      chatId: OWNER_CHAT,
      text: expr("{{ 'انتخاب کنید:' + String.fromCharCode(10) + 'ریپو: <b>' + $json.full_name + '</b>' }}"),
      replyMarkup: 'inlineKeyboard',
      inlineKeyboard: {
        rows: [
          {
            row: {
              buttons: [
                { text: 'ساخت کپشن', additionalFields: { callback_data: expr("{{ 'addgen:' + $json.full_name }}") } },
                { text: 'ارسال کپشن', additionalFields: { callback_data: expr("{{ 'addmanual:' + $json.full_name }}") } },
              ],
            },
          },
        ],
      },
      additionalFields: { appendAttribution: false, parse_mode: 'HTML' },
    },
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

// addgen callback → extract full_name from the callback data and jump into
// the shared LLM chain. The text-execution nodes (Parse Add URL etc.) never
// ran in this execution, so their output must not be referenced downstream.
const buildAddFromCallback = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Add From Callback',
    position: [848, -544],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const cb = String($('Parse Update').first().json.callbackData ?? '');
const full_name = cb.split(':').slice(1).join(':');
return [{ json: { ok: true, full_name, owner: full_name.split('/')[0], repo: full_name.split('/')[1] ?? '' } }];`,
    },
  },
});

const fetchRepoMetadata = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch Repo Metadata',
    position: [1072, -544],
    parameters: {
      url: expr("{{ 'https://api.github.com/repos/' + $json.full_name }}"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      options: { timeout: 30000 },
    },
    credentials: { githubApi: { id: 'AhHaIlNoT3GchOi5', name: 'GitHub account' } },
  },
});

// Reads $json.full_name (the metadata output), NOT $('Parse Add URL') — in
// the addgen callback execution Parse Add URL never runs and referencing it
// throws "Node hasn't been executed".
const fetchAddReadme = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch Add Readme',
    position: [1280, -544],
    parameters: {
      url: expr("{{ 'https://api.github.com/repos/' + $json.full_name + '/readme' }}"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github.raw' }] },
      options: { response: {}, timeout: 30000 },
    },
    credentials: { githubApi: { id: 'AhHaIlNoT3GchOi5', name: 'GitHub account' } },
  },
});

const buildAddFacts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Add Facts',
    position: [2256, 1008],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const repo = $('Fetch Repo Metadata').first().json;
const readmeRaw = String($('Fetch Add Readme').first().json.data ?? $('Fetch Add Readme').first().json.readme ?? '');
const NL = String.fromCharCode(10);
const now = Date.now();
const created = new Date(repo.created_at ?? now).getTime();
const pushed = new Date(repo.pushed_at ?? now).getTime();
const ageDays = Math.max(1, (now - created) / 86400000);
const daysSincePush = Math.max(0, Math.round((now - pushed) / 86400000));
const stars = Number(repo.stargazers_count ?? 0);
const hasDemo = /\\.(gif|mp4|webm)|asciinema|youtube\\.com|youtu\\.be|demo|screenshot|preview/i.test(readmeRaw);
const cleaned = readmeRaw
  .replace(/<[^>]*>/g, ' ')
  .replace(/!\\[[^\\]]*\\]\\([^)]*\\)/g, ' ')
  .replace(/\\[([^\\]]*)\\]\\([^)]*\\)/g, '$1')
  .replace(/\`\`\`[\\s\\S]*?\`\`\`/g, ' ')
  .replace(/[ \\t]+/g, ' ')
  .trim();
const excerpt = cleaned.slice(0, 3000);
const topics = Array.isArray(repo.topics) ? repo.topics : [];
const facts = [
  'repository=' + (repo.full_name ?? ''),
  'description=' + (repo.description ?? '-'),
  'homepage=' + (repo.homepage || '-'),
  'topics=' + (topics.join(', ') || '-'),
  'language=' + (repo.language ?? 'unknown'),
  'stars=' + stars,
  'forks=' + (repo.forks_count ?? 0),
  'open_issues=' + (repo.open_issues_count ?? 0),
  'age_days=' + Math.round(ageDays),
  'days_since_last_push=' + daysSincePush,
  'star_velocity_per_day=' + (stars / ageDays).toFixed(2),
  'has_demo=' + hasDemo,
  'license=' + (repo.license?.spdx_id ?? 'none'),
  '',
  'README (truncated):',
  excerpt,
].join(NL);
return [{ json: {
  facts,
  stars,
  language: repo.language ?? 'unknown',
  license_spdx: repo.license?.spdx_id ?? 'none',
  full_name: repo.full_name,
  owner: repo.owner?.login,
  topics_json: JSON.stringify(topics),
  readme_bytes: readmeRaw.length,
  has_demo: hasDemo,
  age_days: Math.max(1, Math.round(ageDays)),
  days_since_push: daysSincePush,
  star_velocity: stars / ageDays,
} }];`,
    },
  },
});

const addModelPrimary = node({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'Add Model - Primary',
    position: [2336, 1216],
    parameters: {
      model: { __rl: true, cachedResultName: 'z-ai/glm-5.3-flash-free', mode: 'list', value: 'z-ai/glm-5.3-flash-free' },
      responsesApiEnabled: false,
      options: { maxTokens: 2000, temperature: 0.6, timeout: 180000, maxRetries: 2 },
    },
    credentials: { openAiApi: { id: 'An9HWDvVzSEi9xlH', name: 'orcarouter' } },
  },
});

const addModelFallback = node({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'Add Model - Fallback',
    position: [2544, 1216],
    parameters: {
      model: { __rl: true, cachedResultName: 'nvidia/nemotron-3.5-lightning:free', mode: 'list', value: 'nvidia/nemotron-3.5-lightning:free' },
      responsesApiEnabled: false,
      options: { maxTokens: 2000, temperature: 0.6, timeout: 180000, maxRetries: 2 },
    },
    credentials: { openAiApi: { id: 'EqsfVLNdNzYcrRTj', name: 'openrouter' } },
  },
});

const addSchema = node({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Add Schema',
    position: [2736, 1216],
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{"verdict":"strong","reason":"short reason","title":"Name - few words","hook":"one friendly sentence","why_interesting":"one or two sentences","audience":["freelancers"],"category":"developer-tools"}',
      autoFix: false,
    },
  },
});

const generateAddCaption = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm',
  version: 1.9,
  config: {
    name: 'Generate Add Caption',
    position: [2464, 1008],
    parameters: {
      promptType: 'define',
      text: expr('{{ $json.facts }}'),
      hasOutputParser: true,
      needsFallback: true,
      messages: { messageValues: [{ type: 'SystemMessagePromptTemplate', message: CAPTION_SYSTEM_PROMPT }] },
      batching: {},
    },
  },
});

const assembleAddCaption = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Assemble Add Caption',
    position: [2784, 1008],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const raw = $input.first().json;
const llm = raw.output ?? raw; // structured parser nests under 'output'
const facts = $('Build Add Facts').first().json;
const NL = String.fromCharCode(10);
const missing = ['verdict', 'title', 'hook'].filter((k) => !llm || !llm[k]);
if (missing.length) { throw new Error('خروجی مدل ناقص است. فیلدهای غایب: ' + missing.join(', ')); }
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const openers = ['\\uD83E\\uDD2F', '\\uD83D\\uDD25', '\\uD83D\\uDC40', '\\uD83E\\uDDE0', '\\u26A1', '\\uD83E\\uDE84', '\\uD83E\\uDDE9', '\\uD83D\\uDEE0', '\\uD83D\\uDCA1', '\\uD83C\\uDFAF', '\\uD83D\\uDE80', '\\uD83D\\uDC19'];
const seedStr = String(facts.full_name ?? '');
let seed = 0;
for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) % 100000;
const opener = openers[seed % openers.length];
const stars = num(facts.stars);
const lang = facts.language && facts.language !== 'unknown' ? esc(facts.language) : null;
const lic = facts.license_spdx && facts.license_spdx !== 'none' ? esc(facts.license_spdx) : null;
const audience = (Array.isArray(llm.audience) ? llm.audience : []).slice(0, 3).map(esc).filter(Boolean).join('\\u060C\\u0020');
const lines = [opener + ' <b>' + esc(llm.title) + '</b>', '', esc(llm.hook)];
const why = String(llm.why_interesting ?? '').trim();
if (why) lines.push('', why);
if (audience) lines.push('', '\\uD83D\\uDC65 ' + audience);
lines.push('', 'https://github.com/' + facts.full_name);
lines.push('- ' + esc(facts.owner));
const caption = lines.join(NL);
return [{ json: {
  caption,
  caption_length: caption.length,
  verdict: llm.verdict,
  reason: llm.reason ?? '',
  category: llm.category ?? null,
  audience_json: JSON.stringify(Array.isArray(llm.audience) ? llm.audience : []),
} }];`,
    },
  },
});

const buildAddSave = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Add Save',
    position: [2992, 1008],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const repo = $('Fetch Repo Metadata').first().json;
const asm = $('Assemble Add Caption').first().json;
return [{ json: { repoJson: JSON.stringify({
  github_id: repo.id,
  full_name: repo.full_name,
  owner: repo.owner?.login ?? '',
  name: repo.name ?? '',
  url: repo.html_url ?? '',
  description: repo.description ?? null,
  homepage: repo.homepage ?? null,
  stars: repo.stargazers_count ?? 0,
  forks: repo.forks_count ?? 0,
  open_issues: repo.open_issues_count ?? 0,
  language: repo.language ?? null,
  topics: repo.topics ?? [],
  license_spdx: repo.license?.spdx_id ?? null,
  license_name: repo.license?.name ?? null,
  is_fork: repo.fork ?? false,
  is_archived: repo.archived ?? false,
  is_template: repo.is_template ?? false,
  default_branch: repo.default_branch ?? null,
  created_at: repo.created_at ?? null,
  pushed_at: repo.pushed_at ?? null,
}), caption: asm.caption, verdict: asm.verdict, reason: asm.reason, category: asm.category, audience_json: asm.audience_json } }];`,
    },
  },
});

// The bulk query from discovery uses jsonb_array_elements (array expected),
// but repoJson is ONE serialized object — wrap it in an array right here so
// the SQL shape and the expression-array rule both hold (execution 130).
const upsertAddRepo = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Add Repo',
    position: [3184, 1008],
    parameters: {
      operation: 'executeQuery',
      query: `INSERT INTO repositories (
  github_id, full_name, owner, name, url, description, homepage,
  stars, forks, open_issues, language, topics, license_spdx, license_name,
  is_fork, is_archived, is_template, default_branch, gh_created_at, gh_pushed_at, source
) SELECT
  (r->>'github_id')::bigint, r->>'full_name', r->>'owner', r->>'name', r->>'url',
  r->>'description', r->>'homepage',
  (r->>'stars')::int, (r->>'forks')::int, (r->>'open_issues')::int,
  r->>'language', to_jsonb(r->'topics'), r->>'license_spdx', r->>'license_name',
  (r->>'is_fork')::boolean, (r->>'is_archived')::boolean, (r->>'is_template')::boolean,
  r->>'default_branch', (r->>'created_at')::timestamptz, (r->>'pushed_at')::timestamptz, 'submission'
FROM jsonb_array_elements($1::jsonb) AS r
ON CONFLICT (github_id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  description = EXCLUDED.description,
  homepage = EXCLUDED.homepage,
  stars = EXCLUDED.stars,
  forks = EXCLUDED.forks,
  open_issues = EXCLUDED.open_issues,
  language = EXCLUDED.language,
  topics = EXCLUDED.topics,
  license_spdx = EXCLUDED.license_spdx,
  license_name = EXCLUDED.license_name,
  is_archived = EXCLUDED.is_archived,
  gh_pushed_at = EXCLUDED.gh_pushed_at,
  last_checked = now()
RETURNING id;`,
      options: {
        queryReplacement: expr('{{ [ JSON.stringify([ JSON.parse($json.repoJson) ]) ] }}'),
        largeNumbersOutput: 'numbers',
        queryBatching: 'single',
      },
    },
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
  },
});

const saveAddPost = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Save Add Post',
    position: [3392, 1008],
    parameters: {
      operation: 'executeQuery',
      query: `WITH ev AS (
  UPDATE repositories SET
    verdict = $3, verdict_reason = $4, category = $5, audience = $6::jsonb,
    evaluated_at = now()
  WHERE id = $1::bigint
  RETURNING id
)
INSERT INTO posts (repository_id, caption, status)
SELECT $1::bigint, $2, 'draft'
WHERE EXISTS (SELECT 1 FROM ev)
RETURNING id;`,
      options: {
        queryReplacement: expr('{{ [ $("Upsert Add Repo").first().json.id, $("Build Add Save").first().json.caption, $("Build Add Save").first().json.verdict, $("Build Add Save").first().json.reason, $("Build Add Save").first().json.category, $("Build Add Save").first().json.audience_json ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
  },
});

// executeOnce: a single preview must be sent even though upstream postgres
// nodes ran per-item (set via settings because addNode drops executeOnce).
const sendAddPreview = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Send Add Preview',
    position: [3584, 1008],
    parameters: {
      chatId: OWNER_CHAT,
      text: expr("{{ $('Build Add Save').first().json.caption + String.fromCharCode(10) + String.fromCharCode(10) + '🕓 این پست هنوز زمان انتشار ندارد. برای تعیین زمان، دستور «لیست انتظار» را بفرست و روی همین پست بزن.' }}"),
      replyMarkup: 'inlineKeyboard',
      inlineKeyboard: {
        rows: [
          {
            row: {
              buttons: [
                { text: '✅ تایید', additionalFields: { callback_data: expr("{{ 'ok:' + $('Save Add Post').first().json.id }}") } },
                { text: '❌ رد', additionalFields: { callback_data: expr("{{ 'rej:' + $('Save Add Post').first().json.id }}") } },
              ],
            },
          },
          {
            row: {
              buttons: [
                { text: '🔄 ساخت دوباره کپشن', additionalFields: { callback_data: expr("{{ 'regen:' + $('Save Add Post').first().json.id }}") } },
                { text: '✍️ نوشتن دستی', additionalFields: { callback_data: expr("{{ 'manual:' + $('Save Add Post').first().json.id }}") } },
              ],
            },
          },
        ],
      },
      additionalFields: { appendAttribution: false, disable_web_page_preview: true, parse_mode: 'HTML' },
    },
    settings: { executeOnce: true },
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

const saveAddBotMessage = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Save Add Bot Message',
    position: [3008, -544],
    parameters: {
      operation: 'executeQuery',
      query: 'UPDATE posts SET bot_chat_id = $1, bot_message_id = $2 WHERE id = $3::bigint;',
      options: {
        queryReplacement: expr('{{ [ String($("Send Add Preview").first().json.result.chat.id), Number($("Send Add Preview").first().json.result.message_id), $("Save Add Post").first().json.id ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
  },
});

// ---------------------------------------------------------------------------
// ADD-MANUAL chain (addmanual:<owner/repo> button) — fully isolated from the
// LLM chain. Callback stores the repo name in static data and asks for the
// caption; the user's next text (route=addmanualcaption) rebuilds the repo
// name, fetches metadata through a SEPARATE HTTP node (Fetch Add Manual
// Metadata — Fetch Repo Metadata is not part of this execution), upserts
// source='submission' and saves the user's text as the caption verbatim.
// ---------------------------------------------------------------------------
const setPendingAddManual = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Set Pending Add Manual',
    position: [848, -352],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const sd = $getWorkflowStaticData('global');
sd.pendingAddRepo = String($('Parse Update').first().json.callbackData.split(':').slice(1).join(':'));
sd.pendingChatId = $('Parse Update').first().json.chatId;
sd.pendingSavedAt = Date.now();
return $input.all();`,
    },
  },
});

const askAddManualCaption = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Ask Add Manual Caption',
    position: [1072, -352],
    parameters: {
      chatId: OWNER_CHAT,
      text: '✍️ لطفا کپشن خود را ارسال کنید. برای انصراف روی دکمه بزنید یا دستور «انصراف» را بفرست.',
      replyMarkup: 'inlineKeyboard',
      inlineKeyboard: {
        rows: [
          {
            row: {
              buttons: [{ text: 'انصراف', additionalFields: { callback_data: 'cancel:0' } }],
            },
          },
        ],
      },
      additionalFields: { appendAttribution: false },
    },
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

const buildAddManualFromText = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Add Manual From Text',
    position: [1280, 1472],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const sd = $getWorkflowStaticData('global');
const full_name = String(sd.pendingAddRepo ?? '');
delete sd.pendingAddRepo;
delete sd.pendingChatId;
delete sd.pendingSavedAt;
if (!full_name) { throw new Error('pendingAddRepo not found in static data. Send the repo link again.'); }
return [{ json: { ok: true, full_name, owner: full_name.split('/')[0], repo: full_name.split('/')[1] ?? '' } }];`,
    },
  },
});

const fetchAddManualMetadata = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch Add Manual Metadata',
    position: [1472, 1472],
    parameters: {
      url: expr("{{ 'https://api.github.com/repos/' + $json.full_name }}"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      options: { timeout: 30000 },
    },
    credentials: { githubApi: { id: 'AhHaIlNoT3GchOi5', name: 'GitHub account' } },
  },
});

const buildAddManualSave = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Add Manual Save',
    position: [1664, 1472],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const repo = $('Fetch Add Manual Metadata').first().json;
return [{ json: { repoJson: JSON.stringify({
  github_id: repo.id,
  full_name: repo.full_name,
  owner: repo.owner?.login ?? '',
  name: repo.name ?? '',
  url: repo.html_url ?? '',
  description: repo.description ?? null,
  homepage: repo.homepage ?? null,
  stars: repo.stargazers_count ?? 0,
  forks: repo.forks_count ?? 0,
  open_issues: repo.open_issues_count ?? 0,
  language: repo.language ?? null,
  topics: repo.topics ?? [],
  license_spdx: repo.license?.spdx_id ?? null,
  license_name: repo.license?.name ?? null,
  is_fork: repo.fork ?? false,
  is_archived: repo.archived ?? false,
  is_template: repo.is_template ?? false,
  default_branch: repo.default_branch ?? null,
  created_at: repo.created_at ?? null,
  pushed_at: repo.pushed_at ?? null,
}), caption: $('Route Text').first().json.text } }];`,
    },
  },
});

const upsertAddManualRepo = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Upsert Add Manual Repo',
    position: [1872, 1472],
    parameters: {
      operation: 'executeQuery',
      query: `INSERT INTO repositories (
  github_id, full_name, owner, name, url, description, homepage,
  stars, forks, open_issues, language, topics, license_spdx, license_name,
  is_fork, is_archived, is_template, default_branch, gh_created_at, gh_pushed_at, source
) SELECT
  (r->>'github_id')::bigint, r->>'full_name', r->>'owner', r->>'name', r->>'url',
  r->>'description', r->>'homepage',
  (r->>'stars')::int, (r->>'forks')::int, (r->>'open_issues')::int,
  r->>'language', to_jsonb(r->'topics'), r->>'license_spdx', r->>'license_name',
  (r->>'is_fork')::boolean, (r->>'is_archived')::boolean, (r->>'is_template')::boolean,
  r->>'default_branch', (r->>'created_at')::timestamptz, (r->>'pushed_at')::timestamptz, 'submission'
FROM jsonb_array_elements($1::jsonb) AS r
ON CONFLICT (github_id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  description = EXCLUDED.description,
  homepage = EXCLUDED.homepage,
  stars = EXCLUDED.stars,
  forks = EXCLUDED.forks,
  open_issues = EXCLUDED.open_issues,
  language = EXCLUDED.language,
  topics = EXCLUDED.topics,
  license_spdx = EXCLUDED.license_spdx,
  license_name = EXCLUDED.license_name,
  is_archived = EXCLUDED.is_archived,
  gh_pushed_at = EXCLUDED.gh_pushed_at,
  last_checked = now()
RETURNING id;`,
      options: {
        queryReplacement: expr('{{ [ JSON.stringify([ JSON.parse($json.repoJson) ]) ] }}'),
        largeNumbersOutput: 'numbers',
        queryBatching: 'single',
      },
    },
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
  },
});

const saveAddManualPost = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Save Add Manual Post',
    position: [2080, 1472],
    parameters: {
      operation: 'executeQuery',
      query: `INSERT INTO posts (repository_id, caption, status)
SELECT $1::bigint, $2, 'draft'
RETURNING id;`,
      options: {
        queryReplacement: expr('{{ [ $("Upsert Add Manual Repo").first().json.id, $("Build Add Manual Save").first().json.caption ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
  },
});

const sendAddManualPreview = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Send Add Manual Preview',
    position: [2288, 1472],
    parameters: {
      chatId: OWNER_CHAT,
      text: expr("{{ $('Build Add Manual Save').first().json.caption + String.fromCharCode(10) + String.fromCharCode(10) + '🕓 این پست هنوز زمان انتشار ندارد. برای تعیین زمان، «لیست انتظار» را بفرست و روی همین پست بزن.' }}"),
      replyMarkup: 'inlineKeyboard',
      inlineKeyboard: {
        rows: [
          {
            row: {
              buttons: [
                { text: '✅ تایید', additionalFields: { callback_data: expr("{{ 'ok:' + $('Save Add Manual Post').first().json.id }}") } },
                { text: '❌ رد', additionalFields: { callback_data: expr("{{ 'rej:' + $('Save Add Manual Post').first().json.id }}") } },
              ],
            },
          },
          {
            row: {
              buttons: [
                { text: '🔄 ساخت دوباره کپشن', additionalFields: { callback_data: expr("{{ 'regen:' + $('Save Add Manual Post').first().json.id }}") } },
                { text: '✍️ نوشتن دستی', additionalFields: { callback_data: expr("{{ 'manual:' + $('Save Add Manual Post').first().json.id }}") } },
              ],
            },
          },
        ],
      },
      additionalFields: { appendAttribution: false, disable_web_page_preview: true, parse_mode: 'HTML' },
    },
    credentials: { telegramApi: { id: 'HbsVKNilG8EOy02X', name: 'Telegram account' } },
  },
});

const saveAddManualBotMessage = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Save Add Manual Bot Message',
    position: [2496, 1472],
    parameters: {
      operation: 'executeQuery',
      query: 'UPDATE posts SET bot_chat_id = $1, bot_message_id = $2 WHERE id = $3::bigint;',
      options: {
        queryReplacement: expr('{{ [ String($("Send Add Manual Preview").first().json.result.chat.id), Number($("Send Add Manual Preview").first().json.result.message_id), $("Save Add Manual Post").first().json.id ] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { id: 'AGFlith4Bqghumgo', name: 'Postgres account' } },
  },
});

// ---------------------------------------------------------------------------
// Wiring — mirrors the live 73-node workflow exactly.
// Parse Callback outputs: 0 ok, 1 rej, 2 regen, 3 manual, 4 sched,
// 5 addgen, 6 addmanual, 7 cancel, 8 unknown.
// Route Manual Or Cancel outputs: 0 cancel, 1 manualcaption, 2 schedtime,
// 3 waitlist, 4 addlist, 5 addmanualcaption, fallback → Check Pending Timeout.
// ---------------------------------------------------------------------------
const noteMain = sticky(
  '## Pure GitHub — Telegram Bot\n\nربات بازبینی: ۴ دکمه‌ی اینلاین، لیست انتظار، افزودن با لینک GitHub (انتخاب ساخت/ارسال کپشن)، تغییر زمان، انصراف و انقضای ۶۰ ثانیه‌ای.',
  [botTrigger],
  { color: 5 },
);

const noteButtons = sticky(
  'Parse Callback outputs:\n0 ok (post untouched)\n1 rej (status=rejected)\n2 regen (LLM regenerates)\n3 manual (next text = caption)\n4 sched (waiting-list time)\n5 addgen (LLM caption)\n6 addmanual (user caption)\n7 cancel',
  [parseCallback],
  { color: 6 },
);

export default workflow('puregh-telegram-bot', 'Pure GitHub — Telegram Bot')
  .add(noteMain)
  .add(noteButtons)
  .add(botTrigger)
  .to(parseUpdate)
  .to(routeUpdate
    .onCase(0, parseCallback
      .onCase(0, answerOk)
      .onCase(1, answerRej.to(rejectPost).to(loadRejectedPost).to(editRejected))
      .onCase(2, answerRegen.to(loadPost).to(loadRepo).to(fetchReadme).to(buildRegenFacts)
        .to(regenCaption
          .withModel(regenModelPrimary)
          .withModel(regenModelFallback, 1)
          .withParser(regenSchema))
        .to(assembleRegen).to(saveRegen).to(editRegen))
      .onCase(3, askManualCaption.to(setPendingPost))
      .onCase(4, loadSchedPost.to(askSchedTime).to(setPendingSched))
      .onCase(5, buildAddFromCallback.to(fetchRepoMetadata).to(fetchAddReadme).to(buildAddFacts)
        .to(generateAddCaption
          .withModel(addModelPrimary)
          .withModel(addModelFallback, 1)
          .withParser(addSchema))
        .to(assembleAddCaption).to(buildAddSave).to(upsertAddRepo).to(saveAddPost)
        .to(sendAddPreview).to(saveAddBotMessage))
      .onCase(6, setPendingAddManual.to(askAddManualCaption))
      .onCase(7, sendCancelled.to(clearPendingCancel))
      .onCase(8, answerUnknown)))
    .onCase(1, routeText.to(routeManualOrCancel
      .onCase(0, sendCancelled.to(clearPendingCancel))
      .onCase(1, saveManualCaption.to(clearPending).to(loadManualPost).to(editManual))
      .onCase(2, parseTime.to(updatePublishAt).to(clearPendingSched).to(sendSchedDone))
      .onCase(3, queryWaitingList.to(renderWaitingList).to(sendWaitingList))
      .onCase(4, parseAddUrl.to(checkAddUrl
        .whenTrue(sendAddChoice)
        .whenFalse(sendBadUrl)))
      .onCase(5, buildAddManualFromText.to(fetchAddManualMetadata).to(buildAddManualSave)
        .to(upsertAddManualRepo).to(saveAddManualPost).to(sendAddManualPreview)
        .to(saveAddManualBotMessage))
      .onFallback(checkPendingTimeout.to(sendTimedOut))));
