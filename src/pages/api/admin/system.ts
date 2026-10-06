import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authError, requireAdmin } from '../../../lib/auth';
import { listDirectory } from '../../../lib/github';

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
        (SELECT COUNT(*) FROM cms_templates) AS templates`).first();
      checks.push({
        key: 'd1',
        label: 'D1 content database',
        status: 'ok',
        detail: `Connected · ${Number(row?.posts || 0)} posts · ${Number(row?.pages || 0)} pages · ${Number(row?.templates || 0)} templates.`,
      });
    } catch {
      checks.push({ key: 'd1', label: 'D1 content database', status: 'error', detail: 'D1 is bound, but the CMS tables check failed.' });
    }
  } else {
    checks.push({ key: 'd1', label: 'D1 content database', status: 'error', detail: 'DB binding is missing.' });
  }

  checks.push({
    key: 'kv',
    label: 'KV cache',
    status: e.CMS_KV ? 'ok' : 'warning',
    detail: e.CMS_KV ? 'CMS_KV binding is connected.' : 'CMS_KV binding is missing.',
  });

  const hasGithubToken = Boolean(String(e.CMS_GITHUB_TOKEN || '').trim());
  if (!hasGithubToken) {
    checks.push({
      key: 'media',
      label: 'Temporary media storage',
      status: 'warning',
      detail: 'Publishing works without GitHub. Media uploads remain unavailable until the temporary GitHub token is restored or R2 is enabled.',
    });
  } else {
    try {
      await listDirectory('public/uploads');
      checks.push({
        key: 'media',
        label: 'Temporary media storage',
        status: 'ok',
        detail: 'GitHub-backed media is reachable. This will be replaced by R2 later.',
      });
    } catch {
      checks.push({
        key: 'media',
        label: 'Temporary media storage',
        status: 'warning',
        detail: 'Publishing is unaffected, but the temporary GitHub-backed media library could not be reached.',
      });
    }
  }

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
    detail: e.DB ? 'Worker cron and D1 publishing are configured; GitHub is not required.' : 'Scheduled publishing requires the D1 binding.',
  });

  checks.push({
    key: 'login-protection',
    label: 'Login protection',
    status: e.DB ? 'ok' : 'error',
    detail: e.DB ? 'Failed sign-in throttling is persisted in D1.' : 'Persistent sign-in throttling is unavailable without D1.',
  });

  return Response.json({ checks, generatedAt: new Date().toISOString() }, {
    headers: { 'Cache-Control': 'no-store' }
  });
};
