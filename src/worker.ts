import { handle } from '@astrojs/cloudflare/handler';
import { runScheduledPublishing } from './lib/scheduler';

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const response = await handle(request, env as any, ctx as any);
    const url = new URL(request.url);
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
