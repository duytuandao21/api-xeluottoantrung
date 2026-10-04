import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../src/database/database.service.js';
import { auspiciousChangeLogs, auspiciousRuleSets, permissions, profiles, rolePermissions, roles, userRoles } from '../src/database/schema/index.js';
import { AuspiciousRepository, type Tx } from '../src/modules/auspicious-date/repository.js';

// One-time operator cleanup. Defaults to a read-only plan. Applying requires
// explicit IDs and an authorized admin for the owner's development/test DB.
const removable = ['DRAFT', 'REVIEW'] as const;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const arg = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function main() {
  const apply = process.argv.includes('--apply'), actorId = arg('--actor');
  const ids = arg('--ids')?.split(',') ?? [];
  if (apply && (!process.argv.includes('--development-test') || !uuid.test(actorId ?? '') || !ids.length || ids.some(id => !uuid.test(id)) || new Set(ids).size !== ids.length)) {
    throw new Error('Require --apply --development-test --actor <admin UUID> --ids <comma-separated version UUIDs>.');
  }
  const database = new DatabaseService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
  const repo = new AuspiciousRepository(database);
  const reason = 'Xóa các bản nháp và chờ duyệt theo yêu cầu chủ website; giữ các bản đã xuất bản. Thực hiện bằng công cụ vận hành trên database phát triển/test.';
  try {
    if (!apply) {
      const versions = await database.db.select().from(auspiciousRuleSets).where(inArray(auspiciousRuleSets.status, [...removable]));
      console.log(JSON.stringify({ mode: 'read-only', candidates: versions.map(({ id, name, purpose, version, status }) => ({ id, name, purpose, version, status })) }, null, 2));
      return;
    }
    const grants = await database.db.select({ code: permissions.code }).from(profiles)
      .innerJoin(userRoles, eq(userRoles.profileId, profiles.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id)).innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(eq(profiles.id, actorId!), eq(profiles.status, 'active'), isNull(profiles.deletedAt), inArray(roles.code, ['SUPER_ADMIN', 'ADMIN'])));
    if (!grants.some(grant => grant.code === 'auspicious_date.versions.manage')) throw new Error('Operator lacks auspicious_date.versions.manage.');

    const outcome = await database.db.transaction(async (tx: Tx) => {
      // Same lock order as publication: settings first, then versions.
      await tx.execute(sql`SELECT id FROM auspicious_date_settings WHERE id = 1 FOR UPDATE`);
      const settings = await repo.settings(tx);
      const targets = await tx.select().from(auspiciousRuleSets).where(inArray(auspiciousRuleSets.id, ids)).for('update');
      if (targets.length !== ids.length || targets.some(set => set.status !== 'DRAFT' && set.status !== 'REVIEW' || set.publishedAt !== null)) {
        throw new Error('An explicit target is missing or has been published/changed to another status. Nothing deleted.');
      }
      const published = await tx.select().from(auspiciousRuleSets).where(eq(auspiciousRuleSets.status, 'PUBLISHED')).orderBy(auspiciousRuleSets.id);
      const publishedState = async () => {
        const snapshots = [];
        for (const set of published) snapshots.push(await repo.snapshot(set.id, tx));
        const logs = published.length ? await tx.select().from(auspiciousChangeLogs).where(inArray(auspiciousChangeLogs.ruleSetId, published.map(set => set.id))).orderBy(auspiciousChangeLogs.id) : [];
        return { settings: await repo.settings(tx), snapshots, logs };
      };
      const beforePublished = fingerprint(await publishedState());
      const snapshots = [];
      for (const set of targets) snapshots.push(await repo.snapshot(set.id, tx));
      const logs = await tx.select().from(auspiciousChangeLogs).where(inArray(auspiciousChangeLogs.ruleSetId, ids));
      const backupDirectory = resolve('.backups/auspicious-date');
      await mkdir(backupDirectory, { recursive: true });
      const backupPath = resolve(backupDirectory, `draft-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      await writeFile(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), actorId, reason, snapshots, logs }, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });

      // Preserve audit history while removing its FK to deleted versions.
      await tx.update(auspiciousChangeLogs).set({ ruleSetId: null }).where(inArray(auspiciousChangeLogs.ruleSetId, ids));
      for (const snapshot of snapshots) await repo.log(tx, { id: actorId! }, 'version.delete', 'version', snapshot.set.id, snapshot, null, reason);
      const deleted = await tx.delete(auspiciousRuleSets).where(and(inArray(auspiciousRuleSets.id, ids), inArray(auspiciousRuleSets.status, [...removable]))).returning();
      if (deleted.length !== ids.length) throw new Error('Deletion count differs from preflight. Rolling back.');
      // FK cascades remove the targets' rules, contents, sources and cases only.
      if (beforePublished !== fingerprint(await publishedState()) || fingerprint(settings) !== fingerprint(await repo.settings(tx))) {
        throw new Error('Published data or settings changed. Rolling back.');
      }
      const remaining = await tx.select().from(auspiciousRuleSets).orderBy(auspiciousRuleSets.purpose);
      return { backupPath, deleted: deleted.map(({ id, purpose, version, status }) => ({ id, purpose, version, status })), remaining: remaining.map(({ id, purpose, version, status }) => ({ id, purpose, version, status })), publishedDataUnchanged: true };
    });
    console.log(JSON.stringify(outcome, null, 2));
  } finally { await database.onModuleDestroy(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Cleanup failed'); process.exitCode = 1; });
