import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, inArray } from 'drizzle-orm';
import { permissions, rolePermissions, roles, valuationPolicies, valuationSettings } from '../schema/index.js';
import { DEFAULT_CONFIG, DEFAULT_DISCLAIMER } from '../../modules/valuation/defaults.js';
import { VALUATION_PERMISSIONS } from '../../modules/valuation/domain.js';
import { seedDraftExamples } from '../../modules/valuation/seed-data.js';
import type { Db } from '../../modules/valuation/valuation.repository.js';
export async function seedValuation(db: Db) {
  return db.transaction(async tx => {
    // Serialize seed runs without needing any existing singleton or overwriting config.
    await tx.execute((await import('drizzle-orm')).sql`SELECT pg_advisory_xact_lock(72419601)`);
    await tx.insert(permissions).values(VALUATION_PERMISSIONS.map(code => ({ code }))).onConflictDoNothing();
    const roleRows = await tx.select().from(roles).where(inArray(roles.code, ['ADMIN', 'SUPER_ADMIN', 'SALES']));
    const permissionRows = await tx.select().from(permissions).where(inArray(permissions.code, VALUATION_PERMISSIONS));
    const links = roleRows.flatMap(role => permissionRows.filter(permission => role.code !== 'SALES' || ['valuation.read', 'valuation.history.read', 'valuation.history.update'].includes(permission.code)).map(permission => ({ roleId: role.id, permissionId: permission.id })));
    if (links.length) await tx.insert(rolePermissions).values(links).onConflictDoNothing();
    await tx.insert(valuationSettings).values({ id: 1, disclaimer: DEFAULT_DISCLAIMER, ctaLabel: 'Đăng ký kiểm định xe' }).onConflictDoNothing();
    const [existing] = await tx.select().from(valuationPolicies).where(eq(valuationPolicies.version, '0.1.0'));
    if (existing) return { created: false, policyId: existing.id };
    const [policy] = await tx.insert(valuationPolicies).values({ name: 'Cấu hình mẫu — cần rà soát', version: '0.1.0', config: DEFAULT_CONFIG }).returning();
    await seedDraftExamples(tx, policy.id);
    return { created: true, policyId: policy.id };
  });
}
async function main() {
  if (!process.argv.includes('--apply')) { console.log('Seed plan: disabled valuation settings, DRAFT example rules/options, no reference prices; Admin/Super Admin permissions, Sales may read configuration and handle history/leads. Use --apply after migration.'); return; }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try { const result = await seedValuation(drizzle(pool)); console.log(`Valuation seed completed; draft ${result.created ? 'created' : 'preserved'}, no prices fabricated, public feature remains disabled.`); }
  finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Valuation seed failed'); process.exitCode = 1; });
