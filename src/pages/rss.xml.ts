import rss from '@astrojs/rss';
import { getPublishedPosts } from '../lib/posts';
import { getSiteSettings } from '../lib/site-settings';

export const prerender = false;

export async function GET() {
  const site = await getSiteSettings();
  const posts = await getPublishedPosts();
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
