-- Migration 010: push notifications — device token storage (Phase 0).
-- Foundation for user-facing push campaigns (DEV_PLAN_PUSH_NOTIFICATIONS.md).
-- Phase 0 only lays the pipe: the client registers FCM tokens here via
-- POST /api/push/register. Campaigns/deliveries tables come in Phase 1.
--
-- One row per (device) token. A single user_id may own several tokens
-- (multiple devices) — that is expected. A token that FCM reports as
-- unregistered/invalid is soft-disabled (disabled_at) rather than deleted, so
-- we keep an audit trail and never re-target a dead device.

CREATE TABLE IF NOT EXISTS push_tokens (
    id           BIGSERIAL PRIMARY KEY,
    user_id      TEXT,                       -- device-based users.user_id (may be null pre-login)
    token        TEXT NOT NULL UNIQUE,       -- FCM registration token
    platform     TEXT,                       -- ios | android
    app_version  TEXT,                       -- for version-targeted campaigns
    lang         TEXT,                       -- device language at register time (ru | kz | en)
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- heartbeat, refreshed on every register
    disabled_at  TIMESTAMPTZ,                -- set when FCM says the token is dead / user opted out
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_push_tokens_user     ON push_tokens (user_id);
-- Fast lookup of the live audience (segments only target active tokens).
CREATE INDEX IF NOT EXISTS ix_push_tokens_active   ON push_tokens (last_seen_at DESC) WHERE disabled_at IS NULL;
