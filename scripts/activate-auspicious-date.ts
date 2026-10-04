import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DatabaseService } from '../src/database/database.service.js';
import { permissions, profiles, rolePermissions, roles, userRoles } from '../src/database/schema/index.js';
import { ACTIVATION_NAME, ACTIVATION_VERSION, activationReferences, activationRules, activationSources } from '../src/modules/auspicious-date/activation-pack.js';
import { AuspiciousRepository } from '../src/modules/auspicious-date/repository.js';
import { AuspiciousAdminService } from '../src/modules/auspicious-date/admin.service.js';
import { AuspiciousVersionsService } from '../src/modules/auspicious-date/versions.service.js';
import { ReferenceValidation, differences } from '../src/modules/auspicious-date/engine/reference-validation.js';
import { PURPOSES } from '../src/modules/auspicious-date/domain.js';

// Explicit operator tool. Uses the same validation, publication and audit services as admin.
// It never sets PUBLISHED directly, edits published versions, or invents reference expectations.
async function main() {
  if (!process.argv.includes('--apply')) {
    console.log(`Plan: create ${ACTIVATION_VERSION} for 3 purposes, import reviewed sources and 14 independent reference cases per purpose, validate, publish, enable. Existing drafts are preserved. Apply only to an authorized development/test DB with --apply --development-test --actor <profile UUID>.`);
    return;
  }
  const actorId = process.argv[process.argv.indexOf('--actor') + 1];
  if (!process.argv.includes('--development-test') || !process.argv.includes('--actor') || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(actorId ?? '')) throw new Error('Require --development-test and --actor <existing authorized admin profile UUID>.');
  const database = new DatabaseService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
  try {
    const grants = await database.db.select({ code: permissions.code }).from(profiles)
      .innerJoin(userRoles, eq(userRoles.profileId, profiles.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id)).innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(eq(profiles.id, actorId), eq(profiles.status, 'active'), isNull(profiles.deletedAt), inArray(roles.code, ['SUPER_ADMIN','ADMIN'])));
    for (const code of ['read','settings.update','rules.read','rules.update','content.update','sources.manage','versions.manage','publish','simulate'])
      if (!grants.some(grant => grant.code === `auspicious_date.${code}`)) throw new Error(`Operator lacks permission: auspicious_date.${code}`);
    const actor = { id: actorId }, repo = new AuspiciousRepository(database), validation = new ReferenceValidation(repo);
    const admin = new AuspiciousAdminService(repo), versions = new AuspiciousVersionsService(repo, validation);
    const reason = 'Thao tác bằng công cụ kích hoạt theo yêu cầu chủ website ngày 03/10/2026; nguồn được đối chiếu kỹ thuật, dữ liệu chỉ mang tính tham khảo.';
    const existing = await versions.list();
    // Preflight every purpose before making changes: do not overwrite any existing review.
    for (const purpose of PURPOSES) {
      const set = existing.find(item => item.purpose === purpose && item.version === ACTIVATION_VERSION);
      if (set && (set.status !== 'PUBLISHED' || set.name !== `${ACTIVATION_NAME} (${purpose})`)) throw new Error(`${purpose} ${ACTIVATION_VERSION} already exists. Review it in admin; this tool will not overwrite it.`);
      if (set) {
        const snapshot = await repo.snapshot(set.id);
        if (!validation.run(snapshot).passed || snapshot.cases.length !== activationReferences(purpose).length || activationReferences(purpose).some(reference => {
          const stored = snapshot.cases.find(item => item.name === reference.name);
          return !stored || differences(reference.expected, stored.expected).length > 0;
        })) throw new Error(`Existing ${purpose} publication differs from the activation pack; manual review required.`);
      }
    }
    const prepared: string[] = [];
    for (const purpose of PURPOSES) {
      const already = existing.find(item => item.purpose === purpose && item.version === ACTIVATION_VERSION);
      if (already) { console.log(`${purpose}: already published; unchanged.`); continue; }
      const created = await versions.create({ purpose, version: ACTIVATION_VERSION, name: `${ACTIVATION_NAME} (${purpose})`, reason }, actor);
      const snapshot = await repo.snapshot(created.id);
      for (const desired of activationRules(purpose)) {
        const rule = snapshot.rules.find(item => item.code === desired.code)!;
        const { priority, effect, weight, hardExclusion, isEnabled, sortOrder, parameters } = desired;
        await admin.updateRule(rule.id, { priority, effect, weight, hardExclusion, isEnabled, sortOrder, parameters, reason }, actor);
        await admin.saveContent(rule.id, { title: desired.title, shortDescription: desired.description, detailDescription: desired.description, reason }, actor);
        if (desired.isEnabled) for (const source of activationSources(desired.engineHandler, purpose)) await admin.source(rule.id, null, {
          ...source, edition: 'Bản trực tuyến đã đối chiếu 03/10/2026', publishedYear: null, verificationStatus: 'VERIFIED', reason,
        }, actor);
      }
      for (const reference of activationReferences(purpose)) await admin.reference(created.id, null, { ...reference, reason }, actor);
      await versions.review(created.id, { reason }, actor);
      const { report } = await versions.validate(created.id, { reason }, actor);
      console.log(`${purpose}: Total ${report.total}, Pass ${report.pass}, Fail ${report.fail}, Changed ${report.changed}.`);
      if (!report.passed) throw new Error(`${purpose}: validation failed. ${report.errors.join(' ')} ${report.cases.filter(item => item.status !== 'PASS').map(item => `${item.name}: ${item.differences.join(', ')}`).join('; ')}`);
      prepared.push(created.id);
    }
    // All three must pass before any newly prepared version is published.
    for (const id of prepared) await versions.publish(id, { reason, confirmed: true }, actor);
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...settings } = await repo.settings();
    void _id; void _createdAt; void _updatedAt;
    await admin.saveSettings({ ...settings, isEnabled: true, supportedPurposes: [...PURPOSES], defaultPurpose: 'BUY_CAR', showGoodHours: true,
      disclaimer: 'Kết quả chỉ là gợi ý theo một số tiêu chí lịch và quan niệm truyền thống, không bảo đảm may mắn, tài lộc hay an toàn. Hãy ưu tiên kiểm tra xe, giấy tờ và lịch hẹn thực tế.', reason }, actor);
    console.log(`Enabled ${ACTIVATION_VERSION} for BUY_CAR, RECEIVE_CAR and SIGN_CONTRACT. Sources, references and every admin mutation are recorded in the database.`);
  } finally { await database.onModuleDestroy(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Activation failed'); process.exitCode = 1; });
