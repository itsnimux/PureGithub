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
