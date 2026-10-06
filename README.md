# jobandupdates.com CMS

A lightweight publishing CMS for **jobandupdates.com** built with Astro and Cloudflare.

## Current architecture

- **Astro** — public pages and admin UI
- **Cloudflare Workers** — runtime routing, admin APIs, scheduled publishing and short public HTML caching
- **Cloudflare D1** — posts, pages, settings, redirects, templates, revisions, sessions, login throttling, analytics counters and media metadata
- **Cloudflare KV** — media binaries plus lightweight public caches
- **Cloudflare Static Assets** — built CSS, JavaScript, logo and other static files
- **GitHub** — source control and Cloudflare build/deploy source only

Runtime publishing does **not** require a GitHub token.

## Content model

The CMS supports:

- Published, draft and scheduled posts
- Categories, tags and authors
- Managed About/Contact/legal/editorial pages
- D1-backed article revision history
- D1-backed redirects
- D1-backed post templates
- Portable JSON backup and WordPress WXR export
- KV-backed media library with free-tier safety limits

The Worker cron runs every 5 minutes for scheduled publishing.

## SEO

Site-wide SEO controls include:

- Site name, short name and production URL
- Homepage SEO title and default meta description
- Title template
- Canonicals
- Open Graph and X/Twitter metadata
- Default social image and alt text
- Favicon
- Search Console verification

Article/page controls include custom SEO title, meta description, canonical, social metadata, noindex/nofollow and image alt text.

Public routes include sitemap, robots.txt, RSS, search, category/tag/author archives and runtime ads.txt.

## Performance

Public list pages use a lightweight D1 card payload instead of loading full article bodies. Site settings and aggregate metadata use memory/KV caching. Public HTML has a short edge cache and static assets are long-lived cached.

The large Toast UI editor bundle is admin-only and lazy-loaded after authentication, so it does not affect public visitors.

## Accessibility

The shared public/admin UI includes visible keyboard focus states, skip links, reduced-motion support, stronger text contrast, accessible mobile navigation, labeled controls and live status messaging.

## CMS authentication

The CMS has three fixed internal accounts with salted password verifiers in source code. Plaintext passwords are not stored in the repository.

Sessions are:

- random tokens
- stored server-side in D1 as token hashes
- issued through a Secure, HttpOnly, SameSite=Strict `__Host-` cookie
- limited to 8 hours

Failed login throttling is persisted in D1.

`DEV_ADMIN_BYPASS` must remain false/unset in production.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

For intentional local-only admin bypass:

```env
DEV_ADMIN_BYPASS=true
```

Never enable that in production.

## Cloudflare bindings

Configured in `wrangler.jsonc`:

- `ASSETS`
- `DB` → D1 database `cms-db`
- `CMS_KV` → CMS KV namespace
- cron → `*/5 * * * *`

AI inference is disabled in the current zero-cost configuration.

## Deployment

Cloudflare Builds is connected to the GitHub `main` branch and runs:

```bash
npm run build
npx wrangler deploy
```

GitHub Actions is used only for optional validation on pull requests/manual runs; it does not perform scheduled publishing or production deploys.

## Media

Current media storage uses Cloudflare KV with CMS safety limits. New browser uploads are resized and converted to WebP before upload.

R2 is not required for the current zero-cost setup and can be considered later if media volume grows beyond the KV-based design.

## Before wider launch

- Confirm final editorial/contact information
- Add Search Console verification when ready
- Add Analytics/AdSense only when ready
- Keep regular JSON backups
- Periodically review Cloudflare free-tier usage and media storage
