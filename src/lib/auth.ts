import { env } from 'cloudflare:workers';

export type CmsRole = 'owner' | 'admin' | 'editor' | 'author';

type StaticUser = {
  username: string;
  displayName: string;
  role: CmsRole;
  passwordHash: string;
};

type SessionRow = {
  username: string;
  display_name: string;
  role: CmsRole;
  expires_at: number;
};

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};

type D1Binding = {
  prepare(query: string): D1Statement;
};

const ALL_ROLES: CmsRole[] = ['owner', 'admin', 'editor', 'author'];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const encoder = new TextEncoder();
export const SESSION_COOKIE = '__Host-cms_session';
export const SESSION_MAX_AGE = 8 * 60 * 60;
const DUMMY_HASH = 'pbkdf2-sha256$600000$Y21zLWR1bW15LXNhbHQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// Exactly three fixed CMS accounts. Only salted PBKDF2 hashes are committed;
// plaintext passwords are never stored in the repository.
const STATIC_USERS: StaticUser[] = [
  {
    username: 'admin',
    displayName: 'CMS Owner',
    role: 'owner',
    passwordHash: 'pbkdf2-sha256$600000$XhGbn_80GdBquhIpG-woYQ$bT5Q2z_EtQOj07Nq_oWCv8fkmQSX6rgqSqWi8TvLYXw',
  },
  {
    username: 'manager',
    displayName: 'CMS Admin',
    role: 'admin',
    passwordHash: 'pbkdf2-sha256$600000$z0Tgci-yGvjliSi2UMY1Kg$r1KOidKh33oPlt_d8xiQ80UDrAXU3dZZhgALr7VMi3g',
  },
  {
    username: 'editor',
    displayName: 'CMS Editor',
    role: 'editor',
    passwordHash: 'pbkdf2-sha256$600000$io_-a9x4fQ7QYf3sfyctBA$TT6eyd2xg-sx_nQS3DxgB2HC0RZ28tXedgMV4A8g47M',
  },
];

function cmsDb(): D1Binding {
  const binding = (env as any).DB as D1Binding | undefined;
  if (!binding) throw new Error('DB is not configured.');
  return binding;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function cleanUsername(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

async function verifyPassword(password: string, stored: string) {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 310000 || iterations > 1200000) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64Url(parts[2]);
    expected = fromBase64Url(parts[3]);
  } catch {
    return false;
  }

  if (salt.length < 12 || expected.length !== 32) return false;
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = new Uint8Array(await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: bytesToArrayBuffer(salt),
    iterations,
  }, baseKey, 256));

  let diff = derived.length ^ expected.length;
  for (let i = 0; i < Math.min(derived.length, expected.length); i++) diff |= derived[i] ^ expected[i];
  return diff === 0;
}

async function sessionStorageKey(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return toBase64Url(new Uint8Array(digest));
}

function newSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function authenticateStaticUser(usernameInput: unknown, passwordInput: unknown) {
  const username = cleanUsername(usernameInput).slice(0, 64);
  const password = String(passwordInput || '').slice(0, 512);
  const user = STATIC_USERS.find((candidate) => candidate.username === username);
  const valid = await verifyPassword(password, user?.passwordHash || DUMMY_HASH);
  return valid && user ? user : null;
}

export async function createSession(user: StaticUser) {
  const token = newSessionToken();
  const tokenHash = await sessionStorageKey(token);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_MAX_AGE;
  const db = cmsDb();

  await db.prepare('DELETE FROM cms_sessions WHERE expires_at <= ?').bind(now).run().catch(() => {});
  await db.prepare(`INSERT OR REPLACE INTO cms_sessions
    (token_hash, username, display_name, role, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(tokenHash, user.username, user.displayName, user.role, expiresAt, now)
    .run();

  return token;
}

async function verifySession(token: string) {
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;

  const tokenHash = await sessionStorageKey(token);
  const row = await cmsDb()
    .prepare('SELECT username, display_name, role, expires_at FROM cms_sessions WHERE token_hash = ? LIMIT 1')
    .bind(tokenHash)
    .first<SessionRow>();
  if (!row) return null;

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(row.expires_at) || row.expires_at <= now || row.expires_at > now + SESSION_MAX_AGE + 60) {
    await cmsDb().prepare('DELETE FROM cms_sessions WHERE token_hash = ?').bind(tokenHash).run().catch(() => {});
    return null;
  }

  const user = STATIC_USERS.find((candidate) => candidate.username === row.username);
  if (!user || user.role !== row.role || user.displayName !== row.display_name) {
    await cmsDb().prepare('DELETE FROM cms_sessions WHERE token_hash = ?').bind(tokenHash).run().catch(() => {});
    return null;
  }

  return user;
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

export async function revokeSession(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return;
  try {
    const tokenHash = await sessionStorageKey(token);
    await cmsDb().prepare('DELETE FROM cms_sessions WHERE token_hash = ?').bind(tokenHash).run();
  } catch {
    // Clearing the browser cookie still signs the user out locally.
  }
}

export function sessionCookie(token: string, maxAge = SESSION_MAX_AGE) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.min(maxAge, SESSION_MAX_AGE))}`;
}

export function sameOriginError(request: Request) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;
  const expected = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const fetchSite = request.headers.get('sec-fetch-site');

  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return Response.json({ error: 'Cross-site requests are not allowed.' }, { status: 403 });
  if (origin && origin !== expected) return Response.json({ error: 'Cross-site requests are not allowed.' }, { status: 403 });
  if (!origin && referer) {
    try {
      if (new URL(referer).origin !== expected) return Response.json({ error: 'Cross-site requests are not allowed.' }, { status: 403 });
    } catch {
      return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
    }
  }
  return null;
}

export async function requireAdmin(request: Request, allowedRoles: CmsRole[] = ALL_ROLES) {
  const originError = sameOriginError(request);
  if (originError) return { ok: false as const, status: 403, message: 'Cross-site requests are not allowed.' };

  if (String((env as any).DEV_ADMIN_BYPASS || '') === 'true') {
    return {
      ok: true as const,
      id: 'local-dev',
      username: 'local-dev',
      email: 'local-dev',
      role: 'owner' as CmsRole,
      displayName: 'Local Admin',
      token: 'local-dev',
    };
  }

  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return { ok: false as const, status: 401, message: 'Sign in to the CMS.' };

  try {
    const user = await verifySession(token);
    if (!user) return { ok: false as const, status: 401, message: 'Your CMS session is invalid or expired. Please sign in again.' };
    if (!allowedRoles.includes(user.role)) return { ok: false as const, status: 403, message: 'Your CMS role does not allow this action.' };
    return {
      ok: true as const,
      id: user.username,
      username: user.username,
      email: user.username,
      role: user.role,
      displayName: user.displayName,
      token,
    };
  } catch {
    return { ok: false as const, status: 401, message: 'Your CMS session is invalid or expired. Please sign in again.' };
  }
}

export function authError(result: { status: number; message: string }) {
  return Response.json({ error: result.message }, { status: result.status, headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } });
}
