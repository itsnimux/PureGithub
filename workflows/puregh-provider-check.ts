import { workflow, node, trigger, sticky, expr } from '@n8n/workflow-sdk';

// ---------------------------------------------------------------------------
// Pure GitHub — Provider Check
//
// Standalone diagnostic. Paste any OpenAI-compatible provider's Base URL, API
// key and model ID, and it reports whether that combination actually works
// before you wire it into the publishing workflow.
//
// It runs three probes in order:
//   1. GET  {base}/models            -> is the base URL right and the key valid?
//   2. POST {base}/chat/completions  -> does this model ID answer at all?
//   3. same, with response_format    -> does it support JSON mode? (needed by
//                                      the caption workflow's output parser)
//
// Nothing is stored; the key lives only in this execution.
// ---------------------------------------------------------------------------

const providerForm = trigger({
  type: 'n8n-nodes-base.formTrigger',
  version: 2.6,
  config: {
    name: 'Provider Details',
    parameters: {
      formTitle: 'Pure GitHub — تست Provider هوش مصنوعی',
      formDescription: 'اطلاعات هر provider سازگار با OpenAI را وارد کنید تا قبل از استفاده در workflow اصلی، صحت آن بررسی شود. کلید شما ذخیره نمی‌شود.',
      formFields: {
        values: [
          {
            fieldLabel: 'Base URL',
            fieldName: 'base_url',
            fieldType: 'text',
            placeholder: 'مثلاً https://openrouter.ai/api/v1',
            requiredField: true,
          },
          {
            fieldLabel: 'API Key',
            fieldName: 'api_key',
            fieldType: 'password',
            requiredField: true,
          },
          {
            fieldLabel: 'Model ID',
            fieldName: 'model_id',
            fieldType: 'text',
            placeholder: 'مثلاً z-ai/glm-5.2:free',
            requiredField: true,
          },
        ],
      },
      responseMode: 'lastNode',
      options: { path: 'puregh-provider-check', buttonLabel: 'تست کن', appendAttribution: false },
    },
  },
});

const normalize = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Input',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const src = $input.first().json;
const rawBase = String(src.base_url ?? '').trim().replace(/\\/+$/, '');
if (!/^https?:\\/\\//i.test(rawBase)) {
  throw new Error('Base URL باید با http:// یا https:// شروع شود.');
}
const base = /\\/v\\d+$/i.test(rawBase) ? rawBase : rawBase + '/v1';
return [{
  json: {
    base_url_input: rawBase,
    base_url: base,
    models_url: base + '/models',
    chat_url: base + '/chat/completions',
    api_key: String(src.api_key ?? '').trim(),
    model_id: String(src.model_id ?? '').trim(),
    normalized_note: /\\/v\\d+$/i.test(rawBase) ? 'بدون تغییر' : 'پسوند /v1 اضافه شد',
  },
}];`,
    },
  },
});

const probeModels = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Probe 1 - List Models',
    parameters: {
      method: 'GET',
      url: expr('{{ $json.models_url }}'),
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [{ name: 'Authorization', value: expr('Bearer {{ $json.api_key }}') }],
      },
      options: {
        timeout: 20000,
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
      },
    },
  },
});

const probeChat = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Probe 2 - Chat Completion',
    parameters: {
      method: 'POST',
      url: expr('{{ $("Normalize Input").first().json.chat_url }}'),
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: expr('Bearer {{ $("Normalize Input").first().json.api_key }}') },
          { name: 'Content-Type', value: 'application/json' },
        ],
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ model: $("Normalize Input").first().json.model_id, messages: [{ role: "user", content: "Reply with exactly the word: OK" }], max_tokens: 40 }) }}'),
      options: {
        timeout: 60000,
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
      },
    },
  },
});

const probeJsonMode = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Probe 3 - JSON Mode',
    parameters: {
      method: 'POST',
      url: expr('{{ $("Normalize Input").first().json.chat_url }}'),
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: expr('Bearer {{ $("Normalize Input").first().json.api_key }}') },
          { name: 'Content-Type', value: 'application/json' },
        ],
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ model: $("Normalize Input").first().json.model_id, messages: [{ role: "user", content: "Return only this JSON: {\\"ok\\":true}" }], max_tokens: 60, response_format: { type: "json_object" } }) }}'),
      options: {
        timeout: 60000,
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
      },
    },
  },
});

const buildReport = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Report',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: `const cfg = $('Normalize Input').first().json;
const models = $('Probe 1 - List Models').first().json;
const chat = $('Probe 2 - Chat Completion').first().json;
const jsonMode = $('Probe 3 - JSON Mode').first().json;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const errText = (r) => {
  const b = r?.body;
  if (!b) return 'پاسخی دریافت نشد';
  if (typeof b === 'string') return b.slice(0, 300);
  return String(b?.error?.message ?? b?.message ?? JSON.stringify(b)).slice(0, 300);
};

// Probe 1 — base URL + key
const modelsOk = models?.statusCode >= 200 && models?.statusCode < 300;
const modelList = Array.isArray(models?.body?.data) ? models.body.data.map((m) => m.id).filter(Boolean) : [];
const modelIdListed = modelList.length ? modelList.includes(cfg.model_id) : null;

// Probe 2 — does the model reply
const chatOk = chat?.statusCode >= 200 && chat?.statusCode < 300;
const reply = chat?.body?.choices?.[0]?.message?.content;
const usage = chat?.body?.usage;
const servedModel = chat?.body?.model;

// Probe 3 — JSON mode (the caption workflow's output parser depends on this)
const jsonOk = jsonMode?.statusCode >= 200 && jsonMode?.statusCode < 300;
let jsonParsable = false;
if (jsonOk) {
  try { JSON.parse(String(jsonMode?.body?.choices?.[0]?.message?.content ?? '')); jsonParsable = true; } catch (e) { jsonParsable = false; }
}

const verdict = chatOk
  ? (jsonParsable ? 'usable' : 'usable-without-json-mode')
  : 'unusable';

const rows = [];
const row = (label, ok, detail) => rows.push(
  '<tr><td>' + label + '</td><td>' + (ok === null ? '—' : ok ? 'موفق' : 'ناموفق') + '</td><td>' + esc(detail) + '</td></tr>'
);

row('Base URL و کلید (GET /models)', modelsOk,
  modelsOk ? (modelList.length + ' مدل در دسترس') : ('HTTP ' + (models?.statusCode ?? '?') + ' — ' + errText(models)));
row('وجود Model ID در لیست', modelIdListed,
  modelIdListed === null ? 'provider لیست مدل نمی‌دهد (اشکالی ندارد)'
    : modelIdListed ? 'پیدا شد' : 'در لیست نبود — املای شناسه را بررسی کنید');
row('پاسخ مدل (POST /chat/completions)', chatOk,
  chatOk ? ('پاسخ: ' + String(reply ?? '').slice(0, 60)) : ('HTTP ' + (chat?.statusCode ?? '?') + ' — ' + errText(chat)));
row('پشتیبانی JSON mode', jsonParsable,
  jsonOk ? (jsonParsable ? 'JSON معتبر برگشت' : 'پاسخ داد ولی JSON معتبر نبود')
    : ('HTTP ' + (jsonMode?.statusCode ?? '?') + ' — ' + errText(jsonMode)));

const headline = verdict === 'usable'
  ? 'این provider آماده استفاده است.'
  : verdict === 'usable-without-json-mode'
    ? 'مدل پاسخ می‌دهد ولی JSON mode را پشتیبانی نمی‌کند. برای Generate Caption ممکن است خروجی ساختاریافته ناپایدار باشد.'
    : 'این ترکیب کار نمی‌کند. جدول زیر را ببینید.';

const html = [
  '<div style="font-family:system-ui,sans-serif;direction:rtl;max-width:760px;margin:24px auto;padding:0 16px">',
  '<h1 style="font-size:20px">گزارش تست Provider</h1>',
  '<p style="font-size:15px;line-height:1.7">' + headline + '</p>',
  '<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">',
  '<thead><tr><th>بررسی</th><th>نتیجه</th><th>جزئیات</th></tr></thead>',
  '<tbody>' + rows.join('') + '</tbody></table>',
  '<h2 style="font-size:16px;margin-top:24px">تنظیماتی که باید در n8n وارد کنید</h2>',
  '<pre style="direction:ltr;text-align:left;background:#f5f5f5;padding:12px;border-radius:6px;font-size:13px;overflow:auto">',
  'Credential (OpenAI):',
  '  Base URL : ' + esc(cfg.base_url),
  '  API Key  : (همان کلیدی که وارد کردید)',
  '',
  'AI Model node:',
  '  Model              : ' + esc(cfg.model_id),
  '  Use Responses API  : off',
  servedModel ? '  (provider گزارش داد: ' + esc(servedModel) + ')' : '',
  '</pre>',
  cfg.normalized_note === 'بدون تغییر' ? '' : '<p style="font-size:13px;color:#666">توجه: آدرس وارد‌شده پسوند نسخه نداشت، پس <code>/v1</code> به آن اضافه شد.</p>',
  usage ? '<p style="font-size:13px;color:#666">مصرف توکن این تست: ' + esc(JSON.stringify(usage)) + '</p>' : '',
  '</div>',
].join('');

return [{
  json: {
    verdict,
    models_ok: modelsOk,
    model_listed: modelIdListed,
    chat_ok: chatOk,
    json_mode_ok: jsonParsable,
    base_url: cfg.base_url,
    model_id: cfg.model_id,
    served_model: servedModel ?? null,
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
    name: 'Show Report',
    parameters: {
      operation: 'completion',
      respondWith: 'showText',
      responseText: expr('{{ $json.report_html }}'),
    },
  },
});

const note = sticky(
  '## تست Provider\nهر provider سازگار با OpenAI را اینجا بررسی کنید: OpenRouter، Groq، Together، واسط‌های ایرانی، یا هر gateway دیگر.\n\nسه چیز تست می‌شود: درستی Base URL و کلید، پاسخ‌دهی مدل، و پشتیبانی JSON mode (که workflow اصلی به آن نیاز دارد).\n\nکلید در هیچ جا ذخیره نمی‌شود.',
  [normalize],
  { color: 4 },
);

export default workflow('puregh-provider-check', 'Pure GitHub — Provider Check')
  .add(providerForm)
  .to(normalize)
  .to(probeModels)
  .to(probeChat)
  .to(probeJsonMode)
  .to(buildReport)
  .to(showReport)
  .add(note)
  .group('Probes', [probeModels, probeChat, probeJsonMode]);
