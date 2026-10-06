import type { APIRoute } from 'astro';
import { getPublishedPosts, slugify } from '../lib/posts';
import { getSiteSettings } from '../lib/site-settings';
import { getManagedPages } from '../lib/managed-pages';

export const prerender = false;
type Entry = { loc: string; lastmod?: string };
const managedPaths = [
  ['about', '/about/'],
  ['contact', '/contact/'],
  ['editorialPolicy', '/editorial-policy/'],
  ['correctionsPolicy', '/corrections-policy/'],
  ['advertisingPolicy', '/advertising-policy/'],
  ['privacy', '/privacy/'],
  ['terms', '/terms/'],
  ['disclaimer', '/disclaimer/'],
] as const;
const baseStaticPaths = ['/', '/categories/', '/tags/', '/authors/', '/articles/'];
const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const perPage = 18;

export const GET: APIRoute = async () => {
  const [site, posts, pages] = await Promise.all([getSiteSettings(), getPublishedPosts(), getManagedPages()]);
  const staticPaths = [
    ...baseStaticPaths,
    ...managedPaths.filter(([key]) => !(pages as any)[key]?.noindex).map(([, path]) => path),
  ];
  const categories = [...new Set(posts.map((post) => post.data.category))];
  const tags = [...new Set(posts.flatMap((post) => post.data.tags))];
  const authors = [...new Set(posts.map((post) => post.data.author))];
  const archivePages = Math.ceil(posts.length / perPage);
  const entries: Entry[] = [
    ...staticPaths.map((path) => ({ loc: new URL(path, site.url).toString() })),
    ...Array.from({ length: Math.max(0, archivePages - 1) }, (_, i) => ({ loc: new URL(`/articles/${i + 2}/`, site.url).toString() })),
    ...categories.map((name) => ({ loc: new URL(`/category/${slugify(name)}/`, site.url).toString() })),
    ...tags.map((name) => ({ loc: new URL(`/tag/${slugify(name)}/`, site.url).toString() })),
    ...authors.map((name) => ({ loc: new URL(`/author/${slugify(name)}/`, site.url).toString() })),
    ...posts.filter((post) => !post.data.noindex).map((post) => ({ loc: new URL(`/${post.id.replace(/\.md$/, '')}/`, site.url).toString(), lastmod: (post.data.updatedDate || post.data.pubDate).toISOString().slice(0, 10) }))
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((entry) => `  <url><loc>${escapeXml(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
