-- Migration: support multiple languages per tale slug
-- Run once: psql -d fairy_tales -f db/migrate-001-multilang.sql

ALTER TABLE tales DROP CONSTRAINT IF EXISTS tales_slug_key;
ALTER TABLE tales ADD CONSTRAINT tales_slug_lang_unique UNIQUE (slug, lang);
