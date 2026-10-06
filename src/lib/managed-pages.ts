import { env } from 'cloudflare:workers';
import defaults from '../data/pages.json';

export const MANAGED_PAGE_KEYS = ['about','contact','editorialPolicy','correctionsPolicy','advertisingPolicy','privacy','terms','disclaimer'] as const;
export type ManagedPageKey = typeof MANAGED_PAGE_KEYS[number];
export type ManagedPage = {
  title: string;
  description: string;
  kicker?: string;
  body: string;
  seoTitle?: string;
  seoDescription?: string;
  canonical?: string;
  socialTitle?: string;
  socialDescription?: string;
  ogImage?: string;
  ogImageAlt?: string;
  noindex?: boolean;
};
export type ManagedPages = Record<ManagedPageKey, ManagedPage>;

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
};
type D1Binding = { prepare(query: string): D1Statement };
type PageRow = { slug: string; data_json: string };

function db(): D1Binding | null {
  return ((env as any).DB as D1Binding | undefined) || null;
}

function normalizePage(key: ManagedPageKey, input: any): ManagedPage {
  const fallback = (defaults as any)[key] || {};
  const source = input && typeof input === 'object' ? input : {};
  return {
    title: String(source.title || fallback.title || key),
    description: String(source.description || fallback.description || ''),
    kicker: String(source.kicker || fallback.kicker || ''),
    body: String(source.body || fallback.body || ''),
    seoTitle: String(source.seoTitle || ''),
    seoDescription: String(source.seoDescription || ''),
    canonical: String(source.canonical || ''),
    socialTitle: String(source.socialTitle || ''),
    socialDescription: String(source.socialDescription || ''),
    ogImage: String(source.ogImage || ''),
    ogImageAlt: String(source.ogImageAlt || ''),
    noindex: Boolean(source.noindex),
  };
}

export async function getManagedPages(): Promise<ManagedPages> {
  const pages = Object.fromEntries(MANAGED_PAGE_KEYS.map((key) => [key, normalizePage(key, (defaults as any)[key])])) as ManagedPages;
  const binding = db();
  if (!binding) return pages;
  try {
    const placeholders = MANAGED_PAGE_KEYS.map(() => '?').join(', ');
    const result = await binding.prepare(`SELECT slug, data_json FROM cms_pages WHERE slug IN (${placeholders})`).bind(...MANAGED_PAGE_KEYS).all<PageRow>();
    for (const row of result.results || []) {
      if (!MANAGED_PAGE_KEYS.includes(row.slug as ManagedPageKey)) continue;
      try {
        const key = row.slug as ManagedPageKey;
        pages[key] = normalizePage(key, JSON.parse(row.data_json));
      } catch {}
    }
  } catch {}
  return pages;
}

export async function getManagedPage(key: ManagedPageKey): Promise<ManagedPage> {
  return (await getManagedPages())[key];
}

export async function saveManagedPages(pages: ManagedPages, updatedBy: string) {
  const binding = db();
  if (!binding) throw new Error('DB is not configured.');
  const updatedAt = Math.floor(Date.now() / 1000);
  for (const key of MANAGED_PAGE_KEYS) {
    await binding.prepare(`INSERT INTO cms_pages (slug, data_json, updated_at, updated_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
      .bind(key, JSON.stringify(pages[key]), updatedAt, updatedBy).run();
  }
  return updatedAt;
}
