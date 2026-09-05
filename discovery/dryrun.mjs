#!/usr/bin/env node
// Full-funnel dry run — everything the Discovery workflow will do, except the
// LLM call, the database writes and the Telegram post.
//
// WHY THIS RUNS BEFORE THE WORKFLOW EXISTS
// ----------------------------------------
// The workflow is ~15 nodes with an LLM in the middle. Debugging a funnel that
// produces nothing is much harder inside n8n than here, and each debugging pass
// there costs real LLM quota (capped near 50/day on free tiers). So the whole
// chain is proven offline first:
//
//   build queries -> search -> dedup -> cooldown -> stage A -> fetch READMEs
//   -> stage B -> gate -> select -> purpose-similarity
//
// The one thing it cannot prove is the model's judgement. Everything up to the
// prompt is verified.
//
//   node discovery/dryrun.mjs                 # today, live GitHub, live DB
//   node discovery/dryrun.mjs --day 12        # simulate a future run's rotation
//   node discovery/dryrun.mjs --offline       # reuse corpus.json, no requests
//   node discovery/dryrun.mjs --days 5        # five consecutive runs, cumulative
//
// With --days > 1 the run also SIMULATES the outcome of each day (some
// candidates published, some rejected, the rest recorded as near-misses or
// not-selected) and feeds that back into the in-memory history. Without this the
// multi-day mode is meaningless: it would pick the same sixteen repos every day,
// which is exactly the behaviour COOLDOWN exists to prevent. The simulation is
// what proves the cooldown actually bites.
//
// A live run costs 14 search calls + up to FUNNEL.readmeFetchLimit README
// fetches. READMEs come from raw.githubusercontent.com, which does NOT consume
// the API quota — measured during calibration, 1075 READMEs left `core`
// untouched.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as A from './algorithm.js';
import * as Q from './queries.js';
import * as R from './rules.js';

const DIR = import.meta.dirname;
const DAY = 86_400_000;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };

const offline = flag('--offline');
const dayOffset = Number(val('--day', 0)) || 0;
const runs = Number(val('--days', 1)) || 1;
const verbose = flag('--verbose');

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const UA = { Accept: 'application/vnd.github+json', 'User-Agent': 'puregh-dryrun' };
if (TOKEN) UA.Authorization = `Bearer ${TOKEN}`;
const SEARCH_SPACING = TOKEN ? R.QUERY.searchSpacingMs : 6500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pad = (s, n) => String(s).padEnd(n);
const nm = (s, n) => String(s).padStart(n);
const pct = (a, b) => (b ? `${Math.round(100 * a / b)}%` : '—');

// ---------------------------------------------------------------------------
// database — read-only, and optional
// ---------------------------------------------------------------------------
// Talks to the container by exec'ing psql rather than adding a `pg` dependency
// for one query. If the DB is unreachable the run still completes with an empty
// history, which is also what the very first real run will see.

function psql(sql) {
  try {
    const out = execFileSync('docker', [
      'exec', '-i', 'puregh-db',
      'psql', '-U', 'puregh', '-d', 'puregh', '-t', '-A', '-F', '\t', '-c', sql,
    ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
  } catch {
    return null;
  }
}

function loadHistory() {
  const rows = psql(`SELECT github_id, published::text, human_rejected::text,
                            COALESCE(verdict,''), COALESCE(last_total::text,''),
                            COALESCE(last_stage,''),
                            COALESCE(last_reject_reason,''), last_checked
                       FROM repositories`);
  if (rows === null) return { available: false, byId: new Map(), published: [] };
  const byId = new Map();
  for (const [id, pub, hr, verdict, total, stage, reason, checked] of rows) {
    byId.set(Number(id), {
      published: pub === 't',
      human_rejected: hr === 't',
      verdict: verdict || null,
      last_total: total === '' ? null : Number(total),
      last_stage: stage || null,
      last_reject_reason: reason || null,
      last_checked: checked,
    });
  }
  const pubRows = psql(`SELECT full_name, COALESCE(description,''),
                               COALESCE((SELECT string_agg(lower(t), ',')
                                           FROM jsonb_array_elements_text(topics) AS t), '')
                          FROM repositories WHERE published`) ?? [];
  return {
    available: true,
    byId,
    published: pubRows.map(([full_name, description, topics]) => ({
      full_name, description, topics: topics ? topics.split(',') : [],
    })),
  };
}

// ---------------------------------------------------------------------------
// github
// ---------------------------------------------------------------------------

/**
 * fetch with retry on TRANSPORT failures.
 *
 * Not defensive padding — measured on this machine. A live run died with:
 *   TypeError: terminated
 *     cause: SocketError: other side closed (UND_ERR_SOCKET)
 *     remoteAddress: 140.82.121.6 (api.github.com), localAddress: 172.19.0.1
 * The connection goes out over the v2rayA tun0 interface (AGENTS.md §3), and a
 * VPN dropping a long-lived TLS socket is normal, not exceptional. One dropped
 * socket must not kill a 14-query run.
 *
 * Only transport errors are retried. An HTTP error (422 from a malformed query,
 * 403 from rate limiting) is a real answer and is returned to the caller — the
 * whole point of verify-queries.mjs is to see those, not to paper over them.
 *
 * IMPLICATION FOR THE WORKFLOW: the HTTP Request nodes in workflow 3 need
 * retryOnFail with maxTries >= 3. n8n does not do that by default.
 */
async function fetchRetry(url, opts = {}, tries = 3, backoffMs = 1500) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      lastErr = e;
      const cause = e?.cause?.code ?? '';
      if (attempt < tries) {
        // Linear, not exponential: the failure mode is a dropped socket, which a
        // fresh connection fixes immediately. Nothing is overloaded, so backing
        // off aggressively would only slow the run down.
        await sleep(backoffMs * attempt);
        continue;
      }
      throw new Error(`network failed after ${tries} tries (${cause || e.message}): ${url}`);
    }
  }
  throw lastErr;
}

async function search(item) {
  let res;
  try {
    res = await fetchRetry(Q.searchUrl(item), { headers: UA });
  } catch (e) {
    return { ok: false, status: 'network', why: e.message, items: [] };
  }
  if (!res.ok) return { ok: false, status: res.status, items: [] };
  const j = await res.json();
  return { ok: true, total: j.total_count, items: j.items || [] };
}

/** README from raw.githubusercontent — free, does not touch the API quota. */
async function readme(fullName, branch) {
  for (const b of [branch, 'main', 'master'].filter(Boolean)) {
    for (const f of ['README.md', 'readme.md', 'README.rst', 'README']) {
      try {
        const res = await fetchRetry(`https://raw.githubusercontent.com/${fullName}/${b}/${f}`, {}, 2, 800);
        if (res.ok) return await res.text();
      } catch { /* try the next candidate */ }
    }
  }
  return '';
}

const slim = (r, foundBy) => ({
  id: r.id, full_name: r.full_name, name: r.name, owner: r.owner?.login,
  description: r.description, homepage: r.homepage,
  stars: r.stargazers_count, forks: r.forks_count, open_issues: r.open_issues_count,
  language: r.language, topics: r.topics || [], license: r.license?.spdx_id || null,
  size_kb: r.size, archived: !!r.archived, fork: !!r.fork,
  is_template: !!r.is_template, disabled: !!r.disabled,
  created_at: r.created_at, pushed_at: r.pushed_at, default_branch: r.default_branch,
  found_by: foundBy,
});

// ---------------------------------------------------------------------------
// purpose similarity — the same two signals as db/discovery-queries.sql
// ---------------------------------------------------------------------------
// Reimplemented in JS rather than run through psql so a dry run works without
// the database. The thresholds come from rules.js, so the two cannot disagree
// about WHEN to flag; only the execution differs.

function jaccard(a, b) {
  const A_ = new Set(a.map((t) => String(t).toLowerCase()));
  const B_ = new Set(b.map((t) => String(t).toLowerCase()));
  if (!A_.size || !B_.size) return { shared: 0, j: 0 };
  let shared = 0;
  for (const t of A_) if (B_.has(t)) shared++;
  return { shared, j: shared / (A_.size + B_.size - shared) };
}

/** Character-trigram similarity, matching pg_trgm's definition closely enough. */
function trigramSim(a, b) {
  const tri = (s) => {
    const t = `  ${String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
    const out = new Set();
    for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
    return out;
  };
  const A_ = tri(a); const B_ = tri(b);
  if (!A_.size || !B_.size) return 0;
  let shared = 0;
  for (const x of A_) if (B_.has(x)) shared++;
  return shared / (A_.size + B_.size - shared);
}

function purposeMatches(repo, published) {
  const out = [];
  for (const p of published) {
    if (p.full_name === repo.full_name) continue;
    const { shared, j } = jaccard(repo.topics ?? [], p.topics ?? []);
    const d = trigramSim(repo.description, p.description);
    const byTopics = shared >= R.FUNNEL.purposeMinSharedTopics && j >= R.FUNNEL.purposeTopicJaccardThreshold;
    const byDesc = d >= R.FUNNEL.purposeSimilarityThreshold;
    if (byTopics || byDesc) out.push({ ...p, jaccard: j, shared, desc_sim: d, matched_by: byTopics ? 'topics' : 'description' });
  }
  return out.sort((a, b) => b.jaccard - a.jaccard || b.desc_sim - a.desc_sim)
    .slice(0, R.FUNNEL.purposeCompareLimit);
}

// ---------------------------------------------------------------------------
// one run
// ---------------------------------------------------------------------------

async function doRun(now, history, seenAcrossRuns, corpusPool) {
  const plan = Q.buildQueries(now);
  const stats = {
    seed: Q.dayIndex(now),
    queriesFired: 0, queriesDead: 0,
    reposSeen: 0, reposUnique: 0, dupWithinRun: 0, dupAcrossRuns: 0,
    cooldownBlocked: {}, stageAEligible: 0, readmesFetched: 0,
    readmesEmpty: 0, stageBEligible: 0, gatePassed: 0,
    selected: 0, laneCount: {}, rejectReasons: {}, purposeFlagged: 0,
  };

  // --- 1. collect ---
  const byId = new Map();
  if (offline) {
    // Offline mode replays a slice of the corpus, sized like a real run's yield
    // so the funnel percentages stay comparable. Rotated by the day seed so
    // --days does not replay the identical slice.
    const size = Math.min(corpusPool.length, 1200);
    const start = (stats.seed * 137) % Math.max(1, corpusPool.length);
    for (let i = 0; i < size; i++) {
      const r = corpusPool[(start + i) % corpusPool.length];
      byId.set(r.id, { ...r, found_by: 'offline' });
    }
    stats.queriesFired = plan.length;
  } else {
    for (const item of plan) {
      if (stats.queriesFired++) await sleep(SEARCH_SPACING);
      const res = await search(item);
      if (!res.ok) {
        stats.queriesDead++;
        console.log(`    DEAD ${item.label} — ${res.status === 'network' ? res.why : `HTTP ${res.status}`}`);
        continue;
      }
      for (const raw of res.items) {
        stats.reposSeen++;
        if (byId.has(raw.id)) { stats.dupWithinRun++; continue; }
        byId.set(raw.id, slim(raw, item.label));
      }
      if (verbose) console.log(`    ${pad(item.label, 30)} ${nm(res.total, 6)} matching, ${nm(res.items.length, 3)} read`);
    }
  }
  stats.reposUnique = byId.size;
  if (offline) stats.reposSeen = byId.size;

  // --- 2. cooldown ---
  const candidates = [];
  for (const [id, repo] of byId) {
    if (seenAcrossRuns.has(id)) stats.dupAcrossRuns++;
    const row = history.byId.get(id);
    const dec = A.shouldReconsider(row, now);
    if (!dec.ok) {
      stats.cooldownBlocked[dec.outcome] = (stats.cooldownBlocked[dec.outcome] ?? 0) + 1;
      continue;
    }
    candidates.push(repo);
  }

  // --- 3. stage A: metadata only ---
  const stageA = [];
  const hardRejects = [];
  for (const repo of candidates) {
    const s = A.scoreStageA(repo, now);
    if (!s.eligible) {
      hardRejects.push(s);
      for (const why of s.rejects) stats.rejectReasons[why] = (stats.rejectReasons[why] ?? 0) + 1;
      continue;
    }
    stageA.push({ repo, s });
  }
  stats.stageAEligible = stageA.length;

  // --- 4. fetch READMEs, with a per-lane budget ---
  // Not the global top N: see algorithm.allocateReadmeBudget for the measurement
  // that forced this. A global sort starved four of the six lanes completely.
  const forReadme = A.allocateReadmeBudget(stageA.map((x) => x.s), R.FUNNEL.readmeFetchLimit)
    .map((s) => stageA.find((x) => x.s === s));
  const budgeted = new Set(forReadme.map((x) => x.s));
  // Cleared stage A, lost the README lottery. Tracked separately because their
  // score must be written with last_stage 'a' — it is not comparable to
  // minTotalForLlm and must not label them nearMiss.
  const stageAOnly = stageA.filter((x) => !budgeted.has(x.s)).map((x) => x.s);
  stats.stageAOnly = stageAOnly.length;
  stats.readmeLanes = {};
  for (const item of forReadme) stats.readmeLanes[item.s.lane] = (stats.readmeLanes[item.s.lane] ?? 0) + 1;

  const CONC = 8;
  const queue = [...forReadme];
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (queue.length) {
      const item = queue.shift();
      item.readme = offline
        ? (item.repo.readme ?? '')
        : await readme(item.repo.full_name, item.repo.default_branch);
      stats.readmesFetched++;
      if (!item.readme) stats.readmesEmpty++;
    }
  }));

  // --- 5. stage B: with README ---
  const stageB = [];
  for (const item of forReadme) {
    const s = A.scoreStageB(item.repo, item.readme ?? '', now);
    if (!s.eligible) {
      for (const why of s.rejects) stats.rejectReasons[why] = (stats.rejectReasons[why] ?? 0) + 1;
      continue;
    }
    stageB.push(s);
  }
  stats.stageBEligible = stageB.length;
  stats.gatePassed = stageB.filter(A.passesLlmGate).length;

  // --- 6. select the LLM candidate set ---
  const sel = A.select(stageB, R.FUNNEL.llmCandidateLimit);
  stats.selected = sel.chosen.length;
  stats.laneCount = sel.laneCount;

  // --- 7. purpose similarity against what is already published ---
  const withSimilar = sel.chosen.map((s) => {
    const repo = byId.get(s.repo.id) ?? { full_name: s.repo.fullName, description: s.repo.description, topics: s.repo.topics };
    const matches = history.published.length ? purposeMatches(repo, history.published) : [];
    if (matches.length) stats.purposeFlagged++;
    return { s, matches };
  });

  for (const id of byId.keys()) seenAcrossRuns.add(id);
  return {
    plan, stats, chosen: withSimilar, stageB,
    // Everything the run scored, so the simulation can write outcomes back.
    scoredAll: stageB,
    stageAOnly,
    hardRejects,
    selectedIds: new Set(sel.chosen.map((s) => s.repo.id)),
    byId,
  };
}

/**
 * Write the simulated outcome of a run into the in-memory history, the way the
 * real workflow writes it into Postgres.
 *
 * Needed because a multi-day dry run without feedback is worthless: nothing
 * changes between days, so it picks the identical sixteen repos and reports a
 * rotation failure that is really a missing-simulation failure.
 *
 * The split (how many get published vs. rejected) mirrors the intended
 * production shape: finalSelectionSize posts per day out of llmCandidateLimit
 * candidates, with the remainder rejected by the human reviewer.
 */
function applySimulatedOutcomes(out, history, now) {
  const iso = new Date(now).toISOString();
  const publishCount = R.FUNNEL.finalSelectionSize;
  let published = 0;

  for (const { s } of out.chosen) {
    const id = s.repo.id;
    const raw = out.byId.get(id);
    if (published < publishCount) {
      published++;
      history.byId.set(id, { published: true, last_checked: iso });
      history.published.push({
        full_name: s.repo.fullName,
        description: raw?.description ?? s.repo.description ?? '',
        topics: raw?.topics ?? s.repo.topics ?? [],
      });
    } else {
      // Reached the LLM, was not posted. In production this is either a human
      // rejection or a lost slot; modelled as a human rejection, the harsher of
      // the two, so the cooldown is not flattered.
      history.byId.set(id, { human_rejected: true, last_checked: iso, last_total: s.total, last_stage: 'llm' });
    }
  }

  // Everything scored but not selected: recorded so its cooldown starts. This is
  // the group COOLDOWN.nearMiss and COOLDOWN.notSelected govern.
  //
  // last_stage matters as much as last_total here: only a README-bearing stage
  // may produce a nearMiss (rules.COMPARABLE_SCORE_STAGES). Writing the stage is
  // what keeps the multi-day test honest — without it every low score would look
  // like a 30-day lockout and the run would appear to rotate far better than it
  // really does.
  for (const s of out.scoredAll) {
    const id = s.repo.id;
    if (out.selectedIds.has(id) || history.byId.get(id)?.published) continue;
    history.byId.set(id, {
      last_total: s.total,
      last_stage: 'b',
      last_checked: iso,
      evaluated_at: A.passesLlmGate(s) ? iso : null,
    });
  }

  // Repos that cleared stage A but never earned a README. The run knows nothing
  // about them beyond metadata, so they carry stage 'a' and get the short
  // notSelected cooldown rather than being buried as near-misses.
  for (const s of out.stageAOnly ?? []) {
    const id = s.repo.id;
    if (history.byId.has(id)) continue;
    history.byId.set(id, { last_total: s.total, last_stage: 'a', last_checked: iso });
  }

  // Hard rejects, stored purely as dedup memory so their README is never fetched
  // again. REJECT_PERMANENCE decides whether that memory expires.
  for (const s of out.hardRejects ?? []) {
    const id = s.repo.id;
    if (history.byId.has(id)) continue;
    history.byId.set(id, {
      last_reject_reason: s.rejects[0] ?? null,
      last_stage: 'a',
      last_checked: iso,
    });
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const main = async () => {
  const history = loadHistory();
  console.log(`\nPure GitHub — discovery dry run`);
  console.log(`  mode        ${offline ? 'OFFLINE (corpus replay)' : 'LIVE GitHub API'}`);
  console.log(`  auth        ${TOKEN ? 'token present' : 'unauthenticated (10 searches/min)'}`);
  console.log(`  database    ${history.available ? `reachable — ${history.byId.size} repos known, ${history.published.length} published` : 'UNREACHABLE — treating every repo as new'}`);
  console.log(`  runs        ${runs}${dayOffset ? `, starting at day +${dayOffset}` : ''}`);

  let corpusPool = [];
  if (offline) {
    const p = path.join(DIR, 'corpus.json');
    if (!fs.existsSync(p)) { console.error('  corpus.json missing — run collect.mjs, or drop --offline'); process.exit(1); }
    corpusPool = JSON.parse(fs.readFileSync(p, 'utf8'));
    console.log(`  corpus      ${corpusPool.length} repos`);
  }

  const seenAcrossRuns = new Set();
  const base = Date.now() + dayOffset * DAY;
  const all = [];

  for (let d = 0; d < runs; d++) {
    const now = base + d * DAY;
    console.log(`\n${'='.repeat(72)}\nrun ${d + 1}/${runs}  (day seed ${Q.dayIndex(now)}, ${new Date(now).toISOString().slice(0, 10)})`);
    const out = await doRun(now, history, seenAcrossRuns, corpusPool);
    all.push(out);
    const s = out.stats;

    console.log(`\n  funnel`);
    console.log(`    queries fired        ${nm(s.queriesFired, 6)}${s.queriesDead ? `   DEAD: ${s.queriesDead}` : ''}`);
    console.log(`    repos returned       ${nm(s.reposSeen, 6)}`);
    console.log(`    unique this run      ${nm(s.reposUnique, 6)}   (${s.dupWithinRun} dupes within run)`);
    if (runs > 1) console.log(`    already seen        ${nm(s.dupAcrossRuns, 6)}   ${pct(s.dupAcrossRuns, s.reposUnique)} of this run`);
    const blocked = Object.values(s.cooldownBlocked).reduce((a, b) => a + b, 0);
    console.log(`    blocked by cooldown  ${nm(blocked, 6)}   ${Object.entries(s.cooldownBlocked).map(([k, v]) => `${k}:${v}`).join(' ') || '—'}`);
    console.log(`    stage A eligible     ${nm(s.stageAEligible, 6)}   ${pct(s.stageAEligible, s.reposUnique)}`);
    console.log(`    no README budget     ${nm(s.stageAOnly ?? 0, 6)}   stored as stage 'a' -> notSelected ${R.COOLDOWN.notSelected}d, never nearMiss`);
    console.log(`    READMEs fetched      ${nm(s.readmesFetched, 6)}   (${s.readmesEmpty} empty)  per lane: ${Object.entries(s.readmeLanes ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}`);
    console.log(`    stage B eligible     ${nm(s.stageBEligible, 6)}   ${pct(s.stageBEligible, s.readmesFetched)}`);
    console.log(`    passed LLM gate      ${nm(s.gatePassed, 6)}   quality>=${R.FUNNEL.minQualityForLlm} and total>=${R.FUNNEL.minTotalForLlm}`);
    console.log(`    selected             ${nm(s.selected, 6)}   cap ${R.FUNNEL.llmCandidateLimit}`);
    console.log(`    purpose-flagged      ${nm(s.purposeFlagged, 6)}   of the selected`);

    if (Object.keys(s.rejectReasons).length) {
      console.log(`\n  rejects: ${Object.entries(s.rejectReasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    }
    console.log(`  lanes:   ${Object.entries(s.laneCount).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}`);

    console.log(`\n  candidates that would go to the LLM:`);
    for (const { s: c, matches } of out.chosen) {
      console.log(`    [${c.total.toFixed(0).padStart(3)}] ${pad(c.lane, 14)} q=${nm(c.quality.toFixed(0), 2)} ${nm(c.repo.stars, 6)}* ${pad(c.repo.language ?? '-', 12)} ${c.repo.fullName}`);
      for (const m of matches) {
        console.log(`           ~ similar to published ${m.full_name} (${m.matched_by}: jaccard ${m.jaccard.toFixed(2)}, desc ${m.desc_sim.toFixed(2)})`);
      }
    }

    // Feed the run's outcome back, so the next day sees a changed world. See
    // applySimulatedOutcomes: without this, every day picks the same sixteen.
    if (runs > 1) applySimulatedOutcomes(out, history, now);
  }

  // --- verdict ---
  console.log(`\n${'='.repeat(72)}\nassessment`);
  const problems = [];
  const last = all[all.length - 1].stats;

  if (all.some((r) => r.stats.queriesDead)) problems.push('some queries returned an HTTP error — the plan is losing budget silently');
  if (last.selected < R.FUNNEL.finalSelectionSize) {
    problems.push(`only ${last.selected} candidates for ${R.FUNNEL.finalSelectionSize} posts — supply is short`);
  }
  if (last.stageAEligible < R.FUNNEL.readmeFetchLimit) {
    problems.push(`stage A yielded ${last.stageAEligible}, below readmeFetchLimit ${R.FUNNEL.readmeFetchLimit} — not a fault, but the funnel is narrower than designed`);
  }
  if (runs > 1) {
    // The real question over several days is not "did the queries return new
    // repos" — in offline mode they cannot, because the corpus is fixed. It is
    // whether the CANDIDATE SET changes, which is what the cooldown governs and
    // what decides whether the channel gets fresh posts.
    const sets = all.map((r) => new Set(r.chosen.map((x) => x.s.repo.fullName)));
    const repeats = [];
    for (let i = 1; i < sets.length; i++) {
      let same = 0;
      for (const n of sets[i]) if (sets[i - 1].has(n)) same++;
      repeats.push(same);
    }
    console.log(`  candidate overlap between consecutive runs: ${repeats.join(', ')} of ${R.FUNNEL.llmCandidateLimit}`);
    const worstRepeat = Math.max(...repeats);
    if (worstRepeat > R.FUNNEL.llmCandidateLimit / 2) {
      problems.push(`up to ${worstRepeat} of ${R.FUNNEL.llmCandidateLimit} candidates repeated from the previous run — cooldown is not working`);
    }
    const totalPublished = history.published.length;
    console.log(`  simulated posts over ${runs} runs: ${totalPublished}`);
  }

  if (problems.length) {
    console.log('  issues:');
    for (const p of problems) console.log(`    - ${p}`);
  } else {
    console.log('  no issues: every query returned, the funnel fills, rotation spreads.');
  }

  console.log(`\n  designed funnel  ~1200 -> ${R.FUNNEL.readmeFetchLimit} -> ${R.FUNNEL.llmCandidateLimit} -> ${R.FUNNEL.finalSelectionSize}`);
  console.log(`  measured         ${last.reposUnique} -> ${last.readmesFetched} -> ${last.selected} -> (LLM decides)`);
};

main().catch((e) => { console.error(e); process.exit(1); });
