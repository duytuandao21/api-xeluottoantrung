import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { inArray } from 'drizzle-orm';
import { auspiciousRuleContents, auspiciousRules, auspiciousRuleSets, auspiciousSettings, permissions, rolePermissions, roles } from '../schema/index.js';
import { INITIAL_RULES } from '../../modules/auspicious-date/defaults.js';
import { PURPOSES } from '../../modules/auspicious-date/domain.js';

async function main() {
  if (!process.argv.includes('--apply')) { console.log('Seed plan: disabled settings, 3 DRAFT rulesets, foundational rules without verified sources. Use --apply after migration.'); return; }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    await drizzle(pool).transaction(async tx => {
      const codes = ['read', 'settings.update', 'rules.read', 'rules.update', 'content.update', 'sources.manage', 'versions.manage', 'publish', 'simulate', 'audit.read'].map(action => `auspicious_date.${action}`);
      await tx.insert(permissions).values(codes.map(code => ({ code }))).onConflictDoNothing();
      const existingRoles = await tx.select().from(roles).where(inArray(roles.code, ['SUPER_ADMIN', 'ADMIN', 'CONTENT_EDITOR']));
      const featurePermissions = await tx.select().from(permissions).where(inArray(permissions.code, codes));
      const links = existingRoles.flatMap(role => featurePermissions.filter(permission => role.code !== 'CONTENT_EDITOR' || ['auspicious_date.read', 'auspicious_date.rules.read', 'auspicious_date.content.update'].includes(permission.code)).map(permission => ({ roleId: role.id, permissionId: permission.id })));
      if (links.length) await tx.insert(rolePermissions).values(links).onConflictDoNothing();
      await tx.insert(auspiciousSettings).values({ id: 1 }).onConflictDoNothing();
      for (const purpose of PURPOSES) {
        const [set] = await tx.insert(auspiciousRuleSets).values({ code: purpose, name: `Bộ quy tắc ${purpose}`, purpose, version: '1.0.0' }).onConflictDoNothing().returning();
        if (!set) continue;
        for (const { title, description, ...rule } of INITIAL_RULES) {
          const [created] = await tx.insert(auspiciousRules).values({ ...rule, ruleSetId: set.id }).returning();
          await tx.insert(auspiciousRuleContents).values({ ruleId: created.id, title, shortDescription: description, detailDescription: description });
        }
      }
    });
    console.log('Auspicious-date foundation seeded. No production ruleset published.');
  } finally { await pool.end(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Seed failed'); process.exitCode = 1; });
