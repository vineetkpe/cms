import { publishDueDbPosts } from './db-posts';

export async function runScheduledPublishing(now = Date.now()) {
  return publishDueDbPosts(now);
}
