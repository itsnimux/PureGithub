// Pure GitHub — query builder
//
// Turns QUERY_CLASSES (declarative intent) into concrete GitHub search API
// query strings. Pure functions, no I/O, no Date.now() unless passed in —
// same contract as algorithm.js, so this file can also be pasted into an n8n
// Code node.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE IS THE MOST IMPORTANT PART OF THE FUNNEL
// ---------------------------------------------------------------------------
// Measured during calibration: the hard filters pass 87% of what the queries
// return. That is not a weak filter — it means the QUERY already did the
// selecting. Whatever these strings do not ask for, the system will never see,
// no matter how good the scoring is.
//
// Two API limits shape every decision here:
//   1. A query returns AT MOST 1000 results, and a run reads the first 100.
//   2. At most 5 boolean operators, at most 256 characters.
//
// Limit 1 is why rotation exists. A fixed query set reads the same 100 repos
// every day; after run one, every later run is wasted work. Rotation is what
// makes run 30 see different repos than run 1.

import * as R from './rules.js';

const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// date helpers
// ---------------------------------------------------------------------------

/** GitHub date qualifiers take YYYY-MM-DD. */
export function ymd(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Day index since ROTATION.epochUtc. This is the rotation seed.
 *
 * Deliberately the day number rather than a random value or a stored counter:
 * reproducible (a failed run replays identically), stateless (nothing to
 * persist), and monotonic (consecutive days never collide).
 */
export function dayIndex(now = Date.now()) {
  const epoch = Date.parse(`${R.ROTATION.epochUtc}T00:00:00Z`);
  return Math.max(0, Math.floor((now - epoch) / DAY));
}

// ---------------------------------------------------------------------------
// qualifier assembly
// ---------------------------------------------------------------------------

/**
 * Count boolean operators. GitHub rejects a query with more than five, and an
 * N-topic OR chain costs N-1 of them, which is the easiest way to trip it.
 */
export function countOperators(q) {
  return (q.match(/\b(?:AND|OR|NOT)\b/g) || []).length;
}

/** Rotate a pool by the seed, returning `take` items, wrapping around. */
export function rotate(pool, seed, take, stride = 1) {
  if (!pool.length || take <= 0) return [];
  const n = Math.min(take, pool.length);
  const start = ((seed * stride) % pool.length + pool.length) % pool.length;
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[(start + i) % pool.length]);
  return out;
}

/**
 * `topic:a,b,c` — a UNION, and the only multi-topic form the API accepts.
 *
 * `topic:a OR topic:b` returns HTTP 422; see QUERY.topicSeparator for the
 * measurement. Capped by QUERY.maxTopicsPerQuery so one huge topic cannot
 * swamp the 100-result page.
 */
function topicClause(topics) {
  const capped = topics.slice(0, R.QUERY.maxTopicsPerQuery);
  return `topic:${capped.join(R.QUERY.topicSeparator)}`;
}

/**
 * Assemble the shared tail every class needs: star band, date bounds and the
 * free `archived:false` qualifier.
 *
 * `createdRange` takes a [fromDays, toDays] pair and emits GitHub's
 * `created:A..B` form — verified to work, and the only way to make two queries
 * cover DISJOINT creation windows rather than one being a subset of the other.
 */
function tail({ starRange, pushedWithinDays, createdWithinDays, createdBeforeDays, createdRange, extra }, now) {
  const parts = [];
  if (starRange) parts.push(`stars:${starRange}`);
  if (pushedWithinDays != null) parts.push(`pushed:>${ymd(now - pushedWithinDays * DAY)}`);
  if (createdRange) {
    const [fromDays, toDays] = createdRange;
    parts.push(`created:${ymd(now - fromDays * DAY)}..${ymd(now - toDays * DAY)}`);
  }
  if (createdWithinDays != null) parts.push(`created:>${ymd(now - createdWithinDays * DAY)}`);
  if (createdBeforeDays != null) parts.push(`created:<${ymd(now - createdBeforeDays * DAY)}`);
  if (R.QUERY.excludeArchived) parts.push('archived:false');
  if (extra) parts.push(extra);
  return parts.join(' ');
}

/** Pick a sort from the class's list, rotating by seed. */
function pickSort(sorts, seed) {
  if (!sorts || !sorts.length) return { sort: 'updated', order: 'desc' };
  return sorts[seed % sorts.length];
}

// ---------------------------------------------------------------------------
// per-class builders
// ---------------------------------------------------------------------------
// Each returns an array of { label, lane, q, sort, order }.
// `lane` records which lane the query is TRYING to feed — used by the dry run
// to check whether a query class actually delivers what it is budgeted for.

function buildIran(count, seed, now) {
  const C = R.QUERY_CLASSES.iran;
  const out = [];
  const pools = C.topicPools;
  for (let i = 0; i < count; i++) {
    // Walk the pools in order so all four are covered when count is 4, and
    // start at a different pool each day so a count < 4 does not always skip
    // the same pool.
    const pool = pools[(seed + i) % pools.length];
    // Rotate WITHIN the pool too, so a pool of six topics with a cap of five
    // does not permanently exclude its last topic.
    const topics = rotate(pool, seed + i, R.QUERY.maxTopicsPerQuery);
    out.push({
      label: `iran_${i}`,
      lane: 'iran_relevant',
      q: `${topicClause(topics)} ${tail({ starRange: C.starRange, pushedWithinDays: C.pushedWithinDays }, now)}`,
      ...pickSort(C.sorts, seed + i),
    });
  }
  return out;
}

function buildAi(count, seed, now) {
  const C = R.QUERY_CLASSES.ai;
  const out = [];
  for (let i = 0; i < count; i++) {
    const pool = C.topicPools[(seed + i) % C.topicPools.length];
    const topics = rotate(pool, seed + i, R.QUERY.maxTopicsPerQuery);
    out.push({
      label: `ai_${i}`,
      lane: 'ai_agents',
      q: `${topicClause(topics)} ${tail({ starRange: C.starRange, pushedWithinDays: C.pushedWithinDays }, now)}`,
      ...pickSort(C.sorts, seed + i),
    });
  }
  return out;
}

function buildTrending(count, seed, now) {
  const C = R.QUERY_CLASSES.trending;
  const out = [];
  // The trending budget is split into DISJOINT creation windows.
  //
  // The first attempt used `created:>60d` and `created:>20d`, which is wrong:
  // the second is a strict subset of the first. Measured — wide 1635 matches,
  // narrow 271, and 12 of the narrow query's top 100 were already returned by
  // the wide one. With `created:A..B` the windows cannot overlap at all.
  //
  // The split also serves a purpose: the fresh window (0-20 days) catches a
  // spike while it is still spiking; the older window (20-60 days) catches a
  // tool that kept climbing after the initial burst, which is the stronger
  // signal of the two.
  const bounds = splitWindow(C.createdWithinDays, count);
  for (let i = 0; i < count; i++) {
    out.push({
      label: `trending_${i}_d${bounds[i][0]}-${bounds[i][1]}`,
      lane: 'trending',
      q: tail({ starRange: C.starRange, createdRange: bounds[i] }, now),
      ...pickSort(C.sorts, seed + i),
    });
  }
  return out;
}

/**
 * Split a `0..totalDays` window into `count` disjoint [fromDays, toDays] bands,
 * newest last. Geometric rather than linear: a 60-day window split evenly gives
 * two 30-day halves, but repo creation is not uniform — most of what is worth
 * catching is very recent, so the fresh band is kept narrow.
 */
function splitWindow(totalDays, count) {
  if (count <= 1) return [[totalDays, 0]];
  const out = [];
  let from = totalDays;
  for (let i = 0; i < count; i++) {
    const to = i === count - 1 ? 0 : Math.round(from / 3);
    out.push([from, to]);
    from = to;
  }
  return out;
}

function buildHidden(count, seed, now) {
  const C = R.QUERY_CLASSES.hidden;
  const R_ = R.ROTATION;
  const kinds = R_.hiddenShardKinds;
  const out = [];
  for (let i = 0; i < count; i++) {
    // Blocked stepping: `seed * count + i`, not `seed + i`.
    //
    // Measured bug: with `seed + i` and count=3, day N used steps N,N+1,N+2 and
    // day N+1 used N+1,N+2,N+3 — so two of the three hidden queries were
    // byte-identical to yesterday's, and this lane (the largest supply, 329 of
    // 778 eligible in calibration) spent two thirds of its budget re-reading the
    // same 200 repos. Blocking gives each run its own disjoint span of steps.
    const step = seed * count + i;
    const starRange = rotate(C.starShards, step, 1, R_.starShardStride)[0];
    const kind = kinds[step % kinds.length];
    // The shard index must be derived from how many times THIS KIND has come
    // up, not from `step` itself.
    //
    // Measured bug, found by rotationCoverage(): using `step` directly, a topic
    // shard is only ever chosen when `step % 2 === 1`, so the index was always
    // odd * topicStride. With an even pool size (54 topics) an odd multiplier
    // can only ever land on odd positions — 27 of 54 topics were unreachable
    // FOREVER, no matter how many runs. Dividing by the number of kinds gives
    // each kind its own dense counter, so a stride co-prime with the pool size
    // walks the entire pool.
    const kindIndex = Math.floor(step / kinds.length);
    const shard = kind === 'language'
      ? rotate(R.LANGUAGE_SHARDS, kindIndex, 1, R_.languageStride)[0]
      : rotate(R.TOPIC_SHARDS, kindIndex, 1, R_.topicStride)[0];
    const extra = kind === 'language' ? `language:${shard}` : `topic:${shard}`;
    out.push({
      label: `hidden_${i}_${kind}:${shard}`,
      lane: 'hidden_gem',
      q: tail({
        starRange,
        pushedWithinDays: C.pushedWithinDays,
        createdWithinDays: C.createdWithinDays,
        extra,
      }, now),
      ...pickSort(C.sorts, step),
    });
  }
  return out;
}

function buildEstablished(count, seed, now) {
  const C = R.QUERY_CLASSES.established;
  const out = [];
  for (let i = 0; i < count; i++) {
    // Language-sharded for the same reason as hidden: an unsharded
    // `stars:>=1500 sort:updated` query returns the same globally-famous
    // repos on every run, which is the exact failure this file exists to fix.
    const lang = rotate(R.LANGUAGE_SHARDS, seed + i, 1, R.ROTATION.languageStride)[0];
    out.push({
      label: `established_${i}_${lang}`,
      lane: 'established',
      q: tail({
        starRange: C.starRange,
        createdBeforeDays: C.createdBeforeDays,
        pushedWithinDays: C.pushedWithinDays,
        extra: `language:${lang}`,
      }, now),
      ...pickSort(C.sorts, seed + i),
    });
  }
  return out;
}

function buildLists(count, seed, now) {
  const C = R.QUERY_CLASSES.lists;
  const out = [];
  for (let i = 0; i < count; i++) {
    // iranScopedRatio: half of these queries are Iran-scoped, because an
    // Iran-relevant list is worth far more to this channel than a generic one.
    // With count=1 this alternates by day rather than rounding to zero.
    const iranScoped = ((seed + i) % Math.round(1 / C.iranScopedRatio)) === 0;
    const word = rotate(C.namePools, seed + i, 1)[0];
    const scope = iranScoped ? ' topic:iran' : '';
    const starRange = iranScoped
      ? `${R.LANES.curated_list.iranStarsMin}..*`
      : C.starRange;
    out.push({
      label: `lists_${i}${iranScoped ? '_iran' : ''}:${word}`,
      lane: 'curated_list',
      q: `${word} in:name${scope} ${tail({ starRange, pushedWithinDays: C.pushedWithinDays }, now)}`,
      ...pickSort(C.sorts, seed + i),
    });
  }
  return out;
}

const BUILDERS = {
  iran: buildIran,
  ai: buildAi,
  trending: buildTrending,
  hidden: buildHidden,
  established: buildEstablished,
  lists: buildLists,
};

// ---------------------------------------------------------------------------
// public entry point
// ---------------------------------------------------------------------------

/**
 * Build the query plan for one run.
 * Deterministic given (now): same day, same queries.
 */
export function buildQueries(now = Date.now()) {
  const seed = dayIndex(now);
  const out = [];

  for (const [cls, count] of Object.entries(R.QUERY.allocation)) {
    const fn = BUILDERS[cls];
    if (!fn) throw new Error(`QUERY.allocation names unknown class "${cls}"`);
    out.push(...fn(count, seed, now));
  }

  // Normalise whitespace, then assert against the two API limits. Failing here
  // is far better than a silent HTTP 422 that drops a query mid-run.
  for (const item of out) {
    item.q = item.q.replace(/\s+/g, ' ').trim();
    item.url = searchUrl(item);
    const ops = countOperators(item.q);
    if (ops > R.QUERY.maxOperators) {
      throw new Error(`query "${item.label}" uses ${ops} operators (max ${R.QUERY.maxOperators}): ${item.q}`);
    }
    if (item.q.length > R.QUERY.maxQueryChars) {
      throw new Error(`query "${item.label}" is ${item.q.length} chars (max ${R.QUERY.maxQueryChars}): ${item.q}`);
    }
  }

  if (out.length !== R.QUERY.queriesPerRun) {
    throw new Error(`built ${out.length} queries but QUERY.queriesPerRun is ${R.QUERY.queriesPerRun}`);
  }
  return out;
}

/** Full search URL for a plan item. */
export function searchUrl(item, perPage = R.QUERY.resultsPerQuery) {
  return 'https://api.github.com/search/repositories'
    + `?q=${encodeURIComponent(item.q)}`
    + `&sort=${item.sort}&order=${item.order}&per_page=${perPage}`;
}

/**
 * How much of each pool a given number of consecutive runs will visit.
 * Used by the verification script to prove rotation actually spreads out
 * instead of cycling a handful of shards.
 */
export function rotationCoverage(days, now = Date.now()) {
  const langs = new Set();
  const topics = new Set();
  const queries = new Set();
  for (let d = 0; d < days; d++) {
    const plan = buildQueries(now + d * DAY);
    for (const item of plan) {
      queries.add(item.q);
      const m = item.label.match(/(language|topic):(.+)$/);
      if (m) (m[1] === 'language' ? langs : topics).add(m[2]);
    }
  }
  return {
    days,
    uniqueQueries: queries.size,
    languagesSeen: langs.size,
    languagePoolSize: R.LANGUAGE_SHARDS.length,
    topicsSeen: topics.size,
    topicPoolSize: R.TOPIC_SHARDS.length,
  };
}
