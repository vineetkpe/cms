import { getSecret } from 'astro:env/server';

export type CmsRole = 'owner' | 'admin' | 'editor' | 'author';

type StaticUser = {
  username: string;
  displayName: string;
  role: CmsRole;
  passwordHash: string;
};

type AuthConfig = {
  sessionKey: string;
  users: StaticUser[];
};

const ALL_ROLES: CmsRole[] = ['owner', 'admin', 'editor', 'author'];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const SESSION_COOKIE = '__Host-cms_session';
export const SESSION_MAX_AGE = 8 * 60 * 60;
const DUMMY_HASH = 'pbkdf2-sha256$600000$Y21zLWR1bW15LXNhbHQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

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

function encodeJson(value: unknown) {
  return toBase64Url(encoder.encode(JSON.stringify(value)));
}

function decodeJson<T>(value: string): T {
  return JSON.parse(decoder.decode(fromBase64Url(value))) as T;
}

function cleanUsername(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function loadAuthConfig(): AuthConfig {
  const raw = getSecret('CMS_AUTH_CONFIG');
  if (!raw) throw new Error('CMS_AUTH_CONFIG is not configured.');
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { throw new Error('CMS_AUTH_CONFIG is invalid JSON.'); }

  const sessionKey = String(parsed?.sessionKey || '');
  const inputUsers = Array.isArray(parsed?.users) ? parsed.users : [];
  if (sessionKey.length < 32) throw new Error('CMS_AUTH_CONFIG sessionKey must be at least 32 characters.');
  if (inputUsers.length < 1 || inputUsers.length > 3) throw new Error('CMS_AUTH_CONFIG must contain between 1 and 3 users.');

  const seen = new Set<string>();
  const users: StaticUser[] = inputUsers.map((entry: any) => {
    const username = cleanUsername(entry?.username);
    const displayName = String(entry?.displayName || username).trim().slice(0, 100);
    const role = String(entry?.role || '') as CmsRole;
    const passwordHash = String(entry?.passwordHash || '');
    if (!/^[a-z0-9._-]{3,64}$/.test(username)) throw new Error('CMS username format is invalid.');
    if (seen.has(username)) throw new Error('CMS usernames must be unique.');
    seen.add(username);
    if (!displayName) throw new Error('CMS displayName is required.');
    if (!ALL_ROLES.includes(role)) throw new Error(`Invalid CMS role for ${username}.`);
    if (!/^pbkdf2-sha256\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(passwordHash)) throw new Error(`Invalid password hash for ${username}.`);
    return { username, displayName, role, passwordHash };
  });

  return { sessionKey, users };
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
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
  const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, baseKey, 256));
  let diff = derived.length ^ expected.length;
  for (let i = 0; i < Math.min(derived.length, expected.length); i++) diff |= derived[i] ^ expected[i];
  return diff === 0;
}

export async function authenticateStaticUser(usernameInput: unknown, passwordInput: unknown) {
  const username = cleanUsername(usernameInput).slice(0, 64);
  const password = String(passwordInput || '').slice(0, 512);
  const config = loadAuthConfig();
  const user = config.users.find((candidate) => candidate.username === username);
  const valid = await verifyPassword(password, user?.passwordHash || DUMMY_HASH);
  return valid && user ? user : null;
}

export async function createSession(user: StaticUser) {
  const config = loadAuthConfig();
  const now = Math.floor(Date.now() / 1000);
  const payload = encodeJson({ v: 1, u: user.username, r: user.role, n: user.displayName, iat: now, exp: now + SESSION_MAX_AGE });
  const key = await hmacKey(config.sessionKey);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  return `${payload}.${toBase64Url(signature)}`;
}

async function verifySession(token: string) {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const config = loadAuthConfig();
  const key = await hmacKey(config.sessionKey);
  let signatureBytes: Uint8Array;
  try { signatureBytes = fromBase64Url(signature); } catch { return null; }
  const validSignature = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(payload));
  if (!validSignature) return null;

  let data: any;
  try { data = decodeJson(payload); } catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (data?.v !== 1 || !Number.isInteger(data?.iat) || !Number.isInteger(data?.exp)) return null;
  if (data.iat > now + 60 || data.exp <= now || data.exp - data.iat > SESSION_MAX_AGE + 60) return null;

  const user = config.users.find((candidate) => candidate.username === data.u);
  if (!user || user.role !== data.r || user.displayName !== data.n) return null;
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

  if (getSecret('DEV_ADMIN_BYPASS') === 'true') {
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
