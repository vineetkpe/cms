import { handle } from '@astrojs/cloudflare/handler';
import { getMedia, getRedirects } from './lib/cms-store';
import { runScheduledPublishing } from './lib/scheduler';

async function runtimeRedirect(request: Request, url: URL) {
  if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) return null;
  try {
    const redirects = await getRedirects() as Array<{ from?: string; to?: string; status?: number }>;
    const match = redirects.find((item) => String(item?.from || '') === url.pathname);
    if (!match?.to) return null;
    const status = [301, 302, 303, 307, 308].includes(Number(match.status)) ? Number(match.status) : 301;
    const target = new URL(String(match.to), url.origin).toString();
    return Response.redirect(target, status);
  } catch {
    return null;
  }
}

async function runtimeMedia(request: Request, url: URL) {
  if (!['GET', 'HEAD'].includes(request.method.toUpperCase()) || !url.pathname.startsWith('/uploads/')) return null;
  try {
    const { value, metadata } = await getMedia(url.pathname.slice(1));
    if (!value) return null;
    const headers = new Headers({
      'Content-Type': metadata?.type || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    if (metadata?.size) headers.set('Content-Length', String(metadata.size));
    return new Response(request.method === 'HEAD' ? null : value, { status: 200, headers });
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);

    const media = await runtimeMedia(request, url);
    if (media) return media;

    const redirect = await runtimeRedirect(request, url);
    if (redirect) return redirect;

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
