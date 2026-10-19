import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { validateEnv } from '../../config/env.js';
import { DatabaseService } from '../../database/database.service.js';
import { StorageCleanupService } from './storage-cleanup.service.js';
import { R2StorageService } from './storage.service.js';

async function main() {
  const config = validateEnv(process.env);
  const storage = new R2StorageService(new ConfigService(config));
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 2 });
  try {
    const db = drizzle(pool);
    const cleanup = new StorageCleanupService({ db } as unknown as DatabaseService, storage);
    await cleanup.flush();
    const result = await db.execute(sql`SELECT count(*)::int AS total FROM audit_logs p
      WHERE p.entity_type = 'storage_object' AND p.action = 'storage.delete_pending'
      AND NOT EXISTS (SELECT 1 FROM audit_logs d WHERE d.entity_type = 'storage_object' AND d.entity_id = p.entity_id
        AND d.action IN ('storage.deleted', 'storage.retained'))`);
    const remaining = Number(result.rows[0]?.total ?? 0);
    console.log(`Processed one bounded cleanup batch (up to 25 objects); ${remaining} pending. API retries every minute.`);
    if (remaining) process.exitCode = 1;
  } finally { await pool.end(); }
}

main().catch(() => { console.error('Storage cleanup could not finish; inspect API configuration and pending job counts.'); process.exitCode = 1; });
