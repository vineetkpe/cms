import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { putBase64File } from '../../../lib/github';

export const prerender = false;
const allowed: Record<string, string> = {
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/jpeg': 'jpg',
  'image/png': 'png'
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const { name, type, data } = await request.json();
    const ext = allowed[String(type || '')];
    if (!ext) throw new Error('Only WebP, AVIF, JPEG and PNG images are allowed.');
    const base64 = String(data || '').replace(/^data:[^;]+;base64,/, '');
    const approxBytes = Math.floor(base64.length * 0.75);
    if (!base64 || approxBytes > 2_500_000) throw new Error('Image must be smaller than 2.5 MB after optimization.');
    const safe = String(name || 'image').toLowerCase().replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'image';
    const now = new Date();
    const path = `public/uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${safe}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    await putBase64File(path, base64, `Upload media: ${safe}`);
    return Response.json({ ok: true, url: `/${path.replace(/^public\//, '')}` });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to upload image.' }, { status: 400 });
  }
};
