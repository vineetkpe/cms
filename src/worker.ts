import { handle } from '@astrojs/cloudflare/handler';
import { runScheduledPublishing } from './lib/scheduler';

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};

const MAX_MEDIA_ORIGIN_READS_PER_DAY = 50000;

function shouldCheckRedirect(pathname: string) {
  return !(
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_astro/') ||
    pathname.startsWith('/demo/') ||
    pathname.startsWith('/media/') ||
    pathname.startsWith('/uploads/') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname === '/rss.xml'
  );
}

async function serveMedia(request: Request, env: any, ctx: any, url: URL) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  let objectPath = '';
  try {
    objectPath = decodeURIComponent(url.pathname.slice('/media/'.length));
  } catch {
    return new Response('Not Found', { status: 404 });
  }

  if (!/^[a-z0-9/_-]+\.(webp|avif|jpe?g|png)$/i.test(objectPath) || objectPath.includes('..')) {
    return new Response('Not Found', { status: 404 });
  }

  const cache = (globalThis as any).caches?.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });

  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      if (request.method === 'HEAD') return new Response(null, { status: cached.status, headers: cached.headers });
      return cached;
    }
  }

  const path = `media/${objectPath}`;
  const media = await env.DB
    .prepare('SELECT kv_key, content_type, size FROM cms_media WHERE path = ? LIMIT 1')
    .bind(path)
    .first<{ kv_key: string; content_type: string; size: number }>();

  if (!media) return new Response('Not Found', { status: 404 });

  const day = new Date().toISOString().slice(0, 10);
  const activity = await env.DB
    .prepare('SELECT origin_reads FROM cms_media_activity WHERE day = ? LIMIT 1')
    .bind(day)
    .first<{ origin_reads: number }>();

  if (Number(activity?.origin_reads || 0) >= MAX_MEDIA_ORIGIN_READS_PER_DAY) {
    return new Response('Media temporarily unavailable because the free-tier safety limit was reached.', {
      status: 503,
      headers: { 'Retry-After': '3600', 'Cache-Control': 'no-store' },
    });
  }

  const data = await env.CMS_KV.get(media.kv_key, 'arrayBuffer');
  if (!data) return new Response('Not Found', { status: 404 });

  await env.DB.prepare(`INSERT INTO cms_media_activity (day, origin_reads)
    VALUES (?, 1)
    ON CONFLICT(day) DO UPDATE SET origin_reads = origin_reads + 1`)
    .bind(day)
    .run();

  const headers = new Headers({
    'Content-Type': media.content_type,
    'Content-Length': String(media.size),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });

  const response = new Response(request.method === 'HEAD' ? null : data, { status: 200, headers });
  if (cache && request.method === 'GET') ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request: Request, env: any, ctx: any) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/media/')) {
      try {
        return await serveMedia(request, env, ctx, url);
      } catch {
        return new Response('Media unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && shouldCheckRedirect(url.pathname)) {
      try {
        const db = env.DB as { prepare(query: string): D1Statement } | undefined;
        if (db) {
          const rule = await db
            .prepare('SELECT destination, status FROM cms_redirects WHERE source = ? LIMIT 1')
            .bind(url.pathname)
            .first<{ destination: string; status: number }>();

          if (rule?.destination) {
            const target = new URL(rule.destination, url.origin);
            if (!target.search && url.search) target.search = url.search;
            return Response.redirect(target.toString(), Number(rule.status) || 301);
          }
        }
      } catch {
        // Redirect storage should never make the site unavailable.
      }
    }

    const response = await handle(request, env as any, ctx as any);
    const contentType = response.headers.get('content-type') || '';
    const isAdminHtml = url.pathname.startsWith('/admin/') && contentType.includes('text/html');
    const isLogin = url.pathname === '/admin/login/' || url.pathname === '/admin/login';
    const isPreview = url.pathname === '/admin/preview/' || url.pathname === '/admin/preview';

    if (isAdminHtml && !isLogin && !isPreview) {
      const Rewriter = (globalThis as any).HTMLRewriter;
      if (Rewriter) {
        return new Rewriter()
          .on('head', {
            element(element: any) {
              element.append('<link rel="stylesheet" href="/admin-suite.css"><script src="/admin-suite.js" defer></script>', { html: true });
            },
          })
          .transform(response);
      }
    }

    return response;
  },

  async scheduled(controller: { scheduledTime: number }, _env: unknown, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(runScheduledPublishing(controller.scheduledTime));
  },
};
