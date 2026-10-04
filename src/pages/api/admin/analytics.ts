import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authError, requireAdmin } from '../../../lib/auth';

export const prerender = false;

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};

type D1Binding = { prepare(query: string): D1Statement };

function db(): D1Binding {
  const binding = (env as any).DB as D1Binding | undefined;
  if (!binding) throw new Error('DB is not configured.');
  return binding;
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);

  try {
    const today = new Date().toISOString().slice(0, 10);
    const since7 = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const since30 = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

    const [todayRow, sevenRow, thirtyRow, topResult, dailyResult, scheduledResult] = await Promise.all([
      db().prepare('SELECT COALESCE(SUM(views),0) AS views FROM cms_pageviews WHERE day = ?').bind(today).first<any>(),
      db().prepare('SELECT COALESCE(SUM(views),0) AS views FROM cms_pageviews WHERE day >= ?').bind(since7).first<any>(),
      db().prepare('SELECT COALESCE(SUM(views),0) AS views FROM cms_pageviews WHERE day >= ?').bind(since30).first<any>(),
      db().prepare('SELECT slug, SUM(views) AS views FROM cms_pageviews WHERE day >= ? GROUP BY slug ORDER BY views DESC LIMIT 8').bind(since30).all<any>(),
      db().prepare('SELECT day, SUM(views) AS views FROM cms_pageviews WHERE day >= ? GROUP BY day ORDER BY day ASC').bind(since30).all<any>(),
      db().prepare('SELECT slug, publish_at AS publishAt FROM cms_schedules WHERE triggered_at IS NULL ORDER BY publish_at ASC LIMIT 10').all<any>(),
    ]);

    return Response.json({
      views: {
        today: Number(todayRow?.views || 0),
        last7Days: Number(sevenRow?.views || 0),
        last30Days: Number(thirtyRow?.views || 0),
      },
      topPosts: (topResult.results || []).map((row) => ({ slug: String(row.slug), views: Number(row.views || 0) })),
      daily: (dailyResult.results || []).map((row) => ({ day: String(row.day), views: Number(row.views || 0) })),
      scheduled: (scheduledResult.results || []).map((row) => ({ slug: String(row.slug), publishAt: String(row.publishAt) })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load analytics.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
};
