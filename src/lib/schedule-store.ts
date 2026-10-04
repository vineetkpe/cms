import { env } from 'cloudflare:workers';

export type ScheduledPost = {
  slug: string;
  publishAt: string;
  queuedAt: number;
};

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
};

type D1Binding = { prepare(query: string): D1Statement };

function db(): D1Binding {
  const binding = (env as any).DB as D1Binding | undefined;
  if (!binding) throw new Error('DB is not configured.');
  return binding;
}

export async function upsertScheduledPost(slug: string, publishAt: string) {
  const ts = Date.parse(publishAt);
  if (!Number.isFinite(ts)) throw new Error('Publish time is invalid.');
  await db().prepare(`INSERT INTO cms_schedules (slug, publish_at, queued_at, triggered_at)
    VALUES (?, ?, ?, NULL)
    ON CONFLICT(slug) DO UPDATE SET publish_at = excluded.publish_at, queued_at = excluded.queued_at, triggered_at = NULL`)
    .bind(slug, publishAt, Math.floor(Date.now() / 1000)).run();
}

export async function removeScheduledPost(slug: string) {
  await db().prepare('DELETE FROM cms_schedules WHERE slug = ?').bind(slug).run();
}

export async function listDueScheduledPosts(now = Date.now(), limit = 20) {
  const iso = new Date(now).toISOString();
  const result = await db().prepare(`SELECT slug, publish_at, queued_at
    FROM cms_schedules
    WHERE triggered_at IS NULL AND publish_at <= ?
    ORDER BY publish_at ASC
    LIMIT ?`).bind(iso, Math.max(1, Math.min(100, limit))).all<any>();
  return (result.results || []).map((row) => ({
    slug: String(row.slug),
    publishAt: String(row.publish_at),
    queuedAt: Number(row.queued_at || 0),
  })) as ScheduledPost[];
}

export async function markSchedulesTriggered(slugs: string[]) {
  if (!slugs.length) return;
  const now = Math.floor(Date.now() / 1000);
  for (const slug of slugs.slice(0, 100)) {
    await db().prepare('UPDATE cms_schedules SET triggered_at = ? WHERE slug = ?').bind(now, slug).run();
  }
}
