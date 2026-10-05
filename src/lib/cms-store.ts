import { env } from 'cloudflare:workers';
import fallbackSite from '../data/site.json';
import fallbackPages from '../data/pages.json';
import fallbackRedirects from '../data/redirects.json';
import fallbackTemplates from '../data/post-templates.json';

const KEYS = {
  site: 'cms:site',
  pages: 'cms:pages',
  redirects: 'cms:redirects',
  templates: 'cms:templates',
} as const;

export type CmsMediaMetadata = {
  path: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
};

type KvListKey = { name: string; metadata?: unknown };
type KvListResult = { keys: KvListKey[]; list_complete: boolean; cursor?: string };
type KvBinding = {
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
  getWithMetadata<T = unknown, M = unknown>(key: string, type: 'arrayBuffer'): Promise<{ value: ArrayBuffer | null; metadata: M | null }>;
  put(key: string, value: string | ArrayBuffer | ArrayBufferView, options?: { metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<KvListResult>;
};

function kv(): KvBinding {
  const binding = (env as any).CMS_KV as KvBinding | undefined;
  if (!binding) throw new Error('CMS_KV is not configured.');
  return binding;
}

async function getJson<T>(key: string, fallback: T): Promise<T> {
  try {
    return (await kv().get<T>(key, 'json')) || structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

async function putJson(key: string, value: unknown) {
  await kv().put(key, JSON.stringify(value));
  return Date.now().toString(36);
}

export function getSiteSettings() {
  return getJson(KEYS.site, fallbackSite);
}

export function setSiteSettings(value: unknown) {
  return putJson(KEYS.site, value);
}

export function getManagedPages() {
  return getJson(KEYS.pages, fallbackPages);
}

export function setManagedPages(value: unknown) {
  return putJson(KEYS.pages, value);
}

export function getRedirects() {
  return getJson(KEYS.redirects, fallbackRedirects as any[]);
}

export function setRedirects(value: unknown) {
  return putJson(KEYS.redirects, value);
}

export function getPostTemplates() {
  return getJson(KEYS.templates, fallbackTemplates as any[]);
}

export function setPostTemplates(value: unknown) {
  return putJson(KEYS.templates, value);
}

function mediaKey(path: string) {
  return `cms:media:${path.replace(/^\/+/, '')}`;
}

export async function putMedia(path: string, bytes: ArrayBuffer, type: string) {
  const cleanPath = path.replace(/^\/+/, '');
  const metadata: CmsMediaMetadata = {
    path: cleanPath,
    name: cleanPath.split('/').pop() || 'image',
    type,
    size: bytes.byteLength,
    uploadedAt: new Date().toISOString(),
  };
  await kv().put(mediaKey(cleanPath), bytes, { metadata });
  return metadata;
}

export async function getMedia(path: string) {
  return kv().getWithMetadata<ArrayBuffer, CmsMediaMetadata>(mediaKey(path), 'arrayBuffer');
}

export async function deleteMedia(path: string) {
  await kv().delete(mediaKey(path));
}

export async function listMedia(limit = 250): Promise<CmsMediaMetadata[]> {
  const prefix = 'cms:media:';
  const out: CmsMediaMetadata[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv().list({ prefix, cursor, limit: Math.min(1000, Math.max(1, limit - out.length)) });
    for (const item of page.keys) {
      const meta = item.metadata as CmsMediaMetadata | undefined;
      if (meta?.path) out.push(meta);
      else {
        const path = item.name.slice(prefix.length);
        out.push({ path, name: path.split('/').pop() || 'image', type: 'application/octet-stream', size: 0, uploadedAt: '' });
      }
      if (out.length >= limit) break;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < limit);
  return out.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
}
