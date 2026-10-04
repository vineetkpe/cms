import type { APIRoute } from 'astro';
import { sameOriginError } from '../../lib/auth';
import { contentLengthOkay, isEmail, publicApiHeaders, text } from '../../lib/security';
import { supabasePublicRpc } from '../../lib/supabase';

export const prerender = false;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const GET: APIRoute = async ({ request }) => {
  try {
    const slug = new URL(request.url).searchParams.get('post')?.trim().toLowerCase() || '';
    if (!SLUG.test(slug)) return Response.json({ comments: [] }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    const comments = await supabasePublicRpc('cms_public_comments', { p_post_slug: slug });
    return Response.json({ comments: Array.isArray(comments) ? comments : [] }, {
      headers: {
        'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return Response.json({ comments: [] }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const originError = sameOriginError(request);
  if (originError) return originError;
  if (!contentLengthOkay(request, 12_000)) return Response.json({ error: 'Request is too large.' }, { status: 413, headers: publicApiHeaders() });

  try {
    const input = await request.json();
    const postSlug = text(input?.postSlug, 160).toLowerCase();
    const name = text(input?.name, 80);
    const email = text(input?.email, 254).toLowerCase();
    const body = text(input?.body, 3000);
    const parentId = text(input?.parentId, 40) || null;
    const honeypot = text(input?.company, 120);

    if (!SLUG.test(postSlug)) return Response.json({ error: 'Invalid article.' }, { status: 400, headers: publicApiHeaders() });
    if (name.length < 2) return Response.json({ error: 'Enter your name.' }, { status: 400, headers: publicApiHeaders() });
    if (!isEmail(email)) return Response.json({ error: 'Enter a valid email address.' }, { status: 400, headers: publicApiHeaders() });
    if (body.length < 2) return Response.json({ error: 'Write a comment before submitting.' }, { status: 400, headers: publicApiHeaders() });
    if (parentId && !/^[0-9a-f-]{36}$/i.test(parentId)) return Response.json({ error: 'Invalid reply target.' }, { status: 400, headers: publicApiHeaders() });

    await supabasePublicRpc('cms_submit_comment', {
      p_post_slug: postSlug,
      p_author_name: name,
      p_author_email: email,
      p_body: body,
      p_parent_id: parentId,
      p_honeypot: honeypot,
    });

    return Response.json({ ok: true, message: 'Thanks. Your comment is waiting for moderation.' }, { status: 202, headers: publicApiHeaders() });
  } catch (error) {
    const message = error instanceof Error && /Too many requests/i.test(error.message)
      ? 'Too many comments from this connection. Please try again later.'
      : 'Unable to submit your comment right now.';
    return Response.json({ error: message }, { status: message.startsWith('Too many') ? 429 : 400, headers: publicApiHeaders() });
  }
};
