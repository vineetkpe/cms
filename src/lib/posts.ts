import { getCollection, type CollectionEntry } from 'astro:content';

export type PostEntry = CollectionEntry<'posts'>;

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

export function publishTime(post: PostEntry) {
  return (post.data.publishAt || post.data.pubDate).valueOf();
}

export function isPublished(post: PostEntry, now = Date.now()) {
  return !post.data.draft && publishTime(post) <= now;
}

export async function getPublishedPosts() {
  const now = Date.now();
  const posts = await getCollection('posts');
  return posts
    .filter((post) => isPublished(post, now))
    .sort((a, b) => publishTime(b) - publishTime(a));
}

export function getRelatedPosts(current: PostEntry, posts: PostEntry[], limit = 3) {
  const tags = new Set(current.data.tags.map((tag) => slugify(tag)));
  return posts
    .filter((post) => post.id !== current.id)
    .map((post) => {
      const overlap = post.data.tags.reduce((score, tag) => score + (tags.has(slugify(tag)) ? 2 : 0), 0);
      const category = post.data.category === current.data.category ? 3 : 0;
      return { post, score: overlap + category };
    })
    .sort((a, b) => b.score - a.score || publishTime(b.post) - publishTime(a.post))
    .slice(0, limit)
    .map(({ post }) => post);
}
