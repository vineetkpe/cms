import { handle } from '@astrojs/cloudflare/handler';
import { runScheduledPublishing } from './lib/scheduler';

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    return handle(request, env as any, ctx as any);
  },

  async scheduled(controller: { scheduledTime: number }, _env: unknown, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(runScheduledPublishing(controller.scheduledTime));
  },
};
