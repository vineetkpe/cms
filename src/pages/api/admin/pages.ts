import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { getTextFile, putTextFile } from '../../../lib/github';
import { safePublicUrl, text } from '../../../lib/security';

export const prerender = false;
const PATH = 'src/data/pages.json';
const KEYS = ['about', 'contact', 'editorialPolicy', 'privacy', 'terms', 'disclaimer'] as const;

function cleanPages(input: any) {
  const out: Record<string, any> = {};
  for (const key of KEYS) {
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
  return out;
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const file = await getTextFile(PATH);
    return Response.json({ pages: JSON.parse(file.text), sha: file.sha, role: auth.role }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load pages.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin', 'editor']);
  if (!auth.ok) return authError(auth);
  try {
    const { pages, sha } = await request.json();
    const clean = cleanPages(pages);
    const result = await putTextFile(PATH, `${JSON.stringify(clean, null, 2)}\n`, 'Update trust and legal pages', String(sha || ''));
    return Response.json({ ok: true, commit: result?.commit?.sha || null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update pages.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};
