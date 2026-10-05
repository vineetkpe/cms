import { getCollection, type CollectionEntry } from 'astro:content';
import { getDbPost, listDbPosts } from './db-posts';
import type { AdminPost } from './markdown';

export type PostEntry = CollectionEntry<'posts'>;

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function dbToEntry(post: AdminPost): any {
  const pubDate = new Date(post.pubDate);
  const publishAt = post.publishAt ? new Date(post.publishAt) : undefined;
  const updatedDate = post.updatedDate ? new Date(post.updatedDate) : undefined;
  return {
    id: `${post.slug}.md`,
    body: post.body,
    collection: 'posts',
    data: {
      title: post.title,
      description: post.description,
      category: post.category,
      tags: post.tags || [],
      author: post.author,
      pubDate,
      publishAt,
      updatedDate,
      featuredImage: post.featuredImage,
      featuredImageAlt: post.featuredImageAlt,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      focusKeyword: post.focusKeyword,
      canonical: post.canonical,
      ogTitle: post.ogTitle,
      ogDescription: post.ogDescription,
      ogImage: post.ogImage,
      template: post.template,
      draft: post.draft,
      noindex: post.noindex,
      nofollow: post.nofollow,
      featured: post.featured,
      hideAds: post.hideAds,
      faq: post.faq || []
    },
    __d1: true
  };
}

export function publishTime(post: any) {
  return (post.data.publishAt || post.data.pubDate).valueOf();
}

export function isPublished(post: any, now = Date.now()) {
  return !post.data.draft && publishTime(post) <= now;
}

export async function getPublishedPosts(): Promise<any[]> {
  const now = Date.now();
  const staticPosts = await getCollection('posts');
  let dbPosts: any[] = [];
  try {
    dbPosts = (await listDbPosts()).map(dbToEntry);
  } catch {
    // During static tooling/builds the runtime D1 binding may not be available.
  }

  const merged = new Map<string, any>();
  for (const post of staticPosts) merged.set(post.id.replace(/\.md$/, ''), post);
  for (const post of dbPosts) merged.set(post.id.replace(/\.md$/, ''), post);

  return Array.from(merged.values())
    .filter((post) => isPublished(post, now))
    .sort((a, b) => publishTime(b) - publishTime(a));
}

export async function getPublishedPostBySlug(slug: string): Promise<any | null> {
  try {
    const dbPost = await getDbPost(slug);
    if (dbPost) {
      const entry = dbToEntry(dbPost);
      return isPublished(entry) ? entry : null;
    }
  } catch {
    // Fall back to bundled content when D1 is unavailable.
  }
  const posts = await getCollection('posts');
  return posts.find((post) => post.id.replace(/\.md$/, '') === slug && isPublished(post)) || null;
}

export function getRelatedPosts(current: any, posts: any[], limit = 3) {
  const tags = new Set(current.data.tags.map((tag: string) => slugify(tag)));
  return posts
    .filter((post) => post.id !== current.id)
    .map((post) => {
      const overlap = post.data.tags.reduce((score: number, tag: string) => score + (tags.has(slugify(tag)) ? 2 : 0), 0);
      const category = post.data.category === current.data.category ? 3 : 0;
      return { post, score: overlap + category };
    })
    .sort((a, b) => b.score - a.score || publishTime(b.post) - publishTime(a.post))
    .slice(0, limit)
    .map(({ post }) => post);
}
