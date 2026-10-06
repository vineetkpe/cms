import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { deleteDbPost, getPostStatus, listDbPosts, moveDbPost, saveDbRevision } from '../../../lib/db-posts';
import type { AdminPost } from '../../../lib/markdown';
import { slugify } from '../../../lib/posts';

export const prerender = false;

function cleanPost(input: Partial<AdminPost>): AdminPost {
  const slug = slugify(String(input.slug || input.title || ''));
  if (!slug) throw new Error('A valid slug is required.');
  if (!String(input.title || '').trim()) throw new Error('Title is required.');
  if (!String(input.description || '').trim()) throw new Error('Description is required.');
  if (!String(input.body || '').trim()) throw new Error('Article body is required.');

  const canonical = String(input.canonical || '').trim();
  if (canonical) new URL(canonical);
  const publishAt = input.publishAt ? new Date(String(input.publishAt)).toISOString() : undefined;
  const pubDate = String(input.pubDate || (publishAt ? publishAt.slice(0, 10) : new Date().toISOString().slice(0, 10)));
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
    publishAt,
    updatedDate: input.updatedDate ? String(input.updatedDate) : undefined,
    featuredImage: input.featuredImage ? String(input.featuredImage).trim() : undefined,
    featuredImageAlt: input.featuredImageAlt ? String(input.featuredImageAlt).trim().slice(0, 180) : undefined,
    seoTitle: input.seoTitle ? String(input.seoTitle).trim().slice(0, 180) : undefined,
    seoDescription: input.seoDescription ? String(input.seoDescription).trim().slice(0, 320) : undefined,
    focusKeyword: input.focusKeyword ? String(input.focusKeyword).trim().slice(0, 120) : undefined,
    canonical: canonical || undefined,
    ogTitle: input.ogTitle ? String(input.ogTitle).trim().slice(0, 180) : undefined,
    ogDescription: input.ogDescription ? String(input.ogDescription).trim().slice(0, 320) : undefined,
    ogImage: input.ogImage ? String(input.ogImage).trim().slice(0, 500) : undefined,
    template: input.template ? String(input.template).trim().slice(0, 80) : undefined,
    draft: Boolean(input.draft),
    noindex: Boolean(input.noindex),
    nofollow: Boolean(input.nofollow),
    featured: Boolean(input.featured),
    hideAds: Boolean(input.hideAds),
    faq,
    body: String(input.body),
    sha: undefined
  };
}

function ownedBy(post: AdminPost | undefined | null, displayName: string) {
  return !post || String(post.author || '').trim().toLowerCase() === displayName.trim().toLowerCase();
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    let posts = await listDbPosts();
    if (auth.role === 'author') posts = posts.filter((post) => ownedBy(post, auth.displayName));
    posts.sort((a, b) => String(b.publishAt || b.pubDate).localeCompare(String(a.publishAt || a.pubDate)));
    return Response.json({ posts, admin: auth.username, role: auth.role }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load posts.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const post = cleanPost(await request.json());
    const allPosts = await listDbPosts();
    const sourceSlug = post.originalSlug || post.slug;
    const source = allPosts.find((item) => item.slug === sourceSlug);
    const target = allPosts.find((item) => item.slug === post.slug && item.slug !== sourceSlug);

    if (auth.role === 'author') {
      if (!ownedBy(source, auth.displayName) || !ownedBy(target, auth.displayName)) {
        return Response.json({ error: 'Authors can only edit their own articles.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
      }
      post.author = auth.displayName;
    }

    const status = getPostStatus(post);
    if (source) {
      await saveDbRevision(post.slug, { ...source, slug: post.slug, originalSlug: undefined }, auth.username);
    }
    await moveDbPost(sourceSlug, post);
    return Response.json({ ok: true, slug: post.slug, status, storage: 'd1', commit: null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to save post.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const body = await request.json();
    const slug = slugify(String(body.slug || ''));
    if (!slug) throw new Error('Invalid slug.');

    const existing = (await listDbPosts()).find((item) => item.slug === slug);
    if (auth.role === 'author' && (!existing || !ownedBy(existing, auth.displayName))) {
      return Response.json({ error: 'Authors can only delete their own articles.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }

    const deleted = await deleteDbPost(slug);
    if (!deleted) throw new Error('Article was not found.');
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete post.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};
