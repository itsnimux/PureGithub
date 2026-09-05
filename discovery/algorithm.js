// Pure GitHub — Discovery algorithm
//
// Pure functions only, no I/O. Every number comes from rules.js; nothing is
// hardcoded here. Written so the whole file can be pasted into an n8n Code
// node once calibration is settled.
//
// Two-stage by design:
//   scoreStageA(repo)            — metadata only, free, runs on ~1000 repos
//   scoreStageB(repo, readme)    — adds README signals, runs on ~120
// Both return the same shape so the caller can sort with either.

import * as R from './rules.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

/** Compile a pattern list once into a single word-boundary anchored regex. */
function compile(patterns) {
  const body = patterns
    .map((p) => (/[\\^$()[\]*+?{}|]/.test(p) ? p : escapeLiteral(p)))
    .join('|');
  // Boundaries must NOT include letters, or a camelCase repo name defeats
  // them: /(?:^|[^a-z0-9])crack/i never matched "PyInstaCrack" or "hashCrack",
  // which is how four piracy repos leaked through in the first calibration
  // run. Lookaround on non-letters only, so "Crack" inside "PyInstaCrack" is
  // caught while "crack" inside a genuine word is still bounded.
  return new RegExp(`(?<![a-z0-9])(?:${body})(?![a-z0-9])`, 'i');
}

/** Same, but the patterns already encode their own anchors. */
function compileRaw(patterns) {
  return new RegExp(patterns.join('|'), 'i');
}

/**
 * Word-boundary anchored on BOTH sides, for short keywords that appear inside
 * longer words. Measured need: unanchored "rial" matched tutorial, material,
 * serial, editorial and industrial, awarding fake Iran relevance to 163 of
 * 1075 corpus repos against 26 genuine matches — a 6:1 false-positive rate.
 */
function compileWords(patterns) {
  return new RegExp(`\\b(?:${patterns.join('|')})\\b`, 'i');
}

function escapeLiteral(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const RX = {
  configDumpName: compileRaw(R.CONFIG_DUMP_SIGNALS.namePatterns),
  configDumpTopic: compileRaw(R.CONFIG_DUMP_SIGNALS.topicPatterns),
  configDumpDesc: compileRaw(R.CONFIG_DUMP_SIGNALS.descPatterns),
  promptDumpName: compileRaw(R.PROMPT_DUMP_SIGNALS.namePatterns),
  promptDumpDesc: compileRaw(R.PROMPT_DUMP_SIGNALS.descPatterns),
  piracy: compile(R.PIRACY_PATTERNS),
  curatedList: compileRaw(R.CURATED_LIST_PATTERNS),
  learning: compile(R.LEARNING_PROJECT_PATTERNS),
  aiSlop: compileRaw(R.AI_BOOST.slopPatterns),
  demo: compileRaw(R.DEMO_MEDIA_PATTERNS),
  install: compileRaw(R.INSTALL_PATTERNS),
  iranLocation: compile(R.IRANIAN_CREATOR.locationPatterns),
  iranKeywords: compileWords(R.IRAN_RELEVANCE.tier2Keywords),
  // Letters present in Persian but not Arabic, so Arabic repos do not
  // false-positive as Persian.
  persianOnly: /[\u067E\u0686\u0698\u06AF\u06A9\u06CC]/g,
};

const KNOWN_IRANIAN = new Set(
  R.IRANIAN_CREATOR.knownOwners.map((o) => o.toLowerCase()),
);

const LIST_TOPICS = new Set(R.CURATED_LIST_TOPICS);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const saturate = (v, sat) => (sat <= 0 ? 0 : 1 - Math.exp(-3 * clamp(v, 0, Infinity) / sat));

/** Normalise the two shapes we receive: GitHub API JSON, or a DB row. */
export function normalize(raw, now = Date.now()) {
  const stars = num(raw.stars ?? raw.stargazers_count);
  const created = Date.parse(raw.created_at ?? raw.gh_created_at ?? '') || now;
  const pushed = Date.parse(raw.pushed_at ?? raw.gh_pushed_at ?? '') || now;
  const ageDays = Math.max(1, (now - created) / DAY);

  return {
    id: raw.id ?? raw.github_id ?? null,
    fullName: String(raw.full_name ?? ''),
    name: String(raw.name ?? String(raw.full_name ?? '').split('/')[1] ?? ''),
    owner: String(raw.owner?.login ?? raw.owner ?? ''),
    description: String(raw.description ?? ''),
    homepage: String(raw.homepage ?? ''),
    stars,
    forks: num(raw.forks ?? raw.forks_count),
    openIssues: num(raw.open_issues ?? raw.open_issues_count),
    language: raw.language ?? null,
    topics: Array.isArray(raw.topics) ? raw.topics.map((t) => String(t).toLowerCase()) : [],
    license: raw.license?.spdx_id ?? raw.license ?? raw.license_spdx ?? null,
    sizeKb: num(raw.size_kb ?? raw.size),
    archived: !!(raw.archived ?? raw.is_archived),
    fork: !!(raw.fork ?? raw.is_fork),
    isTemplate: !!(raw.is_template ?? raw.isTemplate),
    disabled: !!raw.disabled,
    contributors: raw.contributors ?? null,   // only known at stage 3
    ownerLocation: raw.owner_location ?? null, // only known at stage 3
    ageDays,
    daysSincePush: Math.max(0, (now - pushed) / DAY),
    velocity: stars / ageDays,
  };
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** name + topics, the cheap text surface used for structural classification. */
const nameSurface = (r) => `${splitCamel(r.name)} ${r.topics.join(' ')}`;
/** Everything textual, used for penalty matching. */
const fullSurface = (r, readme = '') =>
  `${splitCamel(r.name)} ${r.description} ${r.topics.join(' ')} ${readme.slice(0, 1500)}`;

/**
 * Insert spaces at camelCase boundaries so word-anchored patterns can see
 * words fused into an identifier.
 *
 * Measured need: four piracy repos leaked through the first calibration run
 * purely because their names were camelCase — PyInstaCrack, hashCrack,
 * GeetestCrack, NetCracker. Splitting first catches all four while still
 * leaving crackle-parser, nutcracker and Cracklib alone.
 */
function splitCamel(s) {
  return String(s ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

// ---------------------------------------------------------------------------
// classification
// ---------------------------------------------------------------------------

/** Is this an auto-generated config / node-list dump rather than software? */
export function configDumpScore(r) {
  const S = R.CONFIG_DUMP_SIGNALS;
  let score = 0;
  const hits = [];
  if (!r.language) { score += S.noLanguagePoints; hits.push('no-language'); }
  if (RX.configDumpName.test(splitCamel(r.name))) { score += S.namePatternPoints; hits.push('name'); }
  if (RX.configDumpTopic.test(r.topics.join(' '))) { score += S.topicPatternPoints; hits.push('topic'); }
  if (RX.configDumpDesc.test(r.description)) { score += S.descPatternPoints; hits.push('desc'); }
  return { score, hits, isDump: score >= S.rejectAtScore };
}

/**
 * Is this a prompt / jailbreak collection rather than software?
 *
 * Kept separate from configDumpScore because the hard case is different: here
 * the risk is confusing a prompt LIST with a real ChatGPT TOOL, whose
 * description contains all the same vocabulary. See PROMPT_DUMP_SIGNALS.
 */
export function promptDumpScore(r) {
  const S = R.PROMPT_DUMP_SIGNALS;
  let score = 0;
  const hits = [];
  if (RX.promptDumpName.test(splitCamel(r.name))) { score += S.namePoints; hits.push('name'); }
  if (RX.promptDumpDesc.test(r.description)) { score += S.descPoints; hits.push('desc'); }
  if (!r.language) { score += S.noLanguagePoints; hits.push('no-language'); }
  return { score, hits, isDump: score >= S.rejectAtScore };
}

export function isCuratedList(r) {
  // Name and topics are tested separately: the name patterns are anchored
  // (^awesome-, -resources$), and those anchors never match inside a
  // concatenated "name + topics" string.
  if (RX.curatedList.test(r.name)) return true;
  return r.topics.some((t) => LIST_TOPICS.has(t));
}

export function isPiracy(r, readme = '') {
  return RX.piracy.test(fullSurface(r, readme));
}

/** Iran relevance tier (0 = none). Returns points and why. */
export function iranRelevance(r, readme = '') {
  const I = R.IRAN_RELEVANCE;
  const topics = new Set(r.topics);

  const t1 = I.tier1Topics.filter((t) => topics.has(t));
  if (t1.length) return { tier: 1, points: I.tier1Points, why: `topic:${t1[0]}` };

  const persianChars = (readme.match(RX.persianOnly) || []).length;
  if (persianChars >= I.persianTextMinChars) {
    return { tier: 1, points: I.persianTextPoints, why: `persian-readme:${persianChars}` };
  }

  const t2 = I.tier2Topics.filter((t) => topics.has(t));
  if (t2.length) return { tier: 2, points: I.tier2Points, why: `topic:${t2[0]}` };
  if (RX.iranKeywords.test(`${r.description} ${readme.slice(0, 3000)}`)) {
    return { tier: 2, points: I.tier2Points, why: 'keyword' };
  }

  const t3 = I.tier3Topics.filter((t) => topics.has(t));
  if (t3.length) return { tier: 3, points: I.tier3Points, why: `topic:${t3[0]}` };

  return { tier: 0, points: 0, why: null };
}

export function aiRelevance(r) {
  const hit = R.AI_BOOST.topics.filter((t) => r.topics.includes(t));
  return { isAi: hit.length > 0, points: hit.length ? R.AI_BOOST.points : 0, why: hit[0] ?? null };
}

export function iranianCreator(r) {
  if (KNOWN_IRANIAN.has(r.owner.toLowerCase())) {
    return { yes: true, points: R.IRANIAN_CREATOR.points, why: 'known-owner' };
  }
  if (r.ownerLocation && RX.iranLocation.test(r.ownerLocation)) {
    return { yes: true, points: R.IRANIAN_CREATOR.points, why: 'location' };
  }
  return { yes: false, points: 0, why: null };
}

// ---------------------------------------------------------------------------
// hard rejects
// ---------------------------------------------------------------------------

/** Returns [] when eligible, otherwise the reasons it is not. */
export function hardRejects(r, readme = null) {
  const H = R.HARD_REJECT;
  const out = [];
  if (H.archived && r.archived) out.push('archived');
  if (H.template && r.isTemplate) out.push('template');
  if (H.fork && r.fork) out.push('fork');
  if (H.disabled && r.disabled) out.push('disabled');
  if (H.maxSizeKb && r.sizeKb > H.maxSizeKb) out.push('oversized');
  if (H.piracy && isPiracy(r, readme ?? '')) out.push('piracy');
  if (H.configDumps && configDumpScore(r).isDump) out.push('config-dump');
  // README is only checked once it has actually been fetched.
  if (readme !== null && readme.length < H.minReadmeBytes) out.push('no-readme');
  return out;
}

// ---------------------------------------------------------------------------
// lanes
// ---------------------------------------------------------------------------

/**
 * Which lanes this repo qualifies for, in LANE_PRIORITY order.
 * `ctx` carries the relevance results so they are computed once.
 */
export function lanesFor(r, ctx) {
  const out = [];
  for (const lane of R.LANE_PRIORITY) {
    if (laneAccepts(lane, r, ctx)) out.push(lane);
  }
  return out;
}

function laneAccepts(lane, r, ctx) {
  const L = R.LANES[lane];
  if (!L) return false;

  if (L.requiresIranRelevance && ctx.iran.tier === 0) return false;
  if (L.requiresAiRelevance && !ctx.ai.isAi) return false;
  if (lane === 'curated_list' && !ctx.isList) return false;
  // A curated list must not also occupy a software lane; its scoring profile
  // is different and it would otherwise take a software slot.
  if (lane !== 'curated_list' && ctx.isList) return false;

  let min = L.starsMin;
  if (lane === 'curated_list' && ctx.iran.tier > 0 && L.iranStarsMin != null) {
    min = L.iranStarsMin;
  }
  if (r.stars < min) return false;
  if (L.starsMax != null && r.stars > L.starsMax) return false;
  if (L.minAgeDays != null && r.ageDays < L.minAgeDays) return false;
  if (L.maxAgeDays != null && r.ageDays > L.maxAgeDays) return false;

  // Idle limit, with the finished-not-abandoned escape hatch where the lane
  // defines one. See IDLE_FORGIVENESS_NOTE in rules.js.
  let maxIdle = L.maxDaysSincePush;
  const f = L.idleForgiveness;
  if (f && r.stars >= f.minStars && f.maxDaysSincePush > (maxIdle ?? 0)) {
    maxIdle = f.maxDaysSincePush;
  }
  if (maxIdle != null && r.daysSincePush > maxIdle) return false;

  if (L.minVelocityPerDay != null && r.velocity < L.minVelocityPerDay) return false;
  if (L.maxVelocityPerDay != null && r.velocity > L.maxVelocityPerDay) return false;
  return true;
}

// ---------------------------------------------------------------------------
// scoring components
// ---------------------------------------------------------------------------

function attentionPoints(r, lane) {
  const curveName = R.LANES[lane]?.attentionCurve ?? 'flat';
  const max = R.QUALITY.attention;
  const C = R.ATTENTION_CURVES[curveName];

  if (curveName === 'bell') {
    const d = (Math.log10(Math.max(1, r.stars)) - Math.log10(C.peakStars)) / C.sigmaLog10;
    return max * Math.exp(-0.5 * d * d);
  }
  if (curveName === 'rising') {
    return max * saturate(r.stars, C.saturationStars);
  }
  // flat
  const floor = R.LANES[lane]?.starsMin ?? 0;
  return clamp(C.baselinePoints + (r.stars >= floor ? C.floorClearedBonus : 0), 0, max);
}

function alivenessPoints(r) {
  const A = R.ALIVENESS;
  const fresh = A.freshnessPoints * Math.pow(0.5, r.daysSincePush / A.freshnessHalfLifeDays);
  const mature = A.maturityPoints * Math.min(1, r.ageDays / A.maturitySaturationDays);
  return fresh + mature;
}

function adoptionPoints(r) {
  const A = R.ADOPTION;
  let pts = A.forksPoints * saturate(r.forks, A.forksSaturation)
          + A.issueActivityPoints * saturate(r.openIssues, A.issuesSaturation);
  // contributors is only available at stage 3; award the average until then so
  // stage-2 ranking is not distorted by a field nobody has.
  pts += r.contributors == null
    ? A.contributorsPoints * 0.5
    : A.contributorsPoints * saturate(r.contributors, A.contributorsSaturation);
  return pts;
}

function craftPoints(r, readme) {
  const C = R.CRAFT;
  const B = R.README_BAND;
  let pts = 0;
  const hits = [];

  if (r.description && r.description.length >= R.PENALTY_THRESHOLDS.minDescriptionChars) {
    pts += C.description; hits.push('description');
  }
  if (r.topics.length >= 3) { pts += C.topics; hits.push('topics'); }
  else if (r.topics.length >= 1) { pts += C.topics * 0.5; hits.push('topics-few'); }
  if (r.homepage && r.homepage.trim()) { pts += C.homepage; hits.push('homepage'); }
  if (r.license) { pts += C.license; hits.push('license'); }

  if (readme != null) {
    const len = readme.length;
    if (len >= B.goodBytes) pts += C.readmeLength;
    else if (len > B.minBytes) {
      pts += C.readmeLength * ((len - B.minBytes) / (B.goodBytes - B.minBytes));
    }
    if (len >= B.minBytes) hits.push('readme');

    if (RX.demo.test(readme)) { pts += C.demoMedia; hits.push('demo'); }

    const headings = (readme.match(/^#{2,3} /gm) || []).length;
    const fences = (readme.match(/```/g) || []).length / 2;
    const structureRatio = Math.min(1, headings / 4) * 0.6 + Math.min(1, fences / 2) * 0.4;
    pts += C.structure * structureRatio;
    if (structureRatio > 0.5) hits.push('structure');

    if (RX.install.test(readme)) { pts += C.installInstructions; hits.push('install'); }
  }

  return { points: pts, hits };
}

function penaltyPoints(r, readme, ctx) {
  const P = R.PENALTIES;
  const T = R.PENALTY_THRESHOLDS;
  const surface = fullSurface(r, readme ?? '');
  let total = 0;
  const hits = [];

  const add = (pts, label) => { total += pts; hits.push(label); };

  if (ctx.dump.isDump) {
    // Scaled by detector confidence — see PENALTIES.configDumpPerPoint.
    const over = ctx.dump.score - R.CONFIG_DUMP_SIGNALS.rejectAtScore + 1;
    add(P.configDumpPerPoint * over, `config-dump:${ctx.dump.score}(${ctx.dump.hits.join('+')})`);
  }
  if (ctx.promptDump.isDump) {
    const over = ctx.promptDump.score - R.PROMPT_DUMP_SIGNALS.rejectAtScore + 1;
    add(P.promptDumpPerPoint * over, `prompt-dump:${ctx.promptDump.score}(${ctx.promptDump.hits.join('+')})`);
  }
  if (RX.learning.test(surface)) add(P.learningProject, 'learning-project');
  if (RX.aiSlop.test(surface)) add(P.aiSlop, 'ai-slop');
  if (r.stars > 0 && r.forks / r.stars > T.forkRatio) add(P.forkRatioAnomaly, 'fork-ratio');
  if (r.stars > 0 && r.openIssues / r.stars > T.issueToStarRatio) add(P.neglectedIssues, 'neglected-issues');
  if (!r.description || r.description.length < T.minDescriptionChars) add(P.noDescription, 'no-description');
  // Expected for a curated list, so waived there.
  if (!r.language && !ctx.isList) add(P.noLanguage, 'no-language');
  if (r.sizeKb > T.bloatedSizeKb) add(P.bloated, 'bloated');

  return { points: total, hits };
}

// ---------------------------------------------------------------------------
// public scoring entry points
// ---------------------------------------------------------------------------

function buildContext(r, readme) {
  const isList = isCuratedList(r);
  return {
    isList,
    dump: configDumpScore(r),
    promptDump: promptDumpScore(r),
    iran: iranRelevance(r, readme ?? ''),
    ai: aiRelevance(r),
    creator: iranianCreator(r),
  };
}

function scoreWith(rawRepo, readme, now) {
  const r = normalize(rawRepo, now);
  const rejects = hardRejects(r, readme);
  const ctx = buildContext(r, readme);

  if (rejects.length) {
    return {
      repo: r, eligible: false, rejects, lanes: [], lane: null,
      quality: 0, relevance: 0, penalty: 0, total: 0, ctx, breakdown: null,
    };
  }

  const lanes = lanesFor(r, ctx);
  if (!lanes.length) {
    return {
      repo: r, eligible: false, rejects: ['no-lane'], lanes: [], lane: null,
      quality: 0, relevance: 0, penalty: 0, total: 0, ctx, breakdown: null,
    };
  }

  const lane = lanes[0]; // LANE_PRIORITY order
  const craft = craftPoints(r, readme);
  const attention = attentionPoints(r, lane);
  const aliveness = alivenessPoints(r);
  const adoption = adoptionPoints(r);
  const quality = craft.points + attention + aliveness + adoption;

  const relevance = clamp(ctx.iran.points, 0, R.RELEVANCE.iranMax)
    + clamp(ctx.ai.points, 0, R.RELEVANCE.aiMax)
    + clamp(ctx.creator.points, 0, R.RELEVANCE.iranianCreatorMax);

  const extraLanes = Math.max(0, lanes.length - 1);
  const multiLane = Math.min(
    R.MULTI_LANE_BONUS.max,
    extraLanes * R.MULTI_LANE_BONUS.perExtraLane,
  );

  const pen = penaltyPoints(r, readme, ctx);
  const total = quality + relevance + multiLane - pen.points;

  return {
    repo: r,
    eligible: true,
    rejects: [],
    lanes,
    lane,
    quality,
    relevance,
    multiLane,
    penalty: pen.points,
    total,
    ctx,
    breakdown: {
      craft: craft.points, craftHits: craft.hits,
      attention, aliveness, adoption,
      iran: ctx.iran.points, iranWhy: ctx.iran.why,
      ai: ctx.ai.points, creator: ctx.creator.points,
      penaltyHits: pen.hits,
    },
  };
}

/** Stage A — metadata only. README signals unavailable. */
export const scoreStageA = (repo, now = Date.now()) => scoreWith(repo, null, now);

/** Stage B — with README. */
export const scoreStageB = (repo, readme, now = Date.now()) =>
  scoreWith(repo, String(readme ?? ''), now);

// ---------------------------------------------------------------------------
// per-lane budget allocation
// ---------------------------------------------------------------------------

/**
 * Split `limit` slots across lanes in proportion to LANE_QUOTA, then fill any
 * remainder with the best leftover candidates regardless of lane.
 *
 * WHY, measured twice: a global sort by total score starves four of the six
 * lanes, because relevance boosts are part of the total and only two lanes can
 * earn one. Mean values across 801 eligible corpus repos:
 *     iran_relevant   quality 53.6   relevance +25.1
 *     ai_agents       quality 48.8   relevance +15.0
 *     curated_list    quality 59.1   relevance  +7.8
 *     established     quality 63.1   relevance  +0.5
 *     trending        quality 50.5   relevance  +0.2
 *     hidden_gem      quality 43.7   relevance  +0.4
 *
 * Note `established` has the HIGHEST mean quality of any lane and still loses —
 * it simply cannot earn a boost. Comparing a boosted total against an unboosted
 * one across lanes is the error. Lanes exist because "obscure" and "trending"
 * are not commensurable; that reasoning has to extend to budget, not just to
 * attention curves.
 *
 * Observed effect of not doing this:
 *   - README budget: global top 120 was iran 99 / ai 16 / lists 5, and ZERO for
 *     trending, hidden_gem and established. Best trending repo ranked 182nd,
 *     best established (gunicorn) 206th.
 *   - LLM candidates: even after fixing the README budget, a global top 16 was
 *     iran 6 / ai 6 / lists 2 / trending 1 / established 1 and again ZERO
 *     hidden_gem, despite 25 hidden_gem candidates clearing the gate. That lane
 *     is the project's original mission; it would never have appeared.
 *
 * Redistribution matters as much as the split: a lane with thin supply hands its
 * slice back rather than shrinking the run.
 */
export function allocateByLane(scoredList, limit) {
  const byLane = new Map();
  for (const s of scoredList) {
    if (!byLane.has(s.lane)) byLane.set(s.lane, []);
    byLane.get(s.lane).push(s);
  }
  for (const list of byLane.values()) list.sort((a, b) => b.total - a.total);

  const active = [...byLane.keys()].filter((l) => byLane.get(l).length);
  const quotaSum = active.reduce((a, l) => a + (R.LANE_QUOTA[l] ?? 1), 0) || 1;

  const chosen = [];
  const leftovers = [];
  for (const lane of active) {
    const list = byLane.get(lane);
    const share = Math.min(list.length, Math.floor(limit * (R.LANE_QUOTA[lane] ?? 1) / quotaSum));
    chosen.push(...list.slice(0, share));
    leftovers.push(...list.slice(share));
  }

  leftovers.sort((a, b) => b.total - a.total);
  chosen.push(...leftovers.slice(0, Math.max(0, limit - chosen.length)));
  return chosen.sort((a, b) => b.total - a.total);
}

/**
 * Which stage-A candidates get a README fetched.
 * The README fetch is free of API quota but not free of time, so the budget is
 * still finite; per-lane allocation is what stops one lane consuming it all.
 */
export function allocateReadmeBudget(stageA, limit = R.FUNNEL.readmeFetchLimit) {
  if (!R.FUNNEL.readmeBudgetPerLane) {
    return [...stageA].sort((a, b) => b.total - a.total).slice(0, limit);
  }
  return allocateByLane(stageA, limit);
}

/** Does this scored candidate clear the gates for an LLM call? */
export function passesLlmGate(scored) {
  return scored.eligible
    && scored.quality >= R.FUNNEL.minQualityForLlm
    && scored.total >= R.FUNNEL.minTotalForLlm;
}

// ---------------------------------------------------------------------------
// reconsideration / cooldown
// ---------------------------------------------------------------------------
// The rule the manual workflow never needed, and the one a REPEATING run
// cannot work without.
//
// Scores are near-stationary day to day: a repo scoring 118 today scores ~118
// tomorrow. So an unconstrained daily run picks the SAME top eight forever. It
// would spend the entire LLM budget re-judging yesterday's candidates and, once
// those are published or rejected, sit permanently on the next eight.
// schema.sql's dedup prevents re-INSERTING a repo; nothing yet prevented
// re-SPENDING quota on it.

/**
 * Classify a previously-seen repo so it can be given the right cooldown.
 * `row` is a repositories row (may be undefined for a first sighting).
 */
export function outcomeOf(row) {
  if (!row) return 'new';
  if (row.published) return 'published';
  // A human decision outranks a model decision.
  if (row.human_rejected) return 'humanRejected';
  if (row.verdict === 'reject') return 'llmRejected';
  const reason = row.last_reject_reason ?? null;
  if (reason) {
    return R.REJECT_PERMANENCE[reason] === 'permanent' ? 'permanentReject' : 'softReject';
  }
  if (row.last_total != null && row.last_total < R.FUNNEL.minTotalForLlm) return 'nearMiss';
  if (row.evaluated_at) return 'notSelected';
  return 'notSelected';
}

/**
 * Should this repo be scored again in this run?
 * Returns { ok, outcome, cooldownDays, daysSince }.
 *
 * A null cooldown means never — used for outcomes that carry a permanent
 * decision (a human said no, the repo is a fork) rather than a temporary state.
 */
export function shouldReconsider(row, now = Date.now()) {
  const outcome = outcomeOf(row);
  if (outcome === 'new') return { ok: true, outcome, cooldownDays: 0, daysSince: null };

  const cooldownDays = R.COOLDOWN[outcome];
  const stamp = Date.parse(row.last_checked ?? row.first_seen ?? '') || now;
  const daysSince = (now - stamp) / DAY;

  if (cooldownDays == null) return { ok: false, outcome, cooldownDays: null, daysSince };
  return { ok: daysSince >= cooldownDays, outcome, cooldownDays, daysSince };
}

// ---------------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------------

/**
 * Pick the LLM candidate set: per-lane shares, with diversity caps applied
 * inside each share.
 *
 * The obvious implementation — allocate a per-lane pool, then walk it greedily
 * by total score — does NOT work, and this was measured. With a pool of 32 the
 * per-lane counts were correct (iran 10, ai 6, hidden 6, established 4,
 * trending 4, lists 2), but walking that pool by score filled all 16 slots from
 * the top: rows 1-10 iran, 11-18 lists and ai, 19-20 established. The first
 * trending row sat at rank 27, so trending received ZERO — the same starvation
 * the per-lane README budget was introduced to fix, merely moved one stage
 * later.
 *
 * Cross-lane totals are not comparable (see allocateByLane), so the WALK has to
 * be per-lane too, not just the allocation. Each lane fills its slots from its
 * own ranking; only genuinely unused slots are contested globally.
 *
 * Note on category: DIVERSITY.maxPerCategory is NOT applied here and cannot be.
 * A repo's category is assigned by the LLM, which has not run at this point, so
 * that cap is enforced afterwards by selectFinal(). The alternative would be
 * guessing a category from topics, which would then disagree with the one the
 * LLM writes into the post.
 */
export function select(scoredList, limit = R.FUNNEL.llmCandidateLimit) {
  const gated = scoredList.filter(passesLlmGate);

  const byLane = new Map();
  for (const s of gated) {
    if (!byLane.has(s.lane)) byLane.set(s.lane, []);
    byLane.get(s.lane).push(s);
  }
  for (const list of byLane.values()) list.sort((a, b) => b.total - a.total);

  const active = [...byLane.keys()].filter((l) => byLane.get(l).length);
  const quotaSum = active.reduce((a, l) => a + (R.LANE_QUOTA[l] ?? 1), 0) || 1;

  // Caps are sized for the FINAL post set. When asked for more than
  // finalSelectionSize (the normal case: 16 candidates for 8 posts) they must
  // scale up, or they bind far too early — with maxPerOwner=1 and a limit of 16,
  // a prolific owner's second repo would be dropped before the LLM ever saw it,
  // even if it were the better of the two.
  const slack = Math.max(1, Math.ceil(limit / R.FUNNEL.finalSelectionSize));
  const langCount = {};
  const ownerCount = {};
  const laneCount = {};
  const chosen = [];
  const skipped = [];
  const taken = new Set();

  const capBlocking = (s) => {
    const lang = s.repo.language ?? 'none';
    const owner = s.repo.owner.toLowerCase();
    if ((langCount[lang] ?? 0) >= R.DIVERSITY.maxPerLanguage * slack) return `lang-cap:${lang}`;
    if ((ownerCount[owner] ?? 0) >= R.DIVERSITY.maxPerOwner * slack) return `owner-cap:${owner}`;
    return null;
  };
  const accept = (s) => {
    const lang = s.repo.language ?? 'none';
    const owner = s.repo.owner.toLowerCase();
    langCount[lang] = (langCount[lang] ?? 0) + 1;
    ownerCount[owner] = (ownerCount[owner] ?? 0) + 1;
    laneCount[s.lane] = (laneCount[s.lane] ?? 0) + 1;
    taken.add(s);
    chosen.push(s);
  };

  // --- pass 1: each lane fills its own share from its own ranking ---
  for (const lane of active) {
    const share = Math.min(
      byLane.get(lane).length,
      Math.floor(limit * (R.LANE_QUOTA[lane] ?? 1) / quotaSum),
    );
    let got = 0;
    for (const s of byLane.get(lane)) {
      if (got >= share) break;
      const why = capBlocking(s);
      if (why) { skipped.push({ s, why }); continue; }
      accept(s);
      got++;
    }
  }

  // --- pass 2: contest leftover slots globally ---
  // Rounding loss, plus any lane with less supply than its share. Best score
  // first is right here: these slots belong to no lane in particular.
  if (chosen.length < limit) {
    for (const s of [...gated].sort((a, b) => b.total - a.total)) {
      if (chosen.length >= limit) break;
      if (taken.has(s)) continue;
      const why = capBlocking(s);
      if (why) { skipped.push({ s, why }); continue; }
      accept(s);
    }
  }

  // --- pass 3: fill anything still empty, ignoring diversity caps ---
  // A short candidate set costs posts directly, and an eleventh Python tool is
  // worth more than an empty slot.
  if (chosen.length < limit) {
    for (const s of [...gated].sort((a, b) => b.total - a.total)) {
      if (chosen.length >= limit) break;
      if (taken.has(s)) continue;
      accept(s);
    }
  }

  return { chosen: chosen.sort((a, b) => b.total - a.total), skipped, laneCount };
}

/**
 * Post-LLM selection. Takes the judged candidates and returns the set that will
 * actually become posts.
 *
 * Exists because three of the decisions can only be made once the model has
 * spoken:
 *   - verdict: a `reject` never becomes a post, whatever it scored.
 *   - category: DIVERSITY.maxPerCategory needs the LLM's category. Without this
 *     step that rule was dead config — declared in rules.js, enforced nowhere,
 *     which is worse than not having it.
 *   - duplicate purpose: the model is asked whether a repo improves on an
 *     already-published one; if it answers no, the repo is dropped here.
 *
 * `judged` items are { scored, verdict, category, isDuplicatePurpose }.
 */
export function selectFinal(judged, limit = R.FUNNEL.finalSelectionSize) {
  const rank = { strong: 0, maybe: 1 };
  const usable = judged
    .filter((j) => j.verdict === 'strong' || j.verdict === 'maybe')
    .filter((j) => !j.isDuplicatePurpose)
    // A `strong` always outranks a `maybe`, regardless of deterministic score:
    // the model saw the README and the deterministic score did not see novelty
    // at all. Score breaks ties within a verdict.
    .sort((a, b) => (rank[a.verdict] - rank[b.verdict]) || (b.scored.total - a.scored.total));

  const laneCount = {};
  const langCount = {};
  const catCount = {};
  const ownerCount = {};
  const chosen = [];
  const skipped = [];

  for (const j of usable) {
    if (chosen.length >= limit) break;
    const s = j.scored;
    const lane = s.lane;
    const lang = s.repo.language ?? 'none';
    const owner = s.repo.owner.toLowerCase();
    const cat = j.category ?? 'unknown';

    if ((laneCount[lane] ?? 0) >= (R.LANE_QUOTA[lane] ?? Infinity)) {
      skipped.push({ j, why: `lane-quota:${lane}` }); continue;
    }
    if ((langCount[lang] ?? 0) >= R.DIVERSITY.maxPerLanguage) {
      skipped.push({ j, why: `lang-cap:${lang}` }); continue;
    }
    if ((catCount[cat] ?? 0) >= R.DIVERSITY.maxPerCategory) {
      skipped.push({ j, why: `category-cap:${cat}` }); continue;
    }
    if ((ownerCount[owner] ?? 0) >= R.DIVERSITY.maxPerOwner) {
      skipped.push({ j, why: `owner-cap:${owner}` }); continue;
    }

    laneCount[lane] = (laneCount[lane] ?? 0) + 1;
    langCount[lang] = (langCount[lang] ?? 0) + 1;
    catCount[cat] = (catCount[cat] ?? 0) + 1;
    ownerCount[owner] = (ownerCount[owner] ?? 0) + 1;
    chosen.push(j);
  }

  const dropped = judged.filter((j) => j.verdict === 'reject' || j.isDuplicatePurpose);
  return { chosen, skipped, dropped, laneCount, catCount };
}

// ---------------------------------------------------------------------------
// self-check — throws at import time if rules.js is internally inconsistent
// ---------------------------------------------------------------------------

export function validateRules() {
  const errs = [];
  const sum = (o) => Object.values(o).filter((v) => typeof v === 'number').reduce((a, b) => a + b, 0);
  if (sum(R.QUALITY) !== 100) errs.push(`QUALITY must sum to 100, got ${sum(R.QUALITY)}`);
  if (sum(R.CRAFT) !== R.QUALITY.craft) errs.push(`CRAFT must sum to QUALITY.craft (${R.QUALITY.craft}), got ${sum(R.CRAFT)}`);

  const alive = R.ALIVENESS.freshnessPoints + R.ALIVENESS.maturityPoints;
  if (alive !== R.QUALITY.aliveness) errs.push(`ALIVENESS points must sum to ${R.QUALITY.aliveness}, got ${alive}`);

  const adopt = R.ADOPTION.forksPoints + R.ADOPTION.issueActivityPoints + R.ADOPTION.contributorsPoints;
  if (adopt !== R.QUALITY.adoption) errs.push(`ADOPTION points must sum to ${R.QUALITY.adoption}, got ${adopt}`);

  const alloc = Object.values(R.QUERY.allocation).reduce((a, b) => a + b, 0);
  if (alloc !== R.QUERY.queriesPerRun) errs.push(`QUERY.allocation must sum to queriesPerRun (${R.QUERY.queriesPerRun}), got ${alloc}`);

  for (const lane of Object.keys(R.LANES)) {
    if (!R.LANE_PRIORITY.includes(lane)) errs.push(`lane ${lane} missing from LANE_PRIORITY`);
    if (R.LANE_QUOTA[lane] == null) errs.push(`lane ${lane} missing from LANE_QUOTA`);
    const curve = R.LANES[lane].attentionCurve;
    if (!R.ATTENTION_CURVES[curve]) errs.push(`lane ${lane} uses unknown curve ${curve}`);
  }

  if (R.PENALTIES.configDumpPerPoint == null) errs.push('PENALTIES.configDumpPerPoint is required');
  if (R.PENALTIES.promptDumpPerPoint == null) errs.push('PENALTIES.promptDumpPerPoint is required');

  // A prompt dump must not survive its own penalty. Measured worst case:
  // ai-boost/awesome-prompts scored total=107 before this detector existed.
  const maxPromptScore = R.PROMPT_DUMP_SIGNALS.namePoints
    + R.PROMPT_DUMP_SIGNALS.descPoints
    + R.PROMPT_DUMP_SIGNALS.noLanguagePoints;
  const maxPromptPenalty = R.PENALTIES.promptDumpPerPoint
    * (maxPromptScore - R.PROMPT_DUMP_SIGNALS.rejectAtScore + 1);
  if (maxPromptPenalty < R.FUNNEL.minTotalForLlm) {
    errs.push(`max prompt-dump penalty (${maxPromptPenalty}) must exceed minTotalForLlm (${R.FUNNEL.minTotalForLlm})`);
  }
  // no-language alone must never be enough to classify. This was the exact bug
  // in CONFIG_DUMP_SIGNALS: 131 of 187 flagged repos were flagged by that
  // signal and nothing else, most of them legitimate curated lists.
  if (R.PROMPT_DUMP_SIGNALS.noLanguagePoints >= R.PROMPT_DUMP_SIGNALS.rejectAtScore) {
    errs.push('PROMPT_DUMP_SIGNALS.noLanguagePoints alone reaches rejectAtScore');
  }
  if (R.CONFIG_DUMP_SIGNALS.noLanguagePoints >= R.CONFIG_DUMP_SIGNALS.rejectAtScore) {
    errs.push('CONFIG_DUMP_SIGNALS.noLanguagePoints alone reaches rejectAtScore');
  }

  // Every cooldown outcome must exist. A typo here would otherwise make
  // shouldReconsider() read undefined, which compares false against every
  // number and silently blocks a repo forever.
  for (const outcome of ['humanRejected', 'published', 'llmRejected', 'nearMiss',
    'notSelected', 'softReject', 'permanentReject']) {
    if (!(outcome in R.COOLDOWN)) errs.push(`COOLDOWN is missing "${outcome}"`);
  }
  for (const [reason, kind] of Object.entries(R.REJECT_PERMANENCE)) {
    if (kind !== 'permanent' && kind !== 'soft') {
      errs.push(`REJECT_PERMANENCE.${reason} must be "permanent" or "soft", got "${kind}"`);
    }
  }
  // The candidate pool must be at least the size of the final post set, or the
  // run cannot fill the channel even when every candidate is approved.
  if (R.FUNNEL.llmCandidateLimit < R.FUNNEL.finalSelectionSize) {
    errs.push(`FUNNEL.llmCandidateLimit (${R.FUNNEL.llmCandidateLimit}) must be >= finalSelectionSize (${R.FUNNEL.finalSelectionSize})`);
  }
  if (R.FUNNEL.readmeFetchLimit < R.FUNNEL.llmCandidateLimit) {
    errs.push(`FUNNEL.readmeFetchLimit (${R.FUNNEL.readmeFetchLimit}) must be >= llmCandidateLimit (${R.FUNNEL.llmCandidateLimit})`);
  }
  // Diversity caps must be able to fill the post set. maxPerCategory=2 with 8
  // posts needs at least 4 categories to exist; the check is that the caps do
  // not make finalSelectionSize structurally unreachable.
  if (R.DIVERSITY.maxPerCategory * R.CATEGORIES.length < R.FUNNEL.finalSelectionSize) {
    errs.push('DIVERSITY.maxPerCategory * CATEGORIES.length is below finalSelectionSize — the run can never fill');
  }
  const quotaSum = Object.values(R.LANE_QUOTA).reduce((a, b) => a + b, 0);
  if (quotaSum < R.FUNNEL.finalSelectionSize) {
    errs.push(`LANE_QUOTA sums to ${quotaSum}, below finalSelectionSize (${R.FUNNEL.finalSelectionSize})`);
  }

  // Query-side consistency. A pool larger than maxTopicsPerQuery is allowed
  // (rotation covers the remainder), but a pool of zero is a mistake.
  for (const [cls, def] of Object.entries(R.QUERY_CLASSES)) {
    if (!(cls in R.QUERY.allocation)) errs.push(`QUERY_CLASSES.${cls} has no allocation`);
    if (def.topicPools) {
      def.topicPools.forEach((p, i) => {
        if (!p.length) errs.push(`QUERY_CLASSES.${cls}.topicPools[${i}] is empty`);
      });
    }
    if (def.sorts && !def.sorts.length) errs.push(`QUERY_CLASSES.${cls}.sorts is empty`);
  }
  for (const cls of Object.keys(R.QUERY.allocation)) {
    if (!(cls in R.QUERY_CLASSES)) errs.push(`QUERY.allocation names "${cls}" with no QUERY_CLASSES entry`);
  }
  if (!R.LANGUAGE_SHARDS.length || !R.TOPIC_SHARDS.length) errs.push('shard pools must not be empty');

  // A maximum-confidence dump must be unrecoverable: its penalty has to
  // exceed the best possible quality + relevance + multi-lane total, or a
  // well-presented dump could still rank.
  const maxDumpScore = R.CONFIG_DUMP_SIGNALS.noLanguagePoints
    + R.CONFIG_DUMP_SIGNALS.namePatternPoints
    + R.CONFIG_DUMP_SIGNALS.topicPatternPoints
    + R.CONFIG_DUMP_SIGNALS.descPatternPoints;
  const maxDumpPenalty = R.PENALTIES.configDumpPerPoint
    * (maxDumpScore - R.CONFIG_DUMP_SIGNALS.rejectAtScore + 1);
  const maxUpside = 100 + Object.values(R.RELEVANCE).reduce((a, b) => a + b, 0)
    + R.MULTI_LANE_BONUS.max;
  if (maxDumpPenalty < maxUpside) {
    errs.push(`max config-dump penalty (${maxDumpPenalty}) must exceed max achievable score (${maxUpside})`);
  }

  if (errs.length) throw new Error(`rules.js inconsistent:\n  - ${errs.join('\n  - ')}`);
  return true;
}
