# Astro CMS for Cloudflare

A static-first blog CMS: **Astro + GitHub + Cloudflare Workers**. Public articles are pre-rendered to static HTML. Only the private admin API runs dynamically.

## Why D1 is intentionally not in v1

For a single-editor blog, D1 adds another state store, migrations, backup logic and runtime limits without solving a problem we have yet. GitHub already provides versioned published content, rollback, audit history and a deployment trigger. Add D1 later only if you need multi-user workflows, scheduled jobs, comments or large amounts of mutable application data.

## Included

- Static Astro homepage, article pages and categories
- Responsive custom design with minimal client JavaScript
- Markdown content collection with schema validation
- `/admin/` dashboard with create/edit/delete, encrypted drafts and publishing
- Client-side image resizing/WebP compression before upload
- GitHub-backed media and content publishing
- SEO title, description, canonical, noindex and Article schema
- Sitemap, RSS, robots.txt, search index and 404
- About, contact, editorial policy, privacy, terms and disclaimer starters
- Cloudflare Access JWT validation for admin APIs
- GitHub Actions build/deploy workflow
- No React, database, PHP, jQuery or UI framework

## Local setup

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

For local admin testing, `.dev.vars` can contain `DEV_ADMIN_BYPASS=true` and a fine-grained GitHub token. Never commit `.dev.vars`.

## Required one-time production setup

### 1. GitHub token for the CMS

Create a **fine-grained GitHub token** restricted to this repository with only **Contents: Read and write**. Add it to the Cloudflare Worker as a secret:

```bash
npx wrangler secret put CMS_GITHUB_TOKEN
```

Do not expose this token to the browser or commit it to GitHub.

### 2. Optional stable draft encryption key

Draft text and metadata are encrypted before being committed to this public repository. By default the CMS derives the encryption key from `CMS_GITHUB_TOKEN`. For a key that remains stable when the GitHub token is rotated, create a long random secret and add:

```bash
npx wrangler secret put CMS_DRAFT_KEY
```

Keep this value backed up securely. Losing both the active key and the previous key makes existing encrypted drafts unreadable. Uploaded images are stored in `public/uploads/` and are not treated as private draft data.

### 3. Cloudflare Access

Protect these paths with a Cloudflare Access self-hosted application:

- `/admin/*`
- `/api/admin/*`

Allow only your admin email/account. Then add the Access values as Worker secrets:

```bash
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
npx wrangler secret put CF_ACCESS_AUD
```

`CF_ACCESS_TEAM_DOMAIN` should look like `https://your-team.cloudflareaccess.com`.

The API validates the Access JWT with Cloudflare's JWKS, so a forged request header is not enough.

### 4. Cloudflare deployment

Add repository Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The API token should have only the permissions needed to deploy this Worker.

Pushes to `main` build, type-check and deploy. Commits that only update encrypted draft files are ignored by the build workflow. Pull requests build and type-check.

### 5. Production URL

Before launch, update the site URL from `/admin/` → Site settings.

Also replace all legal-policy starter copy with text accurate for your actual site, analytics and advertising setup.

## Publishing flow

1. Sign in through Cloudflare Access at `/admin/`.
2. Write the article and save as draft or publish.
3. **Save draft:** the Worker encrypts the article with AES-GCM, stores it under an opaque HMAC-derived filename in `.cms/drafts/`, and does not expose its title/body in the repository.
4. **Publish:** the Worker writes normal Markdown to `src/content/posts/`, removes the encrypted draft and GitHub triggers a new static build.
5. Cloudflare serves the new static HTML.

Drafts are never loaded by Astro's public content collection and therefore cannot appear in public pages, category listings, search, RSS or sitemap.

## Media

v1 stores optimized images in `public/uploads/` so the complete CMS works without creating another Cloudflare resource. The browser converts uploads to WebP and limits their size first. R2 can replace this later without changing the public content model.

## Security rules

- Admin API is never authenticated by a custom browser-stored password.
- Production admin requests require a valid Cloudflare Access JWT.
- GitHub write token exists only as a Worker secret.
- Draft article text/metadata is encrypted at rest in the public repository.
- Uploaded files are limited to image MIME types and size.
- Slugs are normalized before being used as repository paths.
- Dangerous script/event-handler markup is rejected by the publishing endpoint.
- `DEV_ADMIN_BYPASS` is for local development only and must never be set in production.

## Performance model

Normal visitors receive pre-rendered files. They do not invoke the admin API, GitHub API or a database. Astro's Cloudflare adapter is configured without runtime image processing or sessions, avoiding unnecessary Images/KV bindings in v1.
