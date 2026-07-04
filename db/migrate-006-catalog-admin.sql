-- Migration 006: subscription snapshots, remote debug logs, and catalog admin fields.
-- All additive — safe to run on a live DB. `entitlements.source` has no CHECK
-- constraint, so the new 'admin' source works without altering the column.

-- ── §9b: full client-state snapshots (monitoring) ──
CREATE TABLE IF NOT EXISTS subscription_snapshots (
    id             BIGSERIAL PRIMARY KEY,
    user_id        TEXT,
    platform       TEXT,
    app_version    TEXT,
    context        TEXT,
    cached_premium BOOLEAN,
    products       JSONB,          -- products array as sent by the client
    client_ts      TIMESTAMPTZ,
    received_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_snap_user ON subscription_snapshots (user_id, received_at DESC);

-- ── §9a: remote purchase logs (we have no device console / Mac) ──
CREATE TABLE IF NOT EXISTS debug_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT,
    session     TEXT,
    platform    TEXT,
    app_version TEXT,
    ev          TEXT,
    data        TEXT,
    client_ts   TIMESTAMPTZ,       -- ts from the body
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_debug_logs_user ON debug_logs (user_id, received_at);
CREATE INDEX IF NOT EXISTS ix_debug_logs_session ON debug_logs (session);

-- ── Library: server-side catalog control (SERVER_LIBRARY_SPEC §1) ──
-- The catalog keeps one row per (slug, lang); these slug-level attributes are
-- mirrored across a slug's language rows and always written for every row of a slug.
ALTER TABLE tales ADD COLUMN IF NOT EXISTS status          TEXT    NOT NULL DEFAULT 'active';  -- active | hidden | removed
ALTER TABLE tales ADD COLUMN IF NOT EXISTS coming_soon     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tales ADD COLUMN IF NOT EXISTS sort_order      INT     NOT NULL DEFAULT 0;
ALTER TABLE tales ADD COLUMN IF NOT EXISTS content_version INT     NOT NULL DEFAULT 1;
ALTER TABLE tales ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT now();

-- `removed` rows are kept in the API response for a retention window so clients
-- can purge their local cache; this timestamp marks when removal happened.
CREATE INDEX IF NOT EXISTS ix_tales_status ON tales (status);
