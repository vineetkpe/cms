import type { APIRoute } from 'astro';
import { getPublishedPosts, slugify } from '../lib/posts';
import site from '../data/site.json';

export const prerender = true;
type Entry = { loc: string; lastmod?: string };
const staticPaths = ['/', '/about/', '/contact/', '/editorial-policy/', '/privacy/', '/terms/', '/disclaimer/', '/categories/', '/tags/', '/search/'];
const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export const GET: APIRoute = async () => {
  const posts = await getPublishedPosts();
  const categories = [...new Set(posts.map((post) => post.data.category))];
  const tags = [...new Set(posts.flatMap((post) => post.data.tags))];
  const authors = [...new Set(posts.map((post) => post.data.author))];
  const entries: Entry[] = [
    ...staticPaths.map((path) => ({ loc: new URL(path, site.url).toString() })),
    ...categories.map((name) => ({ loc: new URL(`/category/${slugify(name)}/`, site.url).toString() })),
    ...tags.map((name) => ({ loc: new URL(`/tag/${slugify(name)}/`, site.url).toString() })),
    ...authors.map((name) => ({ loc: new URL(`/author/${slugify(name)}/`, site.url).toString() })),
    ...posts.map((post) => ({ loc: new URL(`/${post.id.replace(/\.md$/, '')}/`, site.url).toString(), lastmod: (post.data.updatedDate || post.data.pubDate).toISOString().slice(0, 10) }))
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((entry) => `  <url><loc>${escapeXml(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
