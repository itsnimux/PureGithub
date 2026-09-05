-- Pure GitHub — SQL used by the Discovery workflow (step 2)
--
-- Kept in the repo rather than only inside n8n for the same reason
-- workflows/*.ts are: the queries are reviewable here, and a broken n8n node
-- can be restored from a known-good text. Every statement below has been run
-- against the live database.
--
-- Parameter numbering matches the order the workflow passes them, so a query
-- can be copied into a Postgres node without renumbering.

-- ===========================================================================
-- 1. CANDIDATE FILTER  — which of the repos this run found may be scored?
-- ===========================================================================
-- Implements COOLDOWN from discovery/rules.js.
--
-- Why this is not optional: scores are near-stationary day to day, so without
-- cooldowns a daily run re-selects the same top eight forever and spends the
-- whole LLM budget re-judging yesterday's candidates.
--
-- Takes the run's github_ids as $1 (bigint[]) and returns one row per id with
-- the state needed to decide. The decision itself is made in code
-- (algorithm.shouldReconsider) so the thresholds stay in rules.js — SQL here
-- only supplies facts.
--
-- $1 = bigint[] of github_ids seen this run
-- $2 = COOLDOWN.llmRejected   (days)
-- $3 = COOLDOWN.nearMiss      (days)
-- $4 = COOLDOWN.notSelected   (days)
-- $5 = COOLDOWN.softReject    (days)
-- $6 = FUNNEL.minTotalForLlm

SELECT g.github_id,
       r.id                AS repo_id,
       r.published,
       r.human_rejected,
       r.verdict,
       r.last_total,
       r.last_stage,
       r.last_reject_reason,
       r.last_checked,
       r.times_seen,
       -- The verdict, resolved server-side so the workflow branches on one
       -- column instead of reimplementing the precedence rules in an IF node.
       CASE
         WHEN r.id IS NULL                     THEN 'new'
         WHEN r.published                      THEN 'blocked-published'
         WHEN r.human_rejected                 THEN 'blocked-human-rejected'
         WHEN r.verdict = 'reject'
              AND r.last_checked > now() - ($2 || ' days')::interval
                                               THEN 'cooldown-llm-rejected'
         WHEN r.last_reject_reason IN ('archived','fork','template','disabled',
                                       'piracy','config-dump','oversized')
                                               THEN 'blocked-permanent'
         WHEN r.last_reject_reason IS NOT NULL
              AND r.last_checked > now() - ($5 || ' days')::interval
                                               THEN 'cooldown-soft-reject'
         -- nearMiss only applies to a score that SAW A README. A stage-'a'
         -- total is ~22 points low by construction (measured: mean +21.7 going
         -- from stage A to stage B over 778 corpus repos), so comparing it to
         -- minTotalForLlm mislabels 42% of the repos below the line. Must stay
         -- in sync with rules.COMPARABLE_SCORE_STAGES / algorithm.outcomeOf.
         WHEN r.last_total IS NOT NULL AND r.last_total < $6
              AND r.last_stage IN ('b','llm','selected')
              AND r.last_checked > now() - ($3 || ' days')::interval
                                               THEN 'cooldown-near-miss'
         WHEN r.last_checked > now() - ($4 || ' days')::interval
                                               THEN 'cooldown-not-selected'
         ELSE 'recheck'
       END AS gate
  FROM unnest($1::bigint[]) AS g(github_id)
  LEFT JOIN repositories r ON r.github_id = g.github_id;


-- ===========================================================================
-- 2. PURPOSE SIMILARITY — has this channel already posted something like it?
-- ===========================================================================
-- Two independent signals, either sufficient. See FUNNEL comments in rules.js
-- for the measurements; briefly:
--   - description trigram similarity catches copied wording but MISSED every
--     real same-purpose pair tested (v2rayA~v2rayN 0.32, hazm~shekar 0.17);
--   - topic Jaccard caught them (hiddify-app~s-ui 0.40, Hiddify-Manager~
--     hiddify-app 0.65) but is unusable on the 28% of repos with <2 topics.
--
-- Returns nothing when the channel has published nothing similar, which is the
-- normal case and costs one index lookup.
--
-- $1 = candidate description
-- $2 = candidate topics (jsonb array)
-- $3 = FUNNEL.purposeSimilarityThreshold
-- $4 = FUNNEL.purposeTopicJaccardThreshold
-- $5 = FUNNEL.purposeMinSharedTopics
-- $6 = FUNNEL.purposeCompareLimit
-- $7 = candidate github_id (excluded: a repo is not its own duplicate)

WITH cand AS (
  SELECT $1::text AS descr,
         ARRAY(SELECT lower(jsonb_array_elements_text($2::jsonb))) AS topics
),
pub AS (
  SELECT r.github_id, r.full_name, r.url, r.description, r.stars,
         ARRAY(SELECT lower(jsonb_array_elements_text(r.topics))) AS topics
    FROM repositories r
   WHERE r.published = TRUE
     AND r.github_id <> $7::bigint
),
scored AS (
  SELECT p.full_name, p.url, p.stars, p.description,
         similarity(c.descr, p.description) AS desc_sim,
         cardinality(ARRAY(SELECT unnest(c.topics) INTERSECT SELECT unnest(p.topics))) AS shared,
         cardinality(ARRAY(SELECT unnest(c.topics) INTERSECT SELECT unnest(p.topics)))::numeric
           / GREATEST(1, cardinality(ARRAY(SELECT unnest(c.topics) UNION SELECT unnest(p.topics)))) AS jaccard
    FROM pub p CROSS JOIN cand c
)
SELECT full_name, url, stars, description,
       round(desc_sim::numeric, 3) AS desc_sim,
       shared,
       round(jaccard, 3) AS jaccard,
       CASE WHEN shared >= $5::int AND jaccard >= $4::numeric THEN 'topics'
            WHEN desc_sim >= $3::numeric                      THEN 'description'
       END AS matched_by
  FROM scored
 WHERE (shared >= $5::int AND jaccard >= $4::numeric)
    OR desc_sim >= $3::numeric
 ORDER BY jaccard DESC, desc_sim DESC
 LIMIT $6::int;


-- ===========================================================================
-- 3. UPSERT A SCORED REPO
-- ===========================================================================
-- Every repo the run scores is written, including rejects. Caching rejects is
-- what makes the cooldown possible at all.
--
-- times_seen increments on conflict — a repo re-examined many times and never
-- selected is evidence that a threshold is mis-set, and that is only visible
-- if the count is kept.

INSERT INTO repositories (
    github_id, full_name, owner, name, url, description, homepage,
    stars, forks, open_issues, language, topics, license_spdx, license_name,
    is_fork, is_archived, is_template, default_branch,
    gh_created_at, gh_pushed_at, readme_bytes, has_demo,
    days_since_push, repo_age_days, star_velocity,
    source, last_quality, last_relevance, last_total, lane, lanes,
    last_reject_reason, last_stage, found_by
) VALUES (
    $1, $2, $3, $4, $5, $6, $7,
    $8, $9, $10, $11, $12::jsonb, $13, $14,
    $15, $16, $17, $18,
    $19, $20, $21, $22,
    $23, $24, $25,
    'discovery', $26, $27, $28, $29, $30::jsonb,
    $31, $32, $33
)
ON CONFLICT (github_id) DO UPDATE SET
    full_name          = EXCLUDED.full_name,
    description        = EXCLUDED.description,
    homepage           = EXCLUDED.homepage,
    stars              = EXCLUDED.stars,
    forks              = EXCLUDED.forks,
    open_issues        = EXCLUDED.open_issues,
    language           = EXCLUDED.language,
    topics             = EXCLUDED.topics,
    license_spdx       = EXCLUDED.license_spdx,
    license_name       = EXCLUDED.license_name,
    is_archived        = EXCLUDED.is_archived,
    gh_pushed_at       = EXCLUDED.gh_pushed_at,
    readme_bytes       = EXCLUDED.readme_bytes,
    has_demo           = EXCLUDED.has_demo,
    days_since_push    = EXCLUDED.days_since_push,
    repo_age_days      = EXCLUDED.repo_age_days,
    star_velocity      = EXCLUDED.star_velocity,
    last_quality       = EXCLUDED.last_quality,
    last_relevance     = EXCLUDED.last_relevance,
    last_total         = EXCLUDED.last_total,
    lane               = EXCLUDED.lane,
    lanes              = EXCLUDED.lanes,
    last_reject_reason = EXCLUDED.last_reject_reason,
    last_stage         = EXCLUDED.last_stage,
    found_by           = COALESCE(repositories.found_by, EXCLUDED.found_by),
    times_seen         = repositories.times_seen + 1,
    last_checked       = now()
RETURNING id, times_seen;


-- ===========================================================================
-- 4. RUN LOG
-- ===========================================================================
-- Open the run. Without this, a run that produces nothing is unexplainable:
-- there is no way to tell whether the queries returned little, the filters
-- rejected everything, or the cooldown blocked every candidate.

INSERT INTO discovery_runs (day_seed, queries)
VALUES ($1, $2::jsonb)
RETURNING id, started_at;

-- Close it.
UPDATE discovery_runs
   SET finished_at       = now(),
       repos_seen        = $2,
       repos_new         = $3,
       repos_on_cooldown = $4,
       passed_stage_a    = $5,
       readmes_fetched   = $6,
       passed_stage_b    = $7,
       sent_to_llm       = $8,
       drafts_created    = $9,
       error             = $10
 WHERE id = $1;
