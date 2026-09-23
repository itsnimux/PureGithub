import {
  workflow, trigger, sticky, node, nextBatch, outputParser, splitInBatches,
} from '@n8n/workflow-sdk';

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------
// Model B: Discovery is launched by the Review Bot (Execute Workflow →
// «بررسی/شروع دیسکاوری»). The bot passes its whole input through, but
// Discovery ignores it — everything it needs is queried from the DB.
const fromReviewBot = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  version: 1.2,
  config: {
    name: 'From Review Bot',
    parameters: { inputSource: 'passthrough' },
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
// Also RESETS the loop accumulator ($getWorkflowStaticData('global').judged):
// a run that died mid-loop must not poison the next one with stale judgments.
// ---------------------------------------------------------------------------
const buildQueryPlan = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Query Plan',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: [
        "const sd = $getWorkflowStaticData('global');",
        'sd.judged = null;',
        'sd.llmCount = 0;',
        'sd.draftsCount = 0;',
        '',
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
// found_by comes from pairedItem: the GitHub Search node emits the raw API
// response (no label), but each result's pairedItem points back to its
// query item in Build Query Plan, which carries the label.
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
        'const foundBy = new Map();',
        "const plan = $('Build Query Plan').all().map((it) => it.json);",
        "const searchRuns = $('GitHub Search').all();",
        'for (let i = 0; i < searchRuns.length; i++) {',
        '  const it = searchRuns[i];',
        '  let label = null;',
        '  try {',
        '    const p = it.pairedItem;',
        "    const idx = typeof p?.item === 'number' ? p.item : (Array.isArray(p) ? p[0]?.item : 0);",
        '    label = plan[idx]?.label ?? plan[idx]?.q ?? null;',
        '  } catch (e) { label = null; }',
        '  for (const r of (it.json?.items || [])) {',
        '    byId.set(r.id, r);',
        '    if (label) foundBy.set(r.id, label);',
        '  }',
        '}',
        'const repos = [...byId.values()].map(r => ({',
        '  id: r.id, full_name: r.full_name, name: r.name, owner: r.owner?.login,',
        '  description: r.description, homepage: r.homepage,',
        '  stars: r.stargazers_count, forks: r.forks_count, open_issues: r.open_issues_count,',
        '  language: r.language, topics: r.topics || [], license: r.license?.spdx_id || null,',
        '  size: r.size, archived: !!r.archived, fork: !!r.fork,',
        '  is_template: !!r.is_template, disabled: !!r.disabled,',
        '  created_at: r.created_at, pushed_at: r.pushed_at, default_branch: r.default_branch,',
        '  found_by: foundBy.get(r.id) ?? null,',
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
        '  finalSelectionSize: R.FUNNEL.finalSelectionSize,',
        '  purposeDescThreshold: R.FUNNEL.purposeSimilarityThreshold,',
        '  purposeTopicJaccardThreshold: R.FUNNEL.purposeTopicJaccardThreshold,',
        '  purposeMinSharedTopics: R.FUNNEL.purposeMinSharedTopics,',
        '  purposeCompareLimit: R.FUNNEL.purposeCompareLimit,',
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

// ---------------------------------------------------------------------------
// Purpose Similarity — query 2 of db/discovery-queries.sql. Two independent
// signals (description trigram, topic Jaccard); either is sufficient to flag.
// The LLM — not this query — decides whether the candidate differentiates.
// ---------------------------------------------------------------------------
const purposeSimilarity = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Purpose Similarity',
    parameters: {
      operation: 'executeQuery',
      query: [
        'WITH cand AS (',
        '  SELECT $7::bigint AS gh_id,',
        '         $1::text AS descr,',
        '         ARRAY(SELECT lower(jsonb_array_elements_text($2::jsonb))) AS topics',
        '),',
        'pub AS (',
        '  SELECT r.github_id, r.full_name, r.url, r.description, r.stars,',
        '         ARRAY(SELECT lower(jsonb_array_elements_text(r.topics))) AS topics',
        '    FROM repositories r',
        '   WHERE r.published = TRUE',
        '     AND r.github_id <> $7::bigint',
        '),',
        'scored AS (',
        '  SELECT c.gh_id, p.full_name, p.url, p.stars, p.description,',
        '         similarity(c.descr, p.description) AS desc_sim,',
        '         cardinality(ARRAY(SELECT unnest(c.topics) INTERSECT SELECT unnest(p.topics))) AS shared,',
        '         cardinality(ARRAY(SELECT unnest(c.topics) INTERSECT SELECT unnest(p.topics)))::numeric',
        '           / GREATEST(1, cardinality(ARRAY(SELECT unnest(c.topics) UNION SELECT unnest(p.topics)))) AS jaccard',
        '    FROM pub p CROSS JOIN cand c',
        '),',
        'matched AS (',
        '  SELECT gh_id, full_name, url, stars, description,',
        '         round(desc_sim::numeric, 3) AS desc_sim,',
        '         shared,',
        '         round(jaccard, 3) AS jaccard,',
        "         CASE WHEN shared >= $5::int AND jaccard >= $4::numeric THEN 'topics'",
        "              WHEN desc_sim >= $3::numeric                      THEN 'description'",
        '         END AS matched_by',
        '    FROM scored',
        '   WHERE (shared >= $5::int AND jaccard >= $4::numeric)',
        '      OR desc_sim >= $3::numeric',
        '   ORDER BY jaccard DESC, desc_sim DESC',
        '   LIMIT $6::int',
        ')',
        'SELECT m.gh_id, m.full_name, m.url, m.stars, m.description,',
        '       m.desc_sim, m.shared, m.jaccard, m.matched_by',
        '  FROM matched m',
        'UNION ALL',
        'SELECT $7::bigint, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL',
        ' WHERE NOT EXISTS (SELECT 1 FROM matched)',
      ].join('\n'),
      options: {
        queryReplacement: [
        '={{ [',
        "  $json.repo.description ?? '',",
        "  JSON.stringify($json.repo.topics ?? []),",
        "  $('Dedup and Collect').first().json.purposeDescThreshold,",
        "  $('Dedup and Collect').first().json.purposeTopicJaccardThreshold,",
        "  $('Dedup and Collect').first().json.purposeMinSharedTopics,",
        "  $('Dedup and Collect').first().json.purposeCompareLimit,",
        '  Number($json.repo.id),',
        '] }}',
      ].join('\n'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { name: 'Postgres account' } },
  },
});

// ---------------------------------------------------------------------------
// Build LLM Facts — the LLM's whole world for one candidate: metadata facts
// + README excerpt + similar published posts (for differentiation). The LLM
// never sees numbers it could copy into the caption; Assemble injects those.
// ---------------------------------------------------------------------------
const buildLlmFacts = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build LLM Facts',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: [
        '// runOnceForEachItem: $json here is the Purpose Similarity row for THIS candidate.',
        'const sim = $json;',
        "const candidates = $('Select 16').all().map((it) => it.json);",
        'const repo = candidates.find((c) => Number(c.repo.id) === Number(sim.gh_id));',
        "if (!repo) throw new Error('no Select 16 candidate matches gh_id ' + sim.gh_id);",
        "const readmeRaw = String(repo.readme ?? '');",
        'const NL = String.fromCharCode(10);',
        'const now = Date.now();',
        'const created = new Date(repo.repo.created_at ?? now).getTime();',
        'const pushed = new Date(repo.repo.pushed_at ?? now).getTime();',
        'const ageDays = Math.max(1, (now - created) / 86400000);',
        'const daysSincePush = Math.max(0, Math.round((now - pushed) / 86400000));',
        'const stars = Number(repo.repo.stars ?? 0);',
        'const hasDemo = /\\.(gif|mp4|webm)|asciinema|youtube\\.com|youtu\\.be|demo|screenshot|preview/i.test(readmeRaw);',
        'const cleaned = readmeRaw',
        "  .replace(/<[^>]*>/g, ' ')",
        "  .replace(/!\\[[^\\]]*\\]\\([^)]*\\)/g, ' ')",
        "  .replace(/\\[([^\\]]*)\\]\\([^)]*\\)/g, '$1')",
        "  .replace(/```[\\s\\S]*?```/g, ' ')",
        "  .replace(/[ \\t]+/g, ' ')",
        '  .trim();',
        'const excerpt = cleaned.slice(0, 3000);',
        'const topics = Array.isArray(repo.repo.topics) ? repo.repo.topics : [];',
        "const similarRows = $('Purpose Similarity').all()",
        '  .map((it) => it.json)',
        '  .filter((s) => Number(s.gh_id) === Number(sim.gh_id) && s.full_name);',
        'const facts = [',
        "  'repository=' + (repo.repo.full_name ?? ''),",
        "  'description=' + (repo.repo.description ?? '-'),",
        "  'homepage=' + (repo.repo.homepage || '-'),",
        "  'topics=' + (topics.join(', ') || '-'),",
        "  'language=' + (repo.repo.language ?? 'unknown'),",
        '  \'stars=\' + stars,',
        "  'forks=' + (repo.repo.forks ?? 0),",
        "  'open_issues=' + (repo.repo.open_issues ?? 0),",
        '  \'age_days=\' + Math.round(ageDays),',
        '  \'days_since_last_push=\' + daysSincePush,',
        "  'star_velocity_per_day=' + (stars / ageDays).toFixed(2),",
        '  \'has_demo=\' + hasDemo,',
        "  'license=' + (repo.repo.license ?? 'none'),",
        '  \'\',',
        '  \'README (truncated):\',',
        '  excerpt,',
        '];',
        'if (similarRows.length) {',
        "  facts.push('', 'پست‌های مشابه قبلاً منتشر شده (برای تمایز):');",
        '  for (const s of similarRows) {',
        "    facts.push('- ' + (s.full_name ?? '') + ' (' + (s.stars ?? 0) + '★, مشابهت: ' + (s.matched_by ?? '') + ') — ' + (s.description ?? ''));",
        '  }',
        '}',
        'return { json: {',
        '  facts: facts.join(NL),',
        '  stars, language: repo.repo.language ?? \'unknown\',',
        "  license_spdx: repo.repo.license ?? 'none',",
        '  full_name: repo.repo.full_name, repo_id: repo.repo.id, owner: repo.repo.owner,',
        '} };',
      ].join('\n'),
    },
  },
});

const aiModelPrimary = node({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'AI Model - Primary',
    parameters: {
      model: { __rl: true, value: 'z-ai/glm-5.3-flash-free', mode: 'list', cachedResultName: 'z-ai/glm-5.3-flash-free' },
      responsesApiEnabled: false,
      options: { maxTokens: 2000, temperature: 0.6, timeout: 180000, maxRetries: 2 },
    },
    credentials: { openAiApi: { name: 'orcarouter' } },
  },
});

const aiModelFallback = node({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'AI Model - Fallback',
    parameters: {
      model: { __rl: true, value: 'nvidia/nemotron-3.5-lightning:free', mode: 'list', cachedResultName: 'nvidia/nemotron-3.5-lightning:free' },
      responsesApiEnabled: false,
      options: { maxTokens: 2000, temperature: 0.6, timeout: 180000, maxRetries: 2 },
    },
    credentials: { openAiApi: { name: 'openrouter' } },
  },
});

const captionSchema = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Caption Schema',
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{"verdict":"strong","reason":"short reason","title":"Name - few words","hook":"one friendly sentence","why_interesting":"one or two sentences","audience":["freelancers"],"category":"developer-tools"}',
    },
  },
});

// ---------------------------------------------------------------------------
// Generate Caption — one repo per call (loop feeds it a single item). The
// prompt is the channel's taste + tone rules + length caps (AGENTS.md §10).
// ---------------------------------------------------------------------------
const generateCaption = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm',
  version: 1.9,
  config: {
    name: 'Generate Caption',
    parameters: {
      promptType: 'define',
      text: '={{ $json.facts }}',
      hasOutputParser: true,
      needsFallback: true,
      messages: {
        messageValues: [
          {
            message: 'تو کارگردان کانال تلگرام «Pure GitHub» هستی که پروژه\u200cهای منبع\u200cباز جالب را معرفی می\u200cکند.\n\nسلیقه کانال:\n- پروژه\u200cهای کاربردی، غیرمعمول و خلاقانه را دوست داریم.\n- فورک ساده، boilerplate، CRUD عمومی و ابزارهای AI کم\u200cکیفیت را نمی\u200cپسندیم.\n- واو فاکتور مهم است.\n\n### لحن (مهم\u200cترین قاعده)\nطوری بنویس که انگار داری برای دوست صمیمی\u200cت که برنامه\u200cنویس است از یک پروژه تعریف می\u200cکنی. فارسی روان و خودمانی، نه لحن رسمی و نه لحن تبلیغاتی.\n\nبله: «رو می\u200cگیره»،  «می\u200cتونی»، «خودت»، «بدون اینکه ...»\nنه: «می\u200cباشد»، «جهت استفاده»، «راهکاری جامع»، «بی\u200cنقص»، «انقلابی»\n\nقواعد دیگر:\n- شعار و جملات انگلیسی README را هرگز کلمه\u200cبه\u200cکلمه ترجمه نکن. مفهوم را بفهم و از نو بنویس.\n- از ترجمه تحت\u200cاللفظی استعاره\u200cها پرهیز کن (مانند «with wings» یا «hear every voice»).\n- نام پروژه، نام تکنولوژی\u200cها و اصطلاحات فنی جاافتاده (API، CLI، Docker، IndexedDB) را انگلیسی نگه دار.\n- فقط بر اساس داده\u200cای که دریافت می\u200cکنی بنویس. عدد یا قابلیتی که در داده نیست از خودت اضافه نکن.\n- هیچ عددی (ستاره، زبان، لایسنس) در متن ننویس؛ خودمان جداگانه اضافه می\u200cکنیم.\n- اگر فهرست «پست\u200cهای مشابه قبلاً منتشر شده» در داده هست، فقط وقتی پست را تایید می\u200cکنی که این پروژه با آنها تمایز واقعی داشته باشد؛ در غیر این صورت verdict را reject بگذار و در reason بنویس تکراری است.\n\n### طول (سختگیرانه رعایت کن)\nپست باید در یک نگاه خوانده شود. پرحرفی ممنوع.\n\nخروجی:\n- verdict: فقط یکی از strong / maybe / reject.\n- reason: دلیل این تصمیم، حداکثر یک جمله. (این فقط برای من است و در پست نمی\u200cرود.)\n- title: حداکثر ۶۰ کاراکتر. فرمت: «نام پروژه — توضیح چندکلمه\u200cای». هیچ ایموجی نگذار.\n- hook: دقیقاً یک جمله، حداکثر ۱۴۰ کاراکتر. بگو پروژه چه کاری می\u200cکند، با لحن خودمانی.\n- why_interesting: حداکثر دو جمله و در مجموع حداکثر ۲۲۰ کاراکتر. دقیقاً همان چیزی که این پروژه را از بقیه جدا می\u200cکند — نه فهرست قابلیت\u200cها. اگر چیز خاصی وجود ندارد، رشته خالی بگذار.\n- audience: دقیقاً ۲ تا ۳ مورد، هر کدام دو یا سه کلمه.\n- category: یکی از AI / developer-tools / security / linux / web / mobile / creative / fun / experimental / productivity / backend / gaming / data.\n\nمجموع title + hook + why_interesting باید زیر ۴۲۰ کاراکتر باشد.\n',
          },
        ],
      },
      subnodes: {
        model: aiModelPrimary,
        outputParser: captionSchema,
        // The fallback model attaches to the SECOND ai_languageModel input
        // (needsFallback: true creates it) — see getInputs in ChainLlm's config.
        fallbackModel: aiModelFallback,
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Assemble Caption — render the final caption. All numbers come from Build
// LLM Facts (the LLM never writes numbers — §32 of the spec, structural rule).
// ---------------------------------------------------------------------------
const assembleCaption = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Assemble Caption',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: [
        'const llm = $json.output ?? $json;',
        "const facts = $('Build LLM Facts').item.json;",
        'const NL = String.fromCharCode(10);',
        '',
        "const missing = ['verdict', 'title', 'hook'].filter((k) => !llm || !llm[k]);",
        'if (missing.length) {',
        "  throw new Error('خروجی مدل ناقص است. فیلدهای غایب: ' + missing.join(', '));",
        '}',
        '',
        "const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');",
        "const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');",
        '',
        'const openers = [\'\\uD83E\\uDD2F\', \'\\uD83D\\uDD25\', \'\\uD83D\\uDC40\', \'\\uD83E\\uDDE0\', \'\\u26A1\', \'\\uD83E\\uDE84\', \'\\uD83E\\uDDE9\', \'\\uD83D\\uDEE0\', \'\\uD83D\\uDCA1\', \'\\uD83C\\uDFAF\', \'\\uD83D\\uDE80\', \'\\uD83D\\uDC19\'];',
        "const seedStr = String(facts.full_name ?? '');",
        'let seed = 0;',
        'for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) % 100000;',
        'const opener = openers[seed % openers.length];',
        '',
        'const stars = num(facts.stars);',
        "const lang = facts.language && facts.language !== 'unknown' ? esc(facts.language) : null;",
        "const lic = facts.license_spdx && facts.license_spdx !== 'none' ? esc(facts.license_spdx) : null;",
        'const audience = (Array.isArray(llm.audience) ? llm.audience : []).slice(0, 3).map(esc).filter(Boolean).join(\u060C\u0020);',
        '',
        'const lines = [opener + \' <b>\' + esc(llm.title) + \'</b>\', \'\', esc(llm.hook)];',
        "const why = String(llm.why_interesting ?? '').trim();",
        "if (why) lines.push('', why);",
        "if (audience) lines.push('', '\\uD83D\\uDC65 ' + audience);",
        "lines.push('', 'https://github.com/' + facts.full_name);",
        'lines.push(\'- \' + esc(facts.owner));',
        'const caption = lines.join(NL);',
        '',
        'return { json: {',
        '  verdict: llm.verdict,',
        "  reason: llm.reason ?? '',",
        '  category: llm.category ?? null,',
        '  audience_json: JSON.stringify(Array.isArray(llm.audience) ? llm.audience : []),',
        '  caption,',
        '  caption_length: caption.length,',
        '  stars,',
        '  language: lang,',
        '  license: lic,',
        '  full_name: facts.full_name,',
        '  repo_id: facts.repo_id,',
        '} };',
      ].join('\n'),
    },
  },
});

// ---------------------------------------------------------------------------
// Close Run Log — the funnel counters of the run. Note the deliberate zeros:
// repos_seen/new/on_cooldown/passed_stage_a/readmes_fetched/passed_stage_b
// are not aggregated inside the loop (lesson from execution 110: .all() on
// loop-internal nodes only sees the last iteration). sent_to_llm and
// drafts_created come from Collect Run Stats (counters accumulated in the loop
// via workflow static data).
// ---------------------------------------------------------------------------
const closeRunLog = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Close Run Log',
    parameters: {
      operation: 'executeQuery',
      query: 'UPDATE discovery_runs SET finished_at = now(), repos_seen = $2, repos_new = $3, repos_on_cooldown = $4, passed_stage_a = $5, readmes_fetched = $6, passed_stage_b = $7, sent_to_llm = $8, drafts_created = $9, error = $10 WHERE id = $1;',
      options: {
        queryReplacement: [
        '={{ [',
        "  $('Open Run Log').first().json.id,",
        '  0, 0, 0, 0, 0, 0,',
        "  $('Collect Run Stats').first().json.llmCount,",
        "  $('Collect Run Stats').first().json.draftsCount,",
        '  null,',
        '] }}',
      ].join('\n'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { name: 'Postgres account' } },
  },
});

// ---------------------------------------------------------------------------
// Track Run Stats — runs INSIDE the loop (one candidate per iteration). The
// funnel counters accumulate in workflow static data (lesson from execution
// 110: $('X').all() on loop-internal nodes only sees the last iteration).
// Everything else happens eagerly in the loop now: the repo is upserted, the
// draft post created, and the review message sent to the bot immediately.
// ---------------------------------------------------------------------------
const trackRunStats = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Track Run Stats',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: [
        "const sd = $getWorkflowStaticData('global');",
        'if (!Number.isFinite(sd.llmCount)) sd.llmCount = 0;',
        'if (!Number.isFinite(sd.draftsCount)) sd.draftsCount = 0;',
        'sd.llmCount += 1;',
        'sd.draftsCount += 1;',
        'return { json: { ok: true } };',
      ].join('\n'),
    },
  },
});

// ---------------------------------------------------------------------------
// Wait 3 Minutes — pacing between LLM calls inside the loop. Free-tier model
// quota is 20/min and 50/day; a 3-minute gap means ~20 requests/hour with
// breathing room (approved design, 2026-09-08).
// ---------------------------------------------------------------------------
const wait3Minutes = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Wait 3 Minutes',
    parameters: { resume: 'timeInterval', amount: 3, unit: 'minutes' },
  },
});

// ---------------------------------------------------------------------------
// Loop Repos (batch 1) — the candidates enter one at a time.
// IMPORTANT (execution 119 root-cause): SplitInBatches v3 output 0 = 'done',
// output 1 = 'loop'. The loop body hangs off output 1; the post-loop stage
// (Collect Judgments) hangs off output 0. The first wiring had them swapped.
// ---------------------------------------------------------------------------
const loopRepos = splitInBatches({
  version: 3,
  config: {
    name: 'Loop Repos',
    parameters: { batchSize: 1, options: {} },
  },
});

// ---------------------------------------------------------------------------
// Collect Run Stats — AFTER the loop: read the accumulated counters from
// workflow static data and zero them for the next run. No selectFinal anymore
// — every captioned candidate is saved as a draft and sent to the bot (model B
// review design, 2026-09-21).
// ---------------------------------------------------------------------------
const collectRunStats = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Collect Run Stats',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: [
        "const sd = $getWorkflowStaticData('global');",
        'const out = [{ json: {',
        '  llmCount: Math.max(0, sd.llmCount || 0),',
        '  draftsCount: Math.max(0, sd.draftsCount || 0),',
        '} }];',
        'sd.llmCount = 0;',
        'sd.draftsCount = 0;',
        'return out;',
      ].join('\n'),
    },
  },
});

// ---------------------------------------------------------------------------
// Build Loop Payload — per-item, INSIDE the loop. For the current candidate:
// builds the 38-parameter upsert row (query 3 of discovery-queries.sql,
// extended with the LLM-verdict columns) plus the metadata the Save Post node
// needs. Cooldown semantics are respected via last_stage: rejected repos get
// 'llm' (365d, the model already said no), strong/maybe keep 'selected' (3d, so
// a resolved draft lets the repo be re-considered soon). The verdict itself IS
// always persisted — the Review Bot and the miniapp display it.
// ---------------------------------------------------------------------------
const buildLoopPayload = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Loop Payload',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: [
        'const a = $json;',
        "const candidates = $('Select 16').all().map((it) => it.json);",
        "const cand = candidates.find((c) => String(c.repo.id) === String(a.repo_id));",
        "if (!cand) throw new Error('no Select 16 candidate matches repo_id ' + a.repo_id);",
        '',
        'const r = cand.repo;',
        'const readme = cand.readme ?? "";',
        'const scored = cand.scored;',
        'const nowMs = Date.now();',
        "const created = Date.parse(r.created_at ?? '') || nowMs;",
        "const pushed = Date.parse(r.pushed_at ?? '') || nowMs;",
        'const ageDays = Math.max(1, (nowMs - created) / 86400000);',
        'const readmeBytes = readme.length;',
        'const hasDemo = /\\.(gif|mp4|webm)|asciinema|youtube\\.com|youtu\\.be|demo|screenshot|preview/i.test(String(readme));',
        '',
        "const rejected = a.verdict === 'reject';",
        'let model = null;',
        "try { model = $('AI Model - Primary').params.model.value ?? null; } catch (e) { model = null; }",
        '',
        'const verdict = rejected ? "reject" : (a.verdict ?? null);',
        'const params = [',
        '  Number(r.id), r.full_name, r.owner, r.name, "https://github.com/" + r.full_name,',
        '  r.description ?? null, r.homepage || null,',
        '  Number(r.stars ?? 0), Number(r.forks ?? 0), Number(r.open_issues ?? 0),',
        '  r.language ?? null, JSON.stringify(r.topics ?? []), r.license ?? null, null,',
        '  !!r.fork, !!r.archived, !!r.is_template, r.default_branch ?? null,',
        '  r.created_at ?? null, r.pushed_at ?? null, readmeBytes, hasDemo,',
        '  Math.round(Math.max(0, (nowMs - pushed) / 86400000)), Math.round(ageDays),',
        '  Number((Number(r.stars ?? 0) / ageDays).toFixed(3)),',
        '  Number(scored.quality), Number(scored.relevance), Number(scored.total),',
        '  scored.lane, JSON.stringify(scored.lanes ?? []),',
        '  null, rejected ? "llm" : "selected", r.found_by ?? null,',
        '  verdict, a.reason ?? "", a.category ?? null, a.audience_json ?? "[]", model,',
        '];',
        '',
        'return { json: { params, caption: a.caption, repo_id: a.repo_id, model } };',
      ].join('\n'),
    },
  },
});

// ---------------------------------------------------------------------------
// Upsert Repos — query 3 of db/discovery-queries.sql, one row per item. Now
// also writes the LLM verdict columns (the bot and the miniapp display them;
// cooldown still keys on docs verdict='reject' + last_stage='llm').
// ---------------------------------------------------------------------------
const upsertRepos = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Upsert Repos',
    parameters: {
      operation: 'executeQuery',
      query: [
        'INSERT INTO repositories (',
        '    github_id, full_name, owner, name, url, description, homepage,',
        '    stars, forks, open_issues, language, topics, license_spdx, license_name,',
        '    is_fork, is_archived, is_template, default_branch,',
        '    gh_created_at, gh_pushed_at, readme_bytes, has_demo,',
        '    days_since_push, repo_age_days, star_velocity,',
        '    source, last_quality, last_relevance, last_total, lane, lanes,',
        '    last_reject_reason, last_stage, found_by,',
        '    verdict, verdict_reason, category, audience, evaluated_at, evaluated_model',
        ') VALUES (',
        '    $1, $2, $3, $4, $5, $6, $7,',
        '    $8, $9, $10, $11, $12::jsonb, $13, $14,',
        '    $15, $16, $17, $18,',
        '    $19, $20, $21, $22,',
        '    $23, $24, $25,',
        "    'discovery', $26, $27, $28, $29, $30::jsonb,",
        '    $31, $32, $33, $34, $35, $36, $37::jsonb, now(), $38',
        ')',
        'ON CONFLICT (github_id) DO UPDATE SET',
        '    full_name          = EXCLUDED.full_name,',
        '    description        = EXCLUDED.description,',
        '    homepage           = EXCLUDED.homepage,',
        '    stars              = EXCLUDED.stars,',
        '    forks              = EXCLUDED.forks,',
        '    open_issues        = EXCLUDED.open_issues,',
        '    language           = EXCLUDED.language,',
        '    topics             = EXCLUDED.topics,',
        '    license_spdx       = EXCLUDED.license_spdx,',
        '    license_name       = EXCLUDED.license_name,',
        '    is_archived        = EXCLUDED.is_archived,',
        '    gh_pushed_at       = EXCLUDED.gh_pushed_at,',
        '    readme_bytes       = EXCLUDED.readme_bytes,',
        '    has_demo           = EXCLUDED.has_demo,',
        '    days_since_push    = EXCLUDED.days_since_push,',
        '    repo_age_days      = EXCLUDED.repo_age_days,',
        '    star_velocity      = EXCLUDED.star_velocity,',
        '    last_quality       = EXCLUDED.last_quality,',
        '    last_relevance     = EXCLUDED.last_relevance,',
        '    last_total         = EXCLUDED.last_total,',
        '    lane               = EXCLUDED.lane,',
        '    lanes              = EXCLUDED.lanes,',
        '    last_reject_reason = EXCLUDED.last_reject_reason,',
        '    last_stage         = EXCLUDED.last_stage,',
        '    found_by           = COALESCE(repositories.found_by, EXCLUDED.found_by),',
        '    verdict            = EXCLUDED.verdict,',
        '    verdict_reason     = EXCLUDED.verdict_reason,',
        '    category           = EXCLUDED.category,',
        '    audience           = EXCLUDED.audience,',
        '    evaluated_at       = EXCLUDED.evaluated_at,',
        '    evaluated_model    = EXCLUDED.evaluated_model,',
        '    times_seen         = repositories.times_seen + 1,',
        '    last_checked       = now()',
        'RETURNING id, github_id;',
      ].join('\n'),
      options: { queryReplacement: '={{ $json.params }}', largeNumbersOutput: 'numbers' },
    },
    credentials: { postgres: { name: 'Postgres account' } },
  },
});

// ---------------------------------------------------------------------------
// Save Post — one draft row per candidate, created INSIDE the loop right after
// the repo is upserted (repository_id = the fresh repositories.id). publish_at
// is NULL by design: approval assigns the slot in the review flow, and the
// Publisher (workflow puregh-publisher) only claims status='approved'.
// ---------------------------------------------------------------------------
const saveFinalPosts = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Save Final Posts',
    parameters: {
      operation: 'executeQuery',
      query: 'INSERT INTO posts (repository_id, caption, status, model)\nVALUES ($1::bigint, $2, \'draft\', $3)\nRETURNING id, repository_id;',
      options: {
        queryReplacement: [
          '={{ [',
          '  String($json.id),',
          "  $('Build Loop Payload').item.json.caption,",
          "  $('Build Loop Payload').item.json.model ?? null,",
          '] }}',
        ].join('\n'),
        largeNumbersOutput: 'numbers',
      },
    },
    credentials: { postgres: { name: 'Postgres account' } },
  },
});

// ---------------------------------------------------------------------------
// Build Bot Payload — per-item. Pairs the fresh posts.id with the caption and
// the model opinion, and passes the item into the Review Bot (step 2) along
// with the fields it already knew (publish_at is always null here — the bot
// shows no publish line for an unscheduled draft).
// ---------------------------------------------------------------------------
const buildBotPayload = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Bot Payload',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: [
        'const saved = $json;',
        "const a = $('Assemble Caption').item.json;",
        'return { json: {',
        '  post_id: saved.id,',
        '  repository_id: saved.repository_id,',
        '  caption: a.caption,',
        '  publish_at: null,',
        '  full_name: a.full_name,',
        '  verdict: a.verdict,',
        "  reason: a.reason ?? '',",
        '} };',
      ].join('\n'),
    },
  },
});

// ---------------------------------------------------------------------------
// Send to Review Bot — pass the chosen posts ONCE into the new Review Bot
// workflow (executeWorkflowTrigger). The bot sends each review message and
// records bot_chat_id/bot_message_id itself. We wait for it to finish so the
// run log closes only after the messages are out. Persist payload fields:
// post_id, repository_id, caption, publish_at, full_name.
// ---------------------------------------------------------------------------
const sendToReviewBot = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Send to Review Bot',
    position: [86, 240],
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'KfWNSjAws4DQ2bjq' },
      options: { waitForSubWorkflow: true },
    },
  },
});

const note = sticky(
  '## Pure GitHub — Discovery\n\nبا دکمه\u200cی «شروع دیسکاوری» ربات اجرا می\u200cشود، پروژه\u200cهای Open Source را کشف، امتیازدهی و پیش\u200cنویس کپشن می\u200cسازد، سپس برای بازبینی انسانی به Review Bot می\u200cفرستد.',
  [fromReviewBot],
  { color: 5 },
);

export default workflow('puregh-discovery', 'Pure GitHub — Discovery')
  .add(note)
  .add(fromReviewBot)
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
  .to(select16)
  // section 4: similarity → loop (all 16 captioned + persisted + sent to bot)
  .to(purposeSimilarity)
  .to(buildLlmFacts)
  .to(loopRepos
    .onDone(collectRunStats.to(closeRunLog))
    .onEachBatch(generateCaption.to(assembleCaption).to(buildLoopPayload)
      .to(upsertRepos).to(saveFinalPosts).to(buildBotPayload)
      .to(sendToReviewBot).to(trackRunStats).to(wait3Minutes).to(nextBatch(loopRepos))));
