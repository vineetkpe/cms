import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { audit, cmsDelete, cmsSelect, cmsUpdate } from '../../../lib/supabase';

export const prerender = false;
const STATUSES = ['new', 'read', 'replied', 'spam', 'archived'] as const;

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner','admin']);
  if (!auth.ok) return authError(auth);
  const url = new URL(request.url);
  const status = String(url.searchParams.get('status') || 'new');
  const filter = STATUSES.includes(status as any) ? `&status=eq.${encodeURIComponent(status)}` : '';
  try {
    const rows = await cmsSelect(auth.token, 'cms_contact_submissions', `select=id,name,email,subject,message,status,created_at,updated_at&order=created_at.desc&limit=100${filter}`);
    return Response.json({ submissions: Array.isArray(rows) ? rows : [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load inbox.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner','admin']);
  if (!auth.ok) return authError(auth);
  try {
    const { id, status } = await request.json();
    const cleanId = String(id || '');
    const cleanStatus = String(status || '');
    if (!/^[0-9a-f-]{36}$/i.test(cleanId) || !STATUSES.includes(cleanStatus as any)) return Response.json({ error: 'Invalid inbox update.' }, { status: 400 });
    await cmsUpdate(auth.token, 'cms_contact_submissions', `id=eq.${encodeURIComponent(cleanId)}`, { status: cleanStatus, handled_by: auth.id, updated_at: new Date().toISOString() });
    await audit(auth.token, auth.id, auth.email, 'update_contact_submission', 'contact', cleanId, { status: cleanStatus });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update inbox item.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner','admin']);
  if (!auth.ok) return authError(auth);
  try {
    const id = new URL(request.url).searchParams.get('id') || '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: 'Invalid inbox item.' }, { status: 400 });
    await cmsDelete(auth.token, 'cms_contact_submissions', `id=eq.${encodeURIComponent(id)}`);
    await audit(auth.token, auth.id, auth.email, 'delete_contact_submission', 'contact', id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete inbox item.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};
