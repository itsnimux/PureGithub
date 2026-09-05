-- Pure GitHub — schema (step 1)
--
-- Runs once, automatically, on first start of an empty puregh_pgdata volume.
-- To re-apply on an existing volume: psql -f db/schema.sql (it is idempotent).

-- pgvector is enabled now even though step 1 does not use it, so the RAG phase
-- does not require touching the running database later.
CREATE EXTENSION IF NOT EXISTS vector;
-- Fuzzy matching, used for near-duplicate detection of repo names/descriptions.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- repositories
-- ---------------------------------------------------------------------------
-- One row per repository the system has ever looked at, including rejects.
-- Caching rejects is deliberate: without it, the same repo burns LLM quota
-- again on every run.

CREATE TABLE IF NOT EXISTS repositories (
    id              BIGSERIAL PRIMARY KEY,

    -- Identity. github_id is the durable key (survives renames); full_name is
    -- the human one and is what dedup against reference channels will match on.
    github_id       BIGINT       NOT NULL UNIQUE,
    full_name       TEXT         NOT NULL UNIQUE,
    owner           TEXT         NOT NULL,
    name            TEXT         NOT NULL,
    url             TEXT         NOT NULL,

    -- Factual metadata, always straight from the GitHub API. The LLM never
    -- writes to these columns.
    description     TEXT,
    homepage        TEXT,
    stars           INTEGER      NOT NULL DEFAULT 0,
    forks           INTEGER      NOT NULL DEFAULT 0,
    open_issues     INTEGER      NOT NULL DEFAULT 0,
    language        TEXT,
    topics          JSONB        NOT NULL DEFAULT '[]'::jsonb,
    license_spdx    TEXT,
    license_name    TEXT,
    is_fork         BOOLEAN      NOT NULL DEFAULT FALSE,
    is_archived     BOOLEAN      NOT NULL DEFAULT FALSE,
    is_template     BOOLEAN      NOT NULL DEFAULT FALSE,
    default_branch  TEXT,
    gh_created_at   TIMESTAMPTZ,
    gh_pushed_at    TIMESTAMPTZ,

    -- Signals computed in code, not asked from the LLM. star_velocity
    -- (stars per day since creation) is the strongest "hidden gem" signal:
    -- 850 stars on a 3-week-old repo means more than any model's opinion.
    readme_bytes    INTEGER,
    has_demo        BOOLEAN,
    days_since_push INTEGER,
    repo_age_days   INTEGER,
    star_velocity   NUMERIC(10,3),
    signals         JSONB        NOT NULL DEFAULT '{}'::jsonb,

    -- LLM judgement. Three-way verdict rather than a 0-100 score: models are
    -- far more consistent at reject/maybe/strong than at calibrated numbers.
    verdict         TEXT         CHECK (verdict IN ('strong', 'maybe', 'reject')),
    verdict_reason  TEXT,
    category        TEXT,
    audience        JSONB        NOT NULL DEFAULT '[]'::jsonb,
    evaluated_at    TIMESTAMPTZ,
    evaluated_model TEXT,

    -- Provenance: 'manual' in step 1, 'discovery' once workflow 3 exists.
    source          TEXT         NOT NULL DEFAULT 'manual'
                                 CHECK (source IN ('manual', 'discovery', 'reference', 'submission')),

    published       BOOLEAN      NOT NULL DEFAULT FALSE,
    first_seen      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_checked    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS repositories_verdict_idx       ON repositories (verdict);
CREATE INDEX IF NOT EXISTS repositories_published_idx     ON repositories (published);
CREATE INDEX IF NOT EXISTS repositories_star_velocity_idx ON repositories (star_velocity DESC);
CREATE INDEX IF NOT EXISTS repositories_last_checked_idx  ON repositories (last_checked);
CREATE INDEX IF NOT EXISTS repositories_full_name_trgm_idx
    ON repositories USING gin (full_name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- step 2 — discovery columns
-- ---------------------------------------------------------------------------
-- Added as ALTER ... IF NOT EXISTS rather than edited into the CREATE above, so
-- this file stays runnable against the existing volume. The step-1 table is
-- live; recreating it is not an option.

-- The deterministic scores. Stored, not recomputed, for three reasons: the
-- cooldown logic needs to know how close a repo came last time, a score that
-- moves after a rules.js change is the only way to see the effect of that
-- change, and the review form shows the reviewer why a repo was picked.
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS last_quality   NUMERIC(6,2);
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS last_relevance NUMERIC(6,2);
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS last_total     NUMERIC(6,2);
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS lane           TEXT;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS lanes          JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Why a repo was skipped, and by which stage. Needed because "not selected"
-- and "rejected" carry very different cooldowns (COOLDOWN.notSelected = 3 days,
-- COOLDOWN.softReject = 45) and the run cannot tell them apart otherwise.
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS last_reject_reason TEXT;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS last_stage         TEXT
    CHECK (last_stage IS NULL OR last_stage IN ('a', 'b', 'llm', 'selected'));

-- Separate from verdict='reject', which is the MODEL's opinion. A human
-- rejection is the strongest signal in the system and must never be
-- automatically reconsidered (COOLDOWN.humanRejected = null), so it cannot
-- share a column with the model's verdict.
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS human_rejected BOOLEAN NOT NULL DEFAULT FALSE;

-- How many runs have looked at this repo. A repo re-examined many times and
-- never selected is evidence that a threshold is mis-set.
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS times_seen INTEGER NOT NULL DEFAULT 1;

-- Which generated query surfaced it. The only way to answer "is the AI lane
-- budget actually producing anything?" — the question that exposed five dead
-- queries in the first calibration corpus.
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS found_by TEXT;

-- The candidate query is the hot path: every run reads it with a lane filter,
-- a score floor and a cooldown bound. Partial index so it stays small —
-- published and human-rejected repos are never candidates again.
CREATE INDEX IF NOT EXISTS repositories_candidate_idx
    ON repositories (last_total DESC, last_checked)
 WHERE published = FALSE AND human_rejected = FALSE;

CREATE INDEX IF NOT EXISTS repositories_lane_idx ON repositories (lane);

-- Purpose-level near-duplicate detection (FUNNEL.purposeSimilarityThreshold).
-- Distinct from repo-level dedup: this is what stops the channel posting a
-- fourth v2ray client that does nothing new. The description trigram index is
-- what makes similarity() affordable — without it, every candidate would cause
-- a sequential scan over all published descriptions.
CREATE INDEX IF NOT EXISTS repositories_description_trgm_idx
    ON repositories USING gin (description gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------
-- One row per generated caption. Rejected and regenerated drafts are kept:
-- they are the training signal for the feedback phase.

CREATE TABLE IF NOT EXISTS posts (
    id                  BIGSERIAL PRIMARY KEY,
    repository_id       BIGINT       NOT NULL
                                     REFERENCES repositories (id) ON DELETE CASCADE,

    caption             TEXT         NOT NULL,
    status              TEXT         NOT NULL DEFAULT 'draft'
                                     CHECK (status IN ('draft', 'approved', 'rejected', 'published', 'failed')),

    -- Which model wrote it, and how many attempts this repo needed. Both feed
    -- the "regeneration rate" metric from the spec.
    model               TEXT,
    attempt             INTEGER      NOT NULL DEFAULT 1,
    reject_reason       TEXT,

    telegram_chat_id    TEXT,
    telegram_message_id BIGINT,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    decided_at          TIMESTAMPTZ,
    published_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS posts_repository_id_idx ON posts (repository_id);
CREATE INDEX IF NOT EXISTS posts_status_idx        ON posts (status);
CREATE INDEX IF NOT EXISTS posts_published_at_idx  ON posts (published_at DESC);

-- At most one published post per repository. This is the hard guarantee behind
-- the spec's duplicate-prevention rule; application logic can be bypassed,
-- a unique index cannot.
CREATE UNIQUE INDEX IF NOT EXISTS posts_one_published_per_repo_idx
    ON posts (repository_id) WHERE status = 'published';

-- ---------------------------------------------------------------------------
-- keep repositories.published in sync with posts
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_repository_published() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'published' THEN
        UPDATE repositories
           SET published = TRUE,
               last_checked = now()
         WHERE id = NEW.repository_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS posts_sync_published ON posts;
CREATE TRIGGER posts_sync_published
    AFTER INSERT OR UPDATE OF status ON posts
    FOR EACH ROW EXECUTE FUNCTION sync_repository_published();

-- ---------------------------------------------------------------------------
-- keep repositories.human_rejected in sync with posts
-- ---------------------------------------------------------------------------
-- A human rejection is the strongest signal the system has, and COOLDOWN
-- .humanRejected is null (never reconsider). Enforcing that in the database
-- rather than in workflow logic follows the same reasoning as the unique
-- published index: the discovery run must not be able to forget it by accident.
--
-- Note the deliberate asymmetry with published: a repo whose draft was rejected
-- is NOT reset if a later draft is approved, because human_rejected records that
-- a person once said no, not the state of the newest draft.

CREATE OR REPLACE FUNCTION sync_repository_human_rejected() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'rejected' THEN
        UPDATE repositories
           SET human_rejected = TRUE,
               last_stage     = 'llm',
               last_checked   = now()
         WHERE id = NEW.repository_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS posts_sync_human_rejected ON posts;
CREATE TRIGGER posts_sync_human_rejected
    AFTER INSERT OR UPDATE OF status ON posts
    FOR EACH ROW EXECUTE FUNCTION sync_repository_human_rejected();

-- ---------------------------------------------------------------------------
-- convenience view
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW published_feed AS
SELECT p.published_at,
       r.full_name,
       r.url,
       r.stars,
       r.language,
       r.category,
       r.star_velocity,
       p.telegram_message_id
  FROM posts p
  JOIN repositories r ON r.id = p.repository_id
 WHERE p.status = 'published'
 ORDER BY p.published_at DESC;

-- ---------------------------------------------------------------------------
-- step 2 — discovery run log
-- ---------------------------------------------------------------------------
-- One row per discovery run. Without this the system is unauditable: when a run
-- produces nothing there is no way to tell whether the queries returned little,
-- the filters rejected everything, or the cooldown blocked every candidate.
--
-- Also the only place the funnel's real shape is recorded over time. The design
-- target is ~1200 -> 120 -> 16 -> 8; if the middle number drifts to 5 the
-- thresholds need revisiting, and that is only visible as a series.

CREATE TABLE IF NOT EXISTS discovery_runs (
    id                BIGSERIAL PRIMARY KEY,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at       TIMESTAMPTZ,

    -- Rotation seed (day index). Makes a run reproducible: the same seed
    -- rebuilds the exact same query plan.
    day_seed          INTEGER,
    queries           JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Funnel counters, in order.
    repos_seen        INTEGER NOT NULL DEFAULT 0,
    repos_new         INTEGER NOT NULL DEFAULT 0,
    repos_on_cooldown INTEGER NOT NULL DEFAULT 0,
    passed_stage_a    INTEGER NOT NULL DEFAULT 0,
    readmes_fetched   INTEGER NOT NULL DEFAULT 0,
    passed_stage_b    INTEGER NOT NULL DEFAULT 0,
    sent_to_llm       INTEGER NOT NULL DEFAULT 0,
    drafts_created    INTEGER NOT NULL DEFAULT 0,

    error             TEXT
);

CREATE INDEX IF NOT EXISTS discovery_runs_started_at_idx ON discovery_runs (started_at DESC);

-- ---------------------------------------------------------------------------
-- step 2 — helper views
-- ---------------------------------------------------------------------------

-- Everything the system has scored but never posted, best first. This is the
-- backlog: if it is large and the channel is still short of posts, the gate is
-- too tight rather than the supply too thin.
CREATE OR REPLACE VIEW discovery_backlog AS
SELECT r.full_name,
       r.url,
       r.stars,
       r.language,
       r.lane,
       r.last_total,
       r.last_quality,
       r.last_reject_reason,
       r.times_seen,
       r.last_checked
  FROM repositories r
 WHERE r.published = FALSE
   AND r.human_rejected = FALSE
 ORDER BY r.last_total DESC NULLS LAST;

-- Per-lane supply. Answers whether a lane's query budget is earning its place —
-- the check that would have caught the five dead OR-syntax queries immediately.
CREATE OR REPLACE VIEW lane_supply AS
SELECT COALESCE(lane, '(none)') AS lane,
       count(*)                                              AS total,
       count(*) FILTER (WHERE published)                     AS published,
       count(*) FILTER (WHERE last_reject_reason IS NOT NULL) AS rejected,
       round(avg(last_total), 1)                             AS avg_total,
       max(last_total)                                       AS best_total
  FROM repositories
 GROUP BY 1
 ORDER BY total DESC;

