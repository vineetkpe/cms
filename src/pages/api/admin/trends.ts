import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authError, requireAdmin } from '../../../lib/auth';
import { getSiteSettings } from '../../../lib/site-settings';

export const prerender = false;

type TrendItem = {
  title: string;
  traffic: string;
  trafficValue: number;
  pubDate: string;
  newsTitle: string;
  score: number;
  matchedKeywords: string[];
};

type Idea = {
  title: string;
  primaryKeyword: string;
  angle: string;
  intent: string;
  urgency: string;
  reason: string;
  sourceTrend: string;
};

type KVBinding = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

type AiBinding = {
  run(model: string, input: unknown): Promise<any>;
};

function decodeXml(input: string) {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function field(block: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? decodeXml(match[1]).trim() : '';
}

function trafficNumber(raw: string) {
  const match = raw.replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return 0;
  const base = Number(match[1] || 0);
  const multiplier = match[2]?.toUpperCase() === 'B' ? 1_000_000_000 : match[2]?.toUpperCase() === 'M' ? 1_000_000 : match[2]?.toUpperCase() === 'K' ? 1_000 : 1;
  return Math.round(base * multiplier);
}

function tokenize(text: string) {
  return text.toLowerCase().split(/[^a-z0-9+#]+/).map((x) => x.trim()).filter((x) => x.length >= 3);
}

function siteKeywords(site: any) {
  const configured = Array.isArray(site?.trendKeywords) ? site.trendKeywords : [];
  const fromNiche = tokenize(String(site?.contentNiche || ''));
  return [...new Set([...configured.map((x: unknown) => String(x).toLowerCase().trim()), ...fromNiche])].filter(Boolean).slice(0, 40);
}

function scoreTrend(title: string, newsTitle: string, keywords: string[]) {
  const haystack = `${title} ${newsTitle}`.toLowerCase();
  const matched = keywords.filter((keyword) => keyword.length >= 3 && haystack.includes(keyword));
  let score = matched.length * 12;
  const words = new Set(tokenize(haystack));
  score += keywords.filter((keyword) => words.has(keyword)).length * 4;
  return { score, matched };
}

function parseRss(xml: string, keywords: string[]): TrendItem[] {
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]).slice(0, 80);
  return blocks.map((block) => {
    const title = field(block, 'title');
    const traffic = field(block, 'ht:approx_traffic');
    const pubDate = field(block, 'pubDate');
    const newsTitle = field(block, 'ht:news_item_title');
    const ranked = scoreTrend(title, newsTitle, keywords);
    return { title, traffic, trafficValue: trafficNumber(traffic), pubDate, newsTitle, score: ranked.score, matchedKeywords: ranked.matched };
  }).filter((item) => item.title).sort((a, b) => b.score - a.score || b.trafficValue - a.trafficValue);
}

function fallbackIdeas(trends: TrendItem[], niche: string): Idea[] {
  const candidates = trends.filter((t) => t.score > 0).slice(0, 6);
  return candidates.map((trend) => {
    const keyword = trend.matchedKeywords[0] || trend.title;
    return {
      title: `${trend.title}: what readers in ${niche || 'our niche'} should know`,
      primaryKeyword: keyword,
      angle: `Explain the verified update, why it matters, key dates or actions, and link readers to official sources.`,
      intent: 'Informational / fresh update',
      urgency: trend.trafficValue >= 100000 ? 'High' : trend.trafficValue >= 10000 ? 'Medium' : 'Normal',
      reason: `Google Trends shows active interest${trend.traffic ? ` (${trend.traffic})` : ''}${trend.matchedKeywords.length ? ` and matches ${trend.matchedKeywords.join(', ')}` : ''}.`,
      sourceTrend: trend.title,
    };
  });
}

function cleanIdea(raw: any): Idea | null {
  const title = String(raw?.title || '').trim().slice(0, 180);
  if (!title) return null;
  return {
    title,
    primaryKeyword: String(raw?.primaryKeyword || raw?.keyword || '').trim().slice(0, 100),
    angle: String(raw?.angle || '').trim().slice(0, 500),
    intent: String(raw?.intent || 'Informational').trim().slice(0, 80),
    urgency: String(raw?.urgency || 'Normal').trim().slice(0, 30),
    reason: String(raw?.reason || '').trim().slice(0, 320),
    sourceTrend: String(raw?.sourceTrend || '').trim().slice(0, 160),
  };
}

function extractJson(text: string) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

async function loadTrends(geo: string, site: any) {
  const keywords = siteKeywords(site);
  const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 CMS Trend Intelligence/1.0', 'Accept': 'application/rss+xml,text/xml;q=0.9,*/*;q=0.8' },
  });
  if (!response.ok) throw new Error(`Google Trends returned ${response.status}.`);
  const xml = await response.text();
  const parsed = parseRss(xml, keywords);
  const relevant = parsed.filter((item) => item.score > 0);
  return {
    keywords,
    all: parsed.slice(0, 30),
    relevant: (relevant.length ? relevant : parsed).slice(0, 12),
  };
}

async function generateAiIdeas(trends: TrendItem[], niche: string, keywords: string[]) {
  const ai = (env as any).AI as AiBinding | undefined;
  if (!ai) return null;
  const shortlist = trends.slice(0, 10).map((t) => ({ title: t.title, traffic: t.traffic, matchedKeywords: t.matchedKeywords }));
  const prompt = `You are an SEO content strategist for a publication focused on: ${niche}.\nNiche keywords: ${keywords.join(', ')}.\nBelow are live Google Trends items. Create up to 6 article ideas that are genuinely relevant to this niche. Do not invent news, dates, eligibility rules or facts. Suggest editorial angles only. Prefer useful search intent over clickbait. If a trend is not relevant, skip it.\n\nTrends: ${JSON.stringify(shortlist)}\n\nReturn ONLY a JSON array. Each object must have: title, primaryKeyword, angle, intent, urgency (High|Medium|Normal), reason, sourceTrend.`;
  const result = await ai.run('@cf/google/gemma-4-26b-a4b-it', {
    messages: [
      { role: 'system', content: 'Return strict JSON only. Be conservative about relevance and factual claims.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 1200,
    temperature: 0.35,
    chat_template_kwargs: { enable_thinking: false },
  });
  const text = String(result?.response || result?.result?.response || '');
  const parsed = extractJson(text);
  return Array.isArray(parsed) ? parsed.map(cleanIdea).filter(Boolean).slice(0, 6) as Idea[] : null;
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return authError(auth);
  try {
    const site = await getSiteSettings();
    const url = new URL(request.url);
    const geo = String(url.searchParams.get('geo') || (site as any).trendGeo || 'IN').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'IN';
    const niche = String((site as any).contentNiche || 'jobs, careers, education and useful updates');
    const data = await loadTrends(geo, site);
    const kv = (env as any).CMS_KV as KVBinding | undefined;
    const cacheKey = `cms:trend-ideas:v2:${geo}:${data.keywords.join('-').slice(0, 120)}`;
    let cachedIdeas: Idea[] | null = null;
    if (kv) {
      const cached = await kv.get(cacheKey).catch(() => null);
      if (cached) {
        try { cachedIdeas = JSON.parse(cached); } catch { cachedIdeas = null; }
      }
    }
    return Response.json({
      geo,
      niche,
      source: 'Google Trends',
      sourceUrl: `https://trends.google.com/trending?geo=${geo}`,
      trends: data.relevant,
      ideas: cachedIdeas || fallbackIdeas(data.relevant, niche),
      aiCached: Boolean(cachedIdeas),
      aiAvailable: Boolean((env as any).AI),
      generatedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load trend intelligence.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request, ['owner', 'admin', 'editor']);
  if (!auth.ok) return authError(auth);
  try {
    const site = await getSiteSettings();
    const body = await request.json().catch(() => ({}));
    const geo = String(body?.geo || (site as any).trendGeo || 'IN').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'IN';
    const niche = String((site as any).contentNiche || 'jobs, careers, education and useful updates');
    const data = await loadTrends(geo, site);
    const aiIdeas = await generateAiIdeas(data.relevant, niche, data.keywords);
    const ideas = aiIdeas?.length ? aiIdeas : fallbackIdeas(data.relevant, niche);
    const kv = (env as any).CMS_KV as KVBinding | undefined;
    if (kv && aiIdeas?.length) {
      const cacheKey = `cms:trend-ideas:v2:${geo}:${data.keywords.join('-').slice(0, 120)}`;
      await kv.put(cacheKey, JSON.stringify(ideas), { expirationTtl: 21600 }).catch(() => {});
    }
    return Response.json({ ok: true, geo, niche, ideas, aiUsed: Boolean(aiIdeas?.length), generatedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to generate AI topic ideas.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
};
