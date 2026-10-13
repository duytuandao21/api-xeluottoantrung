import type { DatabaseService } from '../database.service.js';
import { ownershipSettings, permissions, rolePermissions, roles } from '../schema/index.js';
import { DEFAULT_SETTINGS } from '../../modules/ownership/defaults.js';
import { OWNERSHIP_PERMISSIONS } from '../../modules/ownership/domain.js';
export async function seedOwnership(db: DatabaseService['db']) {
  await db.transaction(async tx => {
    await tx.insert(ownershipSettings).values({ id: 1, config: DEFAULT_SETTINGS }).onConflictDoNothing();
    await tx.insert(permissions).values(OWNERSHIP_PERMISSIONS.map(code => ({ code }))).onConflictDoNothing();
    const [allRoles, allPermissions] = await Promise.all([tx.select().from(roles), tx.select().from(permissions)]);
    const links = allRoles.filter(r => ['ADMIN', 'SUPER_ADMIN'].includes(r.code)).flatMap(r => allPermissions.filter(p => OWNERSHIP_PERMISSIONS.includes(p.code)).map(p => ({ roleId: r.id, permissionId: p.id })));
    if (links.length) await tx.insert(rolePermissions).values(links).onConflictDoNothing();
  });
}
// Opt-in CLI: importing this module in tests never connects to a database.
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/seed/ownership.ts')) {
  if (!process.argv.includes('--apply')) { console.log('Ownership seed: no changes. Use --apply after choosing the target DATABASE_URL.'); }
  else {
    const { config } = await import('dotenv'); config({ quiet: true });
    const { Pool } = await import('pg'); const { drizzle } = await import('drizzle-orm/node-postgres');
    const schema = await import('../schema/index.js'); const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    try { if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required'); await seedOwnership(drizzle(pool, { schema })); console.log('Ownership defaults and permissions seeded; existing settings preserved.'); }
    catch { console.error('Ownership seed failed. No connection details or SQL parameters are printed.'); process.exitCode = 1; }
    finally { await pool.end(); }
  }
}
