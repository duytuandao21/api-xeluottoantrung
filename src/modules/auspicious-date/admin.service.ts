import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, count, desc, eq } from 'drizzle-orm';
import { auspiciousChangeLogs, auspiciousReferenceCases, auspiciousRuleContents, auspiciousRules, auspiciousRuleSets, auspiciousRuleSources, auspiciousSettings, profiles } from '../../database/schema/index.js';
import { AuditQuery, CaseDto, ChangeDto, ContentDto, RuleDto, SettingsDto, SimulateDto, SourceDto } from './auspicious-date.dto.js';
import { birthProfile } from './compatibility/compatibility.js';
import { assertExpectation } from './engine/reference-validation.js';
import { evaluate } from './engine/rule-engine.js';
import { validatePerson, validateTarget } from './public.service.js';
import { AuspiciousRepository, type Actor } from './repository.js';

@Injectable()
export class AuspiciousAdminService {
  constructor(@Inject(AuspiciousRepository) private readonly repo: AuspiciousRepository) {}
  async overview() {
    const [settings, versions] = await Promise.all([this.repo.settings(), this.repo.database.db.select().from(auspiciousRuleSets).orderBy(desc(auspiciousRuleSets.createdAt))]);
    return { settings, versions };
  }
  async saveSettings(dto: SettingsDto, actor: Actor) {
    const { reason, ...values } = dto;
    if (!values.supportedPurposes.includes(values.defaultPurpose)) throw new BadRequestException('Mục đích mặc định phải nằm trong các mục đích hỗ trợ.');
    return this.repo.database.db.transaction(async tx => {
      await tx.select().from(auspiciousSettings).where(eq(auspiciousSettings.id, 1)).for('update');
      const old = await this.repo.settings(tx);
      const published = await tx.select().from(auspiciousRuleSets).where(eq(auspiciousRuleSets.status, 'PUBLISHED'));
      const supported = published.filter(set => values.supportedPurposes.includes(set.purpose));
      if (values.isEnabled && !supported.length) throw new BadRequestException('Cần xuất bản một bộ quy tắc đã kiểm tra trước khi bật tiện ích.');
      if (values.showGoodHours) for (const set of supported) {
        const snapshot = await this.repo.snapshot(set.id, tx);
        if (!snapshot.rules.some(rule => rule.isEnabled && rule.engineHandler === 'GOOD_HOURS')) throw new BadRequestException('Phiên bản đang xuất bản chưa có nguồn giờ phù hợp được xác minh.');
      }
      const [updated] = await tx.update(auspiciousSettings).set({ ...values, updatedAt: new Date() }).where(eq(auspiciousSettings.id, 1)).returning();
      await this.repo.log(tx, actor, 'settings.update', 'settings', '1', old, updated, reason);
      return updated;
    });
  }
  async updateRule(id: string, dto: RuleDto, actor: Actor) {
    const { reason, ...values } = dto;
    return this.repo.database.db.transaction(async tx => {
      const [old] = await tx.select().from(auspiciousRules).where(eq(auspiciousRules.id, id));
      if (!old) throw new NotFoundException('Không tìm thấy quy tắc.');
      const set = await this.repo.editable(old.ruleSetId, tx);
      const snapshot = await this.repo.snapshot(set.id, tx);
      this.repo.assertRule({ ...snapshot.rules.find(rule => rule.id === id)!, ...values });
      const [updated] = await tx.update(auspiciousRules).set({ ...values, updatedAt: new Date() }).where(eq(auspiciousRules.id, id)).returning();
      await this.repo.invalidate(set, tx);
      await this.repo.log(tx, actor, 'rule.update', 'rule', id, old, updated, reason, set.id);
      return updated;
    });
  }
  async saveContent(ruleId: string, dto: ContentDto, actor: Actor) {
    const { reason, ...values } = dto;
    return this.repo.database.db.transaction(async tx => {
      const [rule] = await tx.select().from(auspiciousRules).where(eq(auspiciousRules.id, ruleId));
      if (!rule) throw new NotFoundException('Không tìm thấy quy tắc.');
      const set = await this.repo.editable(rule.ruleSetId, tx);
      const [old] = await tx.select().from(auspiciousRuleContents).where(eq(auspiciousRuleContents.ruleId, ruleId));
      const [updated] = await tx.insert(auspiciousRuleContents).values({ ...values, ruleId }).onConflictDoUpdate({ target: [auspiciousRuleContents.ruleId, auspiciousRuleContents.locale], set: { ...values, updatedAt: new Date() } }).returning();
      await this.repo.invalidate(set, tx);
      await this.repo.log(tx, actor, 'content.update', 'content', updated.id, old, updated, reason, set.id);
      return updated;
    });
  }
  async source(ruleId: string, id: string | null, dto: SourceDto | ChangeDto, actor: Actor, remove = false) {
    return this.repo.database.db.transaction(async tx => {
      const [old] = id ? await tx.select().from(auspiciousRuleSources).where(eq(auspiciousRuleSources.id, id)) : [];
      if (id && !old) throw new NotFoundException('Không tìm thấy nguồn.');
      const actualRuleId = old?.ruleId ?? ruleId;
      const [rule] = await tx.select().from(auspiciousRules).where(eq(auspiciousRules.id, actualRuleId));
      if (!rule) throw new NotFoundException('Không tìm thấy quy tắc.');
      const set = await this.repo.editable(rule.ruleSetId, tx);
      let updated: typeof auspiciousRuleSources.$inferSelect | undefined;
      if (remove && id) await tx.delete(auspiciousRuleSources).where(eq(auspiciousRuleSources.id, id));
      else {
        const { reason: _reason, ...values } = dto as SourceDto; void _reason;
        const verified = values.verificationStatus === 'VERIFIED';
        if (verified && (!values.note.trim() || (!values.url.trim() && !values.pageReference.trim()))) throw new BadRequestException('Nguồn xác minh cần URL hoặc trang tham chiếu và ghi chú kiểm chứng.');
        const data = { ...values, ruleId: actualRuleId, verifiedBy: verified ? actor.id : null, verifiedAt: verified ? new Date() : null, updatedAt: new Date() };
        [updated] = id ? await tx.update(auspiciousRuleSources).set(data).where(eq(auspiciousRuleSources.id, id)).returning() : await tx.insert(auspiciousRuleSources).values(data).returning();
      }
      await this.repo.invalidate(set, tx);
      await this.repo.log(tx, actor, remove ? 'source.delete' : 'source.save', 'source', id ?? updated!.id, old, updated, dto.reason, set.id);
      return updated;
    });
  }
  async reference(setId: string, id: string | null, dto: CaseDto | ChangeDto, actor: Actor, remove = false) {
    return this.repo.database.db.transaction(async tx => {
      const [old] = id ? await tx.select().from(auspiciousReferenceCases).where(eq(auspiciousReferenceCases.id, id)) : [];
      if (id && !old) throw new NotFoundException('Không tìm thấy ca tham chiếu.');
      const set = await this.repo.editable(old?.ruleSetId ?? setId, tx);
      let updated: typeof auspiciousReferenceCases.$inferSelect | undefined;
      if (remove && id) await tx.delete(auspiciousReferenceCases).where(eq(auspiciousReferenceCases.id, id));
      else {
        const { reason: _reason, ...values } = dto as CaseDto; void _reason;
        validatePerson(values); validateTarget(values.targetDate); assertExpectation(values.expected);
        if (values.purpose !== set.purpose) throw new BadRequestException('Mục đích ca tham chiếu phải trùng phiên bản.');
        const data = { ...values, gender: values.gender ?? null, ruleSetId: set.id, ruleSetVersion: set.version, updatedAt: new Date() };
        [updated] = id ? await tx.update(auspiciousReferenceCases).set(data).where(eq(auspiciousReferenceCases.id, id)).returning() : await tx.insert(auspiciousReferenceCases).values(data).returning();
      }
      await this.repo.invalidate(set, tx);
      await this.repo.log(tx, actor, remove ? 'case.delete' : 'case.save', 'reference', id ?? updated!.id, old, updated, dto.reason, set.id);
      return updated;
    });
  }
  async simulate(dto: SimulateDto) {
    validatePerson(dto); validateTarget(dto.targetDate);
    const profile = birthProfile(dto.birthDate);
    const run = async (id: string) => {
      const snapshot = await this.repo.snapshot(id);
      if (snapshot.set.purpose !== dto.purpose) throw new BadRequestException('Mục đích không trùng bộ quy tắc.');
      return { ...evaluate(dto.targetDate, profile, dto.purpose, snapshot.rules, snapshot.contents), rulesetVersion: snapshot.set.version };
    };
    const primary = await run(dto.ruleSetId);
    const comparison = dto.compareRuleSetId ? await run(dto.compareRuleSetId) : null;
    return { primary, comparison };
  }
  async audit(query: AuditQuery) {
    const [data, [total]] = await Promise.all([
      this.repo.database.db.select({ id: auspiciousChangeLogs.id, action: auspiciousChangeLogs.action, entityType: auspiciousChangeLogs.entityType, entityId: auspiciousChangeLogs.entityId,
        beforeData: auspiciousChangeLogs.beforeData, afterData: auspiciousChangeLogs.afterData, reason: auspiciousChangeLogs.reason, createdAt: auspiciousChangeLogs.createdAt,
        adminName: profiles.fullName, version: auspiciousRuleSets.version }).from(auspiciousChangeLogs)
        .leftJoin(profiles, eq(profiles.id, auspiciousChangeLogs.adminUserId)).leftJoin(auspiciousRuleSets, eq(auspiciousRuleSets.id, auspiciousChangeLogs.ruleSetId))
        .orderBy(desc(auspiciousChangeLogs.createdAt), asc(auspiciousChangeLogs.id)).limit(query.limit).offset((query.page - 1) * query.limit),
      this.repo.database.db.select({ total: count() }).from(auspiciousChangeLogs),
    ]);
    return { data, meta: { page: query.page, limit: query.limit, total: total.total, totalPages: Math.ceil(total.total / query.limit) } };
  }
}
