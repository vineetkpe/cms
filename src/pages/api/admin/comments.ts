import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { audit, cmsDelete, cmsSelect, cmsUpdate } from '../../../lib/supabase';

export const prerender = false;
const STATUSES = ['pending', 'approved', 'spam', 'trash'] as const;

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner','admin','editor']);
  if (!auth.ok) return authError(auth);
  const url = new URL(request.url);
  const status = String(url.searchParams.get('status') || 'pending');
  const filter = STATUSES.includes(status as any) ? `&status=eq.${encodeURIComponent(status)}` : '';
  try {
    const rows = await cmsSelect(auth.token, 'cms_comments', `select=id,post_slug,parent_id,author_name,author_email,body,status,created_at,moderated_at&order=created_at.desc&limit=100${filter}`);
    return Response.json({ comments: Array.isArray(rows) ? rows : [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load comments.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner','admin','editor']);
  if (!auth.ok) return authError(auth);
  try {
    const { id, status } = await request.json();
    const cleanId = String(id || '');
    const cleanStatus = String(status || '');
    if (!/^[0-9a-f-]{36}$/i.test(cleanId) || !STATUSES.includes(cleanStatus as any)) return Response.json({ error: 'Invalid moderation request.' }, { status: 400 });
    await cmsUpdate(auth.token, 'cms_comments', `id=eq.${encodeURIComponent(cleanId)}`, { status: cleanStatus, moderated_at: new Date().toISOString(), moderated_by: auth.id });
    await audit(auth.token, auth.id, auth.email, 'moderate_comment', 'comment', cleanId, { status: cleanStatus });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to moderate comment.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner','admin','editor']);
  if (!auth.ok) return authError(auth);
  try {
    const id = new URL(request.url).searchParams.get('id') || '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: 'Invalid comment.' }, { status: 400 });
    await cmsDelete(auth.token, 'cms_comments', `id=eq.${encodeURIComponent(id)}`);
    await audit(auth.token, auth.id, auth.email, 'delete_comment', 'comment', id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete comment.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};
