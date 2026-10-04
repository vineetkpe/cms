import { getSecret } from 'astro:env/server';
import { bearerToken, getMembership, getSupabaseUser, type CmsRole } from './supabase';

const ALL_ROLES: CmsRole[] = ['owner', 'admin', 'editor', 'author'];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

export function sameOriginError(request: Request) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;
  const expected = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const fetchSite = request.headers.get('sec-fetch-site');

  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
    return Response.json({ error: 'Cross-site requests are not allowed.' }, { status: 403 });
  }
  if (origin && origin !== expected) {
    return Response.json({ error: 'Cross-site requests are not allowed.' }, { status: 403 });
  }
  if (!origin && referer) {
    try {
      if (new URL(referer).origin !== expected) {
        return Response.json({ error: 'Cross-site requests are not allowed.' }, { status: 403 });
      }
    } catch {
      return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
    }
  }
  return null;
}

export async function requireAdmin(request: Request, allowedRoles: CmsRole[] = ALL_ROLES) {
  const originError = sameOriginError(request);
  if (originError) return { ok: false as const, status: 403, message: 'Cross-site requests are not allowed.' };

  if (getSecret('DEV_ADMIN_BYPASS') === 'true') {
    return {
      ok: true as const,
      id: 'local-dev',
      email: 'local-dev@example.test',
      role: 'owner' as CmsRole,
      displayName: 'Local Admin',
      token: 'local-dev',
    };
  }

  const token = bearerToken(request) || cookieValue(request, 'cms_access');
  if (!token) return { ok: false as const, status: 401, message: 'Sign in to the CMS.' };

  try {
    const user = await getSupabaseUser(token);
    const id = String(user?.id || '');
    const email = String(user?.email || '');
    if (!id || !email) return { ok: false as const, status: 401, message: 'Invalid Supabase session.' };

    const membership = await getMembership(token, id);
    if (!membership?.is_active) return { ok: false as const, status: 403, message: 'This account does not have CMS access.' };

    const role = String(membership.role || '') as CmsRole;
    if (!ALL_ROLES.includes(role) || !allowedRoles.includes(role)) {
      return { ok: false as const, status: 403, message: 'Your CMS role does not allow this action.' };
    }

    return {
      ok: true as const,
      id,
      email,
      role,
      displayName: String(membership.display_name || email),
      token,
    };
  } catch {
    return { ok: false as const, status: 401, message: 'Your CMS session is invalid or expired. Please sign in again.' };
  }
}

export function authError(result: { status: number; message: string }) {
  return Response.json({ error: result.message }, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
}
