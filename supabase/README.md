# Supabase CMS data layer

This directory contains the database schema and integration notes for the CMS.

The public Astro site remains static-first. Supabase stores CMS state (posts, drafts, pages, settings, redirects, media metadata and audit records). Publishing continues to mirror build-time content into the repository so Cloudflare can serve pre-rendered HTML without database reads on normal page views.
