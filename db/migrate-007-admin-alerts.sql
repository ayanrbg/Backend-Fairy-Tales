-- Migration 007: admin activity feed (on-site notifications, no Telegram).
-- One row per meaningful subscription event; dedup_key prevents duplicates from
-- repeated validate calls / S2S retries.

CREATE TABLE IF NOT EXISTS admin_alerts (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,          -- purchase | renewal | refund | expire | promo | admin
  user_id     TEXT,
  source      TEXT,                   -- apple | google | promo | admin
  product_id  TEXT,
  environment TEXT,                   -- production | sandbox
  message     TEXT,
  dedup_key   TEXT UNIQUE,
  read_at     TIMESTAMPTZ,            -- null = unread
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_admin_alerts_created ON admin_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_admin_alerts_unread  ON admin_alerts (read_at) WHERE read_at IS NULL;
