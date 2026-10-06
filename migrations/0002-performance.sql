-- Performance migration: lightweight public post cards.
-- Applied to production on 2026-10-06.
ALTER TABLE cms_posts ADD COLUMN card_json TEXT;

-- Existing rows should be backfilled by application migration logic or a one-time script.
-- New writes populate card_json automatically in src/lib/db-posts.ts.
