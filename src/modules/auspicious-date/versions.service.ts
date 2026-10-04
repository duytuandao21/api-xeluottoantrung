import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { throwOnConstraint } from '../../common/database-errors.js';
import { auspiciousReferenceCases, auspiciousRuleContents, auspiciousRules, auspiciousRuleSets, auspiciousRuleSources, auspiciousSettings } from '../../database/schema/index.js';
import { ChangeDto, PublishDto, VersionDto } from './auspicious-date.dto.js';
import { INITIAL_RULES } from './defaults.js';
import { ReferenceValidation } from './engine/reference-validation.js';
import { AuspiciousRepository, type Actor } from './repository.js';

@Injectable()
export class AuspiciousVersionsService {
  constructor(@Inject(AuspiciousRepository) private readonly repo: AuspiciousRepository, @Inject(ReferenceValidation) private readonly validation: ReferenceValidation) {}
  list() { return this.repo.database.db.select().from(auspiciousRuleSets).orderBy(asc(auspiciousRuleSets.purpose), asc(auspiciousRuleSets.createdAt)); }
  async create(dto: VersionDto, actor: Actor, originalId?: string) {
    try {
      return await this.repo.database.db.transaction(async tx => {
        const original = originalId ? await this.repo.snapshot(originalId, tx) : null;
        if (original && original.set.purpose !== dto.purpose) throw new BadRequestException('Nhân bản phải giữ cùng mục đích.');
        const [created] = await tx.insert(auspiciousRuleSets).values({ code: dto.purpose, name: dto.name, version: dto.version, purpose: dto.purpose, createdBy: actor.id }).returning();
        const rules = original?.rules ?? INITIAL_RULES;
        for (const rule of rules) {
          const [newRule] = await tx.insert(auspiciousRules).values({ ruleSetId: created.id, code: rule.code, category: rule.category, priority: rule.priority, effect: rule.effect,
            weight: rule.weight, hardExclusion: rule.hardExclusion, isEnabled: rule.isEnabled, engineHandler: rule.engineHandler, sortOrder: rule.sortOrder, parameters: rule.parameters }).returning();
          if (original && 'id' in rule) {
            for (const content of original.contents.filter(item => item.ruleId === rule.id)) {
              await tx.insert(auspiciousRuleContents).values({ ruleId: newRule.id, locale: content.locale, title: content.title, shortDescription: content.shortDescription, detailDescription: content.detailDescription });
            }
            for (const source of original.sources.filter(item => item.ruleId === rule.id)) {
              const { id: _id, ruleId: _ruleId, createdAt: _createdAt, updatedAt: _updatedAt, ...data } = source;
              void _id; void _ruleId; void _createdAt; void _updatedAt;
              await tx.insert(auspiciousRuleSources).values({ ...data, ruleId: newRule.id });
            }
          } else {
            const content = INITIAL_RULES.find(item => item.code === rule.code)!;
            await tx.insert(auspiciousRuleContents).values({ ruleId: newRule.id, title: content.title, shortDescription: content.description, detailDescription: content.description });
          }
        }
        for (const item of original?.cases ?? []) {
          await tx.insert(auspiciousReferenceCases).values({ ruleSetId: created.id, ruleSetVersion: created.version, name: item.name, birthDate: item.birthDate, gender: item.gender,
            purpose: item.purpose, targetDate: item.targetDate, expected: item.expected, sourceNote: item.sourceNote, isActive: item.isActive });
        }
        await this.repo.log(tx, actor, original ? 'version.clone' : 'version.create', 'version', created.id, original?.set, created, dto.reason, created.id);
        return created;
      });
    } catch (error) { throwOnConstraint(error); }
  }
  async review(id: string, dto: ChangeDto, actor: Actor) {
    return this.repo.database.db.transaction(async tx => {
      const old = await this.repo.editable(id, tx);
      if (old.status !== 'DRAFT') throw new ConflictException('Chỉ bản nháp được chuyển sang chờ duyệt.');
      const [updated] = await tx.update(auspiciousRuleSets).set({ status: 'REVIEW', updatedAt: new Date() }).where(eq(auspiciousRuleSets.id, id)).returning();
      await this.repo.log(tx, actor, 'version.review', 'version', id, old, updated, dto.reason, id);
      return updated;
    });
  }
  async validate(id: string, dto: ChangeDto, actor: Actor) {
    return this.repo.database.db.transaction(async tx => {
      const old = await this.repo.editable(id, tx);
      if (!['REVIEW', 'VALIDATED'].includes(old.status)) throw new ConflictException('Chuyển bản nháp sang chờ duyệt trước khi kiểm tra.');
      const snapshot = await this.repo.snapshot(id, tx);
      const report = this.validation.run(snapshot);
      const settings = await this.repo.settings(tx);
      if (settings.showGoodHours && !snapshot.rules.some(rule => rule.isEnabled && rule.engineHandler === 'GOOD_HOURS')) { report.errors.push('Thiếu nguồn quy tắc giờ phù hợp khi cấu hình đang bật.'); report.passed = false; }
      const [updated] = await tx.update(auspiciousRuleSets).set({ status: report.passed ? 'VALIDATED' : 'REVIEW', validatedRevision: report.passed ? old.revision : null,
        validationReport: report, updatedAt: new Date() }).where(eq(auspiciousRuleSets.id, id)).returning();
      await this.repo.log(tx, actor, 'version.validate', 'version', id, old, updated, dto.reason, id);
      return { version: updated, report };
    });
  }
  async publish(id: string, dto: PublishDto, actor: Actor) {
    if (dto.confirmed !== true) throw new BadRequestException('Cần xác nhận xuất bản.');
    return this.repo.database.db.transaction(async tx => {
      // All publishers lock the same singleton, preventing two simultaneous active versions.
      await tx.select().from(auspiciousSettings).where(eq(auspiciousSettings.id, 1)).for('update');
      const old = await this.repo.set(id, tx, true);
      if (old.status !== 'VALIDATED' || old.validatedRevision !== old.revision) throw new ConflictException('Phiên bản chưa kiểm tra hoặc đã thay đổi sau kiểm tra.');
      const snapshot = await this.repo.snapshot(id, tx);
      const report = this.validation.run(snapshot);
      const settings = await this.repo.settings(tx);
      if (!report.passed || (settings.showGoodHours && !snapshot.rules.some(rule => rule.isEnabled && rule.engineHandler === 'GOOD_HOURS'))) throw new ConflictException('Kiểm tra nguồn/ca tham chiếu không đạt. Không thể xuất bản.');
      const previous = await tx.select().from(auspiciousRuleSets).where(and(eq(auspiciousRuleSets.purpose, old.purpose), eq(auspiciousRuleSets.status, 'PUBLISHED')));
      for (const set of previous) {
        const [archived] = await tx.update(auspiciousRuleSets).set({ status: 'ARCHIVED', updatedAt: new Date() }).where(eq(auspiciousRuleSets.id, set.id)).returning();
        await this.repo.log(tx, actor, 'version.archive', 'version', set.id, set, archived, `Thay bởi ${old.version}: ${dto.reason}`, set.id);
      }
      const [updated] = await tx.update(auspiciousRuleSets).set({ status: 'PUBLISHED', effectiveFrom: new Date(), publishedAt: new Date(), validationReport: report, updatedAt: new Date() }).where(eq(auspiciousRuleSets.id, id)).returning();
      await this.repo.log(tx, actor, 'version.publish', 'version', id, old, updated, dto.reason, id);
      return updated;
    });
  }
  async archive(id: string, dto: ChangeDto, actor: Actor) {
    return this.repo.database.db.transaction(async tx => {
      await tx.select().from(auspiciousSettings).where(eq(auspiciousSettings.id, 1)).for('update');
      const old = await this.repo.set(id, tx, true);
      if (old.status !== 'PUBLISHED') throw new ConflictException('Chỉ phiên bản đang xuất bản được lưu trữ.');
      const [updated] = await tx.update(auspiciousRuleSets).set({ status: 'ARCHIVED', updatedAt: new Date() }).where(eq(auspiciousRuleSets.id, id)).returning();
      await this.repo.log(tx, actor, 'version.archive', 'version', id, old, updated, dto.reason, id);
      return updated;
    });
  }
}
