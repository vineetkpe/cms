import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authError, requireAdmin } from '../../../lib/auth';
import { contentLengthOkay } from '../../../lib/security';

export const prerender = false;

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 2_500_000;
const MAX_MEDIA_BYTES = 500 * 1024 * 1024;
const MAX_UPLOADS_PER_DAY = 250;
const MAX_DELETES_PER_DAY = 250;

const allowed: Record<string, string> = {
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
};
type D1Binding = { prepare(query: string): D1Statement };
type KvBinding = {
  put(key: string, value: ArrayBuffer | ArrayBufferView | string, options?: { metadata?: Record<string, unknown> }): Promise<void>;
  delete(key: string): Promise<void>;
};

type MediaRow = {
  path: string;
  kv_key: string;
  name: string;
  content_type: string;
  size: number;
  created_at: number;
  created_by: string;
};

function db(): D1Binding {
  const binding = (env as any).DB as D1Binding | undefined;
  if (!binding) throw new Error('DB is not configured.');
  return binding;
}

function kv(): KvBinding {
  const binding = (env as any).CMS_KV as KvBinding | undefined;
  if (!binding) throw new Error('CMS_KV is not configured.');
  return binding;
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function activity() {
  return await db()
    .prepare('SELECT uploads, deletes, origin_reads FROM cms_media_activity WHERE day = ? LIMIT 1')
    .bind(utcDay())
    .first<{ uploads: number; deletes: number; origin_reads: number }>();
}

async function incrementActivity(column: 'uploads' | 'deletes') {
  const day = utcDay();
  await db().prepare(`INSERT INTO cms_media_activity (day, ${column})
    VALUES (?, 1)
    ON CONFLICT(day) DO UPDATE SET ${column} = ${column} + 1`)
    .bind(day)
    .run();
}

async function totalStoredBytes() {
  const row = await db().prepare('SELECT COALESCE(SUM(size), 0) AS bytes FROM cms_media').first<{ bytes: number }>();
  return Number(row?.bytes || 0);
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);

  try {
    const [result, totalBytes, today] = await Promise.all([
      db().prepare(`SELECT path, kv_key, name, content_type, size, created_at, created_by
        FROM cms_media
        ORDER BY created_at DESC
        LIMIT 500`).all<MediaRow>(),
      totalStoredBytes(),
      activity(),
    ]);

    const media = (result.results || []).map((item) => ({
      path: item.path,
      name: item.name,
      url: `/${item.path}`,
      size: item.size,
      type: item.content_type,
      createdAt: item.created_at,
      createdBy: item.created_by,
      storage: 'kv',
    }));

    return Response.json({
      media,
      storage: 'kv',
      role: auth.role,
      usage: {
        bytes: totalBytes,
        limitBytes: MAX_MEDIA_BYTES,
        percent: Math.round((totalBytes / MAX_MEDIA_BYTES) * 1000) / 10,
        uploadsToday: Number(today?.uploads || 0),
        uploadLimit: MAX_UPLOADS_PER_DAY,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to list media.' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  if (!contentLengthOkay(request, MAX_BODY_BYTES)) {
    return Response.json({ error: 'Upload request is too large.' }, { status: 413 });
  }

  try {
    const today = await activity();
    if (Number(today?.uploads || 0) >= MAX_UPLOADS_PER_DAY) {
      throw new Error('Daily free-tier upload safety limit reached. Try again after 00:00 UTC.');
    }

    const { name, type, data, base64: suppliedBase64 } = await request.json();
    const ext = allowed[String(type || '')];
    if (!ext) throw new Error('Only WebP, AVIF, JPEG and PNG images are allowed.');

    const base64 = String(suppliedBase64 || data || '').replace(/^data:[^;]+;base64,/, '');
    const approxBytes = Math.floor(base64.length * 0.75);
    if (!base64 || approxBytes > MAX_FILE_BYTES) {
      throw new Error('Image must be smaller than 2.5 MB after optimization.');
    }

    const bytes = fromBase64(base64);
    if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error('Image must be smaller than 2.5 MB after optimization.');
    }

    const currentBytes = await totalStoredBytes();
    if (currentBytes + bytes.byteLength > MAX_MEDIA_BYTES) {
      throw new Error('The CMS 500 MB free-media safety cap has been reached. Delete unused images before uploading more.');
    }

    const safe = String(name || 'image')
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'image';

    const now = new Date();
    const objectPath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${safe}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const path = `media/${objectPath}`;
    const key = `media:${objectPath}`;
    const createdAt = Math.floor(Date.now() / 1000);

    await kv().put(key, bytes, {
      metadata: {
        contentType: String(type),
        name: `${safe}.${ext}`,
        size: bytes.byteLength,
      },
    });

    try {
      await db().prepare(`INSERT INTO cms_media
        (path, kv_key, name, content_type, size, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(path, key, `${safe}.${ext}`, String(type), bytes.byteLength, createdAt, auth.username)
        .run();
      await incrementActivity('uploads');
    } catch (error) {
      await kv().delete(key).catch(() => {});
      throw error;
    }

    return Response.json({
      ok: true,
      url: `/${path}`,
      path,
      size: bytes.byteLength,
      storage: 'kv',
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to upload image.' }, {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin', 'editor']);
  if (!auth.ok) return authError(auth);

  try {
    const today = await activity();
    if (Number(today?.deletes || 0) >= MAX_DELETES_PER_DAY) {
      throw new Error('Daily free-tier delete safety limit reached. Try again after 00:00 UTC.');
    }

    const { path } = await request.json();
    const cleanPath = String(path || '').trim();
    if (!/^media\/[a-z0-9/_-]+\.(webp|avif|jpe?g|png)$/i.test(cleanPath) || cleanPath.includes('..')) {
      throw new Error('Invalid media path.');
    }

    const item = await db()
      .prepare('SELECT path, kv_key, name, content_type, size, created_at, created_by FROM cms_media WHERE path = ? LIMIT 1')
      .bind(cleanPath)
      .first<MediaRow>();
    if (!item) throw new Error('Media file was not found.');

    await kv().delete(item.kv_key);
    await db().prepare('DELETE FROM cms_media WHERE path = ?').bind(cleanPath).run();
    await incrementActivity('deletes');

    try {
      const cache = (globalThis as any).caches?.default;
      if (cache) await cache.delete(new Request(new URL(`/${cleanPath}`, request.url).toString()));
    } catch {
      // Cache cleanup is best-effort.
    }

    return Response.json({ ok: true, storage: 'kv' });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete media.' }, {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
};
