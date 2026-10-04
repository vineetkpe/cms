export type AdminPost = {
  slug: string;
  originalSlug?: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  author: string;
  pubDate: string;
  updatedDate?: string;
  featuredImage?: string;
  featuredImageAlt?: string;
  seoTitle?: string;
  seoDescription?: string;
  canonical?: string;
  draft: boolean;
  noindex: boolean;
  body: string;
  sha?: string;
};

function q(value: string) {
  return JSON.stringify(value || '');
}

export function toMarkdown(post: AdminPost) {
  const body = sanitizeBody(post.body);
  const lines = [
    '---',
    `title: ${q(post.title)}`,
    `description: ${q(post.description)}`,
    `category: ${q(post.category || 'Guides')}`,
    `tags: ${JSON.stringify(post.tags || [])}`,
    `author: ${q(post.author || 'Editorial Team')}`,
    `pubDate: ${post.pubDate || new Date().toISOString().slice(0, 10)}`,
    post.updatedDate ? `updatedDate: ${post.updatedDate}` : null,
    post.featuredImage ? `featuredImage: ${q(post.featuredImage)}` : null,
    post.featuredImageAlt ? `featuredImageAlt: ${q(post.featuredImageAlt)}` : null,
    post.seoTitle ? `seoTitle: ${q(post.seoTitle)}` : null,
    post.seoDescription ? `seoDescription: ${q(post.seoDescription)}` : null,
    post.canonical ? `canonical: ${q(post.canonical)}` : null,
    `draft: ${Boolean(post.draft)}`,
    `noindex: ${Boolean(post.noindex)}`,
    '---',
    '',
    body.trim(),
    ''
  ].filter((line) => line !== null);
  return lines.join('\n');
}

export function sanitizeBody(body: string) {
  const forbidden = /<\s*script\b|javascript\s*:|on(?:load|error|click|mouseover)\s*=/i;
  if (forbidden.test(body)) throw new Error('Unsafe script or event-handler markup is not allowed.');
  return body;
}

export function parseMarkdown(text: string, slug: string, sha?: string): AdminPost {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) throw new Error(`Invalid frontmatter in ${slug}`);
  const meta: Record<string, unknown> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    if (raw === 'true' || raw === 'false') meta[key] = raw === 'true';
    else if (raw.startsWith('[')) {
      try { meta[key] = JSON.parse(raw); } catch { meta[key] = []; }
    } else {
      try { meta[key] = JSON.parse(raw); } catch { meta[key] = raw; }
    }
  }
  return {
    slug,
    title: String(meta.title || ''),
    description: String(meta.description || ''),
    category: String(meta.category || 'Guides'),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    author: String(meta.author || 'Editorial Team'),
    pubDate: String(meta.pubDate || new Date().toISOString().slice(0, 10)),
    updatedDate: meta.updatedDate ? String(meta.updatedDate) : undefined,
    featuredImage: meta.featuredImage ? String(meta.featuredImage) : undefined,
    featuredImageAlt: meta.featuredImageAlt ? String(meta.featuredImageAlt) : undefined,
    seoTitle: meta.seoTitle ? String(meta.seoTitle) : undefined,
    seoDescription: meta.seoDescription ? String(meta.seoDescription) : undefined,
    canonical: meta.canonical ? String(meta.canonical) : undefined,
    draft: Boolean(meta.draft),
    noindex: Boolean(meta.noindex),
    body: match[2].trim(),
    sha
  };
}
