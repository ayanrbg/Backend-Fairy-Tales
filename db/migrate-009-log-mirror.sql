-- Migration 009: remote log mirror + kill-switch (SERVER_LOG_MIRROR_SPEC).
-- Additive — safe to run on a live DB.
--
-- Two concerns, two tables:
--   • debug_log_lines  — the mirrored Unity log stream (high volume, short retention).
--   • debug_log_config — the server-controlled logging policy (kill-switch), one
--                        global row plus optional per-user overrides.
--
-- This is separate from the existing `debug_logs` table (migration 006), which
-- holds structured IAP events (ev/data). Here we store raw log LINES (level/
-- message/stack) mirrored from the live build so a purchase flow can be read
-- top-to-bottom with nothing on screen.

-- ── §1: mirrored log lines ──
CREATE TABLE IF NOT EXISTS debug_log_lines (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT,
    session     TEXT,               -- groups one app launch
    platform    TEXT,
    app_version TEXT,
    client_ts   TIMESTAMPTZ,        -- ts of the line on device
    level       TEXT,               -- Log | Warning | Error | Exception | Assert
    message     TEXT,
    stack       TEXT,               -- only for Warning/Error/Exception
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_log_lines_user    ON debug_log_lines (user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS ix_log_lines_session ON debug_log_lines (session, client_ts);
-- Supports the client's "dedupe on (session, ts, message) if you care" hint.
CREATE INDEX IF NOT EXISTS ix_log_lines_dedupe  ON debug_log_lines (session, client_ts, md5(message));

-- ── §2: logging policy / kill-switch ──
-- The global policy lives in the row with user_id = '*'. A row with a real
-- user_id overrides the global policy for just that tester. GET /api/debug/config
-- resolves per-user first, then global, then a built-in default.
CREATE TABLE IF NOT EXISTS debug_log_config (
    user_id     TEXT PRIMARY KEY,   -- '*' = global default; else a specific userId
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    level       TEXT    NOT NULL DEFAULT 'all',   -- all | warn
    flush_sec   INT,                              -- optional batch interval seconds
    batch_max   INT,                              -- optional early-flush line count
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the global default: ON + capture everything, so log mirroring works out of
-- the box while we chase the purchase bug. Flip to level='warn' (or enabled=false)
-- via the admin endpoint once stable — see SERVER_LOG_MIRROR_SPEC "Notes".
INSERT INTO debug_log_config (user_id, enabled, level, flush_sec, batch_max)
VALUES ('*', TRUE, 'all', 4, 40)
ON CONFLICT (user_id) DO NOTHING;
