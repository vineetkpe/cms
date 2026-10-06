import { env } from 'cloudflare:workers';

export type CmsRole = 'owner' | 'admin' | 'editor' | 'author';


type AuthUser = {
  username: string;
  displayName: string;
  role: CmsRole;
};

type AuthUserRow = {
  username: string;
  display_name: string;
  role: CmsRole;
  password_salt: string;
  password_verifier: string;
  active: number;
  legacy_salt: string | null;
};

type LegacyUser = AuthUser & { passwordHash: string };

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
const PBKDF2_ITERATIONS = 80_000;
export const SESSION_COOKIE = '__Host-cms_session';
export const SESSION_MAX_AGE = 8 * 60 * 60;

const DUMMY_LEGACY_SALT = '-pt2O8r0Qwzvj8wibqFvJA';
const DUMMY_PBKDF2_SALT = 'gFNVqA6gb_2f-4zNwrPDhg';
const DUMMY_VERIFIER = 'MdMHcA5_5Q46IzxU4CMc4i9CX8VuwYLYfraQa_11R9M';

// Temporary migration source. These legacy verifiers are removed from the
// repository after all three D1 accounts have been migrated.
const LEGACY_USERS: LegacyUser[] = [
  { username: 'admin', displayName: 'CMS Owner', role: 'owner', passwordHash: 'sha256$rlZgpQppxZlZa-SHU12-HQ$_BcigMMAqAhAlVxCscKFtEoGZNWN1insD-cbdqVNn7k' },
  { username: 'manager', displayName: 'CMS Admin', role: 'admin', passwordHash: 'sha256$jBav55ko1cOzP6CMA-6twQ$FDqVdUz67Pc3H7gpbWMbMyKr5cipdBrz-u0t4PL85yU' },
  { username: 'editor', displayName: 'CMS Editor', role: 'editor', passwordHash: 'sha256$calb31PdfcrGkmhiHzkLpQ$mr-cviocszhqVWhU5vEXU4bmytEBe5asxOJeZWVoiaQ' },
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

function cleanUsername(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

async function pbkdf2(legacyDigest: Uint8Array, salt: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', legacyDigest, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return new Uint8Array(bits);
}

async function legacyDigest(password: string, saltValue: string) {
  const salt = fromBase64Url(saltValue);
  const passwordBytes = encoder.encode(password);
  const input = new Uint8Array(salt.length + passwordBytes.length);
  input.set(salt, 0);
  input.set(passwordBytes, salt.length);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
}

function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function migrateLegacyUser(username: string) {
  const user = LEGACY_USERS.find((candidate) => candidate.username === username);
  if (!user) return;

  const db = cmsDb();
  const existing = await db.prepare('SELECT password_verifier FROM cms_auth_users WHERE username = ? LIMIT 1')
    .bind(user.username)
    .first<{ password_verifier: string }>();
  if (existing?.password_verifier) return;

  const parts = user.passwordHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'sha256') return;

  const legacySalt = parts[1];
  const digest = fromBase64Url(parts[2]);
  const newSalt = new Uint8Array(16);
  crypto.getRandomValues(newSalt);
  const verifier = await pbkdf2(digest, newSalt);
  const now = Math.floor(Date.now() / 1000);

  await db.prepare('INSERT OR REPLACE INTO cms_auth_users (username, display_name, role, password_salt, password_verifier, active, created_at, updated_at, legacy_salt) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)')
    .bind(user.username, user.displayName, user.role, toBase64Url(newSalt), toBase64Url(verifier), now, now, legacySalt)
    .run();
}

async function getAuthUser(username: string) {
  return cmsDb()
    .prepare('SELECT username, display_name, role, password_salt, password_verifier, active, legacy_salt FROM cms_auth_users WHERE username = ? AND active = 1 LIMIT 1')
    .bind(username)
    .first<AuthUserRow>();
}

async function verifyStoredPassword(password: string, row: AuthUserRow | null) {
  const legacySalt = row?.legacy_salt || DUMMY_LEGACY_SALT;
  const pbkdfSalt = row?.password_salt || DUMMY_PBKDF2_SALT;
  const expected = fromBase64Url(row?.password_verifier || DUMMY_VERIFIER);
  const digest = await legacyDigest(password, legacySalt);
  const derived = await pbkdf2(digest, fromBase64Url(pbkdfSalt));
  return equalBytes(derived, expected);
}

export async function authenticateStaticUser(usernameInput: unknown, passwordInput: unknown) {
  const username = cleanUsername(usernameInput).slice(0, 64);
  const password = String(passwordInput || '').slice(0, 512);
  await migrateLegacyUser(username);
  const row = await getAuthUser(username);
  const valid = await verifyStoredPassword(password, row);
  if (!valid || !row) return null;
  return { username: row.username, displayName: row.display_name, role: row.role as CmsRole };
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

export async function createSession(user: AuthUser) {
  const token = newSessionToken();
  const tokenHash = await sessionStorageKey(token);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_MAX_AGE;
  const db = cmsDb();

  await db.prepare('DELETE FROM cms_sessions WHERE expires_at <= ?').bind(now).run().catch(() => {});
  await db.prepare('INSERT OR REPLACE INTO cms_sessions (token_hash, username, display_name, role, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(tokenHash, user.username, user.displayName, user.role, expiresAt, now)
    .run();

  return token;
}
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

function cleanUsername(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

async function verifyPassword(password: string, stored: string) {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'sha256') return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64Url(parts[1]);
    expected = fromBase64Url(parts[2]);
  } catch {
    return false;
  }

  if (salt.length < 12 || expected.length !== 32) return false;
  const passwordBytes = encoder.encode(password);
  const input = new Uint8Array(salt.length + passwordBytes.length);
  input.set(salt, 0);
  input.set(passwordBytes, salt.length);
  const derived = new Uint8Array(await crypto.subtle.digest('SHA-256', input));

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

  const userRow = await getAuthUser(row.username);
  if (!userRow || userRow.role !== row.role || userRow.display_name !== row.display_name) {
    await cmsDb().prepare('DELETE FROM cms_sessions WHERE token_hash = ?').bind(tokenHash).run().catch(() => {});
    return null;
  }

  return { username: userRow.username, displayName: userRow.display_name, role: userRow.role as CmsRole };
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
