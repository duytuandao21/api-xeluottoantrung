import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { brands, carModels, carVersions, carColors, auditLogs, valuationOptions, valuationPolicies, valuationReferencePrices, valuationRules, valuationSettings } from '../../database/schema/index.js';
import type { AuditContext } from '../../common/audit.js';
import { throwOnConstraint } from '../../common/database-errors.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { OPTION_CATEGORIES, RANGE_CATEGORIES, type ValidationReport } from './domain.js';
import type { ChangeDto, CreatePolicyDto, CurrentConfigDto, CurrentListQuery, CurrentOptionDto, CurrentReferenceDto, CurrentRuleDto, ListQuery, OptionDto, PublishDto, ReferenceDto, RuleDto, SettingsDto, UpdatePolicyDto } from './valuation.dto.js';
import type { DatabaseService } from '../../database/database.service.js';
import { ValuationRepository, type Tx } from './valuation.repository.js';
import { assertConfig, assertNoPriceOverlap, assertNoRuleOverlap, validateMasterData } from './validation.js';
import { seedDraftExamples } from './seed-data.js';
function timestamp(value: string | null | undefined): Date | null { return value ? new Date(value) : null; }
function selectedPrice(row: { basePriceType: string; originalMsrp: number | null; currentMsrp: number | null; marketReference: number | null }) { return row.basePriceType === 'ORIGINAL_MSRP' ? row.originalMsrp : row.basePriceType === 'CURRENT_MSRP' ? row.currentMsrp : row.marketReference; }
function meta(query: ListQuery, total: number) { return { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) }; }
function search(value: string) { return `%${value.replace(/[\\%_]/g, character => `\\${character}`)}%`; }

@Injectable()
export class ValuationAdminService {
  constructor(@Inject(ValuationRepository) readonly repo: ValuationRepository) {}
  async current() {
    return this.repo.database.db.transaction(async tx => {
      const settings = await this.repo.settings(tx), policy = await this.repo.current(tx), snapshot = await this.repo.snapshot(policy.id, tx);
      return { settings, configuration: { id: policy.id, name: policy.name, revision: policy.revision, config: policy.config, updatedAt: policy.updatedAt, validationReport: policy.validationReport },
        options: snapshot.options, referenceCount: snapshot.references.length, ruleCount: snapshot.rules.length };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }
  async currentList(kind: 'reference' | 'rule' | 'option', query: CurrentListQuery) {
    const policy = await this.repo.current(), scoped = { ...query, policyId: policy.id };
    return kind === 'reference' ? this.references(scoped) : kind === 'rule' ? this.rules(scoped) : this.options(scoped);
  }
  private async editCurrent<T>(audit: AuditContext, reason: string, work: (service: ValuationAdminService, policyId: string) => Promise<T>) {
    return this.repo.database.db.transaction(async tx => {
      // Every edit uses the same lock order; apply and validate within one commit.
      const settings = await this.repo.settings(tx, true), old = await this.repo.current(tx, true);
      const repo = new ValuationRepository({ db: tx } as unknown as DatabaseService);
      repo.mutablePolicyId = old.id;
      const service = new ValuationAdminService(repo), value = await work(service, old.id);
      const snapshot = await repo.snapshot(old.id, tx), policy = snapshot.policy;
      const result = validateMasterData(snapshot.rules, snapshot.options, snapshot.references, policy.config);
      result.errors.push(...await service.catalogErrors(snapshot, tx));
      if (settings.isEnabled && result.errors.length) throw new BadRequestException(`Chưa áp dụng thay đổi. ${result.errors.join(' ')}`);
      const report: ValidationReport = { passed: result.errors.length === 0, ...result, revision: policy.revision, checkedAt: new Date().toISOString() };
      const [applied] = await tx.update(valuationPolicies).set({ status: report.passed ? 'PUBLISHED' : 'DRAFT', validatedRevision: report.passed ? policy.revision : null,
        validationReport: report, publishedAt: report.passed ? old.publishedAt ?? new Date() : old.publishedAt,
        publishedBy: report.passed ? audit.actorProfileId : old.publishedBy, updatedAt: new Date() }).where(eq(valuationPolicies.id, old.id)).returning();
      if (settings.activePolicyId !== old.id) await tx.update(valuationSettings).set({ activePolicyId: old.id, updatedAt: new Date(), updatedBy: audit.actorProfileId }).where(eq(valuationSettings.id, 1));
      await repo.log(tx, audit, 'configuration.apply', 'policy', old.id, { revision: old.revision }, { revision: applied.revision, valid: report.passed }, reason);
      return value;
    });
  }
  async currentConfig(dto: CurrentConfigDto, audit: AuditContext) {
    await this.editCurrent(audit, dto.reason, async (service, id) => service.updatePolicy(id, { ...dto, name: (await service.repo.policy(id)).name }, audit));
    return (await this.current()).configuration;
  }
  currentReference(id: string | null, dto: CurrentReferenceDto, audit: AuditContext) {
    return this.editCurrent(audit, dto.reason, (service, policyId) => service.saveReference(id, { ...dto, policyId }, audit));
  }
  currentRule(id: string | null, dto: CurrentRuleDto, audit: AuditContext) {
    return this.editCurrent(audit, dto.reason, (service, policyId) => service.saveRule(id, { ...dto, policyId }, audit));
  }
  currentOption(id: string | null, dto: CurrentOptionDto, audit: AuditContext) {
    return this.editCurrent(audit, dto.reason, (service, policyId) => service.saveOption(id, { ...dto, policyId }, audit));
  }
  currentRemove(kind: 'reference' | 'rule' | 'option', id: string, dto: ChangeDto, audit: AuditContext) {
    return this.editCurrent(audit, dto.reason, async (service, policyId) => {
      const table = kind === 'reference' ? valuationReferencePrices : kind === 'rule' ? valuationRules : valuationOptions;
      const [row] = await service.repo.database.db.select({ policyId: table.policyId }).from(table).where(eq(table.id, id));
      if (!row || row.policyId !== policyId) throw new NotFoundException('Không tìm thấy dữ liệu trong cấu hình hiện tại.');
      return service.remove(kind, id, dto, audit);
    });
  }
  async currentSettings(dto: SettingsDto, audit: AuditContext) {
    return this.repo.database.db.transaction(async tx => {
      const settings = await this.repo.settings(tx, true);
      if (settings.updatedAt.getTime() !== new Date(dto.expectedUpdatedAt).getTime()) throw new ConflictException('Cấu hình đã thay đổi. Tải lại trước khi lưu.');
      const policy = await this.repo.current(tx, true);
      if (dto.isEnabled) {
        if (!settings.isEnabled && dto.confirmed !== true) throw new BadRequestException('Xác nhận đã rà soát giá và quy tắc trước khi bật tiện ích.');
        const snapshot = await this.repo.snapshot(policy.id, tx), result = validateMasterData(snapshot.rules, snapshot.options, snapshot.references, policy.config);
        result.errors.push(...await this.catalogErrors(snapshot, tx));
        if (result.errors.length) throw new BadRequestException(result.errors.join(' '));
        await tx.update(valuationPolicies).set({ status: 'PUBLISHED', validatedRevision: policy.revision, publishedAt: policy.publishedAt ?? new Date(), publishedBy: audit.actorProfileId, updatedAt: new Date() }).where(eq(valuationPolicies.id, policy.id));
      }
      const [row] = await tx.update(valuationSettings).set({ activePolicyId: policy.id, isEnabled: dto.isEnabled, disclaimer: dto.disclaimer.trim(), ctaLabel: dto.ctaLabel.trim(), updatedBy: audit.actorProfileId, updatedAt: new Date() }).where(eq(valuationSettings.id, 1)).returning();
      await this.repo.log(tx, audit, 'settings.update', 'settings', audit.actorProfileId, settings, row, dto.reason);
      return row;
    });
  }
  async overview() {
    const [settings, policies] = await Promise.all([this.repo.settings(), this.repo.database.db.select().from(valuationPolicies).orderBy(desc(valuationPolicies.createdAt), asc(valuationPolicies.id))]);
    return { settings, policies, phase: 5, publicReady: settings.isEnabled };
  }
  async catalog() {
    const db = this.repo.database.db;
    const [brandRows, models, variants, colors] = await Promise.all([
      db.select().from(brands).orderBy(asc(brands.name)), db.select().from(carModels).orderBy(asc(carModels.name)),
      db.select().from(carVersions).orderBy(asc(carVersions.name)), db.select().from(carColors).orderBy(asc(carColors.name)),
    ]);
    return { brands: brandRows, models, variants, colors };
  }
  async detail(id: string) {
    const policy = await this.repo.policy(id);
    const options = await this.repo.database.db.select().from(valuationOptions).where(eq(valuationOptions.policyId, id)).orderBy(asc(valuationOptions.category), asc(valuationOptions.sortOrder));
    return { policy, options };
  }
  async settings(dto: SettingsDto, audit: AuditContext, canPublish = false) {
    return this.repo.database.db.transaction(async tx => {
      const old = await this.repo.settings(tx, true);
      if (old.updatedAt.getTime() !== new Date(dto.expectedUpdatedAt).getTime()) throw new ConflictException('Cấu hình đã thay đổi. Tải lại trước khi lưu.');
      if (dto.isEnabled) {
        if (!old.isEnabled && !canPublish) throw new ForbiddenException('Bật tiện ích cần quyền xuất bản cấu hình định giá.');
        if (!old.isEnabled && dto.confirmed !== true) throw new BadRequestException('Xác nhận đã rà soát nguồn giá và quy tắc trước khi bật tiện ích.');
        if (!old.activePolicyId) throw new ConflictException('Cần xuất bản cấu hình hợp lệ trước khi bật tiện ích.');
        const snapshot = await this.repo.snapshot(old.activePolicyId, tx), policy = snapshot.policy;
        if (policy.status !== 'PUBLISHED' || policy.validatedRevision !== policy.revision) throw new ConflictException('Phiên bản đang áp dụng chưa được xuất bản hợp lệ.');
        const result = validateMasterData(snapshot.rules, snapshot.options, snapshot.references, policy.config);
        result.errors.push(...await this.catalogErrors(snapshot, tx));
        if (result.errors.length) throw new ConflictException(result.errors.join(' '));
      }
      const [row] = await tx.update(valuationSettings).set({ isEnabled: dto.isEnabled, disclaimer: dto.disclaimer.trim(), ctaLabel: dto.ctaLabel.trim(), updatedBy: audit.actorProfileId, updatedAt: new Date() }).where(eq(valuationSettings.id, 1)).returning();
      await this.repo.log(tx, audit, 'settings.update', 'settings', audit.actorProfileId, old, row, dto.reason);
      return row;
    });
  }
  async createPolicy(dto: CreatePolicyDto, audit: AuditContext, sourceId?: string) {
    try {
      return await this.repo.database.db.transaction(async tx => {
        if (sourceId) await this.repo.policy(sourceId, tx, true);
        const snapshot = sourceId ? await this.repo.snapshot(sourceId, tx) : null;
        const [row] = await tx.insert(valuationPolicies).values({ name: dto.name.trim(), version: dto.version, config: snapshot?.policy.config ?? DEFAULT_CONFIG, createdBy: audit.actorProfileId, updatedBy: audit.actorProfileId }).returning();
        if (!snapshot) await seedDraftExamples(tx, row.id);
        else {
          const ids = new Map<string, string>();
          for (const option of snapshot.options) {
            const { id: oldId, createdAt: _created, updatedAt: _updated, ...fields } = option;
            void _created; void _updated;
            const [created] = await tx.insert(valuationOptions).values({ ...fields, policyId: row.id, updatedBy: audit.actorProfileId }).returning();
            ids.set(oldId, created.id);
          }
          for (const rule of snapshot.rules) {
            const { id: _id, createdAt: _created, updatedAt: _updated, ...fields } = rule;
            void _id; void _created; void _updated;
            await tx.insert(valuationRules).values({ ...fields, policyId: row.id, optionId: rule.optionId ? ids.get(rule.optionId)! : null, updatedBy: audit.actorProfileId });
          }
          for (const reference of snapshot.references) {
            const { id: _id, createdAt: _created, updatedAt: _updated, ...fields } = reference;
            void _id; void _created; void _updated;
            await tx.insert(valuationReferencePrices).values({ ...fields, policyId: row.id, updatedBy: audit.actorProfileId });
          }
        }
        await this.repo.log(tx, audit, sourceId ? 'policy.clone' : 'policy.create', 'policy', row.id, sourceId ? { sourceId } : null, row, dto.reason);
        return row;
      });
    } catch (error) { return throwOnConstraint(error); }
  }
  async updatePolicy(id: string, dto: UpdatePolicyDto, audit: AuditContext) {
    assertConfig(dto.config);
    return this.repo.database.db.transaction(async tx => {
      const old = await this.repo.editable(id, dto.expectedRevision, tx);
      const [row] = await tx.update(valuationPolicies).set({ name: dto.name.trim(), config: dto.config, revision: old.revision + 1, status: 'DRAFT', validatedRevision: null, validationReport: null, updatedBy: audit.actorProfileId, updatedAt: new Date() }).where(eq(valuationPolicies.id, id)).returning();
      await this.repo.log(tx, audit, 'policy.update', 'policy', id, old, row, dto.reason);
      return row;
    });
  }
  async validate(id: string, dto: ChangeDto, audit: AuditContext) {
    return this.repo.database.db.transaction(async tx => {
      const old = await this.repo.editable(id, dto.expectedRevision, tx);
      const { options, rules, references } = await this.repo.snapshot(id, tx);
      const result = validateMasterData(rules, options, references, old.config);
      result.errors.push(...await this.catalogErrors({ rules, references, options, policy: old }, tx));
      const report: ValidationReport = { passed: result.errors.length === 0, ...result, revision: old.revision, checkedAt: new Date().toISOString() };
      const [policy] = await tx.update(valuationPolicies).set({ status: report.passed ? 'VALIDATED' : 'DRAFT', validatedRevision: report.passed ? old.revision : null, validationReport: report, updatedAt: new Date(), updatedBy: audit.actorProfileId }).where(eq(valuationPolicies.id, id)).returning();
      await this.repo.log(tx, audit, 'policy.validate', 'policy', id, old, policy, dto.reason);
      return { policy, report };
    });
  }
  async publish(id: string, dto: PublishDto, audit: AuditContext) {
    return this.repo.database.db.transaction(async tx => {
      const settings = await this.repo.settings(tx, true);
      const old = await this.repo.policy(id, tx, true);
      if (old.status !== 'VALIDATED' || old.revision !== dto.expectedRevision || old.validatedRevision !== old.revision) throw new ConflictException('Cần kiểm tra đạt và đúng revision trước khi xuất bản.');
      const snapshot = await this.repo.snapshot(id, tx);
      const result = validateMasterData(snapshot.rules, snapshot.options, snapshot.references, old.config);
      result.errors.push(...await this.catalogErrors(snapshot, tx));
      if (result.errors.length) throw new ConflictException(result.errors.join(' '));
      const previous = await tx.select().from(valuationPolicies).where(eq(valuationPolicies.status, 'PUBLISHED'));
      for (const policy of previous) {
        await tx.update(valuationPolicies).set({ status: 'ARCHIVED', updatedAt: new Date(), updatedBy: audit.actorProfileId }).where(eq(valuationPolicies.id, policy.id));
        await this.repo.log(tx, audit, 'policy.archive', 'policy', policy.id, policy, { replacedBy: id }, dto.reason);
      }
      const [row] = await tx.update(valuationPolicies).set({ status: 'PUBLISHED', publishedBy: audit.actorProfileId, publishedAt: new Date(), updatedBy: audit.actorProfileId, updatedAt: new Date() }).where(eq(valuationPolicies.id, id)).returning();
      await tx.update(valuationSettings).set({ activePolicyId: id, isEnabled: settings.isEnabled, updatedAt: new Date(), updatedBy: audit.actorProfileId }).where(eq(valuationSettings.id, 1));
      await this.repo.log(tx, audit, 'policy.publish', 'policy', id, old, row, dto.reason);
      return row;
    });
  }
  async archive(id: string, dto: ChangeDto, audit: AuditContext) {
    return this.repo.database.db.transaction(async tx => {
      const settings = await this.repo.settings(tx, true), old = await this.repo.policy(id, tx, true);
      if (old.revision !== dto.expectedRevision || old.status === 'ARCHIVED') throw new ConflictException('Phiên bản đã thay đổi hoặc đã lưu trữ.');
      const [row] = await tx.update(valuationPolicies).set({ status: 'ARCHIVED', updatedAt: new Date(), updatedBy: audit.actorProfileId }).where(eq(valuationPolicies.id, id)).returning();
      if (settings.activePolicyId === id) await tx.update(valuationSettings).set({ activePolicyId: null, isEnabled: false, updatedAt: new Date(), updatedBy: audit.actorProfileId }).where(eq(valuationSettings.id, 1));
      await this.repo.log(tx, audit, 'policy.archive', 'policy', id, old, row, dto.reason);
      return row;
    });
  }
  private async assertVariant(id: string, tx: Tx) {
    const [row] = await tx.select({ id: carVersions.id, versionStatus: carVersions.status, modelStatus: carModels.status, brandStatus: brands.status }).from(carVersions).innerJoin(carModels, eq(carVersions.modelId, carModels.id)).innerJoin(brands, eq(carModels.brandId, brands.id)).where(eq(carVersions.id, id));
    if (!row || [row.versionStatus, row.modelStatus, row.brandStatus].some(status => status !== 'active')) throw new BadRequestException('Phiên bản, dòng và hãng xe phải tồn tại và đang hoạt động.');
  }
  private async catalogErrors(snapshot: Awaited<ReturnType<ValuationRepository['snapshot']>>, tx: Tx) {
    // Four catalog reads for all references/rules, rather than one lookup per row.
    const brandRows = await tx.select().from(brands), modelRows = await tx.select().from(carModels);
    const variantRows = await tx.select().from(carVersions), colorRows = await tx.select().from(carColors);
    const brandActive = (id: string) => brandRows.some(row => row.id === id && row.status === 'active');
    const modelActive = (id: string) => modelRows.some(row => row.id === id && row.status === 'active' && brandActive(row.brandId));
    const variantActive = (id: string) => variantRows.some(row => row.id === id && row.status === 'active' && modelActive(row.modelId));
    const errors: string[] = [];
    const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric' }).format(new Date()));
    for (const reference of snapshot.references.filter(row => row.active)) {
      if (!variantActive(reference.variantId)) errors.push(`Phiên bản không còn hoạt động: ${reference.variantId}.`);
      if (reference.modelYear > year || reference.modelYear < snapshot.policy.config.minModelYear || year - reference.modelYear > snapshot.policy.config.maxVehicleAge) errors.push(`Năm ${reference.modelYear} vượt giới hạn policy.`);
    }
    for (const rule of snapshot.rules.filter(row => row.active)) {
      if ((rule.brandId && !brandActive(rule.brandId)) || (rule.modelId && !modelActive(rule.modelId)) || (rule.variantId && !variantActive(rule.variantId)) || (rule.colorId && !colorRows.some(row => row.id === rule.colorId && row.status === 'active'))) errors.push(`Danh mục không hoạt động trong quy tắc “${rule.label}”.`);
      if (rule.optionId && !snapshot.options.some(option => option.id === rule.optionId && option.policyId === rule.policyId && option.category === rule.category)) errors.push(`Lựa chọn sai nhóm/phiên bản trong quy tắc “${rule.label}”.`);
    }
    return errors;
  }
  async references(query: ListQuery) {
    const filters: SQL[] = [];
    if (query.policyId) filters.push(eq(valuationReferencePrices.policyId, query.policyId));
    if (query.variantId) filters.push(eq(valuationReferencePrices.variantId, query.variantId));
    if (query.modelId) filters.push(eq(carModels.id, query.modelId));
    if (query.brandId) filters.push(eq(brands.id, query.brandId));
    if (query.modelYear) filters.push(eq(valuationReferencePrices.modelYear, query.modelYear));
    if (query.active) filters.push(eq(valuationReferencePrices.active, query.active === 'true'));
    if (query.search) filters.push(or(ilike(brands.name, search(query.search)), ilike(carModels.name, search(query.search)), ilike(carVersions.name, search(query.search)), ilike(valuationReferencePrices.source, search(query.search)))!);
    const db = this.repo.database.db;
    const joined = () => db.select().from(valuationReferencePrices).innerJoin(carVersions, eq(valuationReferencePrices.variantId, carVersions.id)).innerJoin(carModels, eq(carVersions.modelId, carModels.id)).innerJoin(brands, eq(carModels.brandId, brands.id));
    const rows = await joined().where(and(...filters)).orderBy(desc(valuationReferencePrices.updatedAt), asc(valuationReferencePrices.id)).limit(query.limit).offset((query.page - 1) * query.limit);
    const [{ total }] = await db.select({ total: count() }).from(valuationReferencePrices).innerJoin(carVersions, eq(valuationReferencePrices.variantId, carVersions.id)).innerJoin(carModels, eq(carVersions.modelId, carModels.id)).innerJoin(brands, eq(carModels.brandId, brands.id)).where(and(...filters));
    return { data: rows.map(row => ({ ...row.valuation_reference_prices, brandId: row.brands.id, brandName: row.brands.name, modelId: row.car_models.id, modelName: row.car_models.name, variantName: row.car_versions.name, selectedBasePrice: selectedPrice(row.valuation_reference_prices) })), meta: meta(query, total) };
  }
  async saveReference(id: string | null, dto: ReferenceDto, audit: AuditContext) {
    try { return await this.repo.database.db.transaction(async tx => {
      const policy = await this.repo.editable(dto.policyId, dto.expectedRevision, tx);
      const [old] = id ? await tx.select().from(valuationReferencePrices).where(eq(valuationReferencePrices.id, id)) : [];
      if (id && (!old || old.policyId !== dto.policyId)) throw new NotFoundException('Không tìm thấy giá trong phiên bản này.');
      await this.assertVariant(dto.variantId, tx);
      if (dto.modelYear < policy.config.minModelYear || dto.modelYear > new Date().getFullYear() + 1 || new Date().getFullYear() - dto.modelYear > policy.config.maxVehicleAge) throw new BadRequestException('Năm xe nằm ngoài giới hạn cấu hình.');
      const values = { policyId: dto.policyId, variantId: dto.variantId, modelYear: dto.modelYear, originalMsrp: dto.originalMsrp ?? null, currentMsrp: dto.currentMsrp ?? null, marketReference: dto.marketReference ?? null, basePriceType: dto.basePriceType, source: dto.source.trim(), note: dto.note, referenceAgeYears: dto.referenceAgeYears ?? null, referenceOdometerKm: dto.referenceOdometerKm ?? null, basisNote: dto.basisNote.trim(), active: dto.active, effectiveFrom: new Date(dto.effectiveFrom), effectiveTo: timestamp(dto.effectiveTo), updatedBy: audit.actorProfileId, updatedAt: new Date() };
      if (!selectedPrice(values)) throw new BadRequestException('Loại giá nền đã chọn chưa có giá trị.');
      if (values.effectiveTo && values.effectiveTo <= values.effectiveFrom) throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu.');
      if (values.basePriceType === 'MARKET_REFERENCE' && (values.referenceAgeYears === null || values.referenceOdometerKm === null || values.basisNote.length < 3)) throw new BadRequestException('Giá thị trường cần tuổi, ODO nền và mô tả giả định tình trạng chuẩn để tránh khấu hao hai lần.');
      assertNoPriceOverlap({ ...values, id: id ?? '', createdAt: new Date() }, await tx.select().from(valuationReferencePrices).where(eq(valuationReferencePrices.policyId, dto.policyId)));
      const [row] = id ? await tx.update(valuationReferencePrices).set(values).where(eq(valuationReferencePrices.id, id)).returning() : await tx.insert(valuationReferencePrices).values(values).returning();
      await this.repo.invalidate(dto.policyId, audit, tx);
      await this.repo.log(tx, audit, id ? 'reference.update' : 'reference.create', 'reference', row.id, old, row, dto.reason);
      return row;
    }); } catch (error) { return throwOnConstraint(error); }
  }
  async rules(query: ListQuery) {
    const filters: SQL[] = [];
    if (query.policyId) filters.push(eq(valuationRules.policyId, query.policyId));
    if (query.category) filters.push(eq(valuationRules.category, query.category));
    if (query.scope) filters.push(eq(valuationRules.scope, query.scope));
    if (query.active) filters.push(eq(valuationRules.active, query.active === 'true'));
    if (query.search) filters.push(ilike(valuationRules.label, search(query.search)));
    const db = this.repo.database.db, where = and(...filters);
    const rows = await db.select().from(valuationRules).where(where).orderBy(asc(valuationRules.category), asc(valuationRules.scope), asc(valuationRules.minValue), asc(valuationRules.label), asc(valuationRules.id)).limit(query.limit).offset((query.page - 1) * query.limit);
    const [{ total }] = await db.select({ total: count() }).from(valuationRules).where(where);
    return { data: rows, meta: meta(query, total) };
  }
  async saveRule(id: string | null, dto: RuleDto, audit: AuditContext) {
    try { return await this.repo.database.db.transaction(async tx => {
      await this.repo.editable(dto.policyId, dto.expectedRevision, tx);
      const [old] = id ? await tx.select().from(valuationRules).where(eq(valuationRules.id, id)) : [];
      if (id && (!old || old.policyId !== dto.policyId)) throw new NotFoundException('Không tìm thấy quy tắc trong phiên bản.');
      const values = { policyId: dto.policyId, category: dto.category, scope: dto.scope, brandId: dto.brandId ?? null, modelId: dto.modelId ?? null, variantId: dto.variantId ?? null, optionId: dto.optionId ?? null, colorId: dto.colorId ?? null, minValue: dto.minValue ?? null, maxValue: dto.maxValue ?? null, adjustmentPercent: dto.adjustmentPercent, manualInspectionRequired: dto.manualInspectionRequired, active: dto.active, label: dto.label.trim(), note: dto.note, effectiveFrom: timestamp(dto.effectiveFrom), effectiveTo: timestamp(dto.effectiveTo), updatedBy: audit.actorProfileId, updatedAt: new Date() };
      const selector = { BRAND: values.brandId, MODEL: values.modelId, VARIANT: values.variantId };
      if (Object.values(selector).filter(Boolean).length !== (values.scope === 'GLOBAL' ? 0 : 1) || (values.scope !== 'GLOBAL' && !selector[values.scope])) throw new BadRequestException('Phạm vi cần đúng một hãng/dòng/phiên bản tương ứng.');
      if (values.brandId) { const [brand] = await tx.select().from(brands).where(eq(brands.id, values.brandId)); if (!brand || brand.status !== 'active') throw new BadRequestException('Hãng không hoạt động.'); }
      if (values.modelId) { const [model] = await tx.select({ status: carModels.status, brandStatus: brands.status }).from(carModels).innerJoin(brands, eq(carModels.brandId, brands.id)).where(eq(carModels.id, values.modelId)); if (!model || model.status !== 'active' || model.brandStatus !== 'active') throw new BadRequestException('Dòng hoặc hãng không hoạt động.'); }
      if (values.variantId) await this.assertVariant(values.variantId, tx);
      const range = RANGE_CATEGORIES.includes(values.category), categorical = OPTION_CATEGORIES.includes(values.category as typeof OPTION_CATEGORIES[number]);
      if (range) {
        const minimum = values.category === 'ODO' ? -100 : values.category === 'OWNERS' ? 1 : 0;
        if (values.optionId || values.colorId || values.minValue === null || values.minValue < minimum || (values.maxValue !== null && values.maxValue <= values.minValue)) throw new BadRequestException('Khoảng cần giá trị bắt đầu hợp lệ và kết thúc lớn hơn bắt đầu.');
        if (values.category === 'OWNERS' && (!Number.isInteger(values.minValue) || values.maxValue !== null && !Number.isInteger(values.maxValue))) throw new BadRequestException('Số chủ phải là số nguyên.');
      } else if (values.minValue !== null || values.maxValue !== null) throw new BadRequestException('Nhóm này không dùng khoảng số.');
      if (categorical) {
        const [option] = values.optionId ? await tx.select().from(valuationOptions).where(eq(valuationOptions.id, values.optionId)) : [];
        if (!option || option.policyId !== dto.policyId || option.category !== dto.category || values.colorId) throw new BadRequestException('Lựa chọn tình trạng không thuộc nhóm/phiên bản này.');
        if (option.requiresInspection && !values.manualInspectionRequired) throw new BadRequestException('Tình trạng này bắt buộc kiểm tra trực tiếp.');
      } else if (values.optionId) throw new BadRequestException('Nhóm này không dùng lựa chọn tình trạng.');
      if (values.category === 'COLOR') {
        const [color] = values.colorId ? await tx.select().from(carColors).where(eq(carColors.id, values.colorId)) : [];
        if (!color || color.status !== 'active') throw new BadRequestException('Chọn màu xe đang hoạt động.');
      } else if (values.colorId) throw new BadRequestException('Chỉ nhóm màu xe được chọn màu.');
      if (values.effectiveTo && (!values.effectiveFrom || values.effectiveTo <= values.effectiveFrom)) throw new BadRequestException('Thời gian hiệu lực không hợp lệ.');
      assertNoRuleOverlap({ ...values, id: id ?? '', createdAt: new Date() }, await tx.select().from(valuationRules).where(eq(valuationRules.policyId, dto.policyId)));
      const [row] = id ? await tx.update(valuationRules).set(values).where(eq(valuationRules.id, id)).returning() : await tx.insert(valuationRules).values(values).returning();
      await this.repo.invalidate(dto.policyId, audit, tx);
      await this.repo.log(tx, audit, id ? 'rule.update' : 'rule.create', 'rule', row.id, old, row, dto.reason);
      return row;
    }); } catch (error) { return throwOnConstraint(error); }
  }
  async options(query: ListQuery) {
    const filters: SQL[] = [];
    if (query.policyId) filters.push(eq(valuationOptions.policyId, query.policyId));
    if (query.category) filters.push(eq(valuationOptions.category, query.category));
    if (query.active) filters.push(eq(valuationOptions.active, query.active === 'true'));
    if (query.search) filters.push(or(ilike(valuationOptions.label, search(query.search)), ilike(valuationOptions.code, search(query.search)))!);
    const db = this.repo.database.db, where = and(...filters);
    const rows = await db.select().from(valuationOptions).where(where).orderBy(asc(valuationOptions.category), asc(valuationOptions.sortOrder), asc(valuationOptions.id)).limit(query.limit).offset((query.page - 1) * query.limit);
    const [{ total }] = await db.select({ total: count() }).from(valuationOptions).where(where);
    return { data: rows, meta: meta(query, total) };
  }
  async saveOption(id: string | null, dto: OptionDto, audit: AuditContext) {
    try { return await this.repo.database.db.transaction(async tx => {
      await this.repo.editable(dto.policyId, dto.expectedRevision, tx);
      const [old] = id ? await tx.select().from(valuationOptions).where(eq(valuationOptions.id, id)) : [];
      if (id && (!old || old.policyId !== dto.policyId)) throw new NotFoundException('Không tìm thấy lựa chọn trong phiên bản.');
      if (old && (old.category !== dto.category || old.code !== dto.code)) throw new BadRequestException('Code và nhóm ổn định, không đổi khi sửa. Hãy tạo lựa chọn mới.');
      const values = { policyId: dto.policyId, category: dto.category, code: dto.code, label: dto.label.trim(), description: dto.description, isUnknown: dto.isUnknown, requiresInspection: dto.requiresInspection, active: dto.active, sortOrder: dto.sortOrder, updatedBy: audit.actorProfileId, updatedAt: new Date() };
      if (id && dto.requiresInspection) {
        const affectedRules = await tx.select().from(valuationRules).where(and(eq(valuationRules.optionId, id), eq(valuationRules.manualInspectionRequired, false)));
        for (const previous of affectedRules) {
          const [updated] = await tx.update(valuationRules).set({ manualInspectionRequired: true, updatedAt: new Date(), updatedBy: audit.actorProfileId }).where(eq(valuationRules.id, previous.id)).returning();
          await this.repo.log(tx, audit, 'rule.update', 'rule', previous.id, previous, updated, dto.reason);
        }
      }
      const [row] = id ? await tx.update(valuationOptions).set(values).where(eq(valuationOptions.id, id)).returning() : await tx.insert(valuationOptions).values(values).returning();
      await this.repo.invalidate(dto.policyId, audit, tx);
      await this.repo.log(tx, audit, id ? 'option.update' : 'option.create', 'option', row.id, old, row, dto.reason);
      return row;
    }); } catch (error) { return throwOnConstraint(error); }
  }
  async remove(kind: 'reference' | 'rule' | 'option', id: string, dto: ChangeDto, audit: AuditContext) {
    const table = kind === 'reference' ? valuationReferencePrices : kind === 'rule' ? valuationRules : valuationOptions;
    try { return await this.repo.database.db.transaction(async tx => {
      const [old] = await tx.select({ id: table.id, policyId: table.policyId }).from(table).where(eq(table.id, id));
      if (!old) throw new NotFoundException('Không tìm thấy dữ liệu.');
      await this.repo.editable(old.policyId, dto.expectedRevision, tx);
      if (kind === 'option') { const [rule] = await tx.select({ id: valuationRules.id }).from(valuationRules).where(eq(valuationRules.optionId, id)).limit(1); if (rule) throw new ConflictException('Lựa chọn đang có quy tắc. Xóa quy tắc trước hoặc tắt lựa chọn.'); }
      const [removed] = await tx.delete(table).where(eq(table.id, id)).returning();
      await this.repo.invalidate(old.policyId, audit, tx);
      await this.repo.log(tx, audit, `${kind}.delete`, kind, id, removed, null, dto.reason);
    }); } catch (error) { return throwOnConstraint(error); }
  }
  async audit(query: ListQuery) {
    const where = or(eq(auditLogs.entityType, 'valuation_policy'), eq(auditLogs.entityType, 'valuation_reference'), eq(auditLogs.entityType, 'valuation_rule'), eq(auditLogs.entityType, 'valuation_option'), eq(auditLogs.entityType, 'valuation_settings'));
    const db = this.repo.database.db;
    const data = await db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt), asc(auditLogs.id)).limit(query.limit).offset((query.page - 1) * query.limit);
    const [{ total }] = await db.select({ total: count() }).from(auditLogs).where(where);
    return { data, meta: meta(query, total) };
  }
}
