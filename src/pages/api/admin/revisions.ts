import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { getDbPost, getDbRevision, listDbRevisions, saveDbPost, saveDbRevision } from '../../../lib/db-posts';
import { slugify } from '../../../lib/posts';

export const prerender = false;

function cleanSlug(value: unknown) {
  const slug = slugify(String(value || ''));
  if (!slug) throw new Error('Invalid slug.');
  return slug;
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);

  try {
    const slug = cleanSlug(new URL(request.url).searchParams.get('slug'));
    const rows = await listDbRevisions(slug, 30);
    const revisions = rows.map((row) => ({
      id: row.id,
      sha: String(row.id),
      message: `${row.status[0].toUpperCase() + row.status.slice(1)} revision`,
      author: row.savedBy || 'CMS user',
      date: new Date(row.savedAt * 1000).toISOString(),
      status: row.status,
      storage: 'd1',
    }));

    return Response.json({ slug, revisions, storage: 'd1' }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load revisions.' }, {
      status: 400,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin', 'editor']);
  if (!auth.ok) return authError(auth);

  try {
    const body = await request.json();
    const slug = cleanSlug(body.slug);
    const revisionId = Number.parseInt(String(body.revisionId ?? body.sha ?? ''), 10);
    if (!Number.isSafeInteger(revisionId) || revisionId <= 0) throw new Error('Invalid revision.');

    const [historic, current] = await Promise.all([
      getDbRevision(slug, revisionId),
      getDbPost(slug),
    ]);
    if (!historic) throw new Error('Revision was not found.');
    if (!current) throw new Error('Current article was not found.');

    await saveDbRevision(slug, current, auth.username);
    await saveDbPost({ ...historic, slug, originalSlug: undefined, sha: undefined });

    return Response.json({ ok: true, slug, revisionId, storage: 'd1' });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to restore revision.' }, {
      status: 400,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
};
