-- Drop old unique constraint on slug only
ALTER TABLE tales DROP CONSTRAINT IF EXISTS tales_slug_key;

-- Add composite unique constraint on (slug, lang)
ALTER TABLE tales ADD CONSTRAINT tales_slug_lang_key UNIQUE (slug, lang);
