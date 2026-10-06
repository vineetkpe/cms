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

function db(): D1Binding {
  const binding = (env as any).DB as D1Binding | undefined;
  if (!binding) throw new Error('DB is not configured.');
  return binding;
}

export function getPostStatus(post: AdminPost, now = Date.now()): CmsPostStatus {
  if (post.draft) return 'draft';
  const publishAt = post.publishAt ? Date.parse(post.publishAt) : Date.parse(`${post.pubDate}T00:00:00Z`);
  return Number.isFinite(publishAt) && publishAt > now ? 'scheduled' : 'published';
}

function parseRow(row: PostRow): AdminPost {
  const post = JSON.parse(row.payload_json) as AdminPost;
  return { ...post, slug: row.slug, draft: row.status === 'draft', sha: undefined };
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

export async function saveDbPost(post: AdminPost) {
  const status = getPostStatus(post);
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ ...post, draft: status === 'draft', sha: undefined });
  await db().prepare(`INSERT INTO cms_posts
    (slug, title, author, status, pub_date, publish_at, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      status = excluded.status,
      pub_date = excluded.pub_date,
      publish_at = excluded.publish_at,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at`)
    .bind(post.slug, post.title, post.author, status, post.pubDate, post.publishAt || null, payload, now, now)
    .run();
  return status;
}

export async function deleteDbPost(slug: string) {
  const existing = await getDbPost(slug);
  if (!existing) return false;
  await db().prepare('DELETE FROM cms_posts WHERE slug = ?').bind(slug).run();
  return true;
}

export async function moveDbPost(oldSlug: string, post: AdminPost) {
  if (oldSlug && oldSlug !== post.slug) {
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
  const safeLimit = Math.max(1, Math.min(50, Math.round(limit || 30)));
  const result = await db()
    .prepare(`SELECT id, slug, saved_at, saved_by, status, payload_json
      FROM cms_post_revisions
      WHERE slug = ?
      ORDER BY saved_at DESC, id DESC
      LIMIT ?`)
    .bind(slug, safeLimit)
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
  return { triggered: slugs.length, slugs };
}
