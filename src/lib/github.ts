import { getSecret } from 'astro:env/server';

const API = 'https://api.github.com';

function config() {
  const token = getSecret('CMS_GITHUB_TOKEN');
  const repo = getSecret('CMS_GITHUB_REPO') || 'vineetkpe/cms';
  const branch = getSecret('CMS_GITHUB_BRANCH') || 'main';
  if (!token) throw new Error('CMS_GITHUB_TOKEN is not configured.');
  return { token, repo, branch };
}

async function github(path: string, init: RequestInit = {}) {
  const { token } = config();
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.status === 204 ? null : response.json();
}

function encodeUtf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeUtf8(value: string) {
  const binary = atob(value.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function listDirectory(path: string) {
  const { repo, branch } = config();
  return github(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
}

export async function getTextFile(path: string) {
  const { repo, branch } = config();
  const file = await github(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
  return { ...file, text: decodeUtf8(file.content) };
}

export async function putTextFile(path: string, text: string, message: string, sha?: string) {
  const { repo, branch } = config();
  return github(`/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, branch, content: encodeUtf8(text), ...(sha ? { sha } : {}) })
  });
}

export async function putBase64File(path: string, base64: string, message: string, sha?: string) {
  const { repo, branch } = config();
  return github(`/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, branch, content: base64, ...(sha ? { sha } : {}) })
  });
}

export async function deleteFile(path: string, sha: string, message: string) {
  const { repo, branch } = config();
  return github(`/repos/${repo}/contents/${path}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, branch, sha })
  });
}
