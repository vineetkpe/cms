-- CMS RLS/performance cleanup based on Supabase database advisors.

create index if not exists cms_posts_updated_by_idx on public.cms_posts(updated_by);
create index if not exists cms_pages_updated_by_idx on public.cms_pages(updated_by);
create index if not exists cms_settings_updated_by_idx on public.cms_settings(updated_by);
create index if not exists cms_redirects_updated_by_idx on public.cms_redirects(updated_by);
create index if not exists cms_media_uploaded_by_idx on public.cms_media(uploaded_by);
create index if not exists cms_audit_log_user_id_idx on public.cms_audit_log(user_id);

-- Split write policies from SELECT policies so each role/action has a single
-- permissive policy to evaluate.

drop policy if exists cms_pages_manage_editors on public.cms_pages;
drop policy if exists cms_pages_insert_editors on public.cms_pages;
drop policy if exists cms_pages_update_editors on public.cms_pages;
drop policy if exists cms_pages_delete_editors on public.cms_pages;
create policy cms_pages_insert_editors on public.cms_pages for insert to authenticated
with check (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin','editor')));
create policy cms_pages_update_editors on public.cms_pages for update to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin','editor')))
with check (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin','editor')));
create policy cms_pages_delete_editors on public.cms_pages for delete to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin','editor')));

drop policy if exists cms_settings_manage_admins on public.cms_settings;
drop policy if exists cms_settings_insert_admins on public.cms_settings;
drop policy if exists cms_settings_update_admins on public.cms_settings;
drop policy if exists cms_settings_delete_admins on public.cms_settings;
create policy cms_settings_insert_admins on public.cms_settings for insert to authenticated
with check (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')));
create policy cms_settings_update_admins on public.cms_settings for update to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')))
with check (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')));
create policy cms_settings_delete_admins on public.cms_settings for delete to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin')));

drop policy if exists cms_redirects_manage_editors on public.cms_redirects;
drop policy if exists cms_redirects_insert_editors on public.cms_redirects;
drop policy if exists cms_redirects_update_editors on public.cms_redirects;
drop policy if exists cms_redirects_delete_editors on public.cms_redirects;
create policy cms_redirects_insert_editors on public.cms_redirects for insert to authenticated
with check (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin','editor')));
create policy cms_redirects_update_editors on public.cms_redirects for update to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin','editor')))
with check (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin','editor')));
create policy cms_redirects_delete_editors on public.cms_redirects for delete to authenticated
using (exists (select 1 from public.cms_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('owner','admin','editor')));
