import { env } from 'cloudflare:workers';
import defaults from '../data/site.json';

export type SiteSettings = typeof defaults;

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};

type D1Binding = {
  prepare(query: string): D1Statement;
};

type SettingsRow = {
  value_json: string;
  updated_at: number;
};

function database(): D1Binding | null {
  return ((env as any).DB as D1Binding | undefined) || null;
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

export async function getSiteSettings(): Promise<SiteSettings> {
  const db = database();
  if (!db) return merged(defaults);

  try {
    const row = await db
      .prepare("SELECT value_json, updated_at FROM cms_settings WHERE key = 'site' LIMIT 1")
      .first<SettingsRow>();
    if (!row?.value_json) return merged(defaults);
    return merged(JSON.parse(row.value_json));
  } catch {
    return merged(defaults);
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
  return updatedAt;
}
