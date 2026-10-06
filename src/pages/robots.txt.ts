import type { APIRoute } from 'astro';
import { getSiteSettings } from '../lib/site-settings';
export const prerender = false;
export const GET: APIRoute = async () => {
  const site = await getSiteSettings();
  return new Response(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nSitemap: ${site.url}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
