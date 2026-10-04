import type { APIRoute } from 'astro';
import { requireAdmin, sameOriginError } from '../../../lib/auth';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, getMembership } from '../../../lib/supabase';
import { contentLengthOkay } from '../../../lib/security';

export const prerender = false;

function cookie(token: string, maxAge: number) {
  return `cms_access=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.min(maxAge, 3600))}`;
}

export const POST: APIRoute = async ({ request }) => {
  const originError = sameOriginError(request);
  if (originError) return originError;
  if (!contentLengthOkay(request, 8192)) return Response.json({ error: 'Request is too large.' }, { status: 413 });
  try {
    const { email, password } = await request.json();
    const cleanEmail = String(email || '').trim().toLowerCase().slice(0, 254);
    const cleanPassword = String(password || '').slice(0, 512);
    if (!cleanEmail || !cleanPassword) return Response.json({ error: 'Email and password are required.' }, { status: 400 });

    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: cleanEmail, password: cleanPassword }),
    });

    if (!response.ok) return Response.json({ error: 'Invalid email or password.' }, { status: 401 });

    const session = await response.json() as any;
    const token = String(session?.access_token || '');
    const userId = String(session?.user?.id || '');
    if (!token || !userId) return Response.json({ error: 'Unable to create CMS session.' }, { status: 401 });

    const membership = await getMembership(token, userId);
    if (!membership?.is_active) return Response.json({ error: 'This account has not been given CMS access.' }, { status: 403 });

    return new Response(JSON.stringify({
      ok: true,
      user: {
        email: String(session?.user?.email || cleanEmail),
        role: membership.role,
        displayName: membership.display_name || String(session?.user?.email || cleanEmail),
      },
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Set-Cookie': cookie(token, Number(session?.expires_in || 3600)),
      },
    });
  } catch {
    return Response.json({ error: 'Unable to sign in.' }, { status: 400 });
  }
};

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return Response.json({ authenticated: false }, { status: auth.status, headers: { 'Cache-Control': 'no-store' } });
  return Response.json({ authenticated: true, user: { email: auth.email, role: auth.role, displayName: auth.displayName } }, { headers: { 'Cache-Control': 'no-store' } });
};

export const DELETE: APIRoute = async ({ request }) => {
  const originError = sameOriginError(request);
  if (originError) return originError;
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Set-Cookie': cookie('', 0),
    },
  });
};
