import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pruneRecommendationSessions } from '../src/modules/car-recommendations/retention.js';
import type { RecommendationDb } from '../src/modules/car-recommendations/repository.js';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
try {
  console.log(await pruneRecommendationSessions(drizzle(pool) as RecommendationDb, { apply: process.argv.includes('--apply') }));
} catch { console.error('Retention operation failed. Inspect authorized server diagnostics.'); process.exitCode = 1; }
finally { await pool.end(); }
