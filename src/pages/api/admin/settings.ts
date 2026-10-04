import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { getTextFile, putTextFile } from '../../../lib/github';

export const prerender = false;
const PATH = 'src/data/site.json';

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const file = await getTextFile(PATH);
    return Response.json({ settings: JSON.parse(file.text), sha: file.sha });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load settings.' }, { status: 500 });
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const { settings, sha } = await request.json();
    if (!settings || typeof settings !== 'object') throw new Error('Invalid settings.');
    const url = new URL(String(settings.url || ''));
    if (!/^#[0-9a-f]{6}$/i.test(String(settings.primaryColor || ''))) throw new Error('Primary color must be a 6-digit hex color.');
    const clean = {
      name: String(settings.name || '').trim().slice(0, 80),
      tagline: String(settings.tagline || '').trim().slice(0, 180),
      description: String(settings.description || '').trim().slice(0, 320),
      url: url.origin,
      email: String(settings.email || '').trim().slice(0, 160),
      logoText: String(settings.logoText || settings.name || '').trim().slice(0, 80),
      primaryColor: String(settings.primaryColor),
      author: String(settings.author || 'Editorial Team').trim().slice(0, 100),
      navigation: Array.isArray(settings.navigation) ? settings.navigation.slice(0, 12).map((item: any) => ({
        label: String(item.label || '').trim().slice(0, 50),
        href: String(item.href || '/').trim().slice(0, 200)
      })).filter((item: any) => item.label && item.href) : []
    };
    if (!clean.name || !clean.tagline || !clean.description) throw new Error('Name, tagline and description are required.');
    const result = await putTextFile(PATH, `${JSON.stringify(clean, null, 2)}\n`, `Update site settings`, String(sha || ''));
    return Response.json({ ok: true, commit: result?.commit?.sha || null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update settings.' }, { status: 400 });
  }
};
