import { env } from 'cloudflare:workers';
import defaults from '../data/site.json';

export type SiteSettings = typeof defaults;

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};

type D1Binding = { prepare(query: string): D1Statement };
type KVBinding = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

type SettingsRow = { value_json: string; updated_at: number };

const CACHE_KEY = 'cms:public:site-settings:v1';
const MEMORY_TTL_MS = 60_000;
let memoryCache: { value: SiteSettings; expiresAt: number } | null = null;

function database(): D1Binding | null {
  return ((env as any).DB as D1Binding | undefined) || null;
}

function kv(): KVBinding | null {
  return ((env as any).CMS_KV as KVBinding | undefined) || null;
}

function merged(input: any): SiteSettings {
  const source = input && typeof input === 'object' ? input : {};
  return {
    ...defaults,
    ...source,
    theme: { ...defaults.theme, ...(source.theme && typeof source.theme === 'object' ? source.theme : {}) },
    social: { ...defaults.social, ...(source.social && typeof source.social === 'object' ? source.social : {}) },
    navigation: Array.isArray(source.navigation) ? source.navigation : defaults.navigation,
  } as SiteSettings;
}

function remember(value: SiteSettings) {
  memoryCache = { value, expiresAt: Date.now() + MEMORY_TTL_MS };
  return value;
}

export async function getSiteSettings(): Promise<SiteSettings> {
  if (memoryCache && memoryCache.expiresAt > Date.now()) return memoryCache.value;

  const cache = kv();
  if (cache) {
    const cached = await cache.get(CACHE_KEY).catch(() => null);
    if (cached) {
      try { return remember(merged(JSON.parse(cached))); } catch {}
    }
  }

  const db = database();
  if (!db) return remember(merged(defaults));

  try {
    const row = await db
      .prepare("SELECT value_json, updated_at FROM cms_settings WHERE key = 'site' LIMIT 1")
      .first<SettingsRow>();
    const settings = row?.value_json ? merged(JSON.parse(row.value_json)) : merged(defaults);
    if (cache) await cache.put(CACHE_KEY, JSON.stringify(settings), { expirationTtl: 3600 }).catch(() => {});
    return remember(settings);
  } catch {
    return remember(merged(defaults));
  }
}

export async function saveSiteSettings(settings: SiteSettings, updatedBy: string) {
  const db = database();
  if (!db) throw new Error('DB is not configured.');
  const updatedAt = Math.floor(Date.now() / 1000);
  await db.prepare(`INSERT INTO cms_settings (key, value_json, updated_at, updated_by)
    VALUES ('site', ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by`)
    .bind(JSON.stringify(settings), updatedAt, updatedBy)
    .run();

  const clean = merged(settings);
  memoryCache = { value: clean, expiresAt: Date.now() + MEMORY_TTL_MS };
  const cache = kv();
  if (cache) await cache.put(CACHE_KEY, JSON.stringify(clean), { expirationTtl: 3600 }).catch(() => {});
  return updatedAt;
}
