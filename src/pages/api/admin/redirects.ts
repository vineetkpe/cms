import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';
import { getTextFile, putTextFile } from '../../../lib/github';

export const prerender = false;
const PATH = 'src/data/redirects.json';
const ALLOWED = new Set([301, 302, 303, 307, 308]);

function cleanRedirects(input: unknown) {
  if (!Array.isArray(input)) throw new Error('Redirect list must be an array.');
  if (input.length > 500) throw new Error('This CMS limits redirects to 500 entries.');
  const seen = new Set<string>();
  return input.map((item: any) => {
    const from = String(item?.from || '').trim();
    const to = String(item?.to || '').trim();
    const status = Number(item?.status || 301);
    if (!from.startsWith('/') || /\s|[\r\n]/.test(from)) throw new Error(`Invalid source path: ${from || '(empty)'}`);
    if (!to || /[\r\n]/.test(to)) throw new Error(`Invalid destination for ${from}`);
    if (!ALLOWED.has(status)) throw new Error(`Invalid redirect status for ${from}`);
    if (seen.has(from)) throw new Error(`Duplicate redirect source: ${from}`);
    seen.add(from);
    return { from, to, status };
  });
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const file = await getTextFile(PATH);
    return Response.json({ redirects: JSON.parse(file.text), sha: file.sha, role: auth.role }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load redirects.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const PUT: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin', 'editor']);
  if (!auth.ok) return authError(auth);
  try {
    const { redirects, sha } = await request.json();
    const clean = cleanRedirects(redirects);
    const result = await putTextFile(PATH, `${JSON.stringify(clean, null, 2)}\n`, 'Update redirects', String(sha || ''));
    return Response.json({ ok: true, commit: result?.commit?.sha || null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update redirects.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};
