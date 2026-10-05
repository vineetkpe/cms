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
      const posts = await e.DB.prepare('SELECT COUNT(*) AS count FROM cms_posts').first();
      const revisions = await e.DB.prepare('SELECT COUNT(*) AS count FROM cms_post_revisions').first();
      checks.push({ key: 'd1', label: 'D1 content database', status: 'ok', detail: `Connected · ${Number(posts?.count || 0)} post(s), ${Number(revisions?.count || 0)} revision(s).` });
    } catch (error) {
      checks.push({ key: 'd1', label: 'D1 content database', status: 'error', detail: error instanceof Error ? error.message : 'D1 schema check failed.' });
    }
  } else checks.push({ key: 'd1', label: 'D1 content database', status: 'error', detail: 'DB binding is missing.' });

  if (e.CMS_KV) {
    try {
      await e.CMS_KV.get('cms:site');
      checks.push({ key: 'kv', label: 'KV settings & media', status: 'ok', detail: 'CMS_KV is connected for settings, pages, templates, redirects and media.' });
    } catch (error) {
      checks.push({ key: 'kv', label: 'KV settings & media', status: 'error', detail: error instanceof Error ? error.message : 'KV access failed.' });
    }
  } else checks.push({ key: 'kv', label: 'KV settings & media', status: 'error', detail: 'CMS_KV binding is missing.' });

  checks.push({ key: 'publishing', label: 'Publishing storage', status: e.DB ? 'ok' : 'error', detail: e.DB ? 'Posts publish directly to D1. No GitHub write token is required.' : 'Publishing requires the DB binding.' });
  checks.push({ key: 'scheduler', label: 'Scheduled publishing', status: e.DB ? 'ok' : 'error', detail: e.DB ? 'Cron publishes scheduled D1 posts every 5 minutes.' : 'Scheduling requires the DB binding.' });
  checks.push({ key: 'workers-ai', label: 'Workers AI', status: e.AI ? 'ok' : 'warning', detail: e.AI ? 'AI binding is available for trend/content fallback.' : 'AI binding is not configured.' });
  checks.push({ key: 'gemini', label: 'Gemini API', status: String(e.GEMINI_API_KEY || '').trim() ? 'ok' : 'warning', detail: String(e.GEMINI_API_KEY || '').trim() ? 'GEMINI_API_KEY is configured.' : 'Gemini key is not configured; the editor uses Workers AI fallback.' });
  checks.push({ key: 'trends', label: 'Google Trends', status: 'ok', detail: 'Live RSS trend discovery is enabled; no private API key is required.' });

  return Response.json({ checks, generatedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
};
