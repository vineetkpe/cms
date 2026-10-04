import { listDueScheduledPosts, markSchedulesTriggered } from './schedule-store';
import { touchSchedulerMarker } from './github';

export async function runScheduledPublishing(now = Date.now()) {
  const due = await listDueScheduledPosts(now, 20);
  if (!due.length) return { triggered: 0, slugs: [] as string[] };

  const slugs = due.map((item) => item.slug);
  await touchSchedulerMarker(slugs);
  await markSchedulesTriggered(slugs);
  return { triggered: slugs.length, slugs };
}
