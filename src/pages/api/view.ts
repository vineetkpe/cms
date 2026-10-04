import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
};

type D1Binding = { prepare(query: string): D1Statement };

function db(): D1Binding {
  const binding = (env as any).DB as D1Binding | undefined;
  if (!binding) throw new Error('DB is not configured.');
  return binding;
}

function safeSlug(value: unknown) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '').slice(0, 90);
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const slug = safeSlug(body.slug);
    if (!slug) return new Response(null, { status: 204 });
    const day = new Date().toISOString().slice(0, 10);
    await db().prepare(`INSERT INTO cms_pageviews (slug, day, views) VALUES (?, ?, 1)
      ON CONFLICT(slug, day) DO UPDATE SET views = views + 1`).bind(slug, day).run();
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return new Response(null, { status: 204 });
  }
};
