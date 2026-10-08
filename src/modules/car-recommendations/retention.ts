import { count, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { recommendationSessions, recommendationSettings } from '../../database/schema/index.js';
import type { RecommendationDb } from './repository.js';
export async function pruneRecommendationSessions(db: RecommendationDb, { apply = false, now = new Date() } = {}) {
  const [settings] = await db.select().from(recommendationSettings).where(eq(recommendationSettings.id, 1));
  if (!settings) throw new Error('Recommendation settings missing');
  const expired = or(lt(recommendationSessions.expiresAt, now), lt(recommendationSessions.createdAt, new Date(now.getTime() - settings.retentionDays * 86400000)));
  if (!apply) return { mode: 'dry-run', expired: (await db.select({ count: count() }).from(recommendationSessions).where(expired))[0].count };
  let deleted = 0;
  for (;;) {
    const batch = await db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '8s'`);
      const rows = await tx.select({ id: recommendationSessions.id }).from(recommendationSessions).where(expired).limit(500).for('update', { skipLocked: true });
      if (rows.length) await tx.delete(recommendationSessions).where(inArray(recommendationSessions.id, rows.map(row => row.id)));
      return rows.length;
    });
    deleted += batch; if (!batch) break;
  }
  return { mode: 'apply', deleted, events: 'cascade' };
}
