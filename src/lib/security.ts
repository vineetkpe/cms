export function text(value: unknown, max: number) {
  return String(value ?? '').trim().slice(0, max);
}

export function isEmail(value: string) {
  return value.length >= 3 && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function safePublicUrl(value: unknown, allowRelative = false) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (allowRelative && raw.startsWith('/') && !raw.startsWith('//')) return raw.slice(0, 300);
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString().slice(0, 500);
  } catch {
    return '';
  }
}

export function contentLengthOkay(request: Request, maxBytes: number) {
  const raw = request.headers.get('content-length');
  if (!raw) return true;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= maxBytes;
}

export async function requestFingerprint(request: Request) {
  const forwarded = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  const basis = forwarded === 'unknown'
    ? `unknown|${request.headers.get('user-agent') || 'unknown'}`
    : forwarded;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(basis));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function publicApiHeaders() {
  return {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };
}
