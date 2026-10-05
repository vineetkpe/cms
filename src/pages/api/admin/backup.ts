import type { APIRoute } from 'astro';
import { marked } from 'marked';
import { authError, requireAdmin } from '../../../lib/auth';
import { getManagedPages, getPostTemplates, getRedirects, getSiteSettings, setManagedPages, setPostTemplates, setRedirects, setSiteSettings } from '../../../lib/cms-store';
import { addDbPostRevision, listDbPosts, saveDbPost } from '../../../lib/db-posts';
import type { AdminPost } from '../../../lib/markdown';
import { slugify } from '../../../lib/posts';
import { contentLengthOkay } from '../../../lib/security';

export const prerender = false;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const FORMAT = 'cms-portable-backup-v2';

type PortableBackup = {
  format: typeof FORMAT;
  exportedAt: string;
  posts: AdminPost[];
  site: unknown;
  pages: unknown;
  redirects: unknown;
  templates: unknown;
};

function cdata(value: unknown) {
  return `<![CDATA[${String(value ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function xml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char] || char));
}

function wpDate(value: string | undefined) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.valueOf())) return '1970-01-01 00:00:00';
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

async function snapshot(): Promise<PortableBackup> {
  const [posts, site, pages, redirects, templates] = await Promise.all([
    listDbPosts(),
    getSiteSettings(),
    getManagedPages(),
    getRedirects(),
    getPostTemplates(),
  ]);
  return { format: FORMAT, exportedAt: new Date().toISOString(), posts, site, pages, redirects, templates };
}

async function buildWxr() {
  const backup = await snapshot();
  const site = backup.site as any;
  const siteUrl = String(site?.url || 'https://example.com').replace(/\/$/, '');
  const siteName = String(site?.name || 'CMS Export');
  const author = String(site?.author || 'Editorial Team');
  const items: string[] = [];
  let postId = 1;

  for (const post of backup.posts) {
    const slug = post.slug;
    const publishedAt = post.publishAt || `${post.pubDate}T00:00:00.000Z`;
    const status = post.draft ? 'draft' : Date.parse(publishedAt) > Date.now() ? 'future' : 'publish';
    const html = String(marked.parse(post.body, { gfm: true, breaks: false }));
    const taxonomies = [
      `<category domain="category" nicename="${xml(slugify(post.category))}">${cdata(post.category)}</category>`,
      ...(post.tags || []).map((tag) => `<category domain="post_tag" nicename="${xml(slugify(tag))}">${cdata(tag)}</category>`),
    ].join('\n');
    const metas = [
      post.seoTitle ? ['_cms_seo_title', post.seoTitle] : null,
      post.seoDescription ? ['_cms_seo_description', post.seoDescription] : null,
      post.canonical ? ['_cms_canonical', post.canonical] : null,
      post.featuredImage ? ['_cms_featured_image_url', post.featuredImage] : null,
      post.focusKeyword ? ['_cms_focus_keyword', post.focusKeyword] : null,
    ].filter(Boolean).map((pair: any) => `<wp:postmeta><wp:meta_key>${cdata(pair[0])}</wp:meta_key><wp:meta_value>${cdata(pair[1])}</wp:meta_value></wp:postmeta>`).join('\n');

    items.push(`<item>
<title>${cdata(post.title)}</title>
<link>${xml(`${siteUrl}/${slug}/`)}</link>
<pubDate>${new Date(publishedAt).toUTCString()}</pubDate>
<dc:creator>${cdata(post.author || author)}</dc:creator>
<guid isPermaLink="false">${xml(`${siteUrl}/?p=${postId}`)}</guid>
<description></description>
<content:encoded>${cdata(html)}</content:encoded>
<excerpt:encoded>${cdata(post.description)}</excerpt:encoded>
<wp:post_id>${postId}</wp:post_id>
<wp:post_date>${cdata(wpDate(publishedAt))}</wp:post_date>
<wp:post_date_gmt>${cdata(wpDate(publishedAt))}</wp:post_date_gmt>
<wp:comment_status>closed</wp:comment_status>
<wp:ping_status>closed</wp:ping_status>
<wp:post_name>${cdata(slug)}</wp:post_name>
<wp:status>${cdata(status)}</wp:status>
<wp:post_parent>0</wp:post_parent>
<wp:menu_order>0</wp:menu_order>
<wp:post_type>post</wp:post_type>
<wp:post_password></wp:post_password>
<wp:is_sticky>${post.featured ? 1 : 0}</wp:is_sticky>
${taxonomies}
${metas}
</item>`);
    postId += 1;
  }

  for (const [key, page] of Object.entries((backup.pages || {}) as Record<string, any>)) {
    const slug = slugify(key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
    const html = String(marked.parse(String(page?.body || ''), { gfm: true }));
    items.push(`<item>
<title>${cdata(page?.title || key)}</title>
<link>${xml(`${siteUrl}/${slug}/`)}</link>
<pubDate>${new Date().toUTCString()}</pubDate>
<dc:creator>${cdata(author)}</dc:creator>
<guid isPermaLink="false">${xml(`${siteUrl}/?page_id=${postId}`)}</guid>
<description></description>
<content:encoded>${cdata(html)}</content:encoded>
<excerpt:encoded>${cdata(page?.description || '')}</excerpt:encoded>
<wp:post_id>${postId}</wp:post_id>
<wp:post_date>${cdata(wpDate(undefined))}</wp:post_date>
<wp:post_date_gmt>${cdata(wpDate(undefined))}</wp:post_date_gmt>
<wp:comment_status>closed</wp:comment_status>
<wp:ping_status>closed</wp:ping_status>
<wp:post_name>${cdata(slug)}</wp:post_name>
<wp:status>publish</wp:status>
<wp:post_parent>0</wp:post_parent>
<wp:menu_order>0</wp:menu_order>
<wp:post_type>page</wp:post_type>
<wp:post_password></wp:post_password>
<wp:is_sticky>0</wp:is_sticky>
</item>`);
    postId += 1;
  }

  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
 xmlns:excerpt="https://wordpress.org/export/1.2/excerpt/"
 xmlns:content="http://purl.org/rss/1.0/modules/content/"
 xmlns:wfw="http://wellformedweb.org/CommentAPI/"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:wp="https://wordpress.org/export/1.2/">
<channel>
<title>${cdata(siteName)}</title>
<link>${xml(siteUrl)}</link>
<description>${cdata(site?.description || '')}</description>
<pubDate>${new Date().toUTCString()}</pubDate>
<language>${xml(site?.language || 'en')}</language>
<wp:wxr_version>1.2</wp:wxr_version>
<wp:base_site_url>${xml(siteUrl)}</wp:base_site_url>
<wp:base_blog_url>${xml(siteUrl)}</wp:base_blog_url>
${items.join('\n')}
</channel>
</rss>\n`;
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin', 'editor']);
  if (!auth.ok) return authError(auth);
  try {
    const format = new URL(request.url).searchParams.get('format') || 'json';
    if (format === 'wxr') {
      const xmlText = await buildWxr();
      return new Response(xmlText, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Content-Disposition': `attachment; filename="cms-wordpress-${new Date().toISOString().slice(0, 10)}.xml"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const backup = await snapshot();
    return new Response(`${JSON.stringify({ ...backup, notes: 'Posts and CMS configuration are included. Media is stored separately in Cloudflare KV and is not embedded in this text backup.' }, null, 2)}\n`, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="cms-backup-${new Date().toISOString().slice(0, 10)}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to export backup.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin']);
  if (!auth.ok) return authError(auth);
  if (!contentLengthOkay(request, MAX_IMPORT_BYTES)) return Response.json({ error: 'Backup is too large.' }, { status: 413 });
  try {
    const body = await request.json();
    const backup = body?.backup as PortableBackup;
    const confirm = body?.confirm === true;
    const overwrite = body?.overwrite === true;
    if (!backup || backup.format !== FORMAT || !Array.isArray(backup.posts)) throw new Error('Unsupported backup format. Export a fresh backup from this CMS and try again.');
    if (backup.posts.length > 1000) throw new Error('Backup contains too many posts.');

    const existing = new Set((await listDbPosts()).map((post) => post.slug));
    const conflicts = backup.posts.map((post) => post.slug).filter((slug) => existing.has(slug));
    const newPosts = backup.posts.map((post) => post.slug).filter((slug) => !existing.has(slug));
    if (!confirm) {
      return Response.json({ dryRun: true, posts: backup.posts.length, existing: conflicts, newPosts, configuration: ['site', 'pages', 'redirects', 'templates'] });
    }

    const restored: string[] = [];
    const skipped: string[] = [];
    for (const post of backup.posts) {
      if (!post?.slug || !post?.title || !post?.body) continue;
      if (existing.has(post.slug) && !overwrite) { skipped.push(post.slug); continue; }
      await saveDbPost({ ...post, sha: undefined });
      await addDbPostRevision({ ...post, sha: undefined }, auth.displayName);
      restored.push(post.slug);
    }

    await Promise.all([
      setSiteSettings(backup.site || {}),
      setManagedPages(backup.pages || {}),
      setRedirects(Array.isArray(backup.redirects) ? backup.redirects : []),
      setPostTemplates(Array.isArray(backup.templates) ? backup.templates : []),
    ]);

    return Response.json({ ok: true, restored, skipped, storage: 'd1+kv' });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to restore backup.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};
