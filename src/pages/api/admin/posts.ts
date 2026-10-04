import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { deleteFile, getTextFile, putTextFile } from '../../../lib/github';
import { toMarkdown, type AdminPost } from '../../../lib/markdown';
import { slugify } from '../../../lib/posts';
import { audit, cmsDelete, cmsInsert, cmsSelect, cmsUpdate } from '../../../lib/supabase';

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
  const pubDate = String(input.pubDate || new Date().toISOString().slice(0, 10));
  if (Number.isNaN(Date.parse(pubDate))) throw new Error('Publish date is invalid.');
  const faq = Array.isArray(input.faq) ? input.faq.slice(0, 20).map((item) => ({
    question: String(item?.question || '').trim().slice(0, 240),
    answer: String(item?.answer || '').trim().slice(0, 1200)
  })).filter((item) => item.question && item.answer) : [];
  return {
    slug,
    originalSlug: input.originalSlug ? slugify(String(input.originalSlug)) : undefined,
    title: String(input.title).trim().slice(0, 180),
    description: String(input.description).trim().slice(0, 320),
    category: String(input.category || 'Guides').trim().slice(0, 80),
    tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20) : [],
    author: String(input.author || 'Editorial Team').trim().slice(0, 100),
    pubDate,
    updatedDate: input.updatedDate ? String(input.updatedDate) : undefined,
    featuredImage: input.featuredImage ? String(input.featuredImage).trim() : undefined,
    featuredImageAlt: input.featuredImageAlt ? String(input.featuredImageAlt).trim().slice(0, 180) : undefined,
    seoTitle: input.seoTitle ? String(input.seoTitle).trim().slice(0, 180) : undefined,
    seoDescription: input.seoDescription ? String(input.seoDescription).trim().slice(0, 320) : undefined,
    canonical: canonical || undefined,
    draft: Boolean(input.draft),
    noindex: Boolean(input.noindex),
    featured: Boolean(input.featured),
    hideAds: Boolean(input.hideAds),
    faq,
    body: String(input.body),
  };
}

function rowToPost(row: any): AdminPost {
  return {
    slug: String(row.slug),
    title: String(row.title),
    description: String(row.description),
    body: String(row.body),
    category: String(row.category || 'Guides'),
    tags: Array.isArray(row.tags) ? row.tags : [],
    author: String(row.author || 'Editorial Team'),
    pubDate: row.published_at ? String(row.published_at).slice(0, 10) : new Date().toISOString().slice(0, 10),
    updatedDate: row.updated_at ? String(row.updated_at).slice(0, 10) : undefined,
    featuredImage: row.featured_image || undefined,
    featuredImageAlt: row.featured_image_alt || undefined,
    seoTitle: row.seo_title || undefined,
    seoDescription: row.seo_description || undefined,
    canonical: row.canonical_url || undefined,
    draft: row.status === 'draft',
    noindex: Boolean(row.noindex),
    featured: Boolean(row.featured),
    hideAds: Boolean(row.hide_ads),
    faq: Array.isArray(row.faq) ? row.faq : [],
  };
}

async function tryDeletePublished(slug: string, message: string) {
  try {
    const path = `${DIR}/${slug}.md`;
    const file = await getTextFile(path);
    await deleteFile(path, file.sha, message);
    return true;
  } catch {
    return false;
  }
}

async function getRow(token: string, slug: string) {
  const rows = await cmsSelect(token, 'cms_posts', `select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const rows = await cmsSelect(auth.token, 'cms_posts', 'select=*&order=updated_at.desc');
    const posts = (Array.isArray(rows) ? rows : []).map(rowToPost);
    return Response.json({ posts, admin: auth.email, role: auth.role }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load posts.' }, { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const post = cleanPost(await request.json());
    const originalSlug = post.originalSlug || post.slug;
    const existing = await getRow(auth.token, originalSlug);
    const future = new Date(`${post.pubDate}T23:59:59Z`).getTime() > Date.now();
    const status = post.draft ? 'draft' : future ? 'scheduled' : 'published';
    const now = new Date().toISOString();
    const row = {
      slug: post.slug,
      title: post.title,
      description: post.description,
      body: post.body,
      category: post.category,
      tags: post.tags,
      author: post.author,
      status,
      published_at: new Date(`${post.pubDate}T00:00:00Z`).toISOString(),
      featured_image: post.featuredImage || null,
      featured_image_alt: post.featuredImageAlt || null,
      seo_title: post.seoTitle || null,
      seo_description: post.seoDescription || null,
      canonical_url: post.canonical || null,
      noindex: post.noindex,
      featured: post.featured,
      hide_ads: post.hideAds,
      faq: post.faq,
      updated_by: auth.id,
      updated_at: now,
    };

    let saved: any;
    if (existing) {
      const rows = await cmsUpdate(auth.token, 'cms_posts', `id=eq.${encodeURIComponent(String(existing.id))}`, row);
      saved = Array.isArray(rows) ? rows[0] : null;
    } else {
      const rows = await cmsInsert(auth.token, 'cms_posts', { ...row, created_by: auth.id, created_at: now });
      saved = Array.isArray(rows) ? rows[0] : null;
    }

    let commit: string | null = null;
    if (!post.draft) {
      const path = `${DIR}/${post.slug}.md`;
      let existingSha: string | undefined;
      try { existingSha = (await getTextFile(path)).sha; } catch { /* new article */ }
      const result = await putTextFile(path, toMarkdown({ ...post, draft: false }), `Publish: ${post.title}`, existingSha);
      commit = result?.commit?.sha || null;
      if (saved?.id && commit) {
        await cmsUpdate(auth.token, 'cms_posts', `id=eq.${encodeURIComponent(String(saved.id))}`, { mirror_commit_sha: commit, updated_by: auth.id, updated_at: now });
      }
      if (post.originalSlug && post.originalSlug !== post.slug) {
        await tryDeletePublished(post.originalSlug, `Move article: ${post.originalSlug} -> ${post.slug}`);
      }
    } else if (post.originalSlug && post.originalSlug !== post.slug) {
      await tryDeletePublished(post.originalSlug, 'Remove old published copy after moving article to draft');
    }

    await audit(auth.token, auth.id, auth.email, existing ? 'update_post' : 'create_post', 'post', post.slug, { status });
    return Response.json({ ok: true, slug: post.slug, status, commit });
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
    const existing = await getRow(auth.token, slug);
    if (!existing) throw new Error('Article was not found.');

    if (existing.status !== 'draft') await tryDeletePublished(slug, `Delete article: ${slug}`);
    const deleted = await cmsDelete(auth.token, 'cms_posts', `id=eq.${encodeURIComponent(String(existing.id))}`);
    if (!Array.isArray(deleted) || deleted.length === 0) throw new Error('Your role does not allow deleting this article.');
    await audit(auth.token, auth.id, auth.email, 'delete_post', 'post', slug);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete post.' }, { status: 400 });
  }
};
