import config from './config.js';
import { readFile } from 'node:fs/promises';

const SYSTEM_PROMPT_FILE = new URL('./caption-system-prompt.txt', import.meta.url);

async function chatCompletion(model, system, user) {
  const base = config.llm.baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.llm.apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.6,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (res.status === 402 || res.status === 429) {
    throw Object.assign(new Error(`llm ${model}: ${res.status}`), { retryable: true });
  }
  if (!res.ok) throw new Error(`llm ${model}: ${res.status}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? '';
}

export async function generateCaption(factsText, similarPostsText = '') {
  const system = await readFile(SYSTEM_PROMPT_FILE, 'utf8');
  const user = factsText + (similarPostsText ? `\n\nپستهای مشابه قبلاً منتشر شده:\n${similarPostsText}` : '');

  const primary = config.llm.model;
  const fallback = config.llm.fallbackModel;

  let content = null;
  const errors = [];
  for (const model of [primary, fallback]) {
    if (!model) continue;
    try {
      content = await chatCompletion(model, system, user);
      break;
    } catch (e) {
      errors.push(e.message);
      if (!e.retryable) continue; // a hard JSON/schema error won't be fixed by the fallback
    }
  }

  if (content == null) throw new Error(`LLM failed: ${errors.join('; ')}`);

  // The JSON may come wrapped in ```json fences.
  const cleaned = content.replace(/```json\s*/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  // structured output nests under 'output' in n8n; mirror that tolerance here.
  const out = parsed.output ?? parsed;
  for (const k of ['verdict', 'title', 'hook']) {
    if (out[k] == null) throw new Error(`خروجی مدل ناقص است. فیلدهای غایب: ${k}`);
  }
  return out;
}