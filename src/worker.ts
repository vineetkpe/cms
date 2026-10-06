import { handle } from '@astrojs/cloudflare/handler';
import { runScheduledPublishing } from './lib/scheduler';

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};

function shouldCheckRedirect(pathname: string) {
  return !(
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_astro/') ||
    pathname.startsWith('/demo/') ||
    pathname.startsWith('/uploads/') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname === '/rss.xml'
  );
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);

    if ((request.method === 'GET' || request.method === 'HEAD') && shouldCheckRedirect(url.pathname)) {
      try {
        const db = (env as any).DB as { prepare(query: string): D1Statement } | undefined;
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
    const isEditor = url.pathname === '/admin/editor/' || url.pathname === '/admin/editor';

    if (isAdminHtml && !isLogin && !isPreview) {
      const Rewriter = (globalThis as any).HTMLRewriter;
      if (Rewriter) {
        return new Rewriter()
          .on('head', {
            element(element: any) {
              element.append('<link rel="stylesheet" href="/admin-suite.css"><script src="/admin-suite.js" defer></script>', { html: true });
            },
          })
          .on('body', {
            element(element: any) {
              if (isEditor) element.append('<script src="/admin-ai.js" defer></script>', { html: true });
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
