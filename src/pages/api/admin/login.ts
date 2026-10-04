import type { APIRoute } from 'astro';
import { authenticateStaticUser, createSession, requireAdmin, revokeSession, sameOriginError, sessionCookie } from '../../../lib/auth';
import { contentLengthOkay } from '../../../lib/security';

export const prerender = false;

type Attempt = { failures: number; resetAt: number };
const attempts = new Map<string, Attempt>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

function clientKey(request: Request, username: string) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  return `${ip}:${username.toLowerCase()}`;
}

function throttleState(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.delete(key);
    return null;
  }
  return current;
}

function recordFailure(key: string) {
  const now = Date.now();
  const current = throttleState(key);
  attempts.set(key, current ? { failures: current.failures + 1, resetAt: current.resetAt } : { failures: 1, resetAt: now + WINDOW_MS });
}

const noStore = { 'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff' };

export const POST: APIRoute = async ({ request }) => {
  const originError = sameOriginError(request);
  if (originError) return originError;
  if (!contentLengthOkay(request, 8192)) return Response.json({ error: 'Request is too large.' }, { status: 413, headers: noStore });

  try {
    const { username, password } = await request.json();
    const cleanUsername = String(username || '').trim().toLowerCase().slice(0, 64);
    const cleanPassword = String(password || '').slice(0, 512);
    if (!cleanUsername || !cleanPassword) return Response.json({ error: 'Username and password are required.' }, { status: 400, headers: noStore });

    const key = clientKey(request, cleanUsername);
    const state = throttleState(key);
    if (state && state.failures >= MAX_FAILURES) {
      const retryAfter = Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000));
      return Response.json({ error: 'Too many failed sign-in attempts. Try again later.' }, { status: 429, headers: { ...noStore, 'Retry-After': String(retryAfter) } });
    }

    const user = await authenticateStaticUser(cleanUsername, cleanPassword);
    if (!user) {
      recordFailure(key);
      return Response.json({ error: 'Invalid username or password.' }, { status: 401, headers: noStore });
    }

    attempts.delete(key);
    const token = await createSession(user);
    return new Response(JSON.stringify({
      ok: true,
      user: { username: user.username, email: user.username, role: user.role, displayName: user.displayName },
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...noStore,
        'Set-Cookie': sessionCookie(token),
      },
    });
  } catch {
    return Response.json({ error: 'Unable to sign in.' }, { status: 400, headers: noStore });
  }
};

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return Response.json({ authenticated: false }, { status: auth.status, headers: noStore });
  return Response.json({ authenticated: true, user: { username: auth.username, email: auth.username, role: auth.role, displayName: auth.displayName } }, { headers: noStore });
};

export const DELETE: APIRoute = async ({ request }) => {
  const originError = sameOriginError(request);
  if (originError) return originError;
  await revokeSession(request);
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      ...noStore,
      'Set-Cookie': sessionCookie('', 0),
    },
  });
};
