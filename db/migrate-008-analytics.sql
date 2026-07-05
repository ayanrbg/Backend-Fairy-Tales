-- Migration 008: our own copy of client analytics events (DEV_PLAN §3C).
-- Additive and independent from Firebase/GA4 — the client mirrors critical
-- events here so we keep raw data even if Google export is unavailable.
-- One row per event; the client may POST a batch. Retention is short
-- (see diagnostics.cleanupOldRows) — this is a debug/verification copy, not
-- the analytics warehouse (BigQuery is that).

CREATE TABLE IF NOT EXISTS analytics_events (
    id           BIGSERIAL PRIMARY KEY,
    user_id      TEXT,
    session      TEXT,               -- client-generated session id
    platform     TEXT,               -- ios | android | editor
    app_version  TEXT,
    name         TEXT NOT NULL,      -- GA4 event name (tale_open, paywall_view, ...)
    params       JSONB,              -- event parameters (no PII; child_gender ok)
    client_ts    TIMESTAMPTZ,        -- event time on device
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_analytics_name    ON analytics_events (name, received_at DESC);
CREATE INDEX IF NOT EXISTS ix_analytics_user    ON analytics_events (user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS ix_analytics_session ON analytics_events (session);
