import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { deleteFile, getTextFile, listDirectory, putTextFile } from '../../../lib/github';
import { parseMarkdown, toMarkdown, type AdminPost } from '../../../lib/markdown';
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

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const entries = await listDirectory(DIR);
    const files = Array.isArray(entries) ? entries.filter((item) => item.type === 'file' && item.name.endsWith('.md')) : [];
    const posts = await Promise.all(files.map(async (item) => {
      const file = await getTextFile(`${DIR}/${item.name}`);
      return parseMarkdown(file.text, item.name.replace(/\.md$/, ''), file.sha);
    }));
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
    const path = `${DIR}/${post.slug}.md`;
    let existingSha = post.sha;
    if (!existingSha) {
      try { existingSha = (await getTextFile(path)).sha; } catch { /* new file */ }
    }
    const result = await putTextFile(path, toMarkdown(post), `${post.draft ? 'Save draft' : 'Publish'}: ${post.title}`, existingSha);

    if (post.originalSlug && post.originalSlug !== post.slug) {
      try {
        const oldPath = `${DIR}/${post.originalSlug}.md`;
        const oldFile = await getTextFile(oldPath);
        await deleteFile(oldPath, oldFile.sha, `Move article: ${post.originalSlug} -> ${post.slug}`);
      } catch { /* old file may already be absent */ }
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
    const path = `${DIR}/${slug}.md`;
    const file = await getTextFile(path);
    await deleteFile(path, file.sha, `Delete article: ${slug}`);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete post.' }, { status: 400 });
  }
};
