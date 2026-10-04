import { getSecret } from 'astro:env/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export async function requireAdmin(request: Request) {
  if (getSecret('DEV_ADMIN_BYPASS') === 'true') {
    return { ok: true as const, email: 'local-dev' };
  }

  const token = request.headers.get('cf-access-jwt-assertion');
  const audience = getSecret('CF_ACCESS_AUD');
  const rawDomain = getSecret('CF_ACCESS_TEAM_DOMAIN');

  if (!token || !audience || !rawDomain) {
    return { ok: false as const, status: 403, message: 'Cloudflare Access authentication is required.' };
  }

  const issuer = rawDomain.replace(/\/$/, '');
  try {
    const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, jwks, { issuer, audience });
    return { ok: true as const, email: String(payload.email || 'authenticated-admin') };
  } catch {
    return { ok: false as const, status: 403, message: 'Invalid Cloudflare Access token.' };
  }
}

export function authError(result: { status: number; message: string }) {
  return Response.json({ error: result.message }, { status: result.status });
}
