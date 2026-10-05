import rss from '@astrojs/rss';
import { getSiteSettings } from '../lib/cms-store';
import { getPublishedPosts } from '../lib/posts';

export const prerender = false;

export async function GET() {
  const [posts, site] = await Promise.all([getPublishedPosts(), getSiteSettings()]);
  return rss({
    title: site.name,
    description: site.description,
    site: site.url,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/${post.id.replace(/\.md$/, '')}/`
    }))
  });
}
