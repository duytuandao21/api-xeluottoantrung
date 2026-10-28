import { and, eq } from 'drizzle-orm';
import { siteSettings } from '../../database/schema/index.js';
import type { CleanupTransaction } from './storage-cleanup.js';

// A dedicated row lock serializes quota, TV music publication and deletion across processes.
// It neither locks car data nor holds a transaction open while uploading audio.
export async function lockTVMusic(tx: CleanupTransaction) {
  await tx.insert(siteSettings).values({ group: 'tv-music-storage', key: 'lock', value: '', valueType: 'text' }).onConflictDoNothing();
  await tx.select({ id: siteSettings.id }).from(siteSettings)
    .where(and(eq(siteSettings.group, 'tv-music-storage'), eq(siteSettings.key, 'lock'))).for('update');
}
