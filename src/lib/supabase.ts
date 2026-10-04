export const SUPABASE_URL = 'https://ckekmlrybsztcplqaipu.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_aU11M4noIvLvDepPKAb2EA_H20tXuDH';

export type CmsRole = 'owner' | 'admin' | 'editor' | 'author';

function headers(token: string, extra: HeadersInit = {}) {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra,
  } as Record<string, string>;
}

export function bearerToken(request: Request) {
  const raw = request.headers.get('authorization') || '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export async function supabaseRequest(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: headers(token, init.headers || {}),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${response.status}: ${text.slice(0, 300)}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function supabasePublicRpc(name: string, body: Record<string, unknown>) {
  if (!/^cms_[a-z0-9_]+$/.test(name)) throw new Error('Invalid RPC name.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = 'Request could not be completed.';
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed?.message === 'string' && parsed.message.length <= 180) message = parsed.message;
    } catch {}
    throw new Error(message);
  }
  return text ? JSON.parse(text) : null;
}

export async function getSupabaseUser(token: string) {
  return supabaseRequest('/auth/v1/user', token, { method: 'GET' });
}

export async function getMembership(token: string, userId: string) {
  const rows = await supabaseRequest(`/rest/v1/cms_members?select=user_id,role,display_name,is_active&user_id=eq.${encodeURIComponent(userId)}&limit=1`, token, { method: 'GET' });
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function cmsSelect(token: string, table: string, query = '') {
  return supabaseRequest(`/rest/v1/${table}${query ? `?${query}` : ''}`, token, { method: 'GET' });
}

export async function cmsInsert(token: string, table: string, row: unknown) {
  return supabaseRequest(`/rest/v1/${table}`, token, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
}

export async function cmsUpdate(token: string, table: string, filter: string, row: unknown) {
  return supabaseRequest(`/rest/v1/${table}?${filter}`, token, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
}

export async function cmsDelete(token: string, table: string, filter: string) {
  return supabaseRequest(`/rest/v1/${table}?${filter}`, token, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
}

export async function audit(token: string, userId: string, email: string, action: string, entityType: string, entityId?: string, details: Record<string, unknown> = {}) {
  try {
    await cmsInsert(token, 'cms_audit_log', {
      user_id: userId,
      actor_email: email,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      details,
    });
  } catch {
    // Audit logging must not make the primary CMS action fail.
  }
}
