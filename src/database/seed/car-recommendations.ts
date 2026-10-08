import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { inArray, sql } from 'drizzle-orm';
import { permissions, recommendationSettings, rolePermissions, roles } from '../schema/index.js';
import { DEFAULT_RECOMMENDATION_CONFIG } from '../../modules/car-recommendations/defaults.js';
import { RECOMMENDATION_PERMISSIONS } from '../../modules/car-recommendations/domain.js';
import { validateConfig } from '../../modules/car-recommendations/validation.js';
import type { RecommendationDb } from '../../modules/car-recommendations/repository.js';
export async function seedCarRecommendations(db: RecommendationDb) {
  validateConfig(DEFAULT_RECOMMENDATION_CONFIG);
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(620240)`);
    await tx.insert(recommendationSettings).values({ id: 1, enabled: true, config: DEFAULT_RECOMMENDATION_CONFIG, retentionDays: 180 }).onConflictDoNothing();
    await tx.insert(permissions).values(RECOMMENDATION_PERMISSIONS.map(code => ({ code }))).onConflictDoNothing();
    const [roleRows, permissionRows] = await Promise.all([tx.select().from(roles).where(inArray(roles.code, ['ADMIN', 'SUPER_ADMIN', 'SALES'])), tx.select().from(permissions).where(inArray(permissions.code, RECOMMENDATION_PERMISSIONS))]);
    const links = roleRows.flatMap(role => permissionRows.filter(permission => role.code !== 'SALES' || permission.code === 'car_recommendation.sessions.read').map(permission => ({ roleId: role.id, permissionId: permission.id })));
    if (links.length) await tx.insert(rolePermissions).values(links).onConflictDoNothing();
    return { singleton: 1, permissions: permissionRows.length, profilesSeeded: 0 };
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
  try {
    if (!process.argv.includes('--apply') || !process.argv.includes('--development-test')) throw new Error('Seed requires --apply --development-test; production is not authorized.');
    console.log(await seedCarRecommendations(drizzle(pool) as RecommendationDb));
  } catch { console.error('Recommendation seed failed. No connection secrets or SQL parameters are printed.'); process.exitCode = 1; }
  finally { await pool.end(); }
}
