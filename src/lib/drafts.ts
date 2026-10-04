import { getSecret } from 'astro:env/server';
import type { AdminPost } from './markdown';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const DRAFT_DIR = '.cms/drafts';

function secret() {
  const value = getSecret('CMS_DRAFT_KEY') || getSecret('CMS_GITHUB_TOKEN');
  if (!value) throw new Error('CMS_DRAFT_KEY or CMS_GITHUB_TOKEN is required for encrypted drafts.');
  return value;
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey() {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret()));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function draftPath(slug: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(slug)));
  const opaqueName = Array.from(signature).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${DRAFT_DIR}/${opaqueName}.json`;
}

export async function encryptDraft(post: AdminPost) {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify({ ...post, sha: undefined }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return `${JSON.stringify({ v: 1, iv: toBase64(iv), data: toBase64(ciphertext) }, null, 2)}\n`;
}

export async function decryptDraft(text: string): Promise<AdminPost> {
  const payload = JSON.parse(text);
  if (payload?.v !== 1 || !payload.iv || !payload.data) throw new Error('Unsupported encrypted draft format.');
  const key = await encryptionKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(String(payload.iv)) },
    key,
    fromBase64(String(payload.data))
  );
  const post = JSON.parse(decoder.decode(plaintext)) as AdminPost;
  return { ...post, draft: true, sha: undefined };
}
