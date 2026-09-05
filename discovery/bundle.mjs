#!/usr/bin/env node
// Build a single-file version of the discovery engine for an n8n Code node.
//
// WHY THIS EXISTS
// ---------------
// n8n Code nodes have no module system: `import` and `require` are unavailable,
// so rules.js + algorithm.js + queries.js cannot be used there as-is. The
// alternative — retyping the logic into the node by hand — would immediately
// create a second source of truth that drifts, which is exactly the problem
// workflows/puregh-manual-publish.ts already has (see AGENTS.md §12).
//
// So the node gets a GENERATED file. It is never hand-edited; it is rebuilt.
//
// HOW
// ---
// Each module is wrapped in its own IIFE and its exports returned as an object.
// Wrapping rather than concatenating is deliberate: algorithm.js and queries.js
// both declare `const DAY = 86_400_000` at top level, so flat concatenation is
// a syntax error. Wrapping also means a future helper name collision cannot
// silently shadow anything.
//
// The build then VERIFIES itself: the bundle is executed and its output compared
// against the ESM modules on real corpus repos. A bundler that produces
// plausible-looking but wrong code is worse than no bundler.
//
//   node discovery/bundle.mjs            # writes discovery/bundle.generated.js
//   node discovery/bundle.mjs --check    # verify only, write nothing
//   node discovery/bundle.mjs --lean     # also write bundle.lean.js (no comments)

import fs from 'node:fs';
import path from 'node:path';
import * as A from './algorithm.js';
import * as Q from './queries.js';

const DIR = import.meta.dirname;
const OUT = path.join(DIR, 'bundle.generated.js');
const LEAN = path.join(DIR, 'bundle.lean.js');
const MODULES = [
  // [alias, file, argument passed into the IIFE]
  // rules.js imports nothing, so it takes no argument. Passing `R` to it would
  // throw: at that point `const R = (function (R) {...})(R)` still has R in its
  // temporal dead zone, and even `typeof R` throws ReferenceError for a `const`
  // in TDZ — the one case where typeof is not safe.
  ['R', 'rules.js', ''],
  ['A', 'algorithm.js', 'R'],
  ['Q', 'queries.js', 'R'],
];

const checkOnly = process.argv.includes('--check');
const wantLean = process.argv.includes('--lean');

// ---------------------------------------------------------------------------
// transform
// ---------------------------------------------------------------------------

/** Names exported by a module, in declaration order. */
function exportNames(src) {
  const names = [];
  const re = /^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src))) names.push(m[1]);
  return names;
}

function wrap(alias, file, arg) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  const names = exportNames(src);
  if (!names.length) throw new Error(`${file}: no exports found — regex out of date?`);

  // Assert there is no export form the regex cannot see. `export default`,
  // `export {}` and `export * from` would all be silently dropped.
  const unsupported = src.match(/^export\s+(?!(?:async\s+)?(?:const|let|var|function|class)\s)/gm);
  if (unsupported) {
    throw new Error(`${file}: unsupported export form (${unsupported.length}x) — bundler would drop it`);
  }

  const body = src
    // Drop the import lines; the IIFE receives R as a parameter instead.
    .replace(/^import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+/gm, '');

  return [
    `// ===== ${file} ${'='.repeat(Math.max(0, 60 - file.length))}`,
    `const ${alias} = (function (${arg ? 'R' : ''}) {`,
    body.trim(),
    `  return { ${names.join(', ')} };`,
    `})(${arg});`,
    '',
  ].join('\n');
}

const HEADER = `// Pure GitHub — discovery engine, bundled for an n8n Code node.
//
// GENERATED FILE — DO NOT EDIT.
// Source: discovery/rules.js, discovery/algorithm.js, discovery/queries.js
// Rebuild: node discovery/bundle.mjs
//
// Paste the whole file into a Code node (mode: Run Once for All Items) above
// your own logic, then call into PUREGH. Everything is synchronous and pure —
// no fetch, no database, no Date.now() unless you pass one in.
//
// Typical use in the Discovery workflow:
//
//   // node "Build Queries"
//   const plan = PUREGH.buildQueries(Date.now());
//   return plan.map((p) => ({ json: p }));      // one item per query
//
//   // node "Score Stage A"  (metadata only, ~1200 repos)
//   const scored = items.map((i) => PUREGH.scoreStageA(i.json));
//
//   // node "Score Stage B"  (with README, ~120 repos)
//   const s = PUREGH.scoreStageB(repo, readme);
//   if (PUREGH.passesLlmGate(s)) { /* ... */ }
//
//   // node "Select Candidates"
//   const { chosen } = PUREGH.select(scoredList, PUREGH.rules.FUNNEL.llmCandidateLimit);
//
//   // node "Final Selection"  (after the LLM has judged)
//   const { chosen } = PUREGH.selectFinal(judged);
`;

const FOOTER = `
// ---------------------------------------------------------------------------
// public surface
// ---------------------------------------------------------------------------
const PUREGH = {
  rules: R,

  // queries
  buildQueries: Q.buildQueries,
  searchUrl: Q.searchUrl,
  dayIndex: Q.dayIndex,
  rotationCoverage: Q.rotationCoverage,

  // scoring
  normalize: A.normalize,
  scoreStageA: A.scoreStageA,
  scoreStageB: A.scoreStageB,
  passesLlmGate: A.passesLlmGate,

  // budget allocation — per-lane, not a global top-N. See allocateByLane.
  allocateByLane: A.allocateByLane,
  allocateReadmeBudget: A.allocateReadmeBudget,

  // classification, exposed for diagnostics and for the review form
  configDumpScore: A.configDumpScore,
  promptDumpScore: A.promptDumpScore,
  isCuratedList: A.isCuratedList,
  iranRelevance: A.iranRelevance,
  aiRelevance: A.aiRelevance,
  iranianCreator: A.iranianCreator,
  hardRejects: A.hardRejects,
  lanesFor: A.lanesFor,

  // cooldown
  outcomeOf: A.outcomeOf,
  shouldReconsider: A.shouldReconsider,

  // selection
  select: A.select,
  selectFinal: A.selectFinal,

  validateRules: A.validateRules,
};

// Fail loudly at paste time rather than mid-run: if rules.js is internally
// inconsistent, every score below is meaningless.
PUREGH.validateRules();
`;

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

const parts = [HEADER];
for (const [alias, file, arg] of MODULES) parts.push(wrap(alias, file, arg));
parts.push(FOOTER);
const bundle = parts.join('\n');

// ---------------------------------------------------------------------------
// verify — run the bundle and compare against the real modules
// ---------------------------------------------------------------------------

const sandbox = { PUREGH: null };
// eslint-disable-next-line no-new-func
const load = new Function(`${bundle}\nreturn PUREGH;`);
let P;
try {
  P = load();
} catch (e) {
  console.error('bundle failed to execute:\n', e);
  process.exit(1);
}
sandbox.PUREGH = P;

const fails = [];
const eq = (label, a, b) => {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) fails.push(`${label}\n    module: ${String(sa).slice(0, 220)}\n    bundle: ${String(sb).slice(0, 220)}`);
};

// 1. Query plan must be byte-identical for a fixed timestamp.
const NOW = Date.parse('2026-09-05T09:00:00Z');
eq('buildQueries(fixed now)', Q.buildQueries(NOW), P.buildQueries(NOW));
eq('dayIndex', Q.dayIndex(NOW), P.dayIndex(NOW));
eq('rotationCoverage(30)', Q.rotationCoverage(30, NOW), P.rotationCoverage(30, NOW));

// 2. Scoring must match on real repos, including the adversarial ones. The
//    regression fixtures are used because they are the cases that matter: a
//    real client misclassified as a config dump breaks the best lane.
const refPath = path.join(DIR, 'reference.json');
if (fs.existsSync(refPath)) {
  const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));
  const entries = Object.entries(ref);
  for (const [name, repo] of entries) {
    eq(`scoreStageA ${name}`, A.scoreStageA(repo, NOW), P.scoreStageA(repo, NOW));
    eq(`scoreStageB ${name}`, A.scoreStageB(repo, repo.readme, NOW), P.scoreStageB(repo, repo.readme, NOW));
    eq(`configDumpScore ${name}`, A.configDumpScore(A.normalize(repo, NOW)), P.configDumpScore(P.normalize(repo, NOW)));
  }
  console.log(`  compared ${entries.length} reference repos x 3 functions`);
} else {
  console.log('  reference.json missing — run regression.mjs first for full verification');
}

// 3. A wider sweep over the corpus, if present. Catches paths the 24 reference
//    repos never touch (missing language, no topics, huge README).
const corpusPath = path.join(DIR, 'corpus.json');
if (fs.existsSync(corpusPath)) {
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const step = Math.max(1, Math.floor(corpus.length / 200));
  let n = 0;
  for (let i = 0; i < corpus.length; i += step) {
    const r = corpus[i];
    eq(`corpus scoreStageB ${r.full_name}`, A.scoreStageB(r, r.readme, NOW), P.scoreStageB(r, r.readme, NOW));
    n++;
  }
  console.log(`  compared ${n} corpus repos (every ${step}th)`);
}

// 4. Selection, cooldown and budget allocation.
if (fs.existsSync(corpusPath)) {
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const scored = corpus.slice(0, 400).map((r) => A.scoreStageB(r, r.readme, NOW));
  const scoredP = corpus.slice(0, 400).map((r) => P.scoreStageB(r, r.readme, NOW));
  eq('select()', A.select(scored).chosen.map((s) => s.repo.fullName), P.select(scoredP).chosen.map((s) => s.repo.fullName));
  const stageA = corpus.slice(0, 600).map((r) => A.scoreStageA(r, NOW)).filter((s) => s.eligible);
  const stageAP = corpus.slice(0, 600).map((r) => P.scoreStageA(r, NOW)).filter((s) => s.eligible);
  eq('allocateReadmeBudget()',
    A.allocateReadmeBudget(stageA).map((s) => s.repo.fullName),
    P.allocateReadmeBudget(stageAP).map((s) => s.repo.fullName));
}
const rows = [
  null,
  { published: true },
  { human_rejected: true, last_checked: new Date(NOW).toISOString() },
  { verdict: 'reject', last_checked: new Date(NOW - 10 * 86400000).toISOString() },
  { last_total: 60, last_checked: new Date(NOW - 40 * 86400000).toISOString() },
  { last_reject_reason: 'fork', last_checked: new Date(NOW - 999 * 86400000).toISOString() },
  { last_reject_reason: 'no-readme', last_checked: new Date(NOW - 50 * 86400000).toISOString() },
  { evaluated_at: 'x', last_total: 90, last_checked: new Date(NOW - 1 * 86400000).toISOString() },
];
rows.forEach((row, i) => eq(`shouldReconsider[${i}]`, A.shouldReconsider(row, NOW), P.shouldReconsider(row, NOW)));

// 5. selectFinal. Nothing else calls it yet, so this is its only coverage.
//    Verdicts and categories are synthetic, but the same synthetic values are
//    fed to both implementations, so a divergence is a real bundler bug. The
//    category cap is asserted separately because it is the rule that was dead
//    config until selectFinal existed.
if (fs.existsSync(corpusPath)) {
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const cats = ['AI', 'developer-tools', 'security', 'web'];
  const build = (score) => corpus.slice(0, 400)
    .map((r) => score(r, r.readme, NOW))
    .filter((s) => A.passesLlmGate(s))
    .slice(0, 16)
    .map((s, i) => ({
      scored: s,
      verdict: i % 5 === 0 ? 'reject' : (i % 2 ? 'maybe' : 'strong'),
      category: cats[i % cats.length],
      isDuplicatePurpose: i % 7 === 0,
    }));

  const mine = A.selectFinal(build(A.scoreStageB));
  const theirs = P.selectFinal(build(P.scoreStageB));
  eq('selectFinal chosen', mine.chosen.map((j) => j.scored.repo.fullName), theirs.chosen.map((j) => j.scored.repo.fullName));
  eq('selectFinal skipped reasons', mine.skipped.map((x) => x.why), theirs.skipped.map((x) => x.why));

  // The caps must actually bind.
  eq('selectFinal respects maxPerCategory',
    Object.values(mine.catCount).every((n) => n <= 2), true);
  eq('selectFinal respects finalSelectionSize', mine.chosen.length <= 8, true);
  eq('selectFinal drops rejects and duplicates',
    mine.chosen.every((j) => j.verdict !== 'reject' && !j.isDuplicatePurpose), true);
  // A `strong` must never be ordered below a `maybe`.
  const verdicts = mine.chosen.map((j) => j.verdict);
  eq('selectFinal orders strong before maybe',
    verdicts.indexOf('maybe') === -1 || verdicts.lastIndexOf('strong') < verdicts.indexOf('maybe'), true);
}

if (fails.length) {
  console.error(`\nBUNDLE MISMATCH (${fails.length}):`);
  for (const f of fails.slice(0, 10)) console.error('  - ' + f);
  process.exit(1);
}

/**
 * Strip comments and blank lines. The commented bundle is 96KB, of which 39% is
 * comment — deliberate in the source, but an n8n Code node is a textarea in a
 * SQLite row and a smaller paste is easier to work with. Line-based rather than
 * a real parser, so it must not touch anything ambiguous: only lines that are
 * ENTIRELY a comment are dropped, never trailing comments (a `//` inside a
 * string or regex would break the file).
 */
function lean(src) {
  const out = [];
  let inBlock = false;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (inBlock) { if (t.endsWith('*/')) inBlock = false; continue; }
    if (t.startsWith('/*')) { if (!t.endsWith('*/')) inBlock = true; continue; }
    if (t.startsWith('//')) continue;
    if (!t) continue;
    out.push(line);
  }
  return out.join('\n');
}

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)}KB`;
console.log('\n  bundle verified: identical output to the ES modules');
console.log(`  size ${kb(bundle)}  (${bundle.split('\n').length} lines)`);

if (checkOnly) {
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (existing !== bundle) {
    console.error(`\n  ${path.basename(OUT)} is STALE — run: node discovery/bundle.mjs`);
    process.exit(1);
  }
  console.log(`  ${path.basename(OUT)} is up to date`);
} else {
  fs.writeFileSync(OUT, bundle);
  console.log(`  wrote ${OUT}`);
}

if (wantLean) {
  const slim = lean(bundle);
  // Verify the stripped version too — a comment stripper that breaks the file
  // is the kind of bug that only shows up in production.
  try {
    // eslint-disable-next-line no-new-func
    const PL = new Function(`${slim}\nreturn PUREGH;`)();
    const a = JSON.stringify(PL.buildQueries(NOW));
    const b = JSON.stringify(Q.buildQueries(NOW));
    if (a !== b) throw new Error('lean bundle produced a different query plan');
    if (fs.existsSync(refPath)) {
      const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));
      for (const [name, repo] of Object.entries(ref)) {
        const x = JSON.stringify(A.scoreStageB(repo, repo.readme, NOW));
        const y = JSON.stringify(PL.scoreStageB(repo, repo.readme, NOW));
        if (x !== y) throw new Error(`lean bundle diverged on ${name}`);
      }
    }
  } catch (e) {
    console.error(`  lean bundle FAILED: ${e.message}`);
    process.exit(1);
  }
  if (!checkOnly) fs.writeFileSync(LEAN, slim);
  console.log(`  lean ${kb(slim)}  (${slim.split('\n').length} lines) — verified`);
}
