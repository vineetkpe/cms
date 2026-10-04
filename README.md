# Astro CMS for Cloudflare

A static-first publishing CMS built with **Astro + Cloudflare Workers + GitHub**.

Public pages are pre-rendered and lightweight. The private CMS uses a small fixed set of Worker-secret users, signed HttpOnly sessions, GitHub-backed publishing, and encrypted drafts. Supabase is not required.

## Architecture

- **Astro** — static public site
- **Cloudflare Workers / Static Assets** — hosting and private admin APIs
- **Cloudflare Worker secrets** — CMS authentication configuration and private keys
- **GitHub** — versioned posts, pages, settings, redirects, media and encrypted drafts
- **Cloudflare KV** — connected as `CMS_KV` for lightweight CMS state/rate-limit use
- **Cloudflare D1** — connected as `DB` for future private structured data such as forms/comments

## CMS access

Production authentication is provided through the `CMS_AUTH_CONFIG` Worker secret. It supports up to three fixed users. Passwords are not committed to this repository; only salted PBKDF2-SHA256 password hashes are stored inside the Worker secret.

CMS roles supported by the application are:

- `owner` — full access
- `admin` — administration and site settings
- `editor` — editorial operations
- `author` — content operations

## Included

- Responsive editorial homepage and article pages
- Categories, tags, authors and related posts
- Search, RSS, sitemap, robots.txt and 404
- Article/page SEO metadata, canonical URLs and noindex controls
- Open Graph and Twitter metadata
- Article, Breadcrumb, FAQ, Organization and WebSite structured data
- Admin control center
- Post editor with drafts, scheduling fields, FAQ, featured images, tags and ad controls
- Page editor
- Media library
- Redirect manager
- Appearance/site settings
- Google Analytics, Search Console and AdSense configuration fields
- About, Contact, Editorial Policy, Privacy, Terms and Disclaimer pages
- GitHub Actions validation/build workflow

Comments and public contact-form submissions are currently disabled. D1 is connected and can be used for these features later without bringing Supabase back.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

`DEV_ADMIN_BYPASS` defaults to `false`. Set it to `true` only for intentional local development and never in production.

## Production secrets

Configure these as Cloudflare Worker secrets for Worker `cms`:

- `CMS_AUTH_CONFIG` — fixed CMS users, password hashes and session signing key
- `CMS_GITHUB_TOKEN` — fine-grained token restricted to `vineetkpe/cms` with only required repository Contents access
- `CMS_DRAFT_KEY` — separate long random secret used to encrypt unpublished drafts

Never commit the values of these secrets.

## Publishing flow

1. A CMS user signs in at `/admin/login/` using a username and password.
2. The Worker verifies the salted password hash from `CMS_AUTH_CONFIG`.
3. A signed `HttpOnly`, `Secure`, `SameSite=Strict` session cookie is issued.
4. Drafts are encrypted before being written under `.cms/drafts` in GitHub.
5. Publishing writes the final Markdown under `src/content/posts/`.
6. A deployment rebuilds the static Astro site and Cloudflare serves the generated pages.

## Cloudflare bindings

The project Wrangler configuration contains:

- `ASSETS` — Astro static assets
- `DB` — D1 database `cms-db`
- `CMS_KV` — KV namespace `cms-kv`
- `CMS_GITHUB_REPO=vineetkpe/cms`
- `CMS_GITHUB_BRANCH=main`

R2 is intended for media storage once R2 has been enabled on the Cloudflare account and the `cms-media` bucket is created/bound. Queues are intentionally not required at this stage.

## Security

- No plaintext CMS passwords in GitHub
- PBKDF2-SHA256 password hashing with unique salts
- HMAC-signed CMS sessions
- `__Host-` session cookie with `HttpOnly`, `Secure` and `SameSite=Strict`
- Same-origin checks on unsafe admin requests
- Request-size limits on sensitive endpoints
- Login throttling
- Markdown sanitization
- Safe URL validation and JSON-LD escaping
- Encrypted unpublished drafts
- GitHub credentials kept only in Worker secrets
- Security headers for the public site

## Before public launch

- Configure all required Worker secrets
- Add the final three CMS users/roles
- Replace placeholder brand/email/legal information
- Set the final production domain in Site Settings
- Configure Analytics/Search Console/AdSense only when ready
- Enable and bind R2 if media should move off GitHub
