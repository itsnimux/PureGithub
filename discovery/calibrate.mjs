#!/usr/bin/env node
// Calibration harness. Runs the real algorithm over the collected corpus and
// reports what the thresholds actually do, so numbers are measured rather than
// guessed.
//
// Usage: node calibrate.mjs [corpus.json]

import fs from 'node:fs';
import path from 'node:path';
import * as A from './algorithm.js';
import * as R from './rules.js';

A.validateRules();

// Resolved against this file's directory, not the shell's cwd. collect.mjs
// already did this; calibrate.mjs did not, so it only ran from inside
// discovery/ and failed from the project root.
const corpusPath = process.argv[2] ?? path.join(import.meta.dirname, 'corpus.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const NOW = Date.now();

const scored = corpus.map((r) => ({ raw: r, b: A.scoreStageB(r, r.readme, NOW) }));

const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`;
const q = (arr, p) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const line = (s) => console.log(s);
const rule = (t) => { line(''); line(`=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`); };

// ---------------------------------------------------------------------------
rule('1. corpus and gross funnel');
line(`corpus: ${corpus.length} repos, ${corpus.filter((r) => r.readme.length >= 300).length} with usable README`);

const eligible = scored.filter((s) => s.b.eligible);
line(`eligible (passed hard rejects + matched a lane): ${eligible.length}  ${pct(eligible.length, scored.length)}`);

const rejReasons = {};
for (const s of scored) for (const r of s.b.rejects) rejReasons[r] = (rejReasons[r] ?? 0) + 1;
line('rejection reasons:');
for (const [k, v] of Object.entries(rejReasons).sort((a, b) => b[1] - a[1])) {
  line(`   ${String(v).padStart(4)}  ${k}`);
}

// ---------------------------------------------------------------------------
rule('2. lane occupancy');
const byLane = {};
for (const s of eligible) (byLane[s.b.lane] ??= []).push(s);
for (const lane of R.LANE_PRIORITY) {
  const g = byLane[lane] ?? [];
  const tot = g.map((s) => s.b.total);
  line(`${lane.padEnd(15)} n=${String(g.length).padStart(4)}  total: p50=${q(tot, 0.5)?.toFixed(1) ?? '-'} p90=${q(tot, 0.9)?.toFixed(1) ?? '-'} max=${tot.length ? Math.max(...tot).toFixed(1) : '-'}`);
}
const multi = eligible.filter((s) => s.b.lanes.length > 1).length;
line(`repos qualifying for >1 lane: ${multi}  ${pct(multi, eligible.length)}`);

// ---------------------------------------------------------------------------
rule('3. score distributions (eligible only)');
const quals = eligible.map((s) => s.b.quality);
const totals = eligible.map((s) => s.b.total);
line(`quality: min=${Math.min(...quals).toFixed(1)} p10=${q(quals, 0.1).toFixed(1)} p25=${q(quals, 0.25).toFixed(1)} p50=${q(quals, 0.5).toFixed(1)} p75=${q(quals, 0.75).toFixed(1)} p90=${q(quals, 0.9).toFixed(1)} max=${Math.max(...quals).toFixed(1)}`);
line(`total:   min=${Math.min(...totals).toFixed(1)} p10=${q(totals, 0.1).toFixed(1)} p25=${q(totals, 0.25).toFixed(1)} p50=${q(totals, 0.5).toFixed(1)} p75=${q(totals, 0.75).toFixed(1)} p90=${q(totals, 0.9).toFixed(1)} max=${Math.max(...totals).toFixed(1)}`);

// ---------------------------------------------------------------------------
rule('4. threshold sweep — how many survive each gate');
line('The target: enough survivors to fill 3-4 posts/day with review headroom.');
line('');
line(' minQuality  minTotal   survivors   per-lane spread');
for (const mq of [35, 40, 42, 45, 50, 55, 60]) {
  for (const mt of [50, 55, 60, 65, 70]) {
    const pass = eligible.filter((s) => s.b.quality >= mq && s.b.total >= mt);
    if (!pass.length) continue;
    const spread = {};
    for (const s of pass) spread[s.b.lane] = (spread[s.b.lane] ?? 0) + 1;
    const spreadStr = R.LANE_PRIORITY.map((l) => `${l.slice(0, 4)}:${spread[l] ?? 0}`).join(' ');
    line(`   ${String(mq).padStart(4)}       ${String(mt).padStart(4)}      ${String(pass.length).padStart(5)}      ${spreadStr}`);
  }
}

// ---------------------------------------------------------------------------
rule('5. adversarial check — did the junk queries get filtered?');
const junkLabels = ['junk_freenode', 'junk_piracy', 'junk_learning', 'junk_prompts'];
for (const label of junkLabels) {
  const group = scored.filter((s) => s.raw.queries.includes(label));
  const passed = group.filter((s) => A.passesLlmGate(s.b));
  line(`${label.padEnd(15)} n=${String(group.length).padStart(3)}  reached LLM gate: ${passed.length}  ${pct(passed.length, group.length)}`);
  for (const s of passed.slice(0, 6)) {
    line(`      LEAK  total=${s.b.total.toFixed(1)} q=${s.b.quality.toFixed(1)} lane=${s.b.lane} pen=[${s.b.breakdown.penaltyHits.join(',')}]  ${s.raw.full_name}`);
    line(`            "${String(s.raw.description ?? '').slice(0, 90)}"`);
  }
}

// ---------------------------------------------------------------------------
rule('6. config-dump handling');
const dumps = scored.filter((s) => A.configDumpScore(A.normalize(s.raw, NOW)).isDump);
line(`detected as dumps: ${dumps.length}`);
const dumpsPassing = dumps.filter((s) => A.passesLlmGate(s.b));
line(`dumps reaching LLM gate: ${dumpsPassing.length}  (want 0)`);
for (const s of dumps.slice(0, 10)) {
  line(`   total=${String(s.b.total.toFixed(1)).padStart(7)} eligible=${s.b.eligible ? 'Y' : 'N'} rej=[${s.b.rejects.join(',')}]  ${s.raw.full_name}`);
}

// ---------------------------------------------------------------------------
rule('7. what would actually be selected today');
const sel = A.select(eligible.map((s) => s.b), R.FUNNEL.finalSelectionSize);
line(`chosen ${sel.chosen.length} of ${R.FUNNEL.finalSelectionSize} requested; lane counts: ${JSON.stringify(sel.laneCount)}`);
for (const s of sel.chosen) {
  line(`  [${s.total.toFixed(1)}] ${s.lane.padEnd(14)} q=${s.quality.toFixed(0)} rel=${s.relevance} pen=${s.penalty}  ${String(s.repo.stars).padStart(6)}*  ${s.repo.fullName}`);
  line(`        "${s.repo.description.slice(0, 88)}"`);
}

// ---------------------------------------------------------------------------
rule('8. top 25 by total, to eyeball whether the ranking is sane');
for (const s of [...eligible].sort((a, b) => b.b.total - a.b.total).slice(0, 25)) {
  const b = s.b;
  line(`[${b.total.toFixed(1)}] ${b.lane.padEnd(14)} q=${String(b.quality.toFixed(0)).padStart(3)} craft=${String(b.breakdown.craft.toFixed(0)).padStart(2)} rel=${String(b.relevance).padStart(2)} pen=${String(b.penalty).padStart(2)} ${String(b.repo.stars).padStart(6)}* ${String(b.repo.language ?? '-').padEnd(11)} ${b.repo.fullName}`);
}

// ---------------------------------------------------------------------------
rule('9. iran lane detail — is the highest-value lane actually working?');
const iranAll = scored.filter((s) => s.raw.queries.some((qq) => qq.startsWith('iran')));
line(`repos found by iran queries: ${iranAll.length}`);
const iranEl = iranAll.filter((s) => s.b.eligible);
line(`  eligible: ${iranEl.length}`);
const iranLane = iranAll.filter((s) => s.b.lanes.includes('iran_relevant'));
line(`  matched iran_relevant lane: ${iranLane.length}`);
const iranGate = iranLane.filter((s) => A.passesLlmGate(s.b));
line(`  reached LLM gate: ${iranGate.length}`);
line('  top 12:');
for (const s of iranGate.sort((a, b) => b.b.total - a.b.total).slice(0, 12)) {
  line(`    [${s.b.total.toFixed(1)}] ${String(s.raw.stars).padStart(6)}* ${String(s.raw.language ?? '-').padEnd(11)} ${s.raw.full_name}  (${s.b.breakdown.iranWhy})`);
}

// ---------------------------------------------------------------------------
rule('10. detector coverage');
const iranianOwners = scored.filter((s) => A.iranianCreator(A.normalize(s.raw, NOW)).yes);
line(`iranian-creator detected: ${iranianOwners.length} of ${corpus.length}`);
const persianReadme = corpus.filter((r) => (r.readme.match(/[\u067E\u0686\u0698\u06AF\u06A9\u06CC]/g) || []).length >= R.IRAN_RELEVANCE.persianTextMinChars);
line(`persian README detected (>=${R.IRAN_RELEVANCE.persianTextMinChars} chars): ${persianReadme.length}`);
const demoHave = eligible.filter((s) => s.b.breakdown.craftHits.includes('demo'));
line(`README has demo media: ${demoHave.length}  ${pct(demoHave.length, eligible.length)}`);
const installHave = eligible.filter((s) => s.b.breakdown.craftHits.includes('install'));
line(`README has install section: ${installHave.length}  ${pct(installHave.length, eligible.length)}`);
