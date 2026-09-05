// Fetch the known-good and known-bad reference repos explicitly and run the
// full algorithm on them. This is the regression suite: if a real client ever
// gets classified as a config dump, the highest-value lane is broken.

import fs from 'node:fs';
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

const CACHE = './reference.json';

async function repo(fullName) {
  const res = await fetch(`https://api.github.com/repos/${fullName}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'puregh-cal' },
  });
  if (!res.ok) return null;
  const r = await res.json();
  let readme = '';
  for (const b of [r.default_branch, 'main', 'master']) {
    if (!b) continue;
    const rr = await fetch(`https://raw.githubusercontent.com/${fullName}/${b}/README.md`);
    if (rr.ok) { readme = await rr.text(); break; }
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

  for (const n of [...MUST_PASS, ...MUST_REJECT]) {
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

  console.log(`\n${fails === 0 ? 'ALL PASS' : `${fails} FAILURES`}`);
};

main().catch((e) => { console.error(e); process.exit(1); });
