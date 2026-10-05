import type { APIRoute } from 'astro';
import { getPublishedPosts } from '../lib/posts';

export const prerender = false;
export const GET: APIRoute = async () => {
  const posts = await getPublishedPosts();
  const data = posts.map((post) => ({
    title: post.data.title,
    description: post.data.description,
    category: post.data.category,
    tags: post.data.tags,
    author: post.data.author,
    date: post.data.pubDate.toISOString(),
    url: `/${post.id.replace(/\.md$/, '')}/`
  }));
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } });
};
