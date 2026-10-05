import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { deleteMedia, listMedia, putMedia } from '../../../lib/cms-store';

export const prerender = false;
const ROOT = 'uploads';
const allowed: Record<string, string> = {
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/jpeg': 'jpg',
  'image/png': 'png'
};

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const media = (await listMedia(250)).map((item) => ({
      ...item,
      url: `/${item.path}`,
      sha: null,
    }));
    return Response.json({ media, role: auth.role, storage: 'kv' }, { headers: { 'Cache-Control': 'no-store' } });
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

    const safe = String(name || 'image').toLowerCase().replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'image';
    const now = new Date();
    const path = `${ROOT}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${safe}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const bytes = decodeBase64(base64);
    if (bytes.byteLength > 2_500_000) throw new Error('Image must be smaller than 2.5 MB after optimization.');

    const stored = await putMedia(path, bytes, contentType);
    return Response.json({ ok: true, url: `/${path}`, path, sha: null, storage: 'kv', media: stored });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to upload image.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin', 'editor']);
  if (!auth.ok) return authError(auth);
  try {
    const { path } = await request.json();
    const cleanPath = String(path || '').replace(/^\/+/, '');
    if (!cleanPath.startsWith(`${ROOT}/`) || cleanPath.includes('..')) throw new Error('Invalid media path.');
    await deleteMedia(cleanPath);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete media.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};
