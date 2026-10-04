-- CMS data layer for the Astro + Cloudflare publishing system.
-- Public pages remain static; this database stores admin/CMS state.

create table if not exists public.cms_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 180),
  description text not null check (char_length(description) between 1 and 320),
  body text not null,
  category text not null default 'Guides' check (char_length(category) <= 80),
  tags text[] not null default '{}',
  author text not null default 'Editorial Team' check (char_length(author) <= 100),
  status text not null default 'draft' check (status in ('draft','published','scheduled')),
  published_at timestamptz,
  featured_image text,
  featured_image_alt text check (featured_image_alt is null or char_length(featured_image_alt) <= 180),
  seo_title text check (seo_title is null or char_length(seo_title) <= 180),
  seo_description text check (seo_description is null or char_length(seo_description) <= 320),
  canonical_url text,
  noindex boolean not null default false,
  featured boolean not null default false,
  hide_ads boolean not null default false,
  faq jsonb not null default '[]'::jsonb check (jsonb_typeof(faq) = 'array'),
  mirror_commit_sha text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cms_posts_status_published_idx
  on public.cms_posts (status, published_at desc);
create index if not exists cms_posts_category_idx
  on public.cms_posts (category);
create index if not exists cms_posts_tags_gin_idx
  on public.cms_posts using gin (tags);

create table if not exists public.cms_pages (
  slug text primary key check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 320),
  body text not null default '',
  noindex boolean not null default false,
  mirror_commit_sha text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cms_settings (
  id smallint primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);

create table if not exists public.cms_redirects (
  id bigint generated always as identity primary key,
  from_path text not null unique check (left(from_path, 1) = '/'),
  to_path text not null,
  status smallint not null default 301 check (status in (301,302,303,307,308)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cms_media (
  id uuid primary key default gen_random_uuid(),
  path text not null unique,
  public_url text not null,
  filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','image/avif')),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  alt_text text check (alt_text is null or char_length(alt_text) <= 180),
  created_at timestamptz not null default now()
);

create table if not exists public.cms_audit_log (
  id bigint generated always as identity primary key,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists cms_audit_log_created_idx
  on public.cms_audit_log (created_at desc);

-- Defense in depth: every exposed-schema table has RLS enabled.
alter table public.cms_posts enable row level security;
alter table public.cms_pages enable row level security;
alter table public.cms_settings enable row level security;
alter table public.cms_redirects enable row level security;
alter table public.cms_media enable row level security;
alter table public.cms_audit_log enable row level security;

-- No browser role receives direct CMS table access. The trusted backend uses
-- Supabase's server-side secret/service role. Do not expose that key client-side.
revoke all on table public.cms_posts from anon, authenticated;
revoke all on table public.cms_pages from anon, authenticated;
revoke all on table public.cms_settings from anon, authenticated;
revoke all on table public.cms_redirects from anon, authenticated;
revoke all on table public.cms_media from anon, authenticated;
revoke all on table public.cms_audit_log from anon, authenticated;

grant select, insert, update, delete on table public.cms_posts to service_role;
grant select, insert, update, delete on table public.cms_pages to service_role;
grant select, insert, update, delete on table public.cms_settings to service_role;
grant select, insert, update, delete on table public.cms_redirects to service_role;
grant select, insert, update, delete on table public.cms_media to service_role;
grant select, insert on table public.cms_audit_log to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Seed the singleton settings row and core trust/legal pages without overwriting
-- existing content if this migration is re-run.
insert into public.cms_settings (id, data)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

insert into public.cms_pages (slug, title, description, body, noindex) values
  ('about', 'About', 'About this publication.', 'Update this page with the publication mission, ownership and editorial team before launch.', false),
  ('contact', 'Contact', 'Contact this publication.', 'Add the public contact details for this publication before launch.', false),
  ('editorial-policy', 'Editorial Policy', 'How this publication creates and maintains content.', 'Document your sourcing, review, corrections and update practices before launch.', false),
  ('privacy', 'Privacy Policy', 'Privacy information for this website.', 'Replace this placeholder with a privacy policy that accurately reflects the services, analytics, advertising and forms you actually use.', false),
  ('terms', 'Terms', 'Terms for using this website.', 'Replace this placeholder with terms appropriate to the publication before launch.', false),
  ('disclaimer', 'Disclaimer', 'Important information about this publication.', 'Replace this placeholder with a disclaimer appropriate to the topics covered by the site.', false)
on conflict (slug) do nothing;
