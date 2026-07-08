-- Migration 011: push campaigns + per-recipient deliveries (Phase 1).
-- Builds on migrate-010 (push_tokens). A campaign targets an audience (segment
-- filters or a single userId), carries multilang content + a deep-link, and is
-- either sent now or scheduled. push_deliveries is the per-token audit/stat row
-- that also dedups retries.

CREATE TABLE IF NOT EXISTS push_campaigns (
    id            BIGSERIAL PRIMARY KEY,
    title         TEXT,                       -- internal name (not shown to users)
    status        TEXT NOT NULL DEFAULT 'draft', -- draft|scheduled|sending|sent|canceled|failed
    audience      JSONB,                      -- segment filters, or { "userId": "..." }
    content       JSONB,                      -- { ru:{title,body,image?}, kz:{...}, en:{...}, default:"ru" }
    deeplink      JSONB,                      -- { type:"tale|paywall|url|home", taleId?, url? }
    schedule_at   TIMESTAMPTZ,                -- null = send immediately
    automation_id BIGINT,                     -- set when spawned by an automation (Phase 3)
    stats         JSONB NOT NULL DEFAULT '{}'::jsonb, -- { targeted, sent, failed, opened }
    created_by    TEXT,                       -- admin actor (X-Admin-Actor)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_push_campaigns_status ON push_campaigns (status, schedule_at);

CREATE TABLE IF NOT EXISTS push_deliveries (
    id             BIGSERIAL PRIMARY KEY,
    campaign_id    BIGINT NOT NULL REFERENCES push_campaigns(id) ON DELETE CASCADE,
    user_id        TEXT,
    token          TEXT NOT NULL,
    lang_used      TEXT,
    status         TEXT NOT NULL,             -- sent | failed
    fcm_message_id TEXT,
    error          TEXT,                      -- FCM error code on failure
    sent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    opened_at      TIMESTAMPTZ                -- set if the client reports the open (optional)
);
-- One row per (campaign, token): defends against double-send on worker retry.
CREATE UNIQUE INDEX IF NOT EXISTS ux_push_deliveries_campaign_token
    ON push_deliveries (campaign_id, token);
CREATE INDEX IF NOT EXISTS ix_push_deliveries_campaign ON push_deliveries (campaign_id);
