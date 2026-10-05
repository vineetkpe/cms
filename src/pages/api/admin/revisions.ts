import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { addDbPostRevision, getDbPost, getDbPostRevision, listDbPostRevisions, restoreDbPostRevision } from '../../../lib/db-posts';
import type { AdminPost } from '../../../lib/markdown';
import { slugify } from '../../../lib/posts';

export const prerender = false;

function cleanSlug(value: unknown) {
  const slug = slugify(String(value || ''));
  if (!slug) throw new Error('Invalid slug.');
  return slug;
}

function ownedBy(post: AdminPost | null | undefined, displayName: string) {
  return Boolean(post) && String(post?.author || '').trim().toLowerCase() === displayName.trim().toLowerCase();
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const slug = cleanSlug(new URL(request.url).searchParams.get('slug'));
    const current = await getDbPost(slug);
    if (auth.role === 'author' && !ownedBy(current, auth.displayName)) {
      return Response.json({ error: 'Authors can only view revisions for their own articles.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }

    const rows = await listDbPostRevisions(slug, 30);
    const revisions = rows.map((row) => {
      let title = slug;
      try { title = String((JSON.parse(row.payload_json) as AdminPost).title || slug); } catch { /* keep slug */ }
      return {
        sha: String(row.id),
        message: `${row.status === 'draft' ? 'Draft saved' : row.status === 'scheduled' ? 'Scheduled' : 'Published'}: ${title}`,
        author: row.saved_by,
        date: new Date(row.saved_at * 1000).toISOString(),
        url: '',
      };
    });
    return Response.json({ slug, revisions, storage: 'd1' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load revisions.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin', 'editor', 'author']);
  if (!auth.ok) return authError(auth);
  try {
    const body = await request.json();
    const slug = cleanSlug(body.slug);
    const revisionId = Number(body.sha);
    if (!Number.isInteger(revisionId) || revisionId <= 0) throw new Error('Invalid revision.');

    const revision = await getDbPostRevision(revisionId);
    if (!revision || revision.slug !== slug) throw new Error('Revision was not found for this article.');
    let revisionPost: AdminPost;
    try { revisionPost = JSON.parse(revision.payload_json) as AdminPost; } catch { throw new Error('Revision data is invalid.'); }
    if (auth.role === 'author' && !ownedBy(revisionPost, auth.displayName)) {
      return Response.json({ error: 'Authors can only restore their own article revisions.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }

    const restored = await restoreDbPostRevision(revisionId);
    if (!restored) throw new Error('Revision was not found.');
    await addDbPostRevision(restored, auth.displayName);
    return Response.json({ ok: true, storage: 'd1' });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to restore revision.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};
