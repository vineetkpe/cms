import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { deleteFile, listDirectory, putBase64File } from '../../../lib/github';
import { audit, cmsDelete, cmsInsert, cmsSelect } from '../../../lib/supabase';

export const prerender = false;
const ROOT = 'public/uploads';
const allowed: Record<string, string> = {
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/jpeg': 'jpg',
  'image/png': 'png'
};

async function walk(path: string, depth = 0): Promise<any[]> {
  if (depth > 4) return [];
  let entries: any[] = [];
  try { entries = await listDirectory(path); } catch { return []; }
  const out: any[] = [];
  for (const item of Array.isArray(entries) ? entries : []) {
    if (out.length >= 250) break;
    if (item.type === 'dir') out.push(...await walk(item.path, depth + 1));
    else if (item.type === 'file' && /\.(webp|avif|jpe?g|png)$/i.test(item.name)) out.push({ path: item.path, name: item.name, sha: item.sha, url: `/${item.path.replace(/^public\//, '')}` });
  }
  return out.slice(0, 250);
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const files = (await walk(ROOT)).sort((a, b) => b.path.localeCompare(a.path));
    const rows = await cmsSelect(auth.token, 'cms_media', 'select=path,alt_text,uploaded_by,created_at&order=created_at.desc');
    const meta = new Map((Array.isArray(rows) ? rows : []).map((row: any) => [row.path, row]));
    const media = files.map((item) => ({ ...item, ...(meta.get(item.path) || {}) }));
    return Response.json({ media, role: auth.role }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to list media.' }, { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const { name, type, data, base64: suppliedBase64, altText } = await request.json();
    const ext = allowed[String(type || '')];
    if (!ext) throw new Error('Only WebP, AVIF, JPEG and PNG images are allowed.');
    const base64 = String(suppliedBase64 || data || '').replace(/^data:[^;]+;base64,/, '');
    const approxBytes = Math.floor(base64.length * 0.75);
    if (!base64 || approxBytes > 2_500_000) throw new Error('Image must be smaller than 2.5 MB after optimization.');
    const safe = String(name || 'image').toLowerCase().replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'image';
    const now = new Date();
    const path = `public/uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${safe}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const result = await putBase64File(path, base64, `Upload media: ${safe}`);
    const url = `/${path.replace(/^public\//, '')}`;
    await cmsInsert(auth.token, 'cms_media', {
      path,
      public_url: url,
      filename: `${safe}.${ext}`,
      mime_type: String(type),
      size_bytes: approxBytes,
      alt_text: String(altText || '').trim().slice(0, 180) || null,
      uploaded_by: auth.id,
      git_sha: result?.content?.sha || null,
    });
    await audit(auth.token, auth.id, auth.email, 'upload_media', 'media', path, { sizeBytes: approxBytes });
    return Response.json({ ok: true, url, path, sha: result?.content?.sha || null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to upload image.' }, { status: 400 });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const { path, sha } = await request.json();
    const cleanPath = String(path || '');
    if (!cleanPath.startsWith(`${ROOT}/`) || cleanPath.includes('..')) throw new Error('Invalid media path.');
    if (!String(sha || '')) throw new Error('Media SHA is required.');

    const rows = await cmsSelect(auth.token, 'cms_media', `select=id,uploaded_by&path=eq.${encodeURIComponent(cleanPath)}&limit=1`);
    const meta = Array.isArray(rows) ? rows[0] : null;
    if (auth.role === 'author' && meta?.uploaded_by !== auth.id) {
      return Response.json({ error: 'Authors can only delete media they uploaded.' }, { status: 403 });
    }

    await deleteFile(cleanPath, String(sha), `Delete media: ${cleanPath.split('/').pop()}`);
    if (meta?.id) await cmsDelete(auth.token, 'cms_media', `id=eq.${encodeURIComponent(String(meta.id))}`);
    await audit(auth.token, auth.id, auth.email, 'delete_media', 'media', cleanPath);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to delete media.' }, { status: 400 });
  }
};
