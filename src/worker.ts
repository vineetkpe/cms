import { handle } from '@astrojs/cloudflare/handler';
import { runScheduledPublishing } from './lib/scheduler';

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const response = await handle(request, env as any, ctx as any);
    const url = new URL(request.url);
    const contentType = response.headers.get('content-type') || '';

    if ((url.pathname === '/admin/editor/' || url.pathname === '/admin/editor') && contentType.includes('text/html')) {
      return new HTMLRewriter()
        .on('body', {
          element(element) {
            element.append('<script src="/admin-ai.js" defer></script>', { html: true });
          },
        })
        .transform(response);
    }

    return response;
  },

  async scheduled(controller: { scheduledTime: number }, _env: unknown, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(runScheduledPublishing(controller.scheduledTime));
  },
};
