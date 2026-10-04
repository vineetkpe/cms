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

  const hasGithubToken = Boolean(String(e.CMS_GITHUB_TOKEN || '').trim());
  if (!hasGithubToken) checks.push({ key: 'github', label: 'GitHub publishing', status: 'error', detail: 'CMS_GITHUB_TOKEN is missing. Publishing, media and settings writes will fail.' });
  else {
    try {
      await listDirectory('src/content/posts');
      checks.push({ key: 'github', label: 'GitHub publishing', status: 'ok', detail: 'Repository access is working.' });
    } catch (error) {
      checks.push({ key: 'github', label: 'GitHub publishing', status: 'error', detail: error instanceof Error ? error.message : 'Repository access failed.' });
    }
  }

  if (e.DB) {
    try {
      const row = await e.DB.prepare('SELECT COUNT(*) AS count FROM cms_schedules').first();
      checks.push({ key: 'd1', label: 'D1 database', status: 'ok', detail: `Connected · ${Number(row?.count || 0)} scheduled record(s).` });
    } catch {
      checks.push({ key: 'd1', label: 'D1 database', status: 'warning', detail: 'D1 is bound, but the scheduling table check failed.' });
    }
  } else checks.push({ key: 'd1', label: 'D1 database', status: 'error', detail: 'DB binding is missing.' });

  checks.push({ key: 'kv', label: 'KV cache', status: e.CMS_KV ? 'ok' : 'error', detail: e.CMS_KV ? 'CMS_KV binding is connected.' : 'CMS_KV binding is missing.' });
  checks.push({ key: 'workers-ai', label: 'Workers AI', status: e.AI ? 'ok' : 'warning', detail: e.AI ? 'AI binding is available for trend/content fallback.' : 'AI binding is not configured.' });
  checks.push({ key: 'gemini', label: 'Gemini API', status: String(e.GEMINI_API_KEY || '').trim() ? 'ok' : 'warning', detail: String(e.GEMINI_API_KEY || '').trim() ? 'GEMINI_API_KEY is configured.' : 'Gemini key is not configured; the editor uses Workers AI fallback.' });
  checks.push({ key: 'trends', label: 'Google Trends', status: 'ok', detail: 'Live RSS trend discovery is enabled; no private API key is required.' });
  checks.push({ key: 'scheduler', label: 'Scheduled publishing', status: e.DB && hasGithubToken ? 'ok' : 'warning', detail: e.DB && hasGithubToken ? 'Cron + D1 prerequisites are present.' : 'Scheduling needs both D1 and GitHub publishing access.' });

  return Response.json({ checks, generatedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
};
