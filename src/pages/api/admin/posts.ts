import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { deleteFile, getTextFile, listDirectory, putTextFile } from '../../../lib/github';
import { parseMarkdown, toMarkdown, type AdminPost } from '../../../lib/markdown';
import { decryptDraft, draftPath, DRAFT_DIR, encryptDraft } from '../../../lib/drafts';
import { slugify } from '../../../lib/posts';

export const prerender = false;
const DIR = 'src/content/posts';

function cleanPost(input: Partial<AdminPost>): AdminPost {
  const slug = slugify(String(input.slug || input.title || ''));
  if (!slug) throw new Error('A valid slug is required.');
  if (!String(input.title || '').trim()) throw new Error('Title is required.');
  if (!String(input.description || '').trim()) throw new Error('Description is required.');
  if (!String(input.body || '').trim()) throw new Error('Article body is required.');
  const canonical = String(input.canonical || '').trim();
  if (canonical) new URL(canonical);
  return {
    slug,
    originalSlug: input.originalSlug ? slugify(String(input.originalSlug)) : undefined,
    title: String(input.title).trim().slice(0, 180),
    description: String(input.description).trim().slice(0, 320),
    category: String(input.category || 'Guides').trim().slice(0, 80),
    tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20) : [],
    author: String(input.author || 'Editorial Team').trim().slice(0, 100),
    pubDate: String(input.pubDate || new Date().toISOString().slice(0, 10)),
    updatedDate: input.updatedDate ? String(input.updatedDate) : undefined,
    featuredImage: input.featuredImage ? String(input.featuredImage).trim() : undefined,
    featuredImageAlt: input.featuredImageAlt ? String(input.featuredImageAlt).trim().slice(0, 180) : undefined,
    seoTitle: input.seoTitle ? String(input.seoTitle).trim().slice(0, 180) : undefined,
    seoDescription: input.seoDescription ? String(input.seoDescription).trim().slice(0, 320) : undefined,
    canonical: canonical || undefined,
    draft: Boolean(input.draft),
    noindex: Boolean(input.noindex),
    body: String(input.body),
    sha: input.sha ? String(input.sha) : undefined
  };
}

async function tryDelete(path: string, message: string) {
  try {
    const file = await getTextFile(path);
    await deleteFile(path, file.sha, message);
    return true;
  } catch {
    return false;
  }
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const entries = await listDirectory(DIR);
    const files = Array.isArray(entries) ? entries.filter((item) => item.type === 'file' && item.name.endsWith('.md')) : [];
    const published = await Promise.all(files.map(async (item) => {
      const file = await getTextFile(`${DIR}/${item.name}`);
      return parseMarkdown(file.text, item.name.replace(/\.md$/, ''), file.sha);
    }));

    const bySlug = new Map(published.map((post) => [post.slug, post]));
    try {
      const draftEntries = await listDirectory(DRAFT_DIR);
      const draftFiles = Array.isArray(draftEntries) ? draftEntries.filter((item) => item.type === 'file' && item.name.endsWith('.json')) : [];
      for (const item of draftFiles) {
        const file = await getTextFile(`${DRAFT_DIR}/${item.name}`);
        const draft = await decryptDraft(file.text);
        bySlug.set(draft.slug, draft);
      }
    } catch {
      // Draft directory does not exist until the first draft is saved.
    }

    const posts = Array.from(bySlug.values());
    posts.sort((a, b) => String(b.pubDate).localeCompare(String(a.pubDate)));
    return Response.json({ posts, admin: auth.email });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load posts.' }, { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const post = cleanPost(await request.json());

    if (post.draft) {
      const path = await draftPath(post.slug);
      let sha: string | undefined;
      try { sha = (await getTextFile(path)).sha; } catch { /* first save */ }
      const result = await putTextFile(path, await encryptDraft(post), 'Save private CMS draft', sha);
      if (post.originalSlug && post.originalSlug !== post.slug) {
        await tryDelete(await draftPath(post.originalSlug), 'Move private CMS draft');
      }
      return Response.json({ ok: true, slug: post.slug, commit: result?.commit?.sha || null });
    }

    const path = `${DIR}/${post.slug}.md`;
    let existingSha: string | undefined;
    try { existingSha = (await getTextFile(path)).sha; } catch { /* new article */ }
    const result = await putTextFile(path, toMarkdown({ ...post, draft: false }), `Publish: ${post.title}`, existingSha);

    await tryDelete(await draftPath(post.slug), 'Remove published CMS draft');
    if (post.originalSlug && post.originalSlug !== post.slug) {
      await tryDelete(await draftPath(post.originalSlug), 'Remove moved CMS draft');
      await tryDelete(`${DIR}/${post.originalSlug}.md`, `Move article: ${post.originalSlug} -> ${post.slug}`);
    }
    return Response.json({ ok: true, slug: post.slug, commit: result?.commit?.sha || null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to save post.' }, { status: 400 });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const body = await request.json();
    const slug = slugify(String(body.slug || ''));
    if (!slug) throw new Error('Invalid slug.');
    const deletedPublished = await tryDelete(`${DIR}/${slug}.md`, `Delete article: ${slug}`);
    const deletedDraft = await tryDelete(await draftPath(slug), 'Delete private CMS draft');
    if (!deletedPublished && !deletedDraft) throw new Error('Article was not found.');
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete post.' }, { status: 400 });
  }
};
