import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authError, requireAdmin } from '../../../lib/auth';

export const prerender = false;

const allowed: Record<string, string> = {
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/jpeg': 'jpg',
  'image/png': 'png'
};

type MediaBucket = {
  list(options?: { limit?: number; cursor?: string }): Promise<{ objects?: Array<{ key: string; etag?: string; size?: number; uploaded?: Date }>; truncated?: boolean; cursor?: string }>;
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> }): Promise<{ etag?: string }>;
  delete(key: string): Promise<void>;
};

function bucket(): MediaBucket {
  const binding = (env as any).MEDIA as MediaBucket | undefined;
  if (!binding) throw new Error('R2 media storage is not configured.');
  return binding;
}

function publicUrl(key: string) {
  return '/media/' + key.split('/').map(encodeURIComponent).join('/');
}

function safeKey(value: unknown) {
  const key = String(value || '').replace(/^\/+/, '');
  if (!key || key.includes('..') || key.includes('\\')) throw new Error('Invalid media path.');
  return key;
}

function base64Bytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);

  try {
    const media: any[] = [];
    let cursor: string | undefined;

    do {
      const page = await bucket().list({ limit: Math.min(250 - media.length, 100), cursor });
      for (const item of page.objects || []) {
        media.push({
          path: item.key,
          name: item.key.split('/').pop() || item.key,
          sha: item.etag || '',
          etag: item.etag || '',
          size: item.size || 0,
          uploaded: item.uploaded || null,
          url: publicUrl(item.key),
          storage: 'r2'
        });
        if (media.length >= 250) break;
      }
      cursor = page.truncated && media.length < 250 ? page.cursor : undefined;
    } while (cursor);

    media.sort((a, b) => b.path.localeCompare(a.path));
    return Response.json({ media, storage: 'r2', role: auth.role }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to list media.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);

  try {
    const { name, type, data, base64: suppliedBase64 } = await request.json();
    const contentType = String(type || '');
    const ext = allowed[contentType];
    if (!ext) throw new Error('Only WebP, AVIF, JPEG and PNG images are allowed.');

    const base64 = String(suppliedBase64 || data || '').replace(/^data:[^;]+;base64,/, '');
    const approxBytes = Math.floor(base64.length * 0.75);
    if (!base64 || approxBytes > 2_500_000) throw new Error('Image must be smaller than 2.5 MB after optimization.');

    const safe = String(name || 'image')
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'image';

    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${safe}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const bytes = base64Bytes(base64);

    const result = await bucket().put(key, bytes, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=31536000, immutable'
      },
      customMetadata: {
        uploadedBy: auth.username
      }
    });

    return Response.json({
      ok: true,
      storage: 'r2',
      url: publicUrl(key),
      path: key,
      sha: result?.etag || null,
      size: bytes.byteLength
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to upload image.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin', 'editor']);
  if (!auth.ok) return authError(auth);

  try {
    const { path } = await request.json();
    const key = safeKey(path);
    await bucket().delete(key);
    return Response.json({ ok: true, storage: 'r2' });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete media.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};
