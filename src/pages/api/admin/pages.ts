import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { getManagedPages, MANAGED_PAGE_KEYS, saveManagedPages, type ManagedPages } from '../../../lib/managed-pages';
import { safePublicUrl, text } from '../../../lib/security';

export const prerender = false;

function cleanPages(input: any): ManagedPages {
  const out: Record<string, any> = {};
  for (const key of MANAGED_PAGE_KEYS) {
    const page = input?.[key] || {};
    const title = text(page.title, 120);
    const description = text(page.description, 320);
    const kicker = text(page.kicker, 80);
    const body = String(page.body || '').trim().slice(0, 50000);
    const seoTitle = text(page.seoTitle, 180);
    const canonicalRaw = text(page.canonical, 500);
    const canonical = canonicalRaw ? safePublicUrl(canonicalRaw) : '';
    const ogRaw = text(page.ogImage, 500);
    const ogImage = ogRaw ? safePublicUrl(ogRaw, true) : '';
    if (canonicalRaw && !canonical) throw new Error(`Canonical URL is invalid for ${key}.`);
    if (ogRaw && !ogImage) throw new Error(`Social image URL is invalid for ${key}.`);
    if (!title || !description || !body) throw new Error(`Title, description and body are required for ${key}.`);
    out[key] = { title, description, kicker, body, seoTitle, canonical, ogImage, noindex: Boolean(page.noindex) };
  }
  return out as ManagedPages;
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const pages = await getManagedPages();
    return Response.json({ pages, sha: 'd1', storage: 'd1', role: auth.role }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load pages.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin', 'editor']);
  if (!auth.ok) return authError(auth);
  try {
    const { pages } = await request.json();
    const clean = cleanPages(pages);
    const updatedAt = await saveManagedPages(clean, auth.username);
    return Response.json({ ok: true, storage: 'd1', updatedAt, sha: String(updatedAt), commit: null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update pages.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};
