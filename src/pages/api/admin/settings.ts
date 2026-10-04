import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { getTextFile, putTextFile } from '../../../lib/github';
import { audit, cmsUpdate } from '../../../lib/supabase';

export const prerender = false;
const PATH = 'src/data/site.json';

const text = (value: unknown, max: number) => String(value || '').trim().slice(0, max);

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const file = await getTextFile(PATH);
    return Response.json({ settings: JSON.parse(file.text), sha: file.sha, role: auth.role }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load settings.' }, { status: 500 });
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin']);
  if (!auth.ok) return authError(auth);
  try {
    const { settings, sha } = await request.json();
    if (!settings || typeof settings !== 'object') throw new Error('Invalid settings.');
    const url = new URL(String(settings.url || ''));
    if (!/^#[0-9a-f]{6}$/i.test(String(settings.primaryColor || ''))) throw new Error('Primary color must be a 6-digit hex color.');

    const adsensePublisherId = text(settings.adsensePublisherId, 40);
    if (adsensePublisherId && !/^ca-pub-\d+$/i.test(adsensePublisherId)) throw new Error('AdSense publisher ID must look like ca-pub-1234567890.');
    const googleAnalyticsId = text(settings.googleAnalyticsId, 40);
    if (googleAnalyticsId && !/^G-[A-Z0-9]+$/i.test(googleAnalyticsId)) throw new Error('Google Analytics ID must look like G-XXXXXXXX.');

    const socialInput = settings.social && typeof settings.social === 'object' ? settings.social : {};
    const clean = {
      name: text(settings.name, 80),
      tagline: text(settings.tagline, 180),
      description: text(settings.description, 320),
      url: url.origin,
      email: text(settings.email, 160),
      logoText: text(settings.logoText || settings.name, 80),
      primaryColor: String(settings.primaryColor),
      author: text(settings.author || 'Editorial Team', 100),
      language: text(settings.language || 'en', 12) || 'en',
      defaultOgImage: text(settings.defaultOgImage, 500),
      footerText: text(settings.footerText, 240),
      googleAnalyticsId,
      googleSiteVerification: text(settings.googleSiteVerification, 160),
      adsensePublisherId,
      adsenseArticleSlot: text(settings.adsenseArticleSlot, 30).replace(/\D/g, ''),
      adsenseSidebarSlot: text(settings.adsenseSidebarSlot, 30).replace(/\D/g, ''),
      social: {
        x: text(socialInput.x, 300),
        linkedin: text(socialInput.linkedin, 300),
        instagram: text(socialInput.instagram, 300),
        youtube: text(socialInput.youtube, 300)
      },
      navigation: Array.isArray(settings.navigation) ? settings.navigation.slice(0, 12).map((item: any) => ({
        label: text(item?.label, 50),
        href: text(item?.href || '/', 200)
      })).filter((item: any) => item.label && item.href) : []
    };
    if (!clean.name || !clean.tagline || !clean.description) throw new Error('Name, tagline and description are required.');
    const result = await putTextFile(PATH, `${JSON.stringify(clean, null, 2)}\n`, 'Update site settings', String(sha || ''));
    const commit = result?.commit?.sha || null;
    await cmsUpdate(auth.token, 'cms_settings', 'id=eq.1', { data: clean, updated_by: auth.id, updated_at: new Date().toISOString() });
    await audit(auth.token, auth.id, auth.email, 'update_settings', 'settings', 'site', { commit });
    return Response.json({ ok: true, commit });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update settings.' }, { status: 400 });
  }
};
