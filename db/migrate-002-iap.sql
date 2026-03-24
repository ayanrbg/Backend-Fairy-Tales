-- Migration 002: IAP support — free tales flag + subscriptions table

ALTER TABLE tales ADD COLUMN IF NOT EXISTS free BOOLEAN DEFAULT TRUE;

-- Mark all existing tales as free
UPDATE tales SET free = TRUE;

CREATE TABLE IF NOT EXISTS subscriptions (
    user_id                 VARCHAR(255) PRIMARY KEY REFERENCES users(user_id),
    product_id              TEXT NOT NULL,
    original_transaction_id TEXT,
    expires_at              TIMESTAMP NOT NULL,
    platform                TEXT NOT NULL DEFAULT 'apple',
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);
