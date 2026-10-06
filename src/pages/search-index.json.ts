import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getPublishedPostCards } from '../lib/posts';

export const prerender = false;

type KVBinding = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

const CACHE_KEY = 'cms:public:search-index:v1';

export const GET: APIRoute = async () => {
  const kv = (env as any).CMS_KV as KVBinding | undefined;
  if (kv) {
    const cached = await kv.get(CACHE_KEY).catch(() => null);
    if (cached) {
      return new Response(cached, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          'X-CMS-Cache': 'HIT',
        },
      });
    }
  }

  const posts = await getPublishedPostCards();
  const body = JSON.stringify(posts.map((post) => ({
    title: post.data.title,
    description: post.data.description,
    category: post.data.category,
    tags: post.data.tags,
    author: post.data.author,
    date: post.data.pubDate.toISOString(),
    url: `/${post.id.replace(/\.md$/, '')}/`,
  })));

  if (kv) await kv.put(CACHE_KEY, body, { expirationTtl: 900 }).catch(() => {});

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-CMS-Cache': 'MISS',
    },
  });
};
