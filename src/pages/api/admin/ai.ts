import type { APIRoute } from 'astro';
import { authError, requireAdmin } from '../../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin', 'editor', 'author']);
  if (!auth.ok) return authError(auth);

  return Response.json({
    error: 'AI generation is disabled in zero-cost mode to prevent accidental paid inference usage.',
    zeroCostMode: true
  }, {
    status: 503,
    headers: { 'Cache-Control': 'no-store' }
  });
};
