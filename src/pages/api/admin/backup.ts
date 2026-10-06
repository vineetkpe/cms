import type { APIRoute } from 'astro';
import { marked } from 'marked';
import { authError, requireAdmin } from '../../../lib/auth';
import { listDbPosts, saveDbPost } from '../../../lib/db-posts';
import { getSiteSettings, saveSiteSettings } from '../../../lib/site-settings';
import { getManagedPages, saveManagedPages, type ManagedPages } from '../../../lib/managed-pages';
import { listRedirects, listTemplates, saveRedirects, saveTemplates } from '../../../lib/content-config';
import { slugify } from '../../../lib/posts';
import { contentLengthOkay } from '../../../lib/security';

export const prerender = false;

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const FORMAT = 'cms-portable-backup-v2';

function cdata(value: unknown) {
  return `<![CDATA[${String(value ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function xml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[char] || char));
}

function wpDate(value: string | undefined) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.valueOf())) return '1970-01-01 00:00:00';
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function cleanPostsForBackup(posts: any[]) {
  return posts.map((post) => ({ ...post, sha: undefined, originalSlug: undefined }));
}

async function collectBackup() {
  const [posts, site, pages, redirects, templates] = await Promise.all([
    listDbPosts(),
    getSiteSettings(),
    getManagedPages(),
    listRedirects(),
    listTemplates(),
  ]);

  return {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    data: {
      posts: cleanPostsForBackup(posts),
      site,
      pages,
      redirects,
      templates,
    },
    notes: 'Portable D1 content/configuration backup. Media binaries are not included.',
  };
}

async function buildWxr() {
  const [posts, site, pages] = await Promise.all([
    listDbPosts(),
    getSiteSettings(),
    getManagedPages(),
  ]);

  const siteUrl = String(site.url || 'https://example.com').replace(/\/$/, '');
  const siteName = String(site.name || 'CMS Export');
  const authorFallback = String(site.author || 'Editorial Team');
  const items: string[] = [];
  let postId = 1;

  for (const post of posts) {
    const slug = String(post.slug || 'post');
    const publishAt = post.publishAt || `${post.pubDate}T00:00:00.000Z`;
    const status = post.draft ? 'draft' : Date.parse(publishAt) > Date.now() ? 'future' : 'publish';
    const html = String(marked.parse(String(post.body || ''), { gfm: true, breaks: false }));
    const taxonomies = [
      `<category domain="category" nicename="${xml(slugify(post.category || 'Uncategorized'))}">${cdata(post.category || 'Uncategorized')}</category>`,
      ...(post.tags || []).map((tag: string) => `<category domain="post_tag" nicename="${xml(slugify(tag))}">${cdata(tag)}</category>`),
    ].join('\n');

    const metas = [
      post.seoTitle ? ['_cms_seo_title', post.seoTitle] : null,
      post.seoDescription ? ['_cms_seo_description', post.seoDescription] : null,
      post.canonical ? ['_cms_canonical', post.canonical] : null,
      post.featuredImage ? ['_cms_featured_image_url', post.featuredImage] : null,
      post.focusKeyword ? ['_cms_focus_keyword', post.focusKeyword] : null,
    ].filter(Boolean).map((pair: any) =>
      `<wp:postmeta><wp:meta_key>${cdata(pair[0])}</wp:meta_key><wp:meta_value>${cdata(pair[1])}</wp:meta_value></wp:postmeta>`
    ).join('\n');

    items.push(`<item>
<title>${cdata(post.title)}</title>
<link>${xml(`${siteUrl}/${slug}/`)}</link>
<pubDate>${new Date(publishAt).toUTCString()}</pubDate>
<dc:creator>${cdata(post.author || authorFallback)}</dc:creator>
<guid isPermaLink="false">${xml(`${siteUrl}/?p=${postId}`)}</guid>
<description></description>
<content:encoded>${cdata(html)}</content:encoded>
<excerpt:encoded>${cdata(post.description || '')}</excerpt:encoded>
<wp:post_id>${postId}</wp:post_id>
<wp:post_date>${cdata(wpDate(publishAt))}</wp:post_date>
<wp:post_date_gmt>${cdata(wpDate(publishAt))}</wp:post_date_gmt>
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

  const pageSlugs: Record<string, string> = {
    about: 'about',
    contact: 'contact',
    editorialPolicy: 'editorial-policy',
    privacy: 'privacy',
    terms: 'terms',
    disclaimer: 'disclaimer',
  };

  for (const [key, page] of Object.entries(pages as Record<string, any>)) {
    const slug = pageSlugs[key] || slugify(key);
    const html = String(marked.parse(String(page?.body || ''), { gfm: true }));
    items.push(`<item>
<title>${cdata(page?.title || key)}</title>
<link>${xml(`${siteUrl}/${slug}/`)}</link>
<pubDate>${new Date().toUTCString()}</pubDate>
<dc:creator>${cdata(authorFallback)}</dc:creator>
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
<description>${cdata(site.description || '')}</description>
<pubDate>${new Date().toUTCString()}</pubDate>
<language>${xml(site.language || 'en')}</language>
<wp:wxr_version>1.2</wp:wxr_version>
<wp:base_site_url>${xml(siteUrl)}</wp:base_site_url>
<wp:base_blog_url>${xml(siteUrl)}</wp:base_blog_url>
${items.join('\n')}
</channel>
</rss>\n`;
}

function validateBackup(backup: any) {
  if (!backup || backup.format !== FORMAT || !backup.data || typeof backup.data !== 'object') {
    throw new Error('Unsupported backup format. Export a new backup from this CMS first.');
  }

  const posts = Array.isArray(backup.data.posts) ? backup.data.posts.slice(0, 1000) : [];
  const redirects = Array.isArray(backup.data.redirects) ? backup.data.redirects.slice(0, 500) : [];
  const templates = Array.isArray(backup.data.templates) ? backup.data.templates.slice(0, 20) : [];
  const site = backup.data.site;
  const pages = backup.data.pages;

  if (!site || typeof site !== 'object') throw new Error('Backup is missing site settings.');
  if (!pages || typeof pages !== 'object') throw new Error('Backup is missing managed pages.');

  for (const post of posts) {
    if (!post || typeof post !== 'object' || !String(post.slug || '').trim() || !String(post.title || '').trim()) {
      throw new Error('Backup contains an invalid post.');
    }
  }

  return { posts, redirects, templates, site, pages };
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

    const payload = await collectBackup();
    return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="cms-backup-${new Date().toISOString().slice(0, 10)}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to export backup.' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin']);
  if (!auth.ok) return authError(auth);
  if (!contentLengthOkay(request, MAX_IMPORT_BYTES)) {
    return Response.json({ error: 'Backup is too large.' }, { status: 413 });
  }

  try {
    const body = await request.json();
    const backup = validateBackup(body?.backup);
    const confirm = body?.confirm === true;

    if (!confirm) {
      const currentPosts = await listDbPosts();
      return Response.json({
        dryRun: true,
        storage: 'd1',
        posts: backup.posts.length,
        currentPosts: currentPosts.length,
        pages: Object.keys(backup.pages).length,
        redirects: backup.redirects.length,
        templates: backup.templates.length,
        siteSettings: true,
        warning: 'Restore replaces D1 settings/pages/redirects/templates and upserts posts with matching slugs.',
      });
    }

    await saveSiteSettings(backup.site as any, auth.username);
    await saveManagedPages(backup.pages as ManagedPages, auth.username);
    await saveRedirects(backup.redirects, auth.username);
    await saveTemplates(backup.templates, auth.username);

    for (const post of backup.posts) {
      await saveDbPost({ ...post, sha: undefined } as any);
    }

    return Response.json({
      ok: true,
      storage: 'd1',
      restored: {
        posts: backup.posts.length,
        pages: Object.keys(backup.pages).length,
        redirects: backup.redirects.length,
        templates: backup.templates.length,
        siteSettings: true,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to restore backup.' }, {
      status: 400,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
};
