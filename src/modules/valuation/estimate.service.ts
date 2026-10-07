import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, gte, isNull, lte, or } from 'drizzle-orm';
import { brands, carColors, carModels, carVersions, valuationReferencePrices } from '../../database/schema/index.js';
import { ValuationRepository, type Tx } from './valuation.repository.js';
import { ValuationEngineService, vietnamDate } from './valuation-engine.service.js';
import { CONDITION_FIELDS, type EstimateInput, type Evaluation, type Snapshot } from './estimate.types.js';
import type { SimulateEstimateDto } from './estimate.dto.js';
import { ValuationHistoryService } from './history.service.js';
function summaryFactors(result: Evaluation) {
  return result.adjustments.filter(row => Math.abs(row.percentage) > 0.000001).sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before)).slice(0, 5).map(row => ({ type: row.type, label: row.label, direction: row.percentage > 0 ? 'INCREASE' : 'DECREASE' }));
}

@Injectable()
export class ValuationEstimateService {
  constructor(@Inject(ValuationRepository) private readonly repo: ValuationRepository, @Inject(ValuationEngineService) private readonly engine: ValuationEngineService, @Inject(ValuationHistoryService) private readonly history: ValuationHistoryService) {}
  private async available(tx: Tx, snapshot: Snapshot, at: Date) {
    const year = Number(vietnamDate(at).slice(0, 4)), ref = valuationReferencePrices;
    return tx.selectDistinct({ brandId: brands.id, brandName: brands.name, brandImageUrl: brands.imageUrl, modelId: carModels.id, modelName: carModels.name, modelImageUrl: carModels.imageUrl, variantId: carVersions.id, variantName: carVersions.name, variantImageUrl: carVersions.imageUrl, modelYear: ref.modelYear })
      .from(ref).innerJoin(carVersions, eq(ref.variantId, carVersions.id)).innerJoin(carModels, eq(carVersions.modelId, carModels.id)).innerJoin(brands, eq(carModels.brandId, brands.id))
      .where(and(eq(ref.policyId, snapshot.policy.id), eq(ref.active, true), lte(ref.effectiveFrom, at), or(isNull(ref.effectiveTo), gt(ref.effectiveTo, at)),
        eq(brands.status, 'active'), eq(carModels.status, 'active'), eq(carVersions.status, 'active'),
        gte(ref.modelYear, Math.max(snapshot.policy.config.minModelYear, year - snapshot.policy.config.maxVehicleAge)), lte(ref.modelYear, year)))
      .orderBy(asc(brands.name), asc(carModels.name), asc(carVersions.name));
  }
  async config() {
    const settings = await this.repo.settings();
    if (!settings.isEnabled || !settings.activePolicyId) return { enabled: false, disclaimer: settings.disclaimer, ctaLabel: settings.ctaLabel };
    return this.repo.runtime(async (current, snapshot, tx) => ({
      enabled: true, policyVersion: snapshot.policy.version, configurationKey: `${snapshot.policy.id}:${snapshot.policy.revision}`, disclaimer: current.disclaimer, ctaLabel: current.ctaLabel,
      limits: { minModelYear: snapshot.policy.config.minModelYear, maxModelYear: Number(vietnamDate(new Date()).slice(0, 4)), maxVehicleAge: snapshot.policy.config.maxVehicleAge, maxOdometerKm: snapshot.policy.config.maxOdometerKm },
      conditionOptions: snapshot.options.filter(row => row.active).map(row => ({ field: CONDITION_FIELDS[row.category as keyof typeof CONDITION_FIELDS], category: row.category, code: row.code, label: row.label, isUnknown: row.isUnknown })),
      colors: await tx.select({ id: carColors.id, name: carColors.name, colorCode: carColors.colorCode }).from(carColors).where(eq(carColors.status, 'active')).orderBy(asc(carColors.name)),
    }));
  }
  async catalog(kind: 'brands' | 'models' | 'variants' | 'years', parent?: string) {
    const at = new Date();
    return this.repo.runtime(async (_settings, snapshot, tx) => {
      const rows = await this.available(tx, snapshot, at);
      const data = kind === 'years' ? [...new Set(rows.filter(row => row.variantId === parent).map(row => row.modelYear))].sort((a, b) => b - a)
        : [...new Map(rows.filter(row => kind === 'brands' || (kind === 'models' ? row.brandId === parent : row.modelId === parent)).map(row => {
          const item = kind === 'brands' ? { id: row.brandId, name: row.brandName, imageUrl: row.brandImageUrl }
            : kind === 'models' ? { id: row.modelId, name: row.modelName, imageUrl: row.modelImageUrl, brandId: row.brandId }
              : { id: row.variantId, name: row.variantName, imageUrl: row.variantImageUrl, modelId: row.modelId };
          return [item.id, item] as const;
        })).values()];
      return { policyVersion: snapshot.policy.version, configurationKey: `${snapshot.policy.id}:${snapshot.policy.revision}`, data };
    });
  }
  private async vehicle(input: EstimateInput, tx: Tx) {
    const [vehicle] = await tx.select({ brandId: brands.id, brandName: brands.name, modelId: carModels.id, modelName: carModels.name, variantId: carVersions.id, variantName: carVersions.name })
      .from(carVersions).innerJoin(carModels, eq(carVersions.modelId, carModels.id)).innerJoin(brands, eq(carModels.brandId, brands.id))
      .where(and(eq(carVersions.id, input.variantId), eq(carModels.id, input.modelId), eq(brands.id, input.brandId), eq(carVersions.status, 'active'), eq(carModels.status, 'active'), eq(brands.status, 'active')));
    if (!vehicle) throw new BadRequestException('Hãng, dòng và phiên bản không khớp hoặc đã ngừng hoạt động.');
    if (input.colorId) { const [color] = await tx.select({ id: carColors.id }).from(carColors).where(and(eq(carColors.id, input.colorId), eq(carColors.status, 'active'))); if (!color) throw new BadRequestException('Màu xe không tồn tại hoặc đã ngừng hoạt động.'); }
    return { ...vehicle, modelYear: input.modelYear };
  }
  async estimate(input: EstimateInput) {
    const at = new Date();
    return this.repo.runtime(async (settings, snapshot, tx) => {
      const vehicle = await this.vehicle(input, tx), result = this.engine.evaluate(input, snapshot, at);
      const ruleIds = new Set(result.adjustments.map(row => row.ruleId));
      const [color] = input.colorId ? await tx.select({ id: carColors.id, name: carColors.name, colorCode: carColors.colorCode }).from(carColors).where(eq(carColors.id, input.colorId)) : [];
      const record = await this.history.capture(tx, { schemaVersion: 1, input, vehicle,
        policy: { id: snapshot.policy.id, name: snapshot.policy.name, version: snapshot.policy.version, revision: snapshot.policy.revision, config: snapshot.policy.config, publishedAt: snapshot.policy.publishedAt },
        reference: snapshot.references.find(row => row.id === result.referenceId) ?? null, resolvedRules: snapshot.rules.filter(row => ruleIds.has(row.id)),
        conditionOptions: snapshot.options.filter(row => { const code = input[CONDITION_FIELDS[row.category as keyof typeof CONDITION_FIELDS]]; return row.active && (code ? row.code === code : row.isUnknown); }),
        color: color ?? null, result, disclaimer: settings.disclaimer, ctaLabel: settings.ctaLabel });
      // Explicit allowlist: no rule IDs/percentages, source notes, margins, anchors, caps or candidate prices.
      return { ...record, status: result.status, policyVersion: result.policyVersion, calculatedAt: result.calculatedAt, vehicle,
        referencePrice: result.referencePrice, referenceType: result.referenceType, marketRange: result.marketRange, dealerBuyingRange: result.dealerBuyingRange,
        confidenceScore: result.confidenceScore, confidenceLevel: result.confidenceLevel, missingFields: result.missingFields,
        manualInspectionRequired: result.manualInspectionRequired, reasons: result.reasons,
        summaryFactors: summaryFactors(result),
        disclaimer: settings.disclaimer, ctaLabel: settings.ctaLabel,
      };
    }, undefined, true);
  }
  async simulate(dto: SimulateEstimateDto) {
    const { policyId, expectedRevision, asOf, ...input } = dto;
    const at = asOf ? new Date(asOf) : new Date();
    return this.repo.runtime(async (settings, snapshot, tx) => {
      if (snapshot.policy.revision !== expectedRevision) throw new ConflictException('Cấu hình đã thay đổi. Tải lại trước khi mô phỏng.');
      const vehicle = await this.vehicle(input, tx);
      const result = this.engine.evaluate(input, snapshot, at);
      return { ...result, summaryFactors: summaryFactors(result), vehicle, simulated: true, policyStatus: snapshot.policy.status, disclaimer: settings.disclaimer, ctaLabel: settings.ctaLabel };
    }, policyId);
  }
}
