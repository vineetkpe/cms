import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { getTextFile, putTextFile } from '../../../lib/github';

export const prerender = false;
const PATH = 'src/data/pages.json';
const KEYS = ['about', 'contact', 'editorialPolicy', 'privacy', 'terms', 'disclaimer'] as const;

function cleanPages(input: any) {
  const out: Record<string, { title: string; description: string; kicker: string; body: string }> = {};
  for (const key of KEYS) {
    const page = input?.[key] || {};
    const title = String(page.title || '').trim().slice(0, 120);
    const description = String(page.description || '').trim().slice(0, 320);
    const kicker = String(page.kicker || '').trim().slice(0, 80);
    const body = String(page.body || '').trim().slice(0, 50000);
    if (!title || !description || !body) throw new Error(`Title, description and body are required for ${key}.`);
    out[key] = { title, description, kicker, body };
  }
  return out;
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const file = await getTextFile(PATH);
    return Response.json({ pages: JSON.parse(file.text), sha: file.sha });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load pages.' }, { status: 500 });
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const { pages, sha } = await request.json();
    const clean = cleanPages(pages);
    const result = await putTextFile(PATH, `${JSON.stringify(clean, null, 2)}\n`, 'Update trust and legal pages', String(sha || ''));
    return Response.json({ ok: true, commit: result?.commit?.sha || null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update pages.' }, { status: 400 });
  }
};
