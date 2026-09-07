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
        '  llmRejectedDays: R.COOLDOWN.llmRejectedDays,',
        '  nearMissDays: R.COOLDOWN.nearMissDays,',
        '  notSelectedDays: R.COOLDOWN.notSelectedDays,',
        '  softRejectDays: R.COOLDOWN.softRejectDays,',
        '  minTotalForLlm: R.THRESHOLDS.minTotalForLlm,',
        '  minQualityForLlm: R.THRESHOLDS.minQualityForLlm,',
        '  readmeFetchLimit: R.THRESHOLDS.readmeFetchLimit,',
        '  llmCandidateLimit: R.THRESHOLDS.llmCandidateLimit,',
        '} }];',
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
  .to(dedupAndCollect);