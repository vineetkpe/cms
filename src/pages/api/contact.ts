import type { APIRoute } from 'astro';
import { sameOriginError } from '../../lib/auth';
import { contentLengthOkay, isEmail, publicApiHeaders, requestFingerprint, text } from '../../lib/security';
import { supabasePublicRpc } from '../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const originError = sameOriginError(request);
  if (originError) return originError;
  if (!contentLengthOkay(request, 16_000)) return Response.json({ error: 'Request is too large.' }, { status: 413, headers: publicApiHeaders() });

  try {
    const input = await request.json();
    const name = text(input?.name, 100);
    const email = text(input?.email, 254).toLowerCase();
    const subject = text(input?.subject, 160);
    const message = text(input?.message, 5000);
    const honeypot = text(input?.company, 120);

    if (name.length < 2) return Response.json({ error: 'Enter your name.' }, { status: 400, headers: publicApiHeaders() });
    if (!isEmail(email)) return Response.json({ error: 'Enter a valid email address.' }, { status: 400, headers: publicApiHeaders() });
    if (subject.length < 2) return Response.json({ error: 'Enter a subject.' }, { status: 400, headers: publicApiHeaders() });
    if (message.length < 5) return Response.json({ error: 'Write a little more in your message.' }, { status: 400, headers: publicApiHeaders() });

    const fingerprint = await requestFingerprint(request);
    await supabasePublicRpc('cms_submit_contact', {
      p_name: name,
      p_email: email,
      p_subject: subject,
      p_message: message,
      p_fingerprint: fingerprint,
      p_honeypot: honeypot,
    });

    return Response.json({ ok: true, message: 'Message received. Thanks for getting in touch.' }, { status: 202, headers: publicApiHeaders() });
  } catch (error) {
    const message = error instanceof Error && /Too many requests/i.test(error.message)
      ? 'Too many messages from this connection. Please try again later.'
      : 'Unable to send your message right now.';
    return Response.json({ error: message }, { status: message.startsWith('Too many') ? 429 : 400, headers: publicApiHeaders() });
  }
};
