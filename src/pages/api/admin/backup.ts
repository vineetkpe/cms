import type { APIRoute } from 'astro';
import { marked } from 'marked';
import { authError, requireAdmin } from '../../../lib/auth';
import { getTextFile, listDirectory, putTextFile } from '../../../lib/github';
import { parseMarkdown } from '../../../lib/markdown';
import { slugify } from '../../../lib/posts';
import { contentLengthOkay } from '../../../lib/security';

export const prerender = false;
const POST_DIR = 'src/content/posts';
const DATA_FILES = [
  'src/data/site.json',
  'src/data/pages.json',
  'src/data/redirects.json',
  'src/data/post-templates.json',
];
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

type BackupFile = { path: string; text: string };

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

async function listPostFiles() {
  try {
    const entries = await listDirectory(POST_DIR);
    return Array.isArray(entries) ? entries.filter((item: any) => item.type === 'file' && item.name.endsWith('.md')) : [];
  } catch {
    return [];
  }
}

async function collectBackupFiles() {
  const files: BackupFile[] = [];
  for (const item of await listPostFiles()) {
    const path = `${POST_DIR}/${item.name}`;
    const file = await getTextFile(path);
    files.push({ path, text: file.text });
  }
  for (const path of DATA_FILES) {
    try {
      const file = await getTextFile(path);
      files.push({ path, text: file.text });
    } catch {
      // Optional data file.
    }
  }
  return files;
}

async function buildWxr() {
  const siteFile = await getTextFile('src/data/site.json').catch(() => ({ text: '{}' } as any));
  const site = JSON.parse(siteFile.text || '{}');
  const siteUrl = String(site.url || 'https://example.com').replace(/\/$/, '');
  const siteName = String(site.name || 'CMS Export');
  const author = String(site.author || 'Editorial Team');
  const items: string[] = [];
  let postId = 1;

  for (const item of await listPostFiles()) {
    const file = await getTextFile(`${POST_DIR}/${item.name}`);
    const slug = item.name.replace(/\.md$/, '');
    const post = parseMarkdown(file.text, slug, file.sha);
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

  try {
    const pagesFile = await getTextFile('src/data/pages.json');
    const pages = JSON.parse(pagesFile.text || '{}');
    for (const [key, page] of Object.entries(pages as Record<string, any>)) {
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
  } catch {
    // Pages are optional in an export.
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

function safeRestorePath(path: string) {
  return path.startsWith(`${POST_DIR}/`) && path.endsWith('.md') || DATA_FILES.includes(path);
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

    const files = await collectBackupFiles();
    const payload = {
      format: 'cms-portable-backup-v1',
      exportedAt: new Date().toISOString(),
      files,
      notes: 'Text content and configuration backup. Media and code remain versioned in the Git repository.',
    };
    return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
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
    const backup = body?.backup;
    const confirm = body?.confirm === true;
    const overwrite = body?.overwrite === true;
    if (!backup || backup.format !== 'cms-portable-backup-v1' || !Array.isArray(backup.files)) throw new Error('Unsupported backup format.');
    const files = backup.files.slice(0, 1000).map((item: any) => ({ path: String(item?.path || ''), text: String(item?.text || '') }));
    if (files.some((file: BackupFile) => !safeRestorePath(file.path))) throw new Error('Backup contains a path that is not allowed.');

    const conflicts: string[] = [];
    const missing: string[] = [];
    for (const file of files) {
      try { await getTextFile(file.path); conflicts.push(file.path); } catch { missing.push(file.path); }
    }
    if (!confirm) return Response.json({ dryRun: true, files: files.length, existing: conflicts, newFiles: missing });

    const restored: string[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      let sha: string | undefined;
      try { sha = (await getTextFile(file.path)).sha; } catch { /* create */ }
      if (sha && !overwrite) { skipped.push(file.path); continue; }
      await putTextFile(file.path, file.text, `Restore CMS backup: ${file.path}`, sha);
      restored.push(file.path);
    }
    return Response.json({ ok: true, restored, skipped });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to restore backup.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};
