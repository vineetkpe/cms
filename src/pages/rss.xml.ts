import rss from '@astrojs/rss';
import { getPublishedPostPage } from '../lib/posts';
import { getSiteSettings } from '../lib/site-settings';

export const prerender = false;

export async function GET() {
  const [site, page] = await Promise.all([
    getSiteSettings(),
    getPublishedPostPage(100, 0),
  ]);
  return rss({
    title: site.name,
    description: site.description,
    site: site.url,
    items: page.posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/${post.id.replace(/\.md$/, '')}/`,
    })),
  });
}
