import type { APIRoute } from 'astro';
import { getPublishedPosts } from '../lib/posts';
import site from '../data/site.json';

export const prerender = true;
const staticPaths = ['/', '/about/', '/contact/', '/editorial-policy/', '/privacy/', '/terms/', '/disclaimer/'];

export const GET: APIRoute = async () => {
  const posts = await getPublishedPosts();
  const categories = [...new Set(posts.map((p) => p.data.category.toLowerCase().replace(/[^a-z0-9]+/g, '-')))];
  const entries = [
    ...staticPaths.map((path) => ({ loc: new URL(path, site.url).toString() })),
    ...categories.map((category) => ({ loc: new URL(`/category/${category}/`, site.url).toString() })),
    ...posts.map((post) => ({ loc: new URL(`/${post.id.replace(/\.md$/, '')}/`, site.url).toString(), lastmod: (post.data.updatedDate || post.data.pubDate).toISOString().slice(0, 10) }))
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((entry) => `  <url><loc>${entry.loc.replace(/&/g, '&amp;')}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
