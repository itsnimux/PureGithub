#!/usr/bin/env node
// Verify the generated query plan against the LIVE GitHub API.
//
// Checks three things the builder cannot know on its own:
//   1. Does every query actually PARSE? A malformed qualifier returns HTTP 422
//      and the run silently loses that query. Five of the eighteen queries in
//      collect.mjs failed exactly this way, unnoticed, during the first
//      calibration.
//   2. Does it return enough repos to be worth a request?
//   3. Do the queries overlap each other, i.e. is the budget being spent twice
//      on the same repos?
//
// Costs 14 search calls (one per query) plus one per --days extra run.
// Unauthenticated search allows 10/min, so calls are spaced.
//
//   node discovery/verify-queries.mjs             # today's plan
//   node discovery/verify-queries.mjs --days 3    # three consecutive days
//   node discovery/verify-queries.mjs --plan      # print plan only, no requests

import * as Q from './queries.js';
import * as R from './rules.js';

const UA = { Accept: 'application/vnd.github+json', 'User-Agent': 'puregh-verify' };
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
if (TOKEN) UA.Authorization = `Bearer ${TOKEN}`;

// 10 searches/min unauthenticated, 30/min authenticated.
const SPACING = TOKEN ? 2500 : 6500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const planOnly = args.includes('--plan');
const days = Number(args[args.indexOf('--days') + 1]) || 1;
const DAY = 86_400_000;

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

async function probe(item) {
  const url = Q.searchUrl(item, 100);
  let res;
  // Retry transport failures only. Measured need: a live run died with
  // UND_ERR_SOCKET "other side closed" against api.github.com — the connection
  // runs over the v2rayA tun0 interface and a VPN dropping a TLS socket is
  // routine. An HTTP error is a real answer and is reported, not retried.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { res = await fetch(url, { headers: UA }); break; } catch (e) {
      if (attempt === 3) return { ok: false, status: 'network', why: e?.cause?.code ?? e.message };
      await sleep(1500 * attempt);
    }
  }
  if (res.status !== 200) {
    let why = '';
    try { why = (await res.json()).errors?.[0]?.message ?? ''; } catch { /* ignore */ }
    return { ok: false, status: res.status, why };
  }
  const j = await res.json();
  return {
    ok: true,
    total: j.total_count,
    ids: (j.items || []).map((r) => r.id),
    names: (j.items || []).map((r) => r.full_name),
  };
}

const main = async () => {
  const base = Date.now();
  const allPlans = [];
  for (let d = 0; d < days; d++) allPlans.push({ day: d, plan: Q.buildQueries(base + d * DAY) });

  console.log(`\n=== plan (${allPlans[0].plan.length} queries/run, ${days} run(s)) ===`);
  for (const { day, plan } of allPlans) {
    if (days > 1) console.log(`\n-- day +${day} --`);
    for (const it of plan) {
      console.log(`  ${pad(it.lane, 14)} ${pad(`${it.sort}:${it.order}`, 24)} ${num(it.q.length, 3)}c  ${it.q}`);
    }
  }

  if (planOnly) return;

  const idOwner = new Map();   // repo id -> first query label that returned it
  const perQuery = [];
  let calls = 0;

  for (const { day, plan } of allPlans) {
    for (const it of plan) {
      if (calls++) await sleep(SPACING);
      const r = await probe(it);
      if (!r.ok) {
        perQuery.push({ day, it, dead: true, status: r.status, why: r.why });
        console.log(`\n  DEAD  ${it.label}  HTTP ${r.status}  ${r.why}`);
        console.log(`        ${it.q}`);
        continue;
      }
      let dupes = 0;
      const dupeFrom = new Map();
      for (const id of r.ids) {
        const prev = idOwner.get(id);
        if (prev) { dupes++; dupeFrom.set(prev, (dupeFrom.get(prev) ?? 0) + 1); }
        else idOwner.set(id, `${day}:${it.label}`);
      }
      perQuery.push({ day, it, total: r.total, page: r.ids.length, dupes, dupeFrom, sample: r.names.slice(0, 3) });
    }
  }

  console.log(`\n=== yield (page = repos actually read, capped at ${R.QUERY.resultsPerQuery}) ===`);
  console.log(`  ${pad('query', 30)} ${num('matching', 9)} ${num('page', 5)} ${num('dupe', 5)}  sample`);
  for (const p of perQuery) {
    if (p.dead) { console.log(`  ${pad(p.it.label, 30)}    DEAD  HTTP ${p.status}`); continue; }
    const flag = p.total < R.QUERY.minExpectedYield ? ' THIN' : '';
    console.log(`  ${pad(p.it.label, 30)} ${num(p.total, 9)} ${num(p.page, 5)} ${num(p.dupes, 5)}${flag}  ${p.sample[0] ?? ''}`);
  }

  const live = perQuery.filter((p) => !p.dead);
  const dead = perQuery.filter((p) => p.dead);
  const thin = live.filter((p) => p.total < R.QUERY.minExpectedYield);
  const totalRead = live.reduce((a, p) => a + p.page, 0);
  const unique = idOwner.size;

  console.log('\n=== summary ===');
  console.log(`  queries fired      ${perQuery.length}`);
  console.log(`  dead (HTTP != 200) ${dead.length}${dead.length ? '  <-- MUST FIX' : ''}`);
  console.log(`  thin (< ${R.QUERY.minExpectedYield} matches)  ${thin.length}${thin.length ? `  (${thin.map((p) => p.it.label).join(', ')})` : ''}`);
  console.log(`  repos read         ${totalRead}`);
  console.log(`  unique repos       ${unique}   overlap ${totalRead ? Math.round(100 * (1 - unique / totalRead)) : 0}%`);

  // Overlap between query classes matters more than the raw number: two
  // queries in the SAME class returning the same repos is wasted budget.
  const pairs = [];
  for (const p of live) {
    for (const [from, n] of p.dupeFrom ?? []) {
      if (n >= 10) pairs.push(`${from} -> ${p.day}:${p.it.label} (${n})`);
    }
  }
  if (pairs.length) {
    console.log('\n  significant overlaps (>=10 shared repos):');
    for (const s of pairs) console.log(`    ${s}`);
  }

  if (days > 1) {
    const perDay = {};
    for (const p of live) {
      perDay[p.day] ??= { read: 0, fresh: 0 };
      perDay[p.day].read += p.page;
      perDay[p.day].fresh += p.page - p.dupes;
    }
    console.log('\n  freshness by run (fresh = not seen in an earlier run):');
    for (const [d, v] of Object.entries(perDay)) {
      console.log(`    day +${d}: read ${num(v.read, 4)}  fresh ${num(v.fresh, 4)}  ${Math.round(100 * v.fresh / Math.max(1, v.read))}%`);
    }
  }

  const cov = Q.rotationCoverage(90, base);
  console.log(`\n  rotation over 90 runs: languages ${cov.languagesSeen}/${cov.languagePoolSize}, topics ${cov.topicsSeen}/${cov.topicPoolSize}`);

  if (dead.length) process.exitCode = 1;
};

main().catch((e) => { console.error(e); process.exit(1); });
