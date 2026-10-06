import type { APIRoute } from 'astro';
import { getSiteSettings } from '../lib/site-settings';

export const prerender = false;

export const GET: APIRoute = async () => {
  const site = await getSiteSettings();
  const publisher = String(site.adsensePublisherId || '').trim();
  const body = /^ca-pub-\d+$/i.test(publisher)
    ? `google.com, ${publisher.replace(/^ca-/i, '')}, DIRECT, f08c47fec0942fa0\n`
    : '# AdSense publisher ID is not configured.\n';

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
