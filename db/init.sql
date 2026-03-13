CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    user_id       VARCHAR(255) UNIQUE NOT NULL,
    name          VARCHAR(255),
    gender        VARCHAR(20),
    lang          VARCHAR(10) DEFAULT 'ru',
    voice_id      VARCHAR(255),
    cloned_at     TIMESTAMP,
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tales (
    id            SERIAL PRIMARY KEY,
    slug          VARCHAR(255) NOT NULL,
    title         VARCHAR(500) NOT NULL,
    lang          VARCHAR(10) NOT NULL,
    pages         JSONB NOT NULL DEFAULT '[]',
    created_at    TIMESTAMP DEFAULT NOW(),
    UNIQUE(slug, lang)
);

CREATE TABLE IF NOT EXISTS narration_jobs (
    id            SERIAL PRIMARY KEY,
    job_id        VARCHAR(255) UNIQUE NOT NULL,
    user_id       VARCHAR(255) NOT NULL REFERENCES users(user_id),
    tale_slug     VARCHAR(255) NOT NULL,
    status        VARCHAR(50) NOT NULL DEFAULT 'processing',
    pages_ready   INT NOT NULL DEFAULT 0,
    total_pages   INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drafts (
    id            SERIAL PRIMARY KEY,
    user_id       VARCHAR(255) NOT NULL REFERENCES users(user_id),
    narrator_name VARCHAR(255) NOT NULL,
    tale_id       VARCHAR(255) NOT NULL,
    last_page     INT NOT NULL DEFAULT 0,
    voice_id      VARCHAR(255),
    created_at    TIMESTAMP DEFAULT NOW()
);
