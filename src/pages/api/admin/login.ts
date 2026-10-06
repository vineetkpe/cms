import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authenticateStaticUser, createSession, requireAdmin, revokeSession, sameOriginError, sessionCookie } from '../../../lib/auth';
import { contentLengthOkay } from '../../../lib/security';

export const prerender = false;

type Attempt = { failures: number; reset_at: number };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};
type D1Binding = { prepare(query: string): D1Statement };

const WINDOW_SECONDS = 15 * 60;
const MAX_FAILURES = 5;
const encoder = new TextEncoder();
const noStore = { 'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff' };

function db(): D1Binding {
  const binding = (env as any).DB as D1Binding | undefined;
  if (!binding) throw new Error('DB is not configured.');
  return binding;
}

async function clientKey(request: Request, username: string) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${ip}\0${username.toLowerCase()}`)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function throttleState(key: string) {
  const now = Math.floor(Date.now() / 1000);
  const row = await db()
    .prepare('SELECT failures, reset_at FROM cms_login_attempts WHERE key_hash = ? LIMIT 1')
    .bind(key)
    .first<Attempt>();

  if (!row) return null;
  if (!Number.isInteger(row.reset_at) || row.reset_at <= now) {
    await db().prepare('DELETE FROM cms_login_attempts WHERE key_hash = ?').bind(key).run().catch(() => {});
    return null;
  }
  return row;
}

async function recordFailure(key: string) {
  const now = Math.floor(Date.now() / 1000);
  const resetAt = now + WINDOW_SECONDS;
  await db().prepare(`INSERT INTO cms_login_attempts (key_hash, failures, reset_at)
    VALUES (?, 1, ?)
    ON CONFLICT(key_hash) DO UPDATE SET
      failures = CASE WHEN cms_login_attempts.reset_at <= ? THEN 1 ELSE cms_login_attempts.failures + 1 END,
      reset_at = CASE WHEN cms_login_attempts.reset_at <= ? THEN excluded.reset_at ELSE cms_login_attempts.reset_at END`)
    .bind(key, resetAt, now, now)
    .run();
}

async function clearFailures(key: string) {
  await db().prepare('DELETE FROM cms_login_attempts WHERE key_hash = ?').bind(key).run().catch(() => {});
}

export const POST: APIRoute = async ({ request }) => {
  const originError = sameOriginError(request);
  if (originError) return originError;
  if (!contentLengthOkay(request, 8192)) {
    return Response.json({ error: 'Request is too large.' }, { status: 413, headers: noStore });
  }

  try {
    const { username, password } = await request.json();
    const cleanUsername = String(username || '').trim().toLowerCase().slice(0, 64);
    const cleanPassword = String(password || '').slice(0, 512);
    if (!cleanUsername || !cleanPassword) {
      return Response.json({ error: 'Username and password are required.' }, { status: 400, headers: noStore });
    }

    const key = await clientKey(request, cleanUsername);
    const state = await throttleState(key);
    if (state && state.failures >= MAX_FAILURES) {
      const retryAfter = Math.max(1, state.reset_at - Math.floor(Date.now() / 1000));
      return Response.json(
        { error: 'Too many failed sign-in attempts. Try again later.' },
        { status: 429, headers: { ...noStore, 'Retry-After': String(retryAfter) } }
      );
    }

    const user = await authenticateStaticUser(cleanUsername, cleanPassword);
    if (!user) {
      await recordFailure(key);
      return Response.json({ error: 'Invalid username or password.' }, { status: 401, headers: noStore });
    }

    await clearFailures(key);
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
  return Response.json({
    authenticated: true,
    user: { username: auth.username, email: auth.username, role: auth.role, displayName: auth.displayName },
  }, { headers: noStore });
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
