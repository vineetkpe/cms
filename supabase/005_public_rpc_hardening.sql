-- Harden public interaction RPCs so rate-limit identity is derived server-side.

create or replace function public.cms_request_fingerprint()
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  h json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  raw text;
begin
  raw := coalesce(
    nullif(h->>'cf-connecting-ip',''),
    nullif(h->>'x-real-ip',''),
    nullif(split_part(coalesce(h->>'x-forwarded-for',''), ',', 1),''),
    'unknown|' || coalesce(h->>'user-agent','unknown')
  );
  return md5(raw) || md5('cms|' || raw);
end;
$$;
revoke all on function public.cms_request_fingerprint() from public, anon, authenticated;

drop function if exists public.cms_submit_comment(text,text,text,text,uuid,text,text);
drop function if exists public.cms_submit_contact(text,text,text,text,text,text);

create or replace function public.cms_submit_comment(
  p_post_slug text,
  p_author_name text,
  p_author_email text,
  p_body text,
  p_parent_id uuid,
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
  v_fingerprint text := public.cms_request_fingerprint();
begin
  if coalesce(btrim(p_honeypot),'') <> '' then raise exception 'Unable to submit comment.'; end if;
  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'Invalid article.'; end if;
  if char_length(v_name) not between 2 and 80 then raise exception 'Name must be 2 to 80 characters.'; end if;
  if char_length(v_email) not between 3 and 254 or position('@' in v_email) < 2 then raise exception 'Enter a valid email address.'; end if;
  if char_length(v_body) not between 2 and 3000 then raise exception 'Comment must be 2 to 3000 characters.'; end if;

  perform public.cms_consume_public_rate_limit(v_fingerprint, 'comment', 8);

  if p_parent_id is not null and not exists (
    select 1 from public.cms_comments c where c.id=p_parent_id and c.post_slug=v_slug and c.status='approved'
  ) then raise exception 'Invalid parent comment.'; end if;

  insert into public.cms_comments(post_slug,parent_id,author_name,author_email,body,status,fingerprint)
  values (v_slug,p_parent_id,v_name,v_email,v_body,'pending',v_fingerprint)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.cms_submit_comment(text,text,text,text,uuid,text) from public, authenticated;
grant execute on function public.cms_submit_comment(text,text,text,text,uuid,text) to anon;

create or replace function public.cms_submit_contact(
  p_name text,
  p_email text,
  p_subject text,
  p_message text,
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
  v_fingerprint text := public.cms_request_fingerprint();
begin
  if coalesce(btrim(p_honeypot),'') <> '' then raise exception 'Unable to submit form.'; end if;
  if char_length(v_name) not between 2 and 100 then raise exception 'Name must be 2 to 100 characters.'; end if;
  if char_length(v_email) not between 3 and 254 or position('@' in v_email) < 2 then raise exception 'Enter a valid email address.'; end if;
  if char_length(v_subject) not between 2 and 160 then raise exception 'Subject must be 2 to 160 characters.'; end if;
  if char_length(v_message) not between 5 and 5000 then raise exception 'Message must be 5 to 5000 characters.'; end if;

  perform public.cms_consume_public_rate_limit(v_fingerprint, 'contact', 3);

  insert into public.cms_contact_submissions(name,email,subject,message,status,fingerprint)
  values (v_name,v_email,v_subject,v_message,'new',v_fingerprint)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.cms_submit_contact(text,text,text,text,text) from public, authenticated;
grant execute on function public.cms_submit_contact(text,text,text,text,text) to anon;

-- Anonymous readers may only see approved, non-sensitive comment fields.
grant select (id,parent_id,post_slug,author_name,body,status,created_at) on public.cms_comments to anon;
drop policy if exists cms_comments_public_approved on public.cms_comments;
create policy cms_comments_public_approved on public.cms_comments for select to anon using (status='approved');

create or replace function public.cms_public_comments(p_post_slug text)
returns table(id uuid, parent_id uuid, author_name text, body text, created_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.parent_id, c.author_name, c.body, c.created_at
  from public.cms_comments c
  where c.post_slug = lower(btrim(p_post_slug)) and c.status='approved'
  order by c.created_at asc
  limit 200;
$$;
revoke all on function public.cms_public_comments(text) from public, authenticated;
grant execute on function public.cms_public_comments(text) to anon;

-- Explicit no-access RLS policy documents that the rate-limit table is internal-only.
drop policy if exists cms_public_rate_limits_no_access on public.cms_public_rate_limits;
create policy cms_public_rate_limits_no_access on public.cms_public_rate_limits
for all to anon, authenticated using (false) with check (false);
