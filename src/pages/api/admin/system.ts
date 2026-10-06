import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authError, requireAdmin } from '../../../lib/auth';

export const prerender = false;

type Check = { key: string; label: string; status: 'ok' | 'warning' | 'error'; detail: string };

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);

  const checks: Check[] = [];
  const e = env as any;

  if (e.DB) {
    try {
      const row = await e.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM cms_posts) AS posts,
        (SELECT COUNT(*) FROM cms_pages) AS pages,
        (SELECT COUNT(*) FROM cms_templates) AS templates,
        (SELECT COUNT(*) FROM cms_media) AS media`).first();
      checks.push({
        key: 'd1',
        label: 'D1 database',
        status: 'ok',
        detail: `Connected · ${Number(row?.posts || 0)} posts · ${Number(row?.pages || 0)} pages · ${Number(row?.templates || 0)} templates · ${Number(row?.media || 0)} media records.`,
      });
    } catch {
      checks.push({ key: 'd1', label: 'D1 database', status: 'error', detail: 'D1 is bound, but the CMS tables check failed.' });
    }
  } else {
    checks.push({ key: 'd1', label: 'D1 database', status: 'error', detail: 'DB binding is missing.' });
  }

  checks.push({
    key: 'media',
    label: 'Free media storage',
    status: e.CMS_KV ? 'ok' : 'error',
    detail: e.CMS_KV
      ? 'Cloudflare KV media storage is connected with a 500 MB CMS safety cap.'
      : 'CMS_KV binding is missing, so media uploads are unavailable.',
  });

  checks.push({
    key: 'workers-ai',
    label: 'Workers AI',
    status: e.AI ? 'ok' : 'warning',
    detail: e.AI ? 'AI binding is available for trend/content fallback.' : 'AI binding is not configured.',
  });

  checks.push({
    key: 'gemini',
    label: 'Gemini API',
    status: String(e.GEMINI_API_KEY || '').trim() ? 'ok' : 'warning',
    detail: String(e.GEMINI_API_KEY || '').trim() ? 'GEMINI_API_KEY is configured.' : 'Gemini key is not configured; the editor uses Workers AI fallback.',
  });

  checks.push({
    key: 'trends',
    label: 'Google Trends',
    status: 'ok',
    detail: 'Live RSS trend discovery is enabled; no private API key is required.',
  });

  checks.push({
    key: 'scheduler',
    label: 'Scheduled publishing',
    status: e.DB ? 'ok' : 'error',
    detail: e.DB ? 'Worker cron and D1 publishing are configured; GitHub is not required.' : 'Scheduled publishing requires D1.',
  });

  checks.push({
    key: 'login-protection',
    label: 'Login protection',
    status: e.DB ? 'ok' : 'error',
    detail: e.DB ? 'Failed sign-in throttling is persisted in D1.' : 'Persistent sign-in throttling is unavailable without D1.',
  });

  return Response.json({ checks, generatedAt: new Date().toISOString() }, {
    headers: { 'Cache-Control': 'no-store' },
  });
};
