import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { getTextFile, getTextFileAtRef, listCommitsForPath, putTextFile } from '../../../lib/github';
import { slugify } from '../../../lib/posts';

export const prerender = false;
const DIR = 'src/content/posts';

function postPath(slugInput: unknown) {
  const slug = slugify(String(slugInput || ''));
  if (!slug) throw new Error('Invalid slug.');
  return { slug, path: `${DIR}/${slug}.md` };
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const { slug, path } = postPath(new URL(request.url).searchParams.get('slug'));
    const commits = await listCommitsForPath(path, 30);
    const revisions = Array.isArray(commits) ? commits.map((item: any) => ({
      sha: String(item.sha || ''),
      message: String(item.commit?.message || '').split('\n')[0].slice(0, 180),
      author: String(item.commit?.author?.name || item.author?.login || 'Unknown'),
      date: String(item.commit?.author?.date || ''),
      url: String(item.html_url || ''),
    })).filter((item: any) => item.sha) : [];
    return Response.json({ slug, revisions }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load revisions.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin', 'editor']);
  if (!auth.ok) return authError(auth);
  try {
    const body = await request.json();
    const { slug, path } = postPath(body.slug);
    const revision = String(body.sha || '').trim();
    if (!/^[a-f0-9]{40}$/i.test(revision)) throw new Error('Invalid revision.');

    const historic = await getTextFileAtRef(path, revision);
    const current = await getTextFile(path);
    const result = await putTextFile(path, historic.text, `Restore article revision: ${slug} (${revision.slice(0, 8)})`, current.sha);
    return Response.json({ ok: true, commit: result?.commit?.sha || null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to restore revision.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};
