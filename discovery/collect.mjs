#!/usr/bin/env node
// Collect a calibration corpus from the live GitHub API.
//
// Search API is limited to 10 req/min unauthenticated, so queries are spaced.
// READMEs come from raw.githubusercontent.com, which does NOT consume the API
// budget, so the corpus can be large.
//
// Writes: corpus.json  (repo metadata + readme text + which query found it)

import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, 'corpus.json');
const UA = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'puregh-calibration' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Queries chosen to populate every lane, plus deliberate junk queries so the
// corpus contains the things the rules are supposed to REJECT. Calibrating on
// clean data only would produce thresholds that have never seen an adversary.
const QUERIES = [
  // --- iran lane ---
  ['iran_topic',     'topic:iran stars:>=20 pushed:>2025-08-01'],
  ['iran_persian',   'topic:persian stars:>=20 pushed:>2025-08-01'],
  ['iran_circumv',   'topic:v2ray OR topic:xray OR topic:sing-box OR topic:hysteria2 stars:>=20'],
  ['iran_censor',    'topic:anti-censorship OR topic:censorship-circumvention OR topic:firewall-bypass stars:>=20'],
  // --- ai lane ---
  ['ai_mcp',         'topic:mcp OR topic:model-context-protocol stars:>=80 pushed:>2026-05-01'],
  ['ai_agents',      'topic:ai-agent OR topic:agentic stars:>=80 pushed:>2026-05-01'],
  ['ai_llm',         'topic:llm OR topic:rag OR topic:local-llm stars:>=80 pushed:>2026-05-01'],
  // --- trending lane ---
  ['trending',       'created:>2026-07-06 stars:>=200'],
  // --- hidden gem lane (sharded) ---
  ['hidden_low',     'stars:50..300 created:>2022-09-05 pushed:>2025-08-01'],
  ['hidden_mid',     'stars:300..1500 created:>2022-09-05 pushed:>2025-08-01'],
  ['hidden_asc',     'stars:50..4000 pushed:>2025-08-01 created:>2022-09-05'],
  // --- established lane ---
  ['established',    'stars:>=1500 created:<2025-09-05 pushed:>2026-01-08'],
  // --- lists lane ---
  ['lists_generic',  'awesome in:name stars:>=100 pushed:>2025-11-09'],
  ['lists_iran',     'topic:iran awesome in:name stars:>=50'],
  // --- adversarial: things that MUST be rejected ---
  ['junk_freenode',  'free v2ray config in:name,description stars:>=50'],
  ['junk_piracy',    'crack OR keygen OR nulled in:name stars:>=50'],
  ['junk_learning',  'tutorial OR boilerplate in:name stars:>=100'],
  ['junk_prompts',   'chatgpt prompts in:name,description stars:>=200'],
];

const SORTS = {
  hidden_asc: { sort: 'stars', order: 'asc' },
  trending: { sort: 'stars', order: 'desc' },
  established: { sort: 'updated', order: 'desc' },
};

async function search(label, q) {
  const s = SORTS[label] || { sort: 'updated', order: 'desc' };
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}`
    + `&sort=${s.sort}&order=${s.order}&per_page=100`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) {
    console.error(`  ! ${label}: HTTP ${res.status}`);
    return [];
  }
  const j = await res.json();
  return (j.items || []).map((r) => ({ ...r, _q: label }));
}

async function readme(full_name, branch) {
  for (const b of [branch, 'main', 'master'].filter(Boolean)) {
    for (const f of ['README.md', 'readme.md', 'README.MD', 'README.rst', 'README']) {
      try {
        const res = await fetch(`https://raw.githubusercontent.com/${full_name}/${b}/${f}`);
        if (res.ok) return await res.text();
      } catch { /* keep trying */ }
    }
  }
  return '';
}

const main = async () => {
  const byId = new Map();

  for (const [label, q] of QUERIES) {
    const items = await search(label, q);
    let fresh = 0;
    for (const r of items) {
      if (byId.has(r.id)) { byId.get(r.id)._qs.push(label); continue; }
      r._qs = [label];
      byId.set(r.id, r);
      fresh++;
    }
    console.log(`  ${label.padEnd(16)} got ${String(items.length).padStart(3)}  new ${String(fresh).padStart(3)}  total ${byId.size}`);
    await sleep(6500); // stay under 10 searches/min
  }

  const repos = [...byId.values()];
  console.log(`\nfetching ${repos.length} READMEs from raw.githubusercontent (no API cost)...`);

  const CONC = 12;
  let done = 0;
  const queue = [...repos];
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (queue.length) {
      const r = queue.shift();
      r._readme = await readme(r.full_name, r.default_branch);
      if (++done % 50 === 0) console.log(`  ${done}/${repos.length}`);
    }
  }));

  const slim = repos.map((r) => ({
    id: r.id, full_name: r.full_name, name: r.name, owner: r.owner?.login,
    owner_type: r.owner?.type, description: r.description, homepage: r.homepage,
    stars: r.stargazers_count, forks: r.forks_count, open_issues: r.open_issues_count,
    language: r.language, topics: r.topics || [], license: r.license?.spdx_id || null,
    size_kb: r.size, archived: !!r.archived, fork: !!r.fork,
    is_template: !!r.is_template, disabled: !!r.disabled,
    created_at: r.created_at, pushed_at: r.pushed_at,
    default_branch: r.default_branch,
    queries: r._qs, readme: r._readme || '',
  }));

  fs.writeFileSync(OUT, JSON.stringify(slim));
  const withReadme = slim.filter((r) => r.readme.length >= 300).length;
  console.log(`\nwrote ${slim.length} repos -> ${OUT}`);
  console.log(`  with usable README (>=300B): ${withReadme} (${Math.round(100 * withReadme / slim.length)}%)`);
};

main().catch((e) => { console.error(e); process.exit(1); });
