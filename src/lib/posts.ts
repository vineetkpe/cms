import { getCollection, type CollectionEntry } from 'astro:content';
import {
  countPublishedDbPosts,
  countPublishedDbPostsByAuthor,
  countPublishedDbPostsByCategory,
  countPublishedDbPostsByTag,
  getDbPost,
  getFeaturedDbPost,
  getRelatedDbPosts,
  listDbPosts,
  listPublishedDbAuthors,
  listPublishedDbCategories,
  listPublishedDbPosts,
  listPublishedDbPostsByAuthor,
  listPublishedDbPostsByCategory,
  listPublishedDbPostsByTag,
  listPublishedDbTags,
  type TaxonomyCount,
} from './db-posts';
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

async function staticPublishedPosts() {
  const now = Date.now();
  return (await getCollection('posts'))
    .filter((post) => isPublished(post, now))
    .sort((a, b) => publishTime(b) - publishTime(a));
}

export async function getPublishedPosts(): Promise<any[]> {
  const now = Date.now();
  const staticPosts = await getCollection('posts');
  let dbPosts: any[] = [];
  try {
    dbPosts = (await listDbPosts()).map(dbToEntry);
  } catch {}

  const merged = new Map<string, any>();
  for (const post of staticPosts) merged.set(post.id.replace(/\.md$/, ''), post);
  for (const post of dbPosts) merged.set(post.id.replace(/\.md$/, ''), post);

  return Array.from(merged.values())
    .filter((post) => isPublished(post, now))
    .sort((a, b) => publishTime(b) - publishTime(a));
}

export async function getPublishedPostPage(limit = 18, offset = 0): Promise<{ posts: any[]; total: number }> {
  try {
    const [rows, total] = await Promise.all([
      listPublishedDbPosts(limit, offset),
      countPublishedDbPosts(),
    ]);
    return { posts: rows.map(dbToEntry), total };
  } catch {
    const posts = await staticPublishedPosts();
    return { posts: posts.slice(offset, offset + limit), total: posts.length };
  }
}

export async function getFeaturedPublishedPost(): Promise<any | null> {
  try {
    const post = await getFeaturedDbPost();
    return post ? dbToEntry(post) : null;
  } catch {
    const posts = await staticPublishedPosts();
    return posts.find((post) => post.data.featured) || posts[0] || null;
  }
}

export async function getPublishedPostsByCategory(categorySlug: string, limit = 24, offset = 0) {
  try {
    const [rows, total] = await Promise.all([
      listPublishedDbPostsByCategory(categorySlug, limit, offset),
      countPublishedDbPostsByCategory(categorySlug),
    ]);
    return { posts: rows.map(dbToEntry), total };
  } catch {
    const all = await staticPublishedPosts();
    const filtered = all.filter((post) => slugify(post.data.category) === categorySlug);
    return { posts: filtered.slice(offset, offset + limit), total: filtered.length };
  }
}

export async function getPublishedPostsByAuthor(authorSlug: string, limit = 24, offset = 0) {
  try {
    const [rows, total] = await Promise.all([
      listPublishedDbPostsByAuthor(authorSlug, limit, offset),
      countPublishedDbPostsByAuthor(authorSlug),
    ]);
    return { posts: rows.map(dbToEntry), total };
  } catch {
    const all = await staticPublishedPosts();
    const filtered = all.filter((post) => slugify(post.data.author) === authorSlug);
    return { posts: filtered.slice(offset, offset + limit), total: filtered.length };
  }
}

export async function getPublishedPostsByTag(tagSlug: string, limit = 24, offset = 0) {
  try {
    const [rows, total] = await Promise.all([
      listPublishedDbPostsByTag(tagSlug, limit, offset),
      countPublishedDbPostsByTag(tagSlug),
    ]);
    return { posts: rows.map(dbToEntry), total };
  } catch {
    const all = await staticPublishedPosts();
    const filtered = all.filter((post) => post.data.tags.some((tag: string) => slugify(tag) === tagSlug));
    return { posts: filtered.slice(offset, offset + limit), total: filtered.length };
  }
}

export async function getPublishedCategoryCounts(): Promise<TaxonomyCount[]> {
  try {
    return await listPublishedDbCategories();
  } catch {
    const posts = await staticPublishedPosts();
    return [...new Set(posts.map((post) => post.data.category))].map((name) => ({
      name,
      slug: slugify(name),
      count: posts.filter((post) => post.data.category === name).length,
    }));
  }
}

export async function getPublishedAuthorCounts(): Promise<TaxonomyCount[]> {
  try {
    return await listPublishedDbAuthors();
  } catch {
    const posts = await staticPublishedPosts();
    return [...new Set(posts.map((post) => post.data.author))].map((name) => ({
      name,
      slug: slugify(name),
      count: posts.filter((post) => post.data.author === name).length,
    }));
  }
}

export async function getPublishedTagCounts(): Promise<TaxonomyCount[]> {
  try {
    return await listPublishedDbTags();
  } catch {
    const posts = await staticPublishedPosts();
    const names = [...new Set(posts.flatMap((post) => post.data.tags as string[]))] as string[];
    return names.map((name) => ({
      name,
      slug: slugify(name),
      count: posts.filter((post) => post.data.tags.some((tag: string) => slugify(tag) === slugify(name))).length,
    }));
  }
}

export async function getPublishedPostBySlug(slug: string): Promise<any | null> {
  try {
    const dbPost = await getDbPost(slug);
    if (dbPost) {
      const entry = dbToEntry(dbPost);
      return isPublished(entry) ? entry : null;
    }
  } catch {}
  const posts = await getCollection('posts');
  return posts.find((post) => post.id.replace(/\.md$/, '') === slug && isPublished(post)) || null;
}

export async function getRelatedPublishedPosts(current: any, limit = 3) {
  if (current.__d1) {
    try {
      const currentSlug = String(current.id || '').endsWith('.md') ? String(current.id).slice(0, -3) : String(current.id || '');
      const source = await getDbPost(currentSlug);
      if (source) return (await getRelatedDbPosts(source, limit)).map(dbToEntry);
    } catch {}
  }
  const posts = await staticPublishedPosts();
  return getRelatedPosts(current, posts, limit);
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
