// Fetch the known-good and known-bad reference repos explicitly and run the
// full algorithm on them. This is the regression suite: if a real client ever
// gets classified as a config dump, the highest-value lane is broken.

import fs from 'node:fs';
import path from 'node:path';
import * as A from './algorithm.js';

const MUST_PASS = [
  'hiddify/hiddify-app', 'v2rayA/v2rayA', 'alireza0/s-ui', 'SagerNet/sing-box',
  'bia-pain-bache/BPB-Worker-Panel', 'MatsuriDayo/NekoBoxForAndroid',
  'hiddify/Hiddify-Manager', 'XTLS/Xray-core', 'MetaCubeX/mihomo',
  'rastikerdar/vazirmatn', 'roshan-research/hazm', 'majidh1/JalaliDatePicker',
  'mohebifar/made-in-iran', 'sub-store-org/Sub-Store', 'tindy2013/subconverter',
];

const MUST_REJECT = [
  'Loyalsoldier/clash-rules', 'Pawdroid/Free-servers', 'hwanz/SSR-V2ray-Trojan',
  'barry-far/V2ray-Config', 'Loyalsoldier/v2ray-rules-dat',
  'free-nodes/clashfree', '0xRadikal/Free-v2ray-Configs',
  'Chocolate4U/Iran-v2ray-rules', 'bootmortis/iran-hosted-domains',
];

// Prompt / jailbreak collections. Added after calibration measured this as the
// largest leak in the funnel: 27 of 88 repos from the `chatgpt prompts` query
// reached the LLM gate (31%), against 0% for free-node dumps.
//
// These must be PENALISED below the gate rather than hard-rejected, because the
// detector is a confidence score — same reasoning as config dumps.
const MUST_REJECT_PROMPTS = [
  'ai-boost/awesome-prompts', 'f/prompts.chat', 'PlexPt/awesome-chatgpt-prompts-zh',
  'LouisShark/chatgpt_system_prompt', '0xk1h0/ChatGPT_DAN',
  'elder-plinius/CL4R1T4S', 'langgptai/wonderful-prompts',
  'dontriskit/awesome-ai-system-prompts', 'mustvlad/ChatGPT-System-Prompts',
];

// Real software that lives in the same vocabulary as a prompt dump. This is the
// group the detector must NOT touch: their descriptions are full of "chatgpt"
// and "prompt", so any keyword-only rule destroys them. They are the reason
// PROMPT_DUMP_SIGNALS scores signals instead of matching one word.
const MUST_PASS_AI_TOOLS = [
  'kardolus/chatgpt-cli', 'czhou578/llm-god', 'intelligentnode/IntelliNode',
  'timqian/openprompt.co',
];

// Resolved against this file's directory, not the shell's cwd. Run from the
// project root, './reference.json' wrote a SECOND cache at the repo root while
// the .gitignore entry (discovery/reference.json) covered only the first — so an
// untracked 3.9MB file appeared, and the two caches disagreed. That is also why
// evicting an entry from discovery/reference.json appeared to have no effect:
// the run was reading the root copy.
const CACHE = path.join(import.meta.dirname, 'reference.json');

async function repo(fullName) {
  const res = await fetch(`https://api.github.com/repos/${fullName}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'puregh-cal' },
  });
  if (!res.ok) return null;
  const r = await res.json();
  let readme = '';
  // Filename casing varies and GitHub raw is case-SENSITIVE. Measured:
  // czhou578/llm-god serves `readme.md` (lowercase) on `master`, so probing
  // only `README.md` returned nothing and the repo was scored as having no
  // README at all — a false `no-readme` reject on a real 281-star tool.
  // collect.mjs already probed several names; this function did not.
  const names = ['README.md', 'readme.md', 'README.MD', 'Readme.md', 'README.rst', 'README'];
  outer:
  for (const b of [r.default_branch, 'main', 'master'].filter(Boolean)) {
    for (const f of names) {
      const rr = await fetch(`https://raw.githubusercontent.com/${fullName}/${b}/${f}`);
      if (rr.ok) { readme = await rr.text(); break outer; }
    }
  }
  return {
    id: r.id, full_name: r.full_name, name: r.name, owner: r.owner?.login,
    description: r.description, homepage: r.homepage,
    stars: r.stargazers_count, forks: r.forks_count, open_issues: r.open_issues_count,
    language: r.language, topics: r.topics || [], license: r.license?.spdx_id || null,
    size_kb: r.size, archived: !!r.archived, fork: !!r.fork,
    is_template: !!r.is_template, disabled: !!r.disabled,
    created_at: r.created_at, pushed_at: r.pushed_at, default_branch: r.default_branch,
    readme,
  };
}

const main = async () => {
  let data = {};
  if (fs.existsSync(CACHE)) data = JSON.parse(fs.readFileSync(CACHE, 'utf8'));

  for (const n of [...MUST_PASS, ...MUST_REJECT, ...MUST_REJECT_PROMPTS, ...MUST_PASS_AI_TOOLS]) {
    if (data[n]) continue;
    const r = await repo(n);
    if (r) { data[n] = r; process.stderr.write('.'); }
    else process.stderr.write('x');
    await new Promise((res) => setTimeout(res, 200));
  }
  fs.writeFileSync(CACHE, JSON.stringify(data));
  process.stderr.write('\n');

  const NOW = Date.now();
  let fails = 0;

  console.log('=== MUST PASS: real software, must not be flagged as a dump ===');
  for (const n of MUST_PASS) {
    const r = data[n];
    if (!r) { console.log(`  (unavailable) ${n}`); continue; }
    const d = A.configDumpScore(A.normalize(r, NOW));
    const b = A.scoreStageB(r, r.readme, NOW);
    const bad = d.isDump || b.rejects.length;
    if (bad) fails++;
    console.log(`  ${(bad ? 'FAIL' : 'ok').padEnd(5)} dump=${d.score}[${d.hits.join('+')}] rej=[${b.rejects.join(',')}] lane=${b.lane ?? '-'} total=${b.total.toFixed(1)} q=${b.quality.toFixed(0)} rel=${b.relevance} ${String(r.stars).padStart(6)}* ${n}`);
  }

  console.log('\n=== MUST REJECT: config/rule dumps, must never reach the LLM ===');
  for (const n of MUST_REJECT) {
    const r = data[n];
    if (!r) { console.log(`  (unavailable) ${n}`); continue; }
    const d = A.configDumpScore(A.normalize(r, NOW));
    const b = A.scoreStageB(r, r.readme, NOW);
    const reached = A.passesLlmGate(b);
    if (!d.isDump || reached) fails++;
    console.log(`  ${(reached || !d.isDump ? 'FAIL' : 'ok').padEnd(5)} dump=${d.score}[${d.hits.join('+')}] gate=${reached ? 'REACHED' : 'blocked'} total=${b.total.toFixed(1)} ${String(r.stars).padStart(6)}* ${n}`);
  }

  console.log('\n=== MUST REJECT: prompt / jailbreak collections ===');
  for (const n of MUST_REJECT_PROMPTS) {
    const r = data[n];
    if (!r) { console.log(`  (unavailable) ${n}`); continue; }
    const p = A.promptDumpScore(A.normalize(r, NOW));
    const b = A.scoreStageB(r, r.readme, NOW);
    const reached = A.passesLlmGate(b);
    if (!p.isDump || reached) fails++;
    console.log(`  ${(reached || !p.isDump ? 'FAIL' : 'ok').padEnd(5)} prompt=${p.score}[${p.hits.join('+')}] gate=${reached ? 'REACHED' : 'blocked'} total=${b.total.toFixed(1)} ${String(r.stars).padStart(6)}* ${n}`);
  }

  console.log('\n=== MUST PASS: real AI tools, must NOT be flagged as prompt dumps ===');
  for (const n of MUST_PASS_AI_TOOLS) {
    const r = data[n];
    if (!r) { console.log(`  (unavailable) ${n}`); continue; }
    const p = A.promptDumpScore(A.normalize(r, NOW));
    const b = A.scoreStageB(r, r.readme, NOW);
    const bad = p.isDump || b.rejects.length;
    if (bad) fails++;
    console.log(`  ${(bad ? 'FAIL' : 'ok').padEnd(5)} prompt=${p.score}[${p.hits.join('+')}] rej=[${b.rejects.join(',')}] lane=${b.lane ?? '-'} total=${b.total.toFixed(1)} ${String(r.stars).padStart(6)}* ${n}`);
  }

  console.log(`\n${fails === 0 ? 'ALL PASS' : `${fails} FAILURES`}`);
};

main().catch((e) => { console.error(e); process.exit(1); });
