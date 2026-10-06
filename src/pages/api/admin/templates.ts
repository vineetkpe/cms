import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { listTemplates, saveTemplates, type PostTemplate } from '../../../lib/content-config';
import { slugify } from '../../../lib/posts';

export const prerender = false;

function cleanTemplates(input: unknown): PostTemplate[] {
  if (!Array.isArray(input)) throw new Error('Templates must be an array.');

  const templates = input.slice(0, 20).map((item: any) => {
    const id = slugify(String(item?.id || item?.name || ''));
    const name = String(item?.name || '').trim().slice(0, 100);
    const description = String(item?.description || '').trim().slice(0, 240);
    const body = String(item?.body || '').trim().slice(0, 50000);
    if (!id || !name || !body) throw new Error('Every template needs an id, name and body.');
    return { id, name, description, body };
  });

  const ids = new Set<string>();
  for (const template of templates) {
    if (ids.has(template.id)) throw new Error(`Duplicate template id: ${template.id}`);
    ids.add(template.id);
  }

  return templates;
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);

  try {
    return Response.json({ templates: await listTemplates(), sha: 'd1', storage: 'd1', role: auth.role }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load templates.' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin', 'editor']);
  if (!auth.ok) return authError(auth);

  try {
    const { templates } = await request.json();
    const clean = cleanTemplates(templates);
    const updatedAt = await saveTemplates(clean, auth.username);
    return Response.json({ ok: true, storage: 'd1', updatedAt, sha: String(updatedAt), commit: null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update templates.' }, {
      status: 400,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
};
