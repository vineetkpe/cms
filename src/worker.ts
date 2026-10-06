import { handle } from '@astrojs/cloudflare/handler';
import { runScheduledPublishing } from './lib/scheduler';

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/media/')) {
      const bucket = (env as any).MEDIA;
      if (!bucket) return new Response('Media storage is not configured.', { status: 503 });

      let key = '';
      try {
        key = decodeURIComponent(url.pathname.slice('/media/'.length));
      } catch {
        return new Response('Invalid media path.', { status: 400 });
      }
      if (!key || key.includes('..') || key.includes('\\')) return new Response('Invalid media path.', { status: 400 });

      const object = await bucket.get(key);
      if (!object) return new Response('Media not found.', { status: 404 });

      const headers = new Headers();
      if (typeof object.writeHttpMetadata === 'function') object.writeHttpMetadata(headers);
      if (object.httpEtag) headers.set('ETag', object.httpEtag);
      if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('X-Content-Type-Options', 'nosniff');

      if (request.headers.get('If-None-Match') && request.headers.get('If-None-Match') === object.httpEtag) {
        return new Response(null, { status: 304, headers });
      }

      return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
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
