-- Multi-author CMS authentication and RLS upgrade.

create table if not exists public.cms_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','editor','author')),
  display_name text check (display_name is null or char_length(display_name) between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cms_posts add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.cms_posts add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.cms_pages add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.cms_pages add column if not exists kicker text check (kicker is null or char_length(kicker) <= 80);
alter table public.cms_settings add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.cms_redirects add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.cms_media add column if not exists uploaded_by uuid references auth.users(id) on delete set null;
alter table public.cms_media add column if not exists git_sha text;
alter table public.cms_audit_log add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists cms_posts_created_by_idx on public.cms_posts(created_by);

alter table public.cms_members enable row level security;

revoke all on table public.cms_members, public.cms_posts, public.cms_pages, public.cms_settings, public.cms_redirects, public.cms_media, public.cms_audit_log from anon;
revoke all on table public.cms_members, public.cms_posts, public.cms_pages, public.cms_settings, public.cms_redirects, public.cms_media, public.cms_audit_log from authenticated;

grant select on table public.cms_members to authenticated;
grant select, insert, update, delete on table public.cms_posts to authenticated;
grant select, insert, update, delete on table public.cms_pages to authenticated;
grant select, insert, update, delete on table public.cms_settings to authenticated;
grant select, insert, update, delete on table public.cms_redirects to authenticated;
grant select, insert, update, delete on table public.cms_media to authenticated;
grant select, insert on table public.cms_audit_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;

drop policy if exists cms_members_read_self on public.cms_members;
create policy cms_members_read_self on public.cms_members for select to authenticated
using ((select auth.uid()) = user_id and is_active);

drop policy if exists cms_posts_read_members on public.cms_posts;
create policy cms_posts_read_members on public.cms_posts for select to authenticated
using (exists (select 1 from public.cms_members m where m.user_id = (select auth.uid()) and m.is_active));

drop policy if exists cms_posts_insert_members on public.cms_posts;
create policy cms_posts_insert_members on public.cms_posts for insert to authenticated
with check (exists (select 1 from public.cms_members m where m.user_id = (select auth.uid()) and m.is_active) and created_by = (select auth.uid()));

drop policy if exists cms_posts_update_roles on public.cms_posts;
create policy cms_posts_update_roles on public.cms_posts for update to authenticated
using (exists (select 1 from public.cms_members m where m.user_id = (select auth.uid()) and m.is_active and (m.role in ('owner','admin','editor') or public.cms_posts.created_by = (select auth.uid()))))
with check (exists (select 1 from public.cms_members m where m.user_id = (select auth.uid()) and m.is_active and (m.role in ('owner','admin','editor') or public.cms_posts.created_by = (select auth.uid()))) and updated_by = (select auth.uid()));

drop policy if exists cms_posts_delete_roles on public.cms_posts;
create policy cms_posts_delete_roles on public.cms_posts for delete to authenticated
using (exists (select 1 from public.cms_members m where m.user_id = (select auth.uid()) and m.is_active and (m.role in ('owner','admin','editor') or (m.role='author' and public.cms_posts.created_by=(select auth.uid()) and public.cms_posts.status='draft'))));

drop policy if exists cms_pages_read_members on public.cms_pages;
create policy cms_pages_read_members on public.cms_pages for select to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active));

drop policy if exists cms_pages_manage_editors on public.cms_pages;
create policy cms_pages_manage_editors on public.cms_pages for all to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin','editor')))
with check (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin','editor')));

drop policy if exists cms_settings_read_members on public.cms_settings;
create policy cms_settings_read_members on public.cms_settings for select to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active));

drop policy if exists cms_settings_manage_admins on public.cms_settings;
create policy cms_settings_manage_admins on public.cms_settings for all to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')))
with check (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')));

drop policy if exists cms_redirects_read_members on public.cms_redirects;
create policy cms_redirects_read_members on public.cms_redirects for select to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active));

drop policy if exists cms_redirects_manage_editors on public.cms_redirects;
create policy cms_redirects_manage_editors on public.cms_redirects for all to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin','editor')))
with check (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin','editor')));

drop policy if exists cms_media_read_members on public.cms_media;
create policy cms_media_read_members on public.cms_media for select to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active));

drop policy if exists cms_media_insert_members on public.cms_media;
create policy cms_media_insert_members on public.cms_media for insert to authenticated
with check (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active) and uploaded_by=(select auth.uid()));

drop policy if exists cms_media_delete_roles on public.cms_media;
create policy cms_media_delete_roles on public.cms_media for delete to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and (m.role in ('owner','admin','editor') or public.cms_media.uploaded_by=(select auth.uid()))));

drop policy if exists cms_audit_read_admins on public.cms_audit_log;
create policy cms_audit_read_admins on public.cms_audit_log for select to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')));

drop policy if exists cms_audit_insert_members on public.cms_audit_log;
create policy cms_audit_insert_members on public.cms_audit_log for insert to authenticated
with check (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active) and user_id=(select auth.uid()));
