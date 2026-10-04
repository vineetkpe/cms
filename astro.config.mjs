import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  adapter: cloudflare(),
  markdown: {
    shikiConfig: { theme: 'github-light' }
  },
  vite: {
    build: { cssMinify: 'lightningcss' }
  }
});
