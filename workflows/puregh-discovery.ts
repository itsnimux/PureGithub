import {
  workflow, trigger, sticky, node,
} from '@n8n/workflow-sdk';

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------
const schedule = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Daily Schedule',
    parameters: {
      rule: { interval: [{ field: 'days', triggerAtHour: 9, triggerAtMinute: 0 }] },
    },
  },
});

// ---------------------------------------------------------------------------
// Load Engine — holds the discovery engine bundle as a string (single copy).
// The bundle source is GENERATED from discovery/rules.js + algorithm.js +
// queries.js by `node discovery/bundle.mjs`; see bundle.generated.js /
// bundle.lean.js. Other nodes inject it with: new Function(src + '; return PUREGH;')()
// The jsCode here is assembled at deploy time from discovery/bundle.lean.js.
// ---------------------------------------------------------------------------
const loadEngine = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Load Engine',
    parameters: { mode: 'runOnceForAllItems', jsCode: '<BUNDLE_EMBEDDED_BY_SCRIPT>' },
  },
});

// ---------------------------------------------------------------------------
// Build Query Plan — deterministic set of 14 GitHub search queries for today.
// ---------------------------------------------------------------------------
const buildQueryPlan = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Query Plan',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: [
        "const eng = $('Load Engine').first().json.bundle;",
        "const PUREGH = new Function(eng + '; return PUREGH;')();",
        'const seed = PUREGH.dayIndex(Date.now());',
        'const plan = PUREGH.buildQueries(Date.now());',
        'return plan.map((p) => ({ json: { seed: seed, ...p } }));',
      ].join('\n'),
    },
  },
});

// ---------------------------------------------------------------------------
// Open Run Log — one row per run in discovery_runs, returns its id/started_at.
// ---------------------------------------------------------------------------
const openRunLog = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Open Run Log',
    parameters: {
      operation: 'executeQuery',
      query: 'INSERT INTO discovery_runs (day_seed, queries)\nVALUES ($1, $2::jsonb)\nRETURNING id, started_at;',
      options: {
        queryReplacement: "{{ [$('Build Query Plan').first().json.seed, JSON.stringify($('Build Query Plan').all().map(p => p.json))] }}",
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { name: 'Postgres account' } },
  },
});

// ---------------------------------------------------------------------------
// GitHub Search — one HTTP request per query (14), batched one at a time.
// Retry is set via setNodeSettings below; a transient EAI_AGAIN/timeout on a
// single query must not kill the whole run (AGENTS.md §17).
// ---------------------------------------------------------------------------
const githubSearch = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'GitHub Search',
    parameters: {
      url: '={{ $json.url }}',
      method: 'GET',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'githubApi',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }],
      },
      sendBody: false,
      options: {
        batching: { batch: { batchSize: 1, batchInterval: 2500 } },
        timeout: 60000,
      },
    },
    credentials: { githubApi: { name: 'GitHub account' } },
  },
});

// ---------------------------------------------------------------------------
// Dedup and Collect — collapse all search items by id into one normalized
// repos array plus the run's constants. Run once for all items.
// ---------------------------------------------------------------------------
const dedupAndCollect = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Dedup and Collect',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: [
        "const eng = $('Load Engine').first().json.bundle;",
        "const PUREGH = new Function(eng + '; return PUREGH;')();",
        'const byId = new Map();',
        "for (const it of $('GitHub Search').all()) {",
        '  for (const r of (it.json?.items || [])) byId.set(r.id, r);',
        '}',
        'const repos = [...byId.values()].map(r => ({',
        '  id: r.id, full_name: r.full_name, name: r.name, owner: r.owner?.login,',
        '  description: r.description, homepage: r.homepage,',
        '  stars: r.stargazers_count, forks: r.forks_count, open_issues: r.open_issues_count,',
        '  language: r.language, topics: r.topics || [], license: r.license?.spdx_id || null,',
        '  size: r.size, archived: !!r.archived, fork: !!r.fork,',
        '  is_template: !!r.is_template, disabled: !!r.disabled,',
        '  created_at: r.created_at, pushed_at: r.pushed_at, default_branch: r.default_branch,',
        '}));',
        'const R = PUREGH.rules;',
        "const idList = '{' + repos.map(r => r.id).join(',') + '}';",
        'return [{ json: {',
        "  seed: $('Build Query Plan').first().json.seed,",
        '  repos, idList,',
        '  llmRejectedDays: R.COOLDOWN.llmRejected,',
        '  nearMissDays: R.COOLDOWN.nearMiss,',
        '  notSelectedDays: R.COOLDOWN.notSelected,',
        '  softRejectDays: R.COOLDOWN.softReject,',
        '  minTotalForLlm: R.FUNNEL.minTotalForLlm,',
        '  minQualityForLlm: R.FUNNEL.minQualityForLlm,',
        '  readmeFetchLimit: R.FUNNEL.readmeFetchLimit,',
        '  llmCandidateLimit: R.FUNNEL.llmCandidateLimit,',
        '} }];',
      ].join('\n'),
    },
  },
});

// ---------------------------------------------------------------------------
// Cooldown Gate — query 1 of db/discovery-queries.sql. The gate decision is
// resolved server-side (CASE) so the workflow branches on one column.
// With an empty DB every row returns gate='new'; the interval comparisons
// only matter once repositories has rows.
// ---------------------------------------------------------------------------
const cooldownGate = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Cooldown Gate',
    parameters: {
      operation: 'executeQuery',
      query: [
        'SELECT g.github_id,',
        '       r.id                AS repo_id,',
        '       r.published,',
        '       r.human_rejected,',
        '       r.verdict,',
        '       r.last_total,',
        '       r.last_stage,',
        '       r.last_reject_reason,',
        '       r.last_checked,',
        '       r.times_seen,',
        "       CASE",
        "         WHEN r.id IS NULL                     THEN 'new'",
        "         WHEN r.published                      THEN 'blocked-published'",
        "         WHEN r.human_rejected                 THEN 'blocked-human-rejected'",
        "         WHEN r.verdict = 'reject'",
        "              AND r.last_checked > now() - ($2 || ' days')::interval",
        "                                                THEN 'cooldown-llm-rejected'",
        "         WHEN r.last_reject_reason IN ('archived','fork','template','disabled',",
        "                                       'piracy','config-dump','oversized')",
        "                                                THEN 'blocked-permanent'",
        '         WHEN r.last_reject_reason IS NOT NULL',
        "              AND r.last_checked > now() - ($5 || ' days')::interval",
        "                                                THEN 'cooldown-soft-reject'",
        '         WHEN r.last_total IS NOT NULL AND r.last_total < $6',
        "              AND r.last_stage IN ('b','llm','selected')",
        "              AND r.last_checked > now() - ($3 || ' days')::interval",
        "                                                THEN 'cooldown-near-miss'",
        "         WHEN r.last_checked > now() - ($4 || ' days')::interval",
        "                                                THEN 'cooldown-not-selected'",
        "         ELSE 'recheck'",
        '       END AS gate',
        '  FROM unnest($1::bigint[]) AS g(github_id)',
        '  LEFT JOIN repositories r ON r.github_id = g.github_id;',
      ].join('\n'),
      options: {
        queryReplacement: "{{ [$('Dedup and Collect').first().json.idList, $('Dedup and Collect').first().json.llmRejectedDays, $('Dedup and Collect').first().json.nearMissDays, $('Dedup and Collect').first().json.notSelectedDays, $('Dedup and Collect').first().json.softRejectDays, $('Dedup and Collect').first().json.minTotalForLlm] }}",
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { name: 'Postgres account' } },
  },
});

// ---------------------------------------------------------------------------
// Score Stage A — metadata-only scoring on every repo that passed the gate.
// Repos blocked by cooldown are counted and dropped, not scored.
// ---------------------------------------------------------------------------
const scoreStageA = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Score Stage A',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: [
        "const eng = $('Load Engine').first().json.bundle;",
        "const PUREGH = new Function(eng + '; return PUREGH;')();",
        '',
        "const run = $('Dedup and Collect').first().json;",
        'const gates = new Map();',
        "for (const g of $('Cooldown Gate').all()) {",
        '  gates.set(Number(g.json.github_id), g.json.gate);',
        '}',
        '',
        'const now = Date.now();',
        'const out = [];',
        'const blocked = [];',
        'for (const repo of run.repos) {',
        "  const gate = gates.get(Number(repo.id)) ?? 'new';",
        "  if (gate !== 'new' && gate !== 'recheck') {",
        '    blocked.push({ id: repo.id, full_name: repo.full_name, gate });',
        '    continue;',
        '  }',
        '  const scored = PUREGH.scoreStageA(repo, now);',
        '  out.push({ json: { seed: run.seed, repo, gate, scored } });',
        '}',
        'return out;',
      ].join('\n'),
    },
  },
});

// ---------------------------------------------------------------------------
// Allocate README Budget — per-lane split of the 120 README fetches.
// IMPORTANT: passes the RAW repo (with created_at/pushed_at/default_branch),
// NOT scored.repo — the normalized repo lacks those fields, and re-normalizing
// it in Stage B would compute ageDays=1 and reject everything as no-lane.
// ---------------------------------------------------------------------------
const allocateReadmeBudget = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Allocate README Budget',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: [
        "const eng = $('Load Engine').first().json.bundle;",
        "const PUREGH = new Function(eng + '; return PUREGH;')();",
        '',
        "const run = $('Dedup and Collect').first().json;",
        "const stageA = $('Score Stage A').all().map((it) => it.json);",
        'const limit = run.readmeFetchLimit;',
        'const chosen = PUREGH.allocateReadmeBudget(stageA.map((it) => it.scored), limit);',
        '',
        'const rawById = new Map(stageA.map((it) => [String(it.repo.id), it.repo]));',
        'return chosen.map((scored) => {',
        '  const raw = rawById.get(String(scored.repo.id)) ?? {};',
        '  return { json: { seed: run.seed, repo: raw, scored } };',
        '});',
      ].join('\n'),
    },
  },
});

// ---------------------------------------------------------------------------
// Fetch READMEs — raw.githubusercontent, no credential, no API quota.
// batchSize 20 (parallel batches) + 15s timeout: sequential fetching with
// 800ms spacing made this node run 5+ minutes and hit the old 30s timeouts.
// A 404 (no README.md) must not kill the run: onError=continueRegularOutput
// and alwaysOutputData=false are set via setNodeSettings. Failed items come
// back as short/error bodies and Stage B scores them out as no-readme.
// ---------------------------------------------------------------------------
const fetchReadmes = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Fetch READMEs',
    parameters: {
      url: "={{ 'https://raw.githubusercontent.com/' + $json.repo.full_name + '/' + $json.repo.default_branch + '/README.md' }}",
      method: 'GET',
      authentication: 'none',
      sendHeaders: false,
      sendBody: false,
      options: {
        batching: { batch: { batchSize: 20, batchInterval: 300 } },
        response: { responseFormat: 'text' },
        timeout: 15000,
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Score Stage B — README scoring. Response items pair with allocated items
// by index; the raw README text arrives as json.data (responseFormat: 'text').
// ---------------------------------------------------------------------------
const scoreStageB = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Score Stage B',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: [
        "const eng = $('Load Engine').first().json.bundle;",
        "const PUREGH = new Function(eng + '; return PUREGH;')();",
        '',
        "const run = $('Dedup and Collect').first().json;",
        "const allocated = $('Allocate README Budget').all().map((it) => it.json);",
        "const fetched = $('Fetch READMEs').all();",
        'const now = Date.now();',
        '',
        'const out = [];',
        'for (let i = 0; i < fetched.length; i++) {',
        '  const alloc = allocated[i];',
        '  const raw = fetched[i].json ?? {};',
        "  const readme = String(raw.data ?? raw ?? '');",
        '  const scored = PUREGH.scoreStageB(alloc.repo, readme, now);',
        '  out.push({ json: { seed: run.seed, repo: alloc.repo, readme, scored } });',
        '}',
        'return out;',
      ].join('\n'),
    },
  },
});

// ---------------------------------------------------------------------------
// Select 16 — per-lane LLM candidate set with diversity caps.
// Outputs the RAW repo and its README next to `scored` so the LLM prompt and
// the upsert node have complete metadata (full_name, created_at, ...).
// ---------------------------------------------------------------------------
const select16 = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Select 16',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: [
        "const eng = $('Load Engine').first().json.bundle;",
        "const PUREGH = new Function(eng + '; return PUREGH;')();",
        '',
        "const run = $('Dedup and Collect').first().json;",
        "const stageBItems = $('Score Stage B').all().map((it) => it.json);",
        'const stageB = stageBItems.map((it) => it.scored);',
        'const limit = run.llmCandidateLimit;',
        'const res = PUREGH.select(stageB, limit);',
        '',
        'const rawById = new Map(stageBItems.map((it) => [String(it.repo.id), it]));',
        'return res.chosen.map((scored) => {',
        '  const src = rawById.get(String(scored.repo.id));',
        "  return { json: { seed: run.seed, repo: src?.repo ?? scored.repo, readme: src?.readme ?? '', scored } };",
        '});',
      ].join('\n'),
    },
  },
});

const note = sticky(
  '## Pure GitHub — Discovery\n\nروزانه پروژه\u200cهای Open Source را کشف، امتیازدهی و پیش\u200cنویس کپشن می\u200cسازد، سپس برای بازبینی انسانی می\u200cفرستد.',
  [schedule],
  { color: 5 },
);

export default workflow('puregh-discovery', 'Pure GitHub — Discovery')
  .add(note)
  .add(schedule)
  .to(loadEngine)
  .to(buildQueryPlan)
  .to(openRunLog)
  .to(githubSearch)
  .to(dedupAndCollect)
  .to(cooldownGate)
  .to(scoreStageA)
  .to(allocateReadmeBudget)
  .to(fetchReadmes)
  .to(scoreStageB)
  .to(select16);