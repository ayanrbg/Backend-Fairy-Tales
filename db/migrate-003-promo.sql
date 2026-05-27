CREATE TABLE IF NOT EXISTS promo_codes (
    id            SERIAL PRIMARY KEY,
    code          VARCHAR(100) UNIQUE NOT NULL,
    type          VARCHAR(20) NOT NULL CHECK (type IN ('blogger', 'premium')),
    blogger_name  VARCHAR(255),
    duration_days INT,
    used_by       VARCHAR(255),
    used_at       TIMESTAMP,
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promo_purchases (
    id                SERIAL PRIMARY KEY,
    code              VARCHAR(100) NOT NULL REFERENCES promo_codes(code),
    external_user_id  VARCHAR(255) NOT NULL,
    created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_purchases_code ON promo_purchases(code);
