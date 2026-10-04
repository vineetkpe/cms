import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import rehypeSanitize from 'rehype-sanitize';

export default defineConfig({
  adapter: cloudflare({
    imageService: 'compile',
    remoteBindings: false,
  }),
  session: false,
  markdown: {
    shikiConfig: { theme: 'github-light' },
    rehypePlugins: [rehypeSanitize]
  },
  vite: {
    build: { cssMinify: 'lightningcss' }
  }
});
