-- Migration 005: Entitlements — server is the single source of truth for premium.
-- Adds `entitlements` (one active row per user) + `subscription_events` audit log,
-- and migrates existing `subscriptions` rows so nobody loses premium.

CREATE TABLE IF NOT EXISTS entitlements (
    user_id                 TEXT PRIMARY KEY REFERENCES users(user_id),
    premium                 BOOLEAN NOT NULL DEFAULT FALSE,
    source                  TEXT NOT NULL,              -- 'apple' | 'google' | 'promo'
    product_id              TEXT,                        -- fairytales_monthly | _yearly | null for promo
    original_transaction_id TEXT,                        -- Apple originalTransactionId
    purchase_token          TEXT,                        -- Google purchaseToken
    expires_at              TIMESTAMPTZ,                 -- null = lifetime (promo), else period end
    auto_renew              BOOLEAN,                     -- from store (analytics)
    environment             TEXT,                        -- 'production' | 'sandbox'
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup for S2S notifications and merge (unique per store transaction).
CREATE UNIQUE INDEX IF NOT EXISTS ux_entitlements_apple
    ON entitlements (original_transaction_id)
    WHERE original_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_entitlements_google
    ON entitlements (purchase_token)
    WHERE purchase_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS subscription_events (
    id         BIGSERIAL PRIMARY KEY,
    user_id    TEXT,
    source     TEXT,
    raw        JSONB,          -- raw store response / notification
    kind       TEXT,           -- 'validate' | 's2s' | 'promo' | 'status'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscription_events_user ON subscription_events (user_id);

-- One-time data migration from the legacy `subscriptions` table.
-- promo/manual rows -> source 'promo' (product_id nulled); apple rows keep product_id + tx id.
INSERT INTO entitlements (user_id, premium, source, product_id, original_transaction_id, expires_at, environment, updated_at, created_at)
SELECT
    s.user_id,
    TRUE,
    CASE WHEN s.platform IN ('promo', 'manual') THEN 'promo' ELSE s.platform END,
    CASE WHEN s.platform IN ('promo', 'manual') THEN NULL ELSE s.product_id END,
    CASE WHEN s.platform IN ('promo', 'manual') THEN NULL ELSE s.original_transaction_id END,
    s.expires_at AT TIME ZONE 'UTC',
    NULL,
    COALESCE(s.updated_at AT TIME ZONE 'UTC', now()),
    COALESCE(s.created_at AT TIME ZONE 'UTC', now())
FROM subscriptions s
ON CONFLICT (user_id) DO NOTHING;
