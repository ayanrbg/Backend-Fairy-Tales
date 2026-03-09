CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    user_id       VARCHAR(255) UNIQUE NOT NULL,
    voice_id      VARCHAR(255),
    cloned_at     TIMESTAMP,
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tales (
    id            SERIAL PRIMARY KEY,
    slug          VARCHAR(255) UNIQUE NOT NULL,
    title         VARCHAR(500) NOT NULL,
    lang          VARCHAR(10) NOT NULL,
    pages         JSONB NOT NULL DEFAULT '[]',
    created_at    TIMESTAMP DEFAULT NOW()
);
