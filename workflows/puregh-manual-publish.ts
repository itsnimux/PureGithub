import { workflow, node, trigger, sticky, ifElse, placeholder, languageModel, outputParser, expr, newCredential } from '@n8n/workflow-sdk';

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------
const formTrigger = trigger({
  type: 'n8n-nodes-base.formTrigger',
  version: 2.6,
  config: {
    name: 'Pure GitHub - Submit Repo',
    parameters: {
      formTitle: 'Pure GitHub — ثبت ریپازیتوری',
      formDescription: 'آدرس GitHub ریپازیتوری را وارد کنید. سیستم، Caption پیشنهادی می‌سازد و برای تأیید شما می‌فرستد.',
      formFields: {
        values: [
          {
            fieldLabel: 'آدرس ریپازیتوری (یا owner/name)',
            fieldName: 'repo_url',
            fieldType: 'text',
            placeholder: 'مثلاً https://github.com/sharkdp/bat',
            requiredField: true,
          },
          {
            fieldLabel: 'یادداشت (اختیاری)',
            fieldName: 'note',
            fieldType: 'text',
            placeholder: 'هر نکته‌ای که می‌خواهید در Caption لحاظ شود',
            requiredField: false,
          },
        ],
      },
      options: { path: 'puregh-submit', buttonLabel: 'بررسی کن', appendAttribution: false },
    },
  },
});

// ---------------------------------------------------------------------------
// Group A — Fetch & signal computation
// ---------------------------------------------------------------------------
const parseRepo = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse Repo URL',
    parameters: { mode: 'runOnceForAllItems', jsCode: `const raw = String($json.repo_url ?? '').trim();
let m = raw.match(/(?:github\\.com\\/|@)([A-Za-z0-9_.-]+)\\/([A-Za-z0-9_.-]+)/);
let owner, name;
if (m) { owner = m[1]; name = m[2].replace(/\\.git$/, ''); }
else { const p = raw.split('/').filter(Boolean); owner = p[p.length-2] ?? ''; name = p[p.length-1] ?? ''; }
if (!owner || !name) throw new Error('قالب آدرس نامعتبر است. از https://github.com/owner/name استفاده کنید.');
return [{ json: { owner, name, full_name: owner + '/' + name, raw } }];` },
  },
});

const fetchRepo = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch Repo Metadata',
    parameters: {
      method: 'GET',
      url: expr('https://api.github.com/repos/{{ $json.full_name }}'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }] },
      options: { timeout: 30000 },
    },
    credentials: { githubApi: newCredential('GitHub') },
  },
});

const fetchReadme = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch README',
    parameters: {
      method: 'GET',
      url: expr('https://api.github.com/repos/{{ $json.full_name }}/readme'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github.raw' }] },
      options: {
        timeout: 30000,
        response: { response: { responseFormat: 'text', outputPropertyName: 'readme' } },
      },
    },
    credentials: { githubApi: newCredential('GitHub') },
  },
});

const computeSignals = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Compute Signals',
    parameters: { mode: 'runOnceForAllItems', jsCode: `const repo = $('Fetch Repo Metadata').first().json;
const ghNow = Date.now();
const created = new Date(repo.created_at ?? Date.now()).getTime();
const pushed = new Date(repo.pushed_at ?? Date.now()).getTime();
const ageDays = Math.max(1, (ghNow - created) / 86400000);
const daysSincePush = Math.max(0, Math.round((ghNow - pushed) / 86400000));
const stars = Number(repo.stargazers_count ?? 0);
const readme = String($('Fetch README').first().json.readme ?? '');
const hasDemo = /github\\.com\\/[^\\s]+\\.(gif|mp4|webm)|asciinema|\\.youtube\\.com|demo\\.gif|screenshot|preview/i.test(readme);
const bl = [];
if (repo.archived) bl.push('آرشیو شده');
if (repo.is_template) bl.push('قالب (template)');
if (repo.fork) bl.push('فورک است');
if (!readme.trim()) bl.push('README ندارد');
const cleanReadme = readme.replace(/!\\[\\[[\\s\\S]*?$/, '').replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
const excerpt = cleanReadme.slice(0, 4000);
const signalFacts = [
  'stars=' + stars,
  'forks=' + (repo.forks_count ?? 0),
  'language=' + (repo.language ?? 'unknown'),
  'age_days=' + Math.round(ageDays),
  'days_since_last_push=' + daysSincePush,
  'star_velocity=' + (stars / ageDays).toFixed(2),
  'open_issues=' + (repo.open_issues_count ?? 0),
  'has_demo=' + hasDemo,
  'license=' + (repo.license?.spdx_id ?? 'none'),
].join('\\n');
return [{
  json: {
    age_days: Math.round(ageDays),
    days_since_push: daysSincePush,
    star_velocity: stars / ageDays,
    readme_bytes: readme.length,
    has_demo: hasDemo,
    blockers: bl,
    excerpt,
    signal_facts: signalFacts,
    stars, language: repo.language ?? 'unknown',
    license_spdx: repo.license?.spdx_id ?? 'none',
    license_name: repo.license?.name ?? 'بدون لایسنس',
    topics,
    topics_json: JSON.stringify(topics),
  },
}];` },
  },
});

// ---------------------------------------------------------------------------
// Group B — LLM caption
// ---------------------------------------------------------------------------
const captionModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'AI Model - Primary',
    parameters: {
      model: { __rl: true, mode: 'id', value: 'z-ai/glm-5.2:free' },
      responsesApiEnabled: false,
      options: { temperature: 0.6, maxTokens: 2000, timeout: 180000, maxRetries: 2 },
    },
    credentials: { openAiApi: newCredential('AI Provider') },
  },
});

const captionModelFallback = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'AI Model - Fallback',
    parameters: {
      model: { __rl: true, mode: 'id', value: 'openrouter/free' },
      responsesApiEnabled: false,
      options: { temperature: 0.6, maxTokens: 2000, timeout: 180000, maxRetries: 2 },
    },
    credentials: { openAiApi: newCredential('AI Provider') },
  },
});

const captionSchema = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Caption Schema',
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{"verdict":"strong","reason":"دلیل کوتاه فارسی","title":"نام پروژه — توضیح چندکلمه‌ای","hook":"یک جمله خودمانی","why_interesting":"یک یا دو جمله","audience":["فریلنسرها"],"category":"developer-tools"}',
    },
  },
});

const generateCaption = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm',
  version: 1.9,
  config: {
    name: 'Generate Caption',
    parameters: {
      promptType: 'define',
      hasOutputParser: true,
      needsFallback: true,
      text: expr('{{ $("Compute Signals").first().json.signal_facts }}'),
      messages: {
        messageValues: [
          { type: 'SystemMessagePromptTemplate', message: 'تو کارگردان کانال تلگرام «Pure GitHub» هستی که پروژه\u200cهای منبع\u200cباز جالب را معرفی می\u200cکند.\n\nسلیقه کانال:\n- پروژه\u200cهای کاربردی، غیرمعمول و خلاقانه را دوست داریم.\n- فورک ساده، boilerplate، CRUD عمومی و ابزارهای AI کم\u200cکیفیت را نمی\u200cپسندیم.\n- واو فاکتور مهم است.\n\n### لحن (مهم\u200cترین قاعده)\nطوری بنویس که انگار داری برای دوست صمیمی\u200cت که برنامه\u200cنویس است از یک پروژه تعریف می\u200cکنی. فارسی روان و خودمانی، نه لحن رسمی و نه لحن تبلیغاتی.\n\nبله: «رو می\u200cگیره»، «می\u200cتونی»، «خودت»، «بدون اینکه ...»\nنه: «می\u200cباشد»، «جهت استفاده»، «راهکاری جامع»، «بی\u200cنقص»، «انقلابی»\n\nقواعد دیگر:\n- شعار و جملات انگلیسی README را هرگز کلمه\u200cبه\u200cکلمه ترجمه نکن. مفهوم را بفهم و از نو بنویس.\n- از ترجمه تحت\u200cاللفظی استعاره\u200cها پرهیز کن (مانند «with wings» یا «hear every voice»).\n- نام پروژه، نام تکنولوژی\u200cها و اصطلاحات فنی جاافتاده (API، CLI، Docker، IndexedDB) را انگلیسی نگه دار.\n- فقط بر اساس داده\u200cای که دریافت می\u200cکنی بنویس. عدد یا قابلیتی که در داده نیست از خودت اضافه نکن.\n- هیچ عددی (ستاره، زبان، لایسنس) در متن ننویس؛ خودمان جداگانه اضافه می\u200cکنیم.\n\n### طول (سختگیرانه رعایت کن)\nپست باید در یک نگاه خوانده شود. پرحرفی ممنوع.\n\nخروجی:\n- verdict: فقط یکی از strong / maybe / reject.\n- reason: دلیل این تصمیم، حداکثر یک جمله. (این فقط برای من است و در پست نمی\u200cرود.)\n- title: حداکثر ۶۰ کاراکتر. فرمت: «نام پروژه — توضیح چندکلمه\u200cای». هیچ ایموجی نگذار.\n- hook: دقیقاً یک جمله، حداکثر ۱۴۰ کاراکتر. بگو پروژه چه کاری می\u200cکند، با لحن خودمانی.\n- why_interesting: حداکثر دو جمله و در مجموع حداکثر ۲۲۰ کاراکتر. دقیقاً همان چیزی که این پروژه را از بقیه جدا می\u200cکند — نه فهرست قابلیت\u200cها. اگر چیز خاصی وجود ندارد، رشته خالی بگذار.\n- audience: دقیقاً ۲ تا ۳ مورد، هر کدام دو یا سه کلمه.\n- category: یکی از AI / developer-tools / security / linux / web / mobile / creative / fun / experimental / productivity / backend / gaming / data.\n\nمجموع title + hook + why_interesting باید زیر ۴۲۰ کاراکتر باشد.' },
        ],
      },
    },
    subnodes: { model: [captionModel, captionModelFallback], outputParser: captionSchema },
  },
});

const assembleCaption = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Assemble Caption',
    parameters: { mode: 'runOnceForAllItems', jsCode: `const llm = $json.output ?? $json;
const sig = $('Compute Signals').first().json;
const repo = $('Fetch Repo Metadata').first().json;
const NL = String.fromCharCode(10);

const missing = ['verdict', 'title', 'hook'].filter((k) => !llm || !llm[k]);
if (missing.length) {
  throw new Error('خروجی مدل ناقص است. فیلدهای غایب: ' + missing.join(', '));
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

const openers = ['\uD83E\uDD2F', '\uD83D\uDD25', '\uD83D\uDC40', '\uD83E\uDDE0', '\u26A1', '\uD83E\uDE84', '\uD83E\uDDE9', '\uD83D\uDEE0', '\uD83D\uDCA1', '\uD83C\uDFAF', '\uD83D\uDE80', '\uD83D\uDC19'];
const seedStr = String(repo.full_name ?? '');
let seed = 0;
for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) % 100000;
const opener = openers[seed % openers.length];

const stars = num(sig.stars);
const lang = sig.language && sig.language !== 'unknown' ? esc(sig.language) : null;
const lic = sig.license_spdx && sig.license_spdx !== 'none' ? esc(sig.license_spdx) : null;
const audience = (Array.isArray(llm.audience) ? llm.audience : []).slice(0, 3).map(esc).filter(Boolean).join('، ');

const lines = [opener + ' <b>' + esc(llm.title) + '</b>', '', esc(llm.hook)];

const why = String(llm.why_interesting ?? '').trim();
if (why) lines.push('', esc(why));

if (audience) lines.push('', '\uD83D\uDC65 ' + audience);

const meta = ['\u2B50 ' + stars];
if (lang) meta.push('\uD83D\uDCBB ' + lang);
if (lic) meta.push('\uD83D\uDCDC ' + lic);
lines.push('', meta.join('   '));

const url = String(repo.html_url ?? '');
lines.push('', url);
if (repo.owner?.login) lines.push('@' + esc(repo.owner.login));

const caption = lines.join(NL);
const plain = 'تصمیم مدل: ' + llm.verdict + (llm.reason ? ' — ' + llm.reason : '') + ' · طول: ' + caption.length + ' کاراکتر';

const previewBody = url ? caption.replace(url, '<a href="' + url + '" target="_blank" rel="noopener">' + url + '</a>') : caption;
const captionPreview = previewBody + NL + NL + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + NL + '<i>' + esc(plain) + '</i>';

return [{
  json: {
    verdict: llm.verdict,
    reason: llm.reason ?? '',
    category: llm.category ?? null,
    audience_json: JSON.stringify(Array.isArray(llm.audience) ? llm.audience : []),
    caption,
    caption_preview: captionPreview,
    caption_length: caption.length,
    preview_note: plain,
    stars,
    language: lang,
    license: lic,
  },
}];` },
  },
});

// ---------------------------------------------------------------------------
// Postgres writes (ungrouped, shared by both branches)
// ---------------------------------------------------------------------------
const upsertRepo = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Repository',
    parameters: {
      operation: 'executeQuery',
      query: `WITH up AS (
        INSERT INTO repositories (
          github_id, full_name, owner, name, url, description, homepage,
          stars, forks, open_issues, language, topics, license_spdx, license_name,
          is_fork, is_archived, is_template, default_branch, gh_created_at, gh_pushed_at,
          readme_bytes, has_demo, days_since_push, repo_age_days, star_velocity, source
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
        ON CONFLICT (github_id) DO UPDATE SET
          full_name = EXCLUDED.full_name,
          description = EXCLUDED.description,
          homepage = EXCLUDED.homepage,
          stars = EXCLUDED.stars,
          forks = EXCLUDED.forks,
          open_issues = EXCLUDED.open_issues,
          topics = EXCLUDED.topics,
          star_velocity = EXCLUDED.star_velocity,
          days_since_push = EXCLUDED.days_since_push,
          repo_age_days = EXCLUDED.repo_age_days,
          has_demo = EXCLUDED.has_demo,
          readme_bytes = EXCLUDED.readme_bytes,
          language = EXCLUDED.language,
          last_checked = now()
        RETURNING id
      )
      SELECT up.id, COALESCE((SELECT TRUE FROM posts p WHERE p.repository_id = up.id AND p.status = 'published' LIMIT 1), FALSE) AS already_published FROM up`,
      options: {
        queryReplacement: expr('{{ [$("Fetch Repo Metadata").first().json.id, $("Fetch Repo Metadata").first().json.full_name, $("Fetch Repo Metadata").first().json.owner.login, $("Fetch Repo Metadata").first().json.name, $("Fetch Repo Metadata").first().json.html_url, $("Fetch Repo Metadata").first().json.description ?? null, $("Fetch Repo Metadata").first().json.homepage ?? null, $("Fetch Repo Metadata").first().json.stargazers_count ?? 0, $("Fetch Repo Metadata").first().json.forks_count ?? 0, $("Fetch Repo Metadata").first().json.open_issues_count ?? 0, $("Fetch Repo Metadata").first().json.language ?? null, $("Compute Signals").first().json.topics_json, $("Fetch Repo Metadata").first().json.license?.spdx_id ?? null, $("Fetch Repo Metadata").first().json.license?.name ?? null, $("Fetch Repo Metadata").first().json.fork ?? false, $("Fetch Repo Metadata").first().json.archived ?? false, $("Fetch Repo Metadata").first().json.is_template ?? false, $("Fetch Repo Metadata").first().json.default_branch ?? null, $("Fetch Repo Metadata").first().json.created_at ?? null, $("Fetch Repo Metadata").first().json.pushed_at ?? null, $("Compute Signals").first().json.readme_bytes ?? 0, $("Compute Signals").first().json.has_demo ?? false, $("Compute Signals").first().json.days_since_push ?? 0, $("Compute Signals").first().json.age_days ?? 1, $("Compute Signals").first().json.star_velocity ?? 0, "manual"] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: newCredential('PureGitHub DB') },
  },
});

const upsertDraft = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Save Draft',
    parameters: {
      operation: 'executeQuery',
      query: `WITH ev AS (
                UPDATE repositories
                   SET verdict = $2, verdict_reason = $3, category = $4,
                       audience = $5::jsonb, evaluated_at = now(), evaluated_model = $6
                 WHERE id = $1
                RETURNING id
              )
              INSERT INTO posts (repository_id, caption, status, model)
              SELECT ev.id, $7, 'draft', $6 FROM ev
              RETURNING id`,
      options: {
        queryReplacement: expr('{{ [$("Upsert Repository").first().json.id, $("Assemble Caption").first().json.verdict, $("Assemble Caption").first().json.reason, $("Assemble Caption").first().json.category, $("Assemble Caption").first().json.audience_json, $("AI Model - Primary").params.model.value, $("Assemble Caption").first().json.caption] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: newCredential('PureGitHub DB') },
  },
});

const markPublished = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Mark Published',
    parameters: {
      operation: 'executeQuery',
      query: `UPDATE posts SET status = 'published', telegram_chat_id = $1, telegram_message_id = $2, decided_at = now(), published_at = now()
              WHERE id = $3`,
      options: {
        queryReplacement: expr('{{ [String($("Publish to Channel").first().json.result?.chat?.id ?? $("Publish to Channel").first().json.chat?.id ?? ""), $("Publish to Channel").first().json.result?.message_id ?? $("Publish to Channel").first().json.message_id ?? 0, $("Save Draft").first().json.id] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: newCredential('PureGitHub DB') },
  },
});

const markRejected = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Mark Rejected',
    parameters: {
      operation: 'executeQuery',
      query: `UPDATE posts SET status = 'rejected', reject_reason = $1, decided_at = now()
              WHERE id = $2`,
      options: {
        queryReplacement: expr('{{ [$json.reject_reason ?? null, $("Save Draft").first().json.id] }}'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: newCredential('PureGitHub DB') },
  },
});

// ---------------------------------------------------------------------------
// Decision / gate
// ---------------------------------------------------------------------------
const alreadyPublished = ifElse({
  version: 2.2,
  config: {
    name: 'Already Published?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.already_published }}'), operator: { type: 'boolean', operation: 'equals' }, rightValue: true }],
        combinator: 'and',
      },
    },
  },
});

const approveDecision = ifElse({
  version: 2.2,
  config: {
    name: 'Approve?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.decision }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'publish' }],
        combinator: 'and',
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------
const publishToChannel = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Publish to Channel',
    parameters: {
      resource: 'message',
      operation: 'sendMessage',
      chatId: placeholder('شناسه عددی کانال (مثلاً -1001234567890)'),
      text: expr('{{ $("Assemble Caption").first().json.caption }}'),
      additionalFields: { parse_mode: 'HTML', disable_web_page_preview: false, appendAttribution: false },
    },
    credentials: { telegramApi: newCredential('Telegram') },
  },
});

// ---------------------------------------------------------------------------
// Form pages
// ---------------------------------------------------------------------------
const reviewForm = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: 'Review Draft',
    parameters: {
      operation: 'page',
      defineForm: 'fields',
      formFields: {
        values: [
          { fieldName: 'decision', fieldLabel: 'تصمیم', fieldType: 'radio', fieldOptions: { values: [{ option: 'publish' }, { option: 'reject' }] }, requiredField: true },
          { fieldName: 'reject_reason', fieldLabel: 'دلیل رد (اختیاری)', fieldType: 'text', placeholder: 'این بازخورد برای بهبود سیستم ذخیره می‌شود', requiredField: false },
        ],
      },
      options: {
        formTitle: 'بازبینی پیش‌نویس',
        formDescription: expr('{{ $("Assemble Caption").first().json.caption_preview }}'),
        customCss: ":root { --font-family: 'Vazirmatn', -apple-system, 'Segoe UI', system-ui, sans-serif; }\n\n.card, .form-container { direction: rtl; text-align: right; }\n\n#n8n-form-title { font-size: 20px; }\n\n.form-description, .form-description p {\n  direction: rtl;\n  text-align: right;\n  font-size: 15px;\n  line-height: 2;\n  color: #1f2328;\n  background: #f6f8fa;\n  border: 1px solid #d0d7de;\n  border-radius: 10px;\n  padding: 16px 18px;\n  margin-bottom: 8px;\n  word-break: break-word;\n}\n\n.form-description b, .form-description strong { font-weight: 700; }\n\n.form-description a { color: #0969da; text-decoration: none; }\n\n.form-description i { color: #656d76; font-size: 13px; }",
        buttonLabel: 'ثبت تصمیم',
      },
    },
  },
});

const donePublished = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: 'Published Done',
    parameters: { operation: 'completion', respondWith: 'text', completionTitle: 'منتشر شد', completionMessage: 'پست در کانال منتشر شد.' },
  },
});

const doneRejected = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: 'Rejected Done',
    parameters: { operation: 'completion', respondWith: 'text', completionTitle: 'رد شد', completionMessage: 'پیش‌نویس رد شد و دلیلش ثبت گردید.' },
  },
});

const doneAlready = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: 'Already Published Done',
    parameters: { operation: 'completion', respondWith: 'text', completionTitle: 'تکراری است', completionMessage: 'این ریپازیتوری قبلاً منتشر شده است.' },
  },
});

// ---------------------------------------------------------------------------
// Sticky notes
// ---------------------------------------------------------------------------
const setupNote = sticky('## راه‌اندازی\n1. Credential های لازم را بسازید: **GitHub** (PAT)، **OpenRouter**، **PureGitHub DB** و **Telegram**.\n2. در نود «Publish to Channel» شناسه عددی کانال را جایگزین کنید.\n3. برای گرفتن شناسه کانال، فرم را با یک ریپوی تستی اجرا کنید و در نود Review نتیجه را ببینید.', [parseRepo], { color: 5 });

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------
export default workflow('puregh-manual-publish', 'Pure GitHub — Manual Publish')
  .add(formTrigger)
  .to(parseRepo)
  .to(fetchRepo)
  .to(fetchReadme)
  .to(computeSignals)
  .to(upsertRepo)
  .to(alreadyPublished
    .onFalse(generateCaption)
    .onTrue(doneAlready)
  )
  .to(assembleCaption)
  .to(upsertDraft)
  .to(reviewForm)
  .to(approveDecision
    .onTrue(publishToChannel.to(markPublished.to(donePublished)))
    .onFalse(markRejected.to(doneRejected))
  )
  .add(setupNote)
  .group('Fetch & Signals', [parseRepo, fetchRepo, fetchReadme, computeSignals])
  .group('Caption Generation', [generateCaption, captionModel, captionModelFallback, captionSchema])
  .group('Review & Publish', [assembleCaption, upsertDraft, reviewForm, approveDecision, publishToChannel, markPublished, donePublished, markRejected, doneRejected]);