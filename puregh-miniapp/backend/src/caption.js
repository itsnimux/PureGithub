// Caption assembly — ported verbatim from the telegram-bot workflow
// (Assemble Regen / Assemble Add Caption). The opener emoji is deterministic
// on full_name so a regenerated draft keeps the same emoji (previews compare).
const OPENERS = [
  '🤯', '🔥', '👀', '🧠', '⚡', '🦄', '🧩', '🛠', '💡', '🎯', '🚀', '🐙',
];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function openerFor(fullName) {
  let seed = 0;
  for (let i = 0; i < fullName.length; i++) seed = (seed * 31 + fullName.charCodeAt(i)) % 100000;
  return OPENERS[seed % OPENERS.length];
}

export function assembleCaption(llm, facts) {
  const NL = String.fromCharCode(10);
  const missing = ['verdict', 'title', 'hook'].filter((k) => !llm || !llm[k]);
  if (missing.length) throw new Error(`خروجی مدل ناقص است. فیلدهای غایب: ${missing.join(', ')}`);

  const opener = openerFor(facts.full_name ?? '');
  const audience = (Array.isArray(llm.audience) ? llm.audience : []).slice(0, 3).map(esc).filter(Boolean).join('، ');

  const lines = [opener + ' <b>' + esc(llm.title) + '</b>', '', esc(llm.hook)];
  const why = String(llm.why_interesting ?? '').trim();
  if (why) lines.push('', why);
  if (audience) lines.push('', '👥 ' + audience);
  lines.push('', 'https://github.com/' + facts.full_name);
  lines.push('- ' + esc(facts.owner));

  return {
    caption: lines.join(NL),
    verdict: llm.verdict,
    reason: llm.reason ?? '',
    category: llm.category ?? null,
    audience: Array.isArray(llm.audience) ? llm.audience : [],
  };
}