import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { getSiteSettings, saveSiteSettings } from '../../../lib/site-settings';
import { safePublicUrl, text } from '../../../lib/security';

export const prerender = false;
const HEX = /^#[0-9a-f]{6}$/i;

function safeOrigin(value: unknown) {
  const clean = safePublicUrl(value);
  if (!clean) throw new Error('Site URL must be a valid http/https URL.');
  return new URL(clean).origin;
}

function cleanExpiryDate(value: unknown) {
  const raw = text(value, 32);
  if (!raw) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new Error('GitHub token expiry must be a valid date.');
  }
  return raw;
}

function cleanTrendGeo(value: unknown) {
  const geo = text(value || 'IN', 8).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  return geo || 'IN';
}

function cleanTrendKeywords(value: unknown) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source.map((item) => text(item, 60).toLowerCase().trim()).filter((item) => item.length >= 2))].slice(0, 40);
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const settings = await getSiteSettings();
    return Response.json({ settings, sha: 'd1', storage: 'd1', role: auth.role }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load settings.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin']);
  if (!auth.ok) return authError(auth);
  try {
    const { settings } = await request.json();
    if (!settings || typeof settings !== 'object') throw new Error('Invalid settings.');

    const primaryColor = String(settings.primaryColor || '');
    if (!HEX.test(primaryColor)) throw new Error('Primary color must be a 6-digit hex color.');

    const themeInput = settings.theme && typeof settings.theme === 'object' ? settings.theme : {};
    const surfaceColor = String(themeInput.surfaceColor || '#f6f6f3');
    if (!HEX.test(surfaceColor)) throw new Error('Surface color must be a 6-digit hex color.');
    const radius = Math.max(0, Math.min(24, Math.round(Number(themeInput.radius ?? 14) || 14)));
    const maxWidth = Math.max(1040, Math.min(1440, Math.round(Number(themeInput.maxWidth ?? 1240) || 1240)));

    const adsensePublisherId = text(settings.adsensePublisherId, 40);
    if (adsensePublisherId && !/^ca-pub-\d+$/i.test(adsensePublisherId)) throw new Error('AdSense publisher ID must look like ca-pub-1234567890.');
    const googleAnalyticsId = text(settings.googleAnalyticsId, 40);
    if (googleAnalyticsId && !/^G-[A-Z0-9]+$/i.test(googleAnalyticsId)) throw new Error('Google Analytics ID must look like G-XXXXXXXX.');

    const logoUrlRaw = text(settings.logoUrl, 500);
    const logoUrl = logoUrlRaw ? safePublicUrl(logoUrlRaw, true) : '';
    if (logoUrlRaw && !logoUrl) throw new Error('Logo URL must be a relative path or http/https URL.');
    const defaultOgRaw = text(settings.defaultOgImage, 500);
    const defaultOgImage = defaultOgRaw ? safePublicUrl(defaultOgRaw, true) : '';
    if (defaultOgRaw && !defaultOgImage) throw new Error('Default social image must be a relative path or http/https URL.');

    const socialInput = settings.social && typeof settings.social === 'object' ? settings.social : {};
    const cleanSocial = Object.fromEntries(['x','linkedin','instagram','youtube'].map((key) => {
      const raw = text((socialInput as any)[key], 500);
      const safe = raw ? safePublicUrl(raw) : '';
      if (raw && !safe) throw new Error(`${key} URL must use http or https.`);
      return [key, safe];
    }));

    const navigation = Array.isArray(settings.navigation) ? settings.navigation.slice(0, 12).map((item: any) => {
      const label = text(item?.label, 50);
      const rawHref = text(item?.href || '/', 300);
      const href = safePublicUrl(rawHref, true);
      if (rawHref && !href) throw new Error(`Invalid navigation URL for ${label || 'item'}.`);
      return { label, href };
    }).filter((item: any) => item.label && item.href) : [];

    const clean = {
      name: text(settings.name, 80),
      tagline: text(settings.tagline, 180),
      description: text(settings.description, 320),
      url: safeOrigin(settings.url),
      email: text(settings.email, 160),
      logoText: text(settings.logoText || settings.name, 80),
      logoUrl,
      primaryColor,
      author: text(settings.author || 'Editorial Team', 100),
      language: text(settings.language || 'en', 12) || 'en',
      defaultOgImage,
      footerText: text(settings.footerText, 240),
      homepageEyebrow: text(settings.homepageEyebrow || 'Independent publication', 80),
      theme: { surfaceColor, radius, maxWidth },
      googleAnalyticsId,
      googleSiteVerification: text(settings.googleSiteVerification, 160),
      adsensePublisherId,
      adsenseArticleSlot: text(settings.adsenseArticleSlot, 30).replace(/\D/g, ''),
      adsenseSidebarSlot: text(settings.adsenseSidebarSlot, 30).replace(/\D/g, ''),
      githubTokenExpiresAt: cleanExpiryDate(settings.githubTokenExpiresAt),
      contentNiche: text(settings.contentNiche || 'Jobs, careers, education and useful updates', 320),
      trendGeo: cleanTrendGeo(settings.trendGeo),
      trendKeywords: cleanTrendKeywords(settings.trendKeywords),
      social: cleanSocial,
      navigation,
    };

    if (!clean.name || !clean.tagline || !clean.description) throw new Error('Name, tagline and description are required.');
    if (!clean.contentNiche) throw new Error('Content niche is required for trend recommendations.');
    const updatedAt = await saveSiteSettings(clean as any, auth.username);
    return Response.json({ ok: true, storage: 'd1', updatedAt, sha: String(updatedAt), commit: null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update settings.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};
