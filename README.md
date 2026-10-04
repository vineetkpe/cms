# Astro CMS for Cloudflare

A static-first multi-author publishing system using **Astro + Supabase + GitHub + Cloudflare Workers**.

Normal readers receive pre-rendered HTML from Cloudflare. Supabase is used for CMS authentication, roles, drafts, content state, settings, media metadata and audit data. GitHub remains the versioned static publishing mirror that triggers Astro builds.

## Architecture

- **Astro** — static public site
- **Cloudflare Workers / Static Assets** — hosting and private admin API
- **Supabase Auth** — email/password login for CMS users
- **Supabase Postgres** — CMS data and multi-author roles
- **GitHub** — published Markdown/media mirror and deployment trigger

## CMS roles

The database supports:

- `owner` — full CMS access
- `admin` — site/admin management
- `editor` — content, pages, redirects and editorial operations
- `author` — create/edit own content and upload media

All CMS tables have Row Level Security enabled. Anonymous access is revoked. The browser never receives a Supabase service-role/secret key.

## Included

- Content-first Astro homepage and article pages
- Categories, tags, authors and related posts
- Responsive editorial design with minimal public JavaScript
- `/admin/login/` Supabase email/password login
- `/admin/` control center
- Post editor with drafts, publishing, scheduling fields, FAQ, SEO and featured content
- Supabase-backed private drafts and post state
- GitHub mirror for published Markdown
- Media library with Supabase metadata + GitHub-hosted optimized images
- Editable About, Contact, Editorial Policy, Privacy, Terms and Disclaimer pages
- Redirect manager
- Site settings, analytics/Search Console/AdSense configuration
- Sitemap, RSS, robots.txt, search and structured data
- Audit log table
- GitHub Actions build/deploy workflow

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

For local-only testing you may set:

```bash
DEV_ADMIN_BYPASS=true
```

Never enable that value in production.

## Production secrets

The CMS still requires a fine-grained GitHub token because publishing writes the final static article/media files back to this repository.

Add this as a Cloudflare Worker secret:

```bash
npx wrangler secret put CMS_GITHUB_TOKEN
```

The token should be restricted to this repository with only the permissions required to read/write repository contents.

The Supabase project URL and publishable key are public client values and are safe to ship to the browser. Never expose a Supabase secret/service-role key.

## Cloudflare deployment

The GitHub Actions workflow expects repository Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Pushes to `main` run the Astro checks/build and deploy when those Cloudflare values are available.

## Publishing flow

1. Author signs in at `/admin/login/` using Supabase Auth.
2. The Worker validates the Supabase session and checks `cms_members` for the user's role.
3. Drafts are stored in Supabase and are not committed to the public GitHub repository.
4. Publishing stores the final CMS record in Supabase and mirrors Markdown to `src/content/posts/`.
5. GitHub triggers the Cloudflare build.
6. Astro generates static pages and Cloudflare serves them globally.

## Database

CMS-specific tables are prefixed with `cms_` so the existing Supabase project's other application tables are left untouched.

Current CMS tables:

- `cms_members`
- `cms_posts`
- `cms_pages`
- `cms_settings`
- `cms_redirects`
- `cms_media`
- `cms_audit_log`

Schema files are stored under `supabase/` for reproducibility.

## Security

- Supabase Auth handles passwords; the CMS never stores raw passwords.
- All CMS database tables use RLS.
- Anonymous database access is revoked.
- Roles are checked server-side and again through database policies.
- GitHub write credentials stay only in Worker secrets.
- Admin session cookies are `HttpOnly`, `Secure` and `SameSite=Strict`.
- Public visitors do not query Supabase or GitHub.
- Uploaded media is limited by MIME type and size.
- `DEV_ADMIN_BYPASS` is development-only.

## Before launch

- Select the first Supabase Auth user to become the CMS `owner`.
- Add each additional author/editor to `cms_members` with the correct role.
- Replace starter legal/trust-page copy with accurate business information.
- Set the production domain in Site Settings.
- Configure Analytics/Search Console/AdSense only when ready.
