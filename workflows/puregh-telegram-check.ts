import { workflow, node, trigger, sticky, expr, newCredential } from '@n8n/workflow-sdk';

// ---------------------------------------------------------------------------
// Pure GitHub — Telegram Channel Check
//
// Diagnoses Telegram's "Bad Request: chat not found", which is ambiguous: it
// means the bot cannot see the chat, but not *why*. Four probes narrow it down:
//
//   1. getChat(channel)             -> can the bot see the channel at all?
//   2. getChatAdministrators()      -> is the bot an admin, and who else is?
//   3. getChat(control chat)        -> is the token itself valid?
//   4. sendMessage(control chat)    -> which bot does this credential hold?
//
// Probe 3 separates "bad token" from "bad channel". Probe 4 answers the
// decisive question the others cannot: the credential's actual bot identity,
// which is what you compare against the channel's admin list.
//
// All probes use onError: continueRegularOutput so a failure is reported in
// the summary rather than aborting the run.
// ---------------------------------------------------------------------------

const chatForm = trigger({
  type: 'n8n-nodes-base.formTrigger',
  version: 2.6,
  config: {
    name: 'Channel Details',
    parameters: {
      formTitle: 'Pure GitHub — تست دسترسی بات به کانال',
      formDescription:
        'شناسه کانال را وارد کنید تا بررسی شود بات آن را می‌بیند و اجازه ارسال دارد.<br><br>' +
        'فیلد دوم اختیاری است ولی خیلی کمک می‌کند: یک چت که مطمئنید همین بات قبلاً به آن پیام داده ' +
        '(مثلاً چت خودتان با بات). این باعث می‌شود بفهمیم مشکل از خود توکن است یا فقط از این کانال.',
      formFields: {
        values: [
          {
            fieldLabel: 'شناسه یا یوزرنیم کانال',
            fieldName: 'chat_id',
            fieldType: 'text',
            placeholder: 'مثلاً @mychannel یا -1001234567890',
            requiredField: true,
          },
          {
            fieldLabel: 'چت کنترل (اختیاری)',
            fieldName: 'control_chat_id',
            fieldType: 'text',
            placeholder: 'مثلاً شناسه عددی چت خودتان با بات',
            requiredField: false,
          },
        ],
      },
      responseMode: 'lastNode',
      options: { path: 'puregh-telegram-check', buttonLabel: 'تست کن', appendAttribution: false },
    },
  },
});

const normalizeChat = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Chat ID',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const src = $input.first().json;
const normalize = (raw) => {
  const v = String(raw ?? '').trim();
  if (!v) return { id: '', form: 'empty' };
  if (/^-?\\d+$/.test(v)) {
    const form = v.startsWith('-100') ? 'numeric-channel' : (v.startsWith('-') ? 'numeric-group' : 'numeric-user');
    return { id: v, form };
  }
  if (v.startsWith('@')) return { id: v, form: 'username' };
  if (/^https?:\\/\\/t\\.me\\//i.test(v)) {
    const slug = v.replace(/^https?:\\/\\/t\\.me\\//i, '').replace(/\\/.*$/, '');
    if (slug.startsWith('+') || slug.startsWith('joinchat')) {
      throw new Error('لینک دعوت خصوصی شناسه نیست. شناسه عددی کانال را وارد کنید.');
    }
    return { id: '@' + slug, form: 'username-from-link' };
  }
  return { id: '@' + v, form: 'username-assumed' };
};

const main = normalize(src.chat_id);
if (!main.id) throw new Error('شناسه کانال خالی است.');
const ctrl = normalize(src.control_chat_id);

return [{
  json: {
    chat_id: main.id,
    id_form: main.form,
    input_raw: String(src.chat_id ?? '').trim(),
    control_chat_id: ctrl.id,
    control_form: ctrl.form,
    has_control: Boolean(ctrl.id),
  },
}];`,
    },
  },
});

const getChat = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Probe 1 - Chat Visible',
    parameters: {
      resource: 'chat',
      operation: 'get',
      chatId: expr('{{ $("Normalize Chat ID").first().json.chat_id }}'),
    },
    credentials: { telegramApi: newCredential('Telegram') },
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
  },
});

const getAdmins = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Probe 2 - Bot Is Admin',
    parameters: {
      resource: 'chat',
      operation: 'administrators',
      chatId: expr('{{ $("Normalize Chat ID").first().json.chat_id }}'),
    },
    credentials: { telegramApi: newCredential('Telegram') },
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
  },
});

const controlChat = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Probe 3 - Control Chat',
    parameters: {
      resource: 'chat',
      operation: 'get',
      chatId: expr('{{ $(\'Normalize Chat ID\').first().json.control_chat_id || $(\'Normalize Chat ID\').first().json.chat_id }}'),
    },
    credentials: { telegramApi: newCredential('Telegram') },
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
  },
});

const identifyBot = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'Probe 4 - Identify Bot',
    parameters: {
      resource: 'message',
      operation: 'sendMessage',
      chatId: expr('{{ $(\'Normalize Chat ID\').first().json.control_chat_id }}'),
      text: 'Pure GitHub — تست هویت بات. این پیام فقط برای تشخیص است و می‌توانید پاکش کنید.',
      additionalFields: { appendAttribution: false, disable_notification: true },
    },
    credentials: { telegramApi: newCredential('Telegram') },
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
  },
});

const buildReport = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Telegram Report',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const cfg = $('Normalize Chat ID').first().json;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const readChat = (name) => {
  try {
    const j = $(name).first().json;
    if (j && j.error) return { ok: false, err: String(j.error), chat: null };
    const c = j?.result ?? j;
    return { ok: Boolean(c && c.id), err: null, chat: c && c.id ? c : null };
  } catch (e) {
    return { ok: false, err: 'اجرا نشد', chat: null };
  }
};

const main = readChat('Probe 1 - Chat Visible');

let admins = [];
let adminErr = null;
try {
  admins = $('Probe 2 - Bot Is Admin').all().map((i) => i.json).filter((a) => a && a.user);
  const first = $('Probe 2 - Bot Is Admin').first().json;
  if (first && first.error) adminErr = String(first.error);
} catch (e) {
  adminErr = 'اجرا نشد';
}
const botAdmin = admins.find((a) => a.user?.is_bot) || null;
const canPost = botAdmin ? Boolean(botAdmin.can_post_messages ?? (botAdmin.status === 'administrator')) : false;

const hasControl = Boolean(cfg.has_control);
const ctrl = hasControl ? readChat('Probe 3 - Control Chat') : { ok: false, err: null, chat: null };

let botName = null;
let botId = null;
if (hasControl) {
  try {
    const s = $('Probe 4 - Identify Bot').first().json;
    const from = s?.result?.from;
    if (from) { botName = from.username ?? null; botId = from.id ?? null; }
  } catch (e) { /* probe did not run */ }
}

const adminUsernames = admins.map((a) => (a.user?.username ? '@' + a.user.username : (a.user?.first_name ?? '?'))).join('، ');

const rows = [];
const row = (label, ok, detail) => rows.push('<tr><td>' + label + '</td><td>' + (ok === null ? 'بررسی نشد' : ok ? 'موفق' : 'ناموفق') + '</td><td>' + esc(detail) + '</td></tr>');

row('توکن credential مال کدام بات است', botName ? true : null,
  botName ? ('@' + botName + ' (id=' + botId + ')') : 'برای تشخیص این مورد، فیلد «چت کنترل» را پر کنید');

row('کانال برای بات قابل مشاهده است', main.ok,
  main.ok ? ('type=' + (main.chat.type ?? '?') + ' · title=' + (main.chat.title ?? main.chat.username ?? '-') + ' · id=' + main.chat.id)
    : ('بات این چت را نمی‌بیند' + (main.err ? ' — ' + main.err : '')));

row('بات در فهرست ادمین‌ها هست', Boolean(botAdmin),
  botAdmin ? ('username=@' + (botAdmin.user?.username ?? '?') + ' · status=' + botAdmin.status)
    : (adminUsernames ? ('ادمین‌های کانال: ' + adminUsernames + ' — این بات در فهرست نیست') : ('بات ادمین نیست' + (adminErr ? ' — ' + adminErr : ''))));

row('اجازه ارسال پیام دارد', botAdmin ? canPost : null,
  botAdmin ? (canPost ? 'can_post_messages فعال است' : 'ادمین است ولی اجازه ارسال ندارد') : 'ابتدا بات را ادمین کنید');

row('توکن بات سالم است (چت کنترل)', hasControl ? ctrl.ok : null,
  !hasControl ? 'چت کنترل وارد نشد'
    : ctrl.ok ? ('دسترسی دارد — ' + (ctrl.chat.title ?? ctrl.chat.username ?? ctrl.chat.first_name ?? ctrl.chat.id))
    : ('این چت را هم نمی‌بیند' + (ctrl.err ? ' — ' + ctrl.err : '')));

let verdict;
let headline;
let cause;
if (main.ok && botAdmin && canPost) {
  verdict = 'ready';
  headline = 'بات آماده انتشار در این کانال است.';
  cause = '';
} else if (main.ok) {
  verdict = 'needs-permission';
  headline = 'کانال پیدا شد ولی بات اجازه ارسال ندارد.';
  cause = 'بات ' + (botName ? '@' + botName + ' ' : '') + 'را در همین کانال Administrator کنید و دسترسی Post Messages بدهید.';
} else if (hasControl && ctrl.ok) {
  verdict = 'channel-specific';
  headline = 'توکن بات سالم است؛ مشکل فقط مربوط به این کانال است.';
  cause = botName
    ? ('توکن credential مال بات <b>@' + esc(botName) + '</b> است و این بات به چت کنترل دسترسی دارد ولی این کانال را نمی‌بیند. یعنی دقیقاً همین بات عضو/ادمین کانال نیست، یا شناسه کانال اشتباه است.')
    : 'بات به چت کنترل دسترسی دارد ولی این کانال را نمی‌بیند. پس یا بات عضو/ادمین این کانال نیست، یا شناسه اشتباه است.';
} else if (hasControl && !ctrl.ok) {
  verdict = 'token-suspect';
  headline = 'بات هیچ‌کدام از دو چت را نمی‌بیند.';
  cause = 'احتمال زیاد: توکن در credential مال بات دیگری است، یا شناسه چت کنترل هم درست نیست.';
} else {
  verdict = 'not-visible';
  headline = 'بات این کانال را نمی‌بیند.';
  cause = 'برای تشخیص دقیق‌تر، فرم را دوباره با پرکردن «چت کنترل» اجرا کنید.';
}

const usableId = main.ok ? String(main.chat.id) : null;

const html = [
  '<div style="font-family:system-ui,sans-serif;direction:rtl;max-width:780px;margin:24px auto;padding:0 16px">',
  '<h1 style="font-size:20px">گزارش دسترسی بات به کانال</h1>',
  '<p style="font-size:16px;line-height:1.8"><b>' + headline + '</b></p>',
  cause ? '<p style="font-size:14px;line-height:1.9;color:#444">' + cause + '</p>' : '',
  '<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">',
  '<thead><tr><th>بررسی</th><th>نتیجه</th><th>جزئیات</th></tr></thead>',
  '<tbody>' + rows.join('') + '</tbody></table>',
  usableId ? '<h2 style="font-size:16px;margin-top:24px">شناسه‌ای که باید در نود Publish to Channel بگذارید</h2><pre style="direction:ltr;text-align:left;background:#f5f5f5;padding:12px;border-radius:6px;font-size:14px">' + esc(usableId) + '</pre>' : '',
  '<h2 style="font-size:16px;margin-top:24px">چک‌لیست رفع مشکل</h2>',
  '<ol style="font-size:14px;line-height:2">',
  botName ? ('<li>در کانال، مطمئن شوید دقیقاً بات <b>@' + esc(botName) + '</b> را اضافه کرده‌اید (نه بات دیگری با اسم مشابه).</li>') : '<li>در BotFather ببینید توکن credential مال کدام بات است.</li>',
  '<li>بات باید <b>Administrator</b> باشد، نه عضو ساده.</li>',
  '<li>گزینه <b>Post Messages</b> در دسترسی‌های ادمین روشن باشد.</li>',
  '<li>شناسه عددی را دوباره بگیرید: یک پیام از کانال را به <b>@userinfobot</b> فوروارد کنید و مقدار <code>Id</code> را با مقدار واردشده مقایسه کنید.</li>',
  '<li>اگر کانال عمومی است، به جای شناسه عددی با <code>@username</code> هم تست کنید.</li>',
  '<li>لینک دعوت <code>t.me/+...</code> شناسه نیست.</li>',
  '</ol>',
  '<p style="font-size:13px;color:#666">قالب شناسه واردشده: <code>' + esc(cfg.id_form) + '</code></p>',
  '</div>',
].join('');

return [{
  json: {
    verdict,
    bot_username: botName,
    bot_id: botId,
    chat_ok: main.ok,
    bot_is_admin: Boolean(botAdmin),
    can_post: canPost,
    control_tested: hasControl,
    control_ok: ctrl.ok,
    usable_chat_id: usableId,
    id_form: cfg.id_form,
    report_html: html,
  },
}];`,
    },
  },
});

const showReport = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: 'Show Telegram Report',
    parameters: {
      operation: 'completion',
      respondWith: 'showText',
      responseText: expr('{{ $json.report_html }}'),
    },
  },
});

const note = sticky(
  '## تست کانال تلگرام\nخطای «chat not found» یعنی بات آن چت را نمی‌بیند، ولی نمی‌گوید چرا.\n\nچهار probe علت را جدا می‌کنند: دیده‌شدن کانال، ادمین‌بودن بات، سالم‌بودن توکن (چت کنترل)، و اینکه credential مال کدام بات است.\n\nProbe چهارم یک پیام کوتاه به چت کنترل می‌فرستد تا هویت بات را از پاسخ API بخواند.',
  [normalizeChat],
  { color: 3 },
);

export default workflow('puregh-telegram-check', 'Pure GitHub — Telegram Channel Check')
  .add(chatForm)
  .to(normalizeChat)
  .to(getChat)
  .to(getAdmins)
  .to(controlChat)
  .to(identifyBot)
  .to(buildReport)
  .to(showReport)
  .add(note)
  .group('Checks', [getChat, getAdmins, controlChat, identifyBot]);
