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

async function loadAllPosts() {
  const published: AdminPost[] = [];
  try {
    const entries = await listDirectory(DIR);
    const files = Array.isArray(entries) ? entries.filter((item) => item.type === 'file' && item.name.endsWith('.md')) : [];
    for (const item of files) {
      const file = await getTextFile(`${DIR}/${item.name}`);
      published.push(parseMarkdown(file.text, item.name.replace(/\.md$/, ''), file.sha));
    }
  } catch {
    // Empty repository is valid.
  }

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
    // Draft directory is created on first save.
  }

  return Array.from(bySlug.values());
}

function ownedBy(post: AdminPost | undefined, displayName: string) {
  return !post || String(post.author || '').trim().toLowerCase() === displayName.trim().toLowerCase();
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    let posts = await loadAllPosts();
    if (auth.role === 'author') posts = posts.filter((post) => ownedBy(post, auth.displayName));
    posts.sort((a, b) => String(b.pubDate).localeCompare(String(a.pubDate)));
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
    const allPosts = auth.role === 'author' ? await loadAllPosts() : [];
    const sourceSlug = post.originalSlug || post.slug;

    if (auth.role === 'author') {
      const source = allPosts.find((item) => item.slug === sourceSlug);
      const target = allPosts.find((item) => item.slug === post.slug && item.slug !== sourceSlug);
      if (!ownedBy(source, auth.displayName) || !ownedBy(target, auth.displayName)) {
        return Response.json({ error: 'Authors can only edit their own articles.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
      }
      post.author = auth.displayName;
    }

    const future = new Date(`${post.pubDate}T23:59:59Z`).getTime() > Date.now();
    const status = post.draft ? 'draft' : future ? 'scheduled' : 'published';

    if (post.draft) {
      const path = await draftPath(post.slug);
      let sha: string | undefined;
      try { sha = (await getTextFile(path)).sha; } catch { /* first save */ }
      const result = await putTextFile(path, await encryptDraft(post), `Save CMS draft: ${post.slug}`, sha);
      if (post.originalSlug && post.originalSlug !== post.slug) await tryDelete(await draftPath(post.originalSlug), 'Move private CMS draft');
      return Response.json({ ok: true, slug: post.slug, status, commit: result?.commit?.sha || null });
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
    return Response.json({ ok: true, slug: post.slug, status, commit: result?.commit?.sha || null });
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

    if (auth.role === 'author') {
      const existing = (await loadAllPosts()).find((item) => item.slug === slug);
      if (!existing || !ownedBy(existing, auth.displayName)) {
        return Response.json({ error: 'Authors can only delete their own articles.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
      }
    }

    const deletedPublished = await tryDelete(`${DIR}/${slug}.md`, `Delete article: ${slug}`);
    const deletedDraft = await tryDelete(await draftPath(slug), 'Delete private CMS draft');
    if (!deletedPublished && !deletedDraft) throw new Error('Article was not found.');
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete post.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};
