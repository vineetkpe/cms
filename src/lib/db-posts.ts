import { env } from 'cloudflare:workers';
import type { AdminPost } from './markdown';

export type CmsPostStatus = 'draft' | 'scheduled' | 'published';

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
};

type D1Binding = { prepare(query: string): D1Statement };

type KVBinding = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

type TaxonomySnapshot = {
  total: number;
  categories: TaxonomyCount[];
  authors: TaxonomyCount[];
  tags: TaxonomyCount[];
};

const TAXONOMY_CACHE_KEY = 'cms:public:taxonomy:v1';
const PUBLIC_CACHE_KEYS = [
  TAXONOMY_CACHE_KEY,
  'cms:public:search-index:v1',
  'cms:public:sitemap:v1',
  'cms:public:rss:v1',
];

type RevisionRow = {
  id: number;
  slug: string;
  saved_at: number;
  saved_by: string;
  status: CmsPostStatus;
  payload_json: string;
};

type PostRow = {
  slug: string;
  payload_json: string;
  status: CmsPostStatus;
};

export type TaxonomyCount = {
  name: string;
  slug: string;
  count: number;
  latest?: string;
};

function db(): D1Binding {
  const binding = (env as any).DB as D1Binding | undefined;
  if (!binding) throw new Error('DB is not configured.');
  return binding;
}

function kv(): KVBinding | null {
  return ((env as any).CMS_KV as KVBinding | undefined) || null;
}

async function invalidatePublicCaches() {
  const binding = kv();
  if (!binding) return;
  await Promise.all(PUBLIC_CACHE_KEYS.map((key) => binding.delete(key).catch(() => {})));
}

async function taxonomySnapshot(): Promise<TaxonomySnapshot> {
  const binding = kv();
  if (binding) {
    const cached = await binding.get(TAXONOMY_CACHE_KEY).catch(() => null);
    if (cached) {
      try { return JSON.parse(cached) as TaxonomySnapshot; } catch {}
    }
  }

  const [totalRow, categoryRows, authorRows, tagRows] = await Promise.all([
    db().prepare("SELECT COUNT(*) AS count FROM cms_posts WHERE status = 'published'").first<{ count: number }>(),
    db().prepare(`SELECT category AS name, category_slug AS slug, COUNT(*) AS count, MAX(sort_at) AS latest
      FROM cms_posts
      WHERE status = 'published' AND category_slug IS NOT NULL AND category_slug <> ''
      GROUP BY category_slug, category
      ORDER BY count DESC, name ASC`).all<{ name: string; slug: string; count: number; latest: string }>(),
    db().prepare(`SELECT author AS name, author_slug AS slug, COUNT(*) AS count, MAX(sort_at) AS latest
      FROM cms_posts
      WHERE status = 'published' AND author_slug IS NOT NULL AND author_slug <> ''
      GROUP BY author_slug, author
      ORDER BY count DESC, name ASC`).all<{ name: string; slug: string; count: number; latest: string }>(),
    db().prepare(`SELECT t.tag AS name, t.tag_slug AS slug, COUNT(*) AS count, MAX(p.sort_at) AS latest
      FROM cms_post_tags t
      JOIN cms_posts p ON p.slug = t.post_slug
      WHERE p.status = 'published'
      GROUP BY t.tag_slug, t.tag
      ORDER BY count DESC, name ASC`).all<{ name: string; slug: string; count: number; latest: string }>(),
  ]);

  const normalize = (rows: Array<{ name: string; slug: string; count: number; latest?: string }>) =>
    rows.map((row) => ({ ...row, count: Number(row.count || 0) }));

  const snapshot: TaxonomySnapshot = {
    total: Number(totalRow?.count || 0),
    categories: normalize(categoryRows.results || []),
    authors: normalize(authorRows.results || []),
    tags: normalize(tagRows.results || []),
  };

  if (binding) await binding.put(TAXONOMY_CACHE_KEY, JSON.stringify(snapshot), { expirationTtl: 3600 }).catch(() => {});
  return snapshot;
}

function indexSlug(value: string) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function sortAt(post: AdminPost) {
  if (post.publishAt) return post.publishAt;
  const value = String(post.pubDate || '');
  return value.includes('T') ? value : `${value}T00:00:00.000Z`;
}

function parseRow(row: PostRow): AdminPost {
  const post = JSON.parse(row.payload_json) as AdminPost;
  return { ...post, slug: row.slug, draft: row.status === 'draft', sha: undefined };
}

function cardPayload(post: AdminPost, status: CmsPostStatus) {
  const words = String(post.body || '').trim().split(/\s+/).filter(Boolean).length;
  return JSON.stringify({
    ...post,
    body: '',
    _readTime: Math.max(1, Math.ceil(words / 220)),
    draft: status === 'draft',
    sha: undefined,
  });
}

function safeLimit(value: number, fallback = 18, max = 100) {
  const n = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(1, Math.min(max, n));
}

function safeOffset(value: number) {
  const n = Number.isFinite(value) ? Math.round(value) : 0;
  return Math.max(0, n);
}

export function getPostStatus(post: AdminPost, now = Date.now()): CmsPostStatus {
  if (post.draft) return 'draft';
  const publishAt = post.publishAt ? Date.parse(post.publishAt) : Date.parse(`${post.pubDate}T00:00:00Z`);
  return Number.isFinite(publishAt) && publishAt > now ? 'scheduled' : 'published';
}

export async function listDbPosts(): Promise<AdminPost[]> {
  const result = await db()
    .prepare('SELECT slug, payload_json, status FROM cms_posts ORDER BY COALESCE(publish_at, pub_date) DESC, updated_at DESC')
    .all<PostRow>();
  return (result.results || []).map(parseRow);
}

export async function getDbPost(slug: string): Promise<AdminPost | null> {
  const row = await db()
    .prepare('SELECT slug, payload_json, status FROM cms_posts WHERE slug = ? LIMIT 1')
    .bind(slug)
    .first<PostRow>();
  return row ? parseRow(row) : null;
}

export async function listPublishedDbPosts(limit = 18, offset = 0): Promise<AdminPost[]> {
  const result = await db()
    .prepare(`SELECT slug, COALESCE(card_json, payload_json) AS payload_json, status
      FROM cms_posts
      WHERE status = 'published'
      ORDER BY sort_at DESC, updated_at DESC
      LIMIT ? OFFSET ?`)
    .bind(safeLimit(limit), safeOffset(offset))
    .all<PostRow>();
  return (result.results || []).map(parseRow);
}

export async function countPublishedDbPosts(): Promise<number> {
  return (await taxonomySnapshot()).total;
}

export async function listPublishedDbCardsAll(): Promise<AdminPost[]> {
  const result = await db()
    .prepare(`SELECT slug, COALESCE(card_json, payload_json) AS payload_json, status
      FROM cms_posts
      WHERE status = 'published'
      ORDER BY sort_at DESC, updated_at DESC`)
    .all<PostRow>();
  return (result.results || []).map(parseRow);
}
export async function getFeaturedDbPost(): Promise<AdminPost | null> {
  const row = await db()
    .prepare(`SELECT slug, COALESCE(card_json, payload_json) AS payload_json, status
      FROM cms_posts
      WHERE status = 'published' AND featured = 1
      ORDER BY sort_at DESC, updated_at DESC
      LIMIT 1`)
    .first<PostRow>();
  return row ? parseRow(row) : null;
}

export async function listPublishedDbPostsByCategory(categorySlug: string, limit = 24, offset = 0): Promise<AdminPost[]> {
  const result = await db()
    .prepare(`SELECT slug, COALESCE(card_json, payload_json) AS payload_json, status
      FROM cms_posts
      WHERE status = 'published' AND category_slug = ?
      ORDER BY sort_at DESC, updated_at DESC
      LIMIT ? OFFSET ?`)
    .bind(categorySlug, safeLimit(limit, 24), safeOffset(offset))
    .all<PostRow>();
  return (result.results || []).map(parseRow);
}

export async function countPublishedDbPostsByCategory(categorySlug: string): Promise<number> {
  return (await taxonomySnapshot()).categories.find((item) => item.slug === categorySlug)?.count || 0;
}
export async function listPublishedDbPostsByAuthor(authorSlug: string, limit = 24, offset = 0): Promise<AdminPost[]> {
  const result = await db()
    .prepare(`SELECT slug, COALESCE(card_json, payload_json) AS payload_json, status
      FROM cms_posts
      WHERE status = 'published' AND author_slug = ?
      ORDER BY sort_at DESC, updated_at DESC
      LIMIT ? OFFSET ?`)
    .bind(authorSlug, safeLimit(limit, 24), safeOffset(offset))
    .all<PostRow>();
  return (result.results || []).map(parseRow);
}

export async function countPublishedDbPostsByAuthor(authorSlug: string): Promise<number> {
  return (await taxonomySnapshot()).authors.find((item) => item.slug === authorSlug)?.count || 0;
}
export async function listPublishedDbPostsByTag(tagSlug: string, limit = 24, offset = 0): Promise<AdminPost[]> {
  const result = await db()
    .prepare(`SELECT p.slug, COALESCE(p.card_json, p.payload_json) AS payload_json, p.status
      FROM cms_post_tags t INDEXED BY idx_cms_post_tags_tag
      JOIN cms_posts p ON p.slug = t.post_slug
      WHERE t.tag_slug = ? AND p.status = 'published'
      ORDER BY p.sort_at DESC, p.updated_at DESC
      LIMIT ? OFFSET ?`)
    .bind(tagSlug, safeLimit(limit, 24), safeOffset(offset))
    .all<PostRow>();
  return (result.results || []).map(parseRow);
}

export async function countPublishedDbPostsByTag(tagSlug: string): Promise<number> {
  return (await taxonomySnapshot()).tags.find((item) => item.slug === tagSlug)?.count || 0;
}
export async function listPublishedDbCategories(): Promise<TaxonomyCount[]> {
  return (await taxonomySnapshot()).categories;
}
export async function listPublishedDbAuthors(): Promise<TaxonomyCount[]> {
  return (await taxonomySnapshot()).authors;
}
export async function listPublishedDbTags(): Promise<TaxonomyCount[]> {
  return (await taxonomySnapshot()).tags;
}
export async function getRelatedDbPosts(post: AdminPost, limit = 3): Promise<AdminPost[]> {
  const wanted = safeLimit(limit, 3, 8);
  const seen = new Map<string, AdminPost>();
  const currentSlug = post.slug;

  if (post.category) {
    const categoryRows = await db()
      .prepare(`SELECT slug, COALESCE(card_json, payload_json) AS payload_json, status
        FROM cms_posts
        WHERE status = 'published' AND category_slug = ? AND slug <> ?
        ORDER BY sort_at DESC, updated_at DESC
        LIMIT ?`)
      .bind(indexSlug(post.category), currentSlug, Math.max(wanted * 2, 6))
      .all<PostRow>();
    for (const row of categoryRows.results || []) seen.set(row.slug, parseRow(row));
  }

  const tagSlugs = [...new Set((post.tags || []).map(indexSlug).filter(Boolean))].slice(0, 8);
  if (seen.size < wanted && tagSlugs.length) {
    const placeholders = tagSlugs.map(() => '?').join(',');
    const tagRows = await db()
      .prepare(`SELECT DISTINCT p.slug, COALESCE(p.card_json, p.payload_json) AS payload_json, p.status
        FROM cms_post_tags t INDEXED BY idx_cms_post_tags_tag
        JOIN cms_posts p ON p.slug = t.post_slug
        WHERE p.status = 'published' AND p.slug <> ? AND t.tag_slug IN (${placeholders})
        ORDER BY p.sort_at DESC, p.updated_at DESC
        LIMIT ?`)
      .bind(currentSlug, ...tagSlugs, Math.max(wanted * 2, 6))
      .all<PostRow>();
    for (const row of tagRows.results || []) if (!seen.has(row.slug)) seen.set(row.slug, parseRow(row));
  }

  if (seen.size < wanted) {
    const latest = await db()
      .prepare(`SELECT slug, COALESCE(card_json, payload_json) AS payload_json, status
        FROM cms_posts
        WHERE status = 'published' AND slug <> ?
        ORDER BY sort_at DESC, updated_at DESC
        LIMIT ?`)
      .bind(currentSlug, wanted)
      .all<PostRow>();
    for (const row of latest.results || []) if (!seen.has(row.slug)) seen.set(row.slug, parseRow(row));
  }

  return [...seen.values()].slice(0, wanted);
}

export async function saveDbPost(post: AdminPost) {
  const status = getPostStatus(post);
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ ...post, draft: status === 'draft', sha: undefined });
  const card = cardPayload(post, status);
  const category = String(post.category || '').trim();
  const categorySlug = indexSlug(category);
  const authorSlug = indexSlug(post.author || '');
  const featured = post.featured ? 1 : 0;
  const publishedSort = sortAt(post);

  await db().prepare(`INSERT INTO cms_posts
    (slug, title, author, status, pub_date, publish_at, payload_json, card_json, created_at, updated_at, category, category_slug, author_slug, featured, sort_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      status = excluded.status,
      pub_date = excluded.pub_date,
      publish_at = excluded.publish_at,
      payload_json = excluded.payload_json,
      card_json = excluded.card_json,
      updated_at = excluded.updated_at,
      category = excluded.category,
      category_slug = excluded.category_slug,
      author_slug = excluded.author_slug,
      featured = excluded.featured,
      sort_at = excluded.sort_at`)
    .bind(post.slug, post.title, post.author, status, post.pubDate, post.publishAt || null, payload, card, now, now, category, categorySlug, authorSlug, featured, publishedSort)
    .run();

  await db().prepare('DELETE FROM cms_post_tags WHERE post_slug = ?').bind(post.slug).run();
  for (const tag of [...new Set(post.tags || [])].slice(0, 30)) {
    const tagSlug = indexSlug(tag);
    if (!tagSlug) continue;
    await db().prepare('INSERT OR IGNORE INTO cms_post_tags (post_slug, tag, tag_slug) VALUES (?, ?, ?)')
      .bind(post.slug, String(tag), tagSlug)
      .run();
  }

  await invalidatePublicCaches();
  return status;
}

export async function deleteDbPost(slug: string) {
  const existing = await getDbPost(slug);
  if (!existing) return false;
  await db().prepare('DELETE FROM cms_post_tags WHERE post_slug = ?').bind(slug).run();
  await db().prepare('DELETE FROM cms_posts WHERE slug = ?').bind(slug).run();
  await invalidatePublicCaches();
  return true;
}

export async function moveDbPost(oldSlug: string, post: AdminPost) {
  if (oldSlug && oldSlug !== post.slug) {
    await db().prepare('DELETE FROM cms_post_tags WHERE post_slug = ?').bind(oldSlug).run();
    await db().prepare('DELETE FROM cms_posts WHERE slug = ?').bind(oldSlug).run();
  }
  return saveDbPost(post);
}

export async function saveDbRevision(slug: string, post: AdminPost, savedBy: string) {
  const cleanSlug = String(slug || post.slug || '').trim();
  if (!cleanSlug) throw new Error('Revision slug is required.');
  const status = getPostStatus(post);
  const payload = JSON.stringify({
    ...post,
    slug: cleanSlug,
    originalSlug: undefined,
    draft: status === 'draft',
    sha: undefined,
  });
  const savedAt = Math.floor(Date.now() / 1000);

  await db().prepare(`INSERT INTO cms_post_revisions (slug, saved_at, saved_by, status, payload_json)
    VALUES (?, ?, ?, ?, ?)`)
    .bind(cleanSlug, savedAt, savedBy, status, payload)
    .run();

  await db().prepare(`DELETE FROM cms_post_revisions
    WHERE slug = ?
      AND id NOT IN (
        SELECT id FROM cms_post_revisions
        WHERE slug = ?
        ORDER BY saved_at DESC, id DESC
        LIMIT 50
      )`)
    .bind(cleanSlug, cleanSlug)
    .run();

  return savedAt;
}

export async function listDbRevisions(slug: string, limit = 30) {
  const safe = Math.max(1, Math.min(50, Math.round(limit || 30)));
  const result = await db()
    .prepare(`SELECT id, slug, saved_at, saved_by, status, payload_json
      FROM cms_post_revisions
      WHERE slug = ?
      ORDER BY saved_at DESC, id DESC
      LIMIT ?`)
    .bind(slug, safe)
    .all<RevisionRow>();

  return (result.results || []).map((row) => ({
    id: row.id,
    slug: row.slug,
    savedAt: row.saved_at,
    savedBy: row.saved_by,
    status: row.status,
  }));
}

export async function getDbRevision(slug: string, id: number): Promise<AdminPost | null> {
  const row = await db()
    .prepare(`SELECT id, slug, saved_at, saved_by, status, payload_json
      FROM cms_post_revisions
      WHERE slug = ? AND id = ?
      LIMIT 1`)
    .bind(slug, id)
    .first<RevisionRow>();

  if (!row) return null;
  const post = JSON.parse(row.payload_json) as AdminPost;
  return {
    ...post,
    slug,
    originalSlug: undefined,
    draft: row.status === 'draft',
    sha: undefined,
  };
}

export async function publishDueDbPosts(now = Date.now()) {
  const iso = new Date(now).toISOString();
  const due = await db()
    .prepare("SELECT slug FROM cms_posts WHERE status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= ? ORDER BY publish_at ASC LIMIT 100")
    .bind(iso)
    .all<{ slug: string }>();
  const slugs = (due.results || []).map((row) => row.slug);
  if (!slugs.length) return { triggered: 0, slugs };

  for (const slug of slugs) {
    await db().prepare("UPDATE cms_posts SET status = 'published', updated_at = ? WHERE slug = ?")
      .bind(Math.floor(now / 1000), slug)
      .run();
  }
  await invalidatePublicCaches();
  return { triggered: slugs.length, slugs };
}
