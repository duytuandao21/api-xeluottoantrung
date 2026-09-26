import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { validateEnv } from '../../config/env.js';
import { auditLogs, carMedia } from '../../database/schema/index.js';
import { R2StorageService } from './storage.service.js';

async function main() {
  const config = validateEnv(process.env);
  const storage = new R2StorageService(new ConfigService(config));
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 2 });
  try {
    const db = drizzle(pool);
    const pending = await db.select().from(carMedia).where(isNotNull(carMedia.deletionPendingAt));
    let recovered = 0;
    for (const media of pending) {
      try {
        if (media.storageKey) await storage.delete(media.storageKey);
        await db.transaction(async (tx) => {
          const [removed] = await tx.delete(carMedia).where(and(eq(carMedia.id, media.id),
            isNotNull(carMedia.deletionPendingAt))).returning();
          if (removed) await tx.insert(auditLogs).values({ action: 'media.delete_recovered', entityType: 'car_media',
            entityId: media.id, oldData: { carId: media.carId, storageKey: media.storageKey, type: media.type }, newData: null });
        });
        recovered++;
      } catch (error) {
        console.error(`Failed to recover media ${media.id}:`, error instanceof Error ? error.message : 'Unknown error');
      }
    }
    console.log(`Recovered ${recovered} of ${pending.length} pending media deletions`);
    if (recovered !== pending.length) process.exitCode = 1;
  } finally { await pool.end(); }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
