import { readFile, writeFile, mkdir } from 'node:fs/promises';

const publicDir = new URL('../public/', import.meta.url);
await mkdir(publicDir, { recursive: true });

const redirects = JSON.parse(await readFile(new URL('../src/data/redirects.json', import.meta.url), 'utf8'));
const redirectLines = ['# Generated from src/data/redirects.json. Do not edit by hand.'];
for (const item of Array.isArray(redirects) ? redirects : []) {
  const from = String(item.from || '').trim();
  const to = String(item.to || '').trim();
  const status = Number(item.status || 301);
  if (!from.startsWith('/') || !to || ![301, 302, 303, 307, 308].includes(status)) continue;
  if (/\s/.test(from) || /[\r\n]/.test(to)) continue;
  redirectLines.push(`${from} ${to} ${status}`);
}
await writeFile(new URL('../public/_redirects', import.meta.url), `${redirectLines.join('\n')}\n`, 'utf8');

const site = JSON.parse(await readFile(new URL('../src/data/site.json', import.meta.url), 'utf8'));
const publisher = String(site.adsensePublisherId || '').trim();
const adsText = /^ca-pub-\d+$/i.test(publisher)
  ? `google.com, ${publisher.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`
  : '# Add an AdSense publisher ID in CMS settings to generate ads.txt.\n';
await writeFile(new URL('../public/ads.txt', import.meta.url), adsText, 'utf8');
