import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authError, requireAdmin } from '../../../lib/auth';

export const prerender = false;

type AiBinding = { run(model: string, input: unknown): Promise<any> };

const ACTIONS = new Set(['ask', 'ideas', 'outline', 'titles', 'seo', 'improve', 'continue']);

function clean(value: unknown, max = 12000) {
  return String(value ?? '').trim().slice(0, max);
}

function actionInstruction(action: string) {
  switch (action) {
    case 'ideas': return 'Suggest 6 practical article angles. Each should include a clear search intent and a useful reader outcome. Avoid clickbait.';
    case 'outline': return 'Create a strong SEO-friendly article outline using H2/H3 headings. Include intro angle, key sections, FAQs, and suggested internal-link opportunities. Do not invent facts.';
    case 'titles': return 'Suggest 10 concise, natural article titles and 5 meta-title options. Keep them useful and non-clickbait.';
    case 'seo': return 'Review the article for on-page SEO. Suggest a focus keyword, SEO title, meta description, missing subtopics, internal-link ideas, and any readability improvements. Do not claim guaranteed rankings.';
    case 'improve': return 'Improve the supplied article draft for clarity, structure, usefulness, factual caution, and natural SEO. Return an improved Markdown version without changing verified facts.';
    case 'continue': return 'Continue the article naturally in Markdown, matching its tone and structure. Add useful substance rather than filler. Do not invent facts that are not supported by the draft.';
    default: return 'Answer the author request as an experienced editor and SEO content strategist. Be practical, concise, and factually cautious.';
  }
}

async function callGemini(prompt: string) {
  const apiKey = clean((env as any).GEMINI_API_KEY, 500);
  if (!apiKey) return null;
  const model = clean((env as any).GEMINI_MODEL || 'gemini-3.8-flash', 80).replace(/[^a-zA-Z0-9._-]/g, '') || 'gemini-3.8-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.35, maxOutputTokens: 2200 },
    }),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Gemini returned ${response.status}.`);
  const text = (data?.candidates?.[0]?.content?.parts || []).map((part: any) => String(part?.text || '')).join('\n').trim();
  if (!text) throw new Error('Gemini returned an empty response.');
  return { text, provider: 'Gemini', model };
}

async function callWorkersAi(prompt: string) {
  const ai = (env as any).AI as AiBinding | undefined;
  if (!ai) return null;
  const result = await ai.run('@cf/google/gemma-4-26b-a4b-it', {
    messages: [
      { role: 'system', content: 'You are a careful publication editor. Never promise rankings or invent facts.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 2200,
    temperature: 0.35,
    chat_template_kwargs: { enable_thinking: false },
  });
  const text = String(result?.response || result?.result?.response || '').trim();
  return text ? { text, provider: 'Workers AI', model: 'gemma-4-26b-a4b-it' } : null;
}

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin', 'editor', 'author']);
  if (!auth.ok) return authError(auth);

  try {
    const body = await request.json().catch(() => ({}));
    const action = ACTIONS.has(String(body?.action || '')) ? String(body.action) : 'ask';
    const title = clean(body?.title, 180);
    const description = clean(body?.description, 500);
    const focusKeyword = clean(body?.focusKeyword, 120);
    const category = clean(body?.category, 80);
    const article = clean(body?.article, 14000);
    const userPrompt = clean(body?.prompt, 1500);

    if (!title && !article && !userPrompt) throw new Error('Add a title, article draft, or question first.');

    const prompt = [
      'You are assisting an author inside a professional blogging CMS.',
      'Never claim that SEO changes guarantee Google rankings. Do not fabricate statistics, news, dates, quotes, eligibility rules, or sources.',
      `Task: ${actionInstruction(action)}`,
      title ? `Article title: ${title}` : '',
      description ? `Description: ${description}` : '',
      focusKeyword ? `Focus keyword: ${focusKeyword}` : '',
      category ? `Category: ${category}` : '',
      userPrompt ? `Author request: ${userPrompt}` : '',
      article ? `Current article Markdown:\n---\n${article}\n---` : '',
      'Return only the useful answer for the author. Use Markdown where appropriate.',
    ].filter(Boolean).join('\n\n');

    const gemini = await callGemini(prompt);
    const result = gemini || await callWorkersAi(prompt);
    if (!result) throw new Error('AI is not configured. Add GEMINI_API_KEY as a Cloudflare Worker secret.');

    return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to generate AI suggestion.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
};
