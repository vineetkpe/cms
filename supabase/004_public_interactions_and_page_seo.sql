-- Public interaction, moderation and page-level SEO upgrade.

alter table public.cms_pages add column if not exists seo_title text check (seo_title is null or char_length(seo_title) <= 180);
alter table public.cms_pages add column if not exists canonical_url text;
alter table public.cms_pages add column if not exists og_image text;
alter table public.cms_pages add column if not exists noindex boolean not null default false;

create table if not exists public.cms_comments (
  id uuid primary key default gen_random_uuid(),
  post_slug text not null check (post_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  parent_id uuid references public.cms_comments(id) on delete set null,
  author_name text not null check (char_length(author_name) between 2 and 80),
  author_email text not null check (char_length(author_email) between 3 and 254),
  body text not null check (char_length(body) between 2 and 3000),
  status text not null default 'pending' check (status in ('pending','approved','spam','trash')),
  fingerprint text check (fingerprint is null or fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  moderated_at timestamptz,
  moderated_by uuid references auth.users(id) on delete set null
);

create index if not exists cms_comments_post_status_created_idx on public.cms_comments(post_slug, status, created_at);
create index if not exists cms_comments_parent_idx on public.cms_comments(parent_id);
create index if not exists cms_comments_moderated_by_idx on public.cms_comments(moderated_by);

create table if not exists public.cms_contact_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  email text not null check (char_length(email) between 3 and 254),
  subject text not null check (char_length(subject) between 2 and 160),
  message text not null check (char_length(message) between 5 and 5000),
  status text not null default 'new' check (status in ('new','read','replied','spam','archived')),
  fingerprint text check (fingerprint is null or fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  handled_by uuid references auth.users(id) on delete set null
);

create index if not exists cms_contact_status_created_idx on public.cms_contact_submissions(status, created_at desc);
create index if not exists cms_contact_handled_by_idx on public.cms_contact_submissions(handled_by);

create table if not exists public.cms_public_rate_limits (
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('comment','contact')),
  window_start timestamptz not null,
  request_count integer not null default 1 check (request_count >= 1),
  primary key (fingerprint, action, window_start)
);

alter table public.cms_comments enable row level security;
alter table public.cms_contact_submissions enable row level security;
alter table public.cms_public_rate_limits enable row level security;

revoke all on table public.cms_comments, public.cms_contact_submissions, public.cms_public_rate_limits from anon;
revoke all on table public.cms_comments, public.cms_contact_submissions, public.cms_public_rate_limits from authenticated;

grant select, update, delete on table public.cms_comments to authenticated;
grant select, update, delete on table public.cms_contact_submissions to authenticated;

drop policy if exists cms_comments_read_members on public.cms_comments;
create policy cms_comments_read_members on public.cms_comments for select to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active));

drop policy if exists cms_comments_manage_editors on public.cms_comments;
create policy cms_comments_manage_editors on public.cms_comments for update to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin','editor')))
with check (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin','editor')));

drop policy if exists cms_comments_delete_editors on public.cms_comments;
create policy cms_comments_delete_editors on public.cms_comments for delete to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin','editor')));

drop policy if exists cms_contact_read_admins on public.cms_contact_submissions;
create policy cms_contact_read_admins on public.cms_contact_submissions for select to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')));

drop policy if exists cms_contact_manage_admins on public.cms_contact_submissions;
create policy cms_contact_manage_admins on public.cms_contact_submissions for update to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')))
with check (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')));

drop policy if exists cms_contact_delete_admins on public.cms_contact_submissions;
create policy cms_contact_delete_admins on public.cms_contact_submissions for delete to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')));

create or replace function public.cms_consume_public_rate_limit(
  p_fingerprint text,
  p_action text,
  p_limit integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_window timestamptz := date_trunc('hour', now());
begin
  if p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid request fingerprint';
  end if;
  if p_action not in ('comment','contact') then
    raise exception 'Invalid rate limit action';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'Invalid rate limit';
  end if;

  insert into public.cms_public_rate_limits(fingerprint, action, window_start, request_count)
  values (p_fingerprint, p_action, v_window, 1)
  on conflict (fingerprint, action, window_start)
  do update set request_count = public.cms_public_rate_limits.request_count + 1
  returning request_count into v_count;

  if v_count > p_limit then
    raise exception 'Too many requests. Please try again later.';
  end if;

  delete from public.cms_public_rate_limits where window_start < now() - interval '2 days';
end;
$$;

revoke all on function public.cms_consume_public_rate_limit(text,text,integer) from public, anon, authenticated;

create or replace function public.cms_submit_comment(
  p_post_slug text,
  p_author_name text,
  p_author_email text,
  p_body text,
  p_parent_id uuid,
  p_fingerprint text,
  p_honeypot text default ''
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_slug text := lower(btrim(coalesce(p_post_slug,'')));
  v_name text := btrim(coalesce(p_author_name,''));
  v_email text := lower(btrim(coalesce(p_author_email,'')));
  v_body text := btrim(coalesce(p_body,''));
begin
  if coalesce(btrim(p_honeypot),'') <> '' then
    raise exception 'Unable to submit comment.';
  end if;
  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'Invalid article.'; end if;
  if char_length(v_name) not between 2 and 80 then raise exception 'Name must be 2 to 80 characters.'; end if;
  if char_length(v_email) not between 3 and 254 or position('@' in v_email) < 2 then raise exception 'Enter a valid email address.'; end if;
  if char_length(v_body) not between 2 and 3000 then raise exception 'Comment must be 2 to 3000 characters.'; end if;

  perform public.cms_consume_public_rate_limit(p_fingerprint, 'comment', 8);

  if p_parent_id is not null and not exists (
    select 1 from public.cms_comments c where c.id=p_parent_id and c.post_slug=v_slug and c.status='approved'
  ) then
    raise exception 'Invalid parent comment.';
  end if;

  insert into public.cms_comments(post_slug,parent_id,author_name,author_email,body,status,fingerprint)
  values (v_slug,p_parent_id,v_name,v_email,v_body,'pending',p_fingerprint)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.cms_submit_comment(text,text,text,text,uuid,text,text) from public;
grant execute on function public.cms_submit_comment(text,text,text,text,uuid,text,text) to anon, authenticated;

create or replace function public.cms_public_comments(p_post_slug text)
returns table(id uuid, parent_id uuid, author_name text, body text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.parent_id, c.author_name, c.body, c.created_at
  from public.cms_comments c
  where c.post_slug = lower(btrim(p_post_slug)) and c.status='approved'
  order by c.created_at asc
  limit 200;
$$;

revoke all on function public.cms_public_comments(text) from public;
grant execute on function public.cms_public_comments(text) to anon, authenticated;

create or replace function public.cms_submit_contact(
  p_name text,
  p_email text,
  p_subject text,
  p_message text,
  p_fingerprint text,
  p_honeypot text default ''
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name,''));
  v_email text := lower(btrim(coalesce(p_email,'')));
  v_subject text := btrim(coalesce(p_subject,''));
  v_message text := btrim(coalesce(p_message,''));
begin
  if coalesce(btrim(p_honeypot),'') <> '' then
    raise exception 'Unable to submit form.';
  end if;
  if char_length(v_name) not between 2 and 100 then raise exception 'Name must be 2 to 100 characters.'; end if;
  if char_length(v_email) not between 3 and 254 or position('@' in v_email) < 2 then raise exception 'Enter a valid email address.'; end if;
  if char_length(v_subject) not between 2 and 160 then raise exception 'Subject must be 2 to 160 characters.'; end if;
  if char_length(v_message) not between 5 and 5000 then raise exception 'Message must be 5 to 5000 characters.'; end if;

  perform public.cms_consume_public_rate_limit(p_fingerprint, 'contact', 3);

  insert into public.cms_contact_submissions(name,email,subject,message,status,fingerprint)
  values (v_name,v_email,v_subject,v_message,'new',p_fingerprint)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.cms_submit_contact(text,text,text,text,text,text) from public;
grant execute on function public.cms_submit_contact(text,text,text,text,text,text) to anon, authenticated;
