import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { auditLogs, brands, carModels, cars, carRecommendationProfiles, recommendationSettings } from '../../database/schema/index.js';
import type { AuditContext } from '../../common/audit.js';
import { RecommendationRepository, type RecommendationTx } from './repository.js';
import { DEFAULT_RECOMMENDATION_CONFIG } from './defaults.js';
import { normalizeAnswers, validateConfig } from './validation.js';
import { ASSESSMENT_CATALOG } from './assessment-catalog.js';
import { rankCars } from './engine.js';
import type { BatchProfilesDto, ProfileDto, SettingsDto, PreviewDto } from './admin.dto.js';
const changedAt = (old?: Date | null) => new Date(Math.max(Date.now(), (old?.getTime() || 0) + 1));
function validateAssessments(dto: ProfileDto) {
  if (!dto.assessments || typeof dto.assessments !== 'object' || Array.isArray(dto.assessments) || Object.keys(dto.assessments).length > ASSESSMENT_CATALOG.length) throw new BadRequestException('Hồ sơ đánh giá không hợp lệ.');
  const valid = new Set(ASSESSMENT_CATALOG.map(item => item.key));
  for (const [key, assessment] of Object.entries(dto.assessments)) {
    if (!valid.has(key) || !assessment || typeof assessment !== 'object' || Object.keys(assessment).length !== 2 || !Number.isInteger(assessment.score) || assessment.score < 1 || assessment.score > 5 || typeof assessment.source !== 'string' || assessment.source.trim().length < 3 || assessment.source.length > 1000) throw new BadRequestException(`Điểm ${key} phải từ 1–5 và có nguồn/căn cứ (3–1000 ký tự). Chưa rõ thì bỏ tiêu chí.`);
    assessment.source = assessment.source.trim();
  }
}
@Injectable()
export class RecommendationAdminService {
  constructor(@Inject(RecommendationRepository) private readonly repo: RecommendationRepository) {}
  async settings() {
    const [settings, brandRows, modelRows] = await Promise.all([this.repo.settings(), this.repo.database.db.select({ id: brands.id, name: brands.name }).from(brands).orderBy(asc(brands.name)), this.repo.database.db.select({ id: carModels.id, brandId: carModels.brandId, name: carModels.name }).from(carModels).orderBy(asc(carModels.name))]);
    return { ...settings, defaults: DEFAULT_RECOMMENDATION_CONFIG, assessmentCatalog: ASSESSMENT_CATALOG, catalogs: { brands: brandRows, models: modelRows } };
  }
  async saveSettings(dto: SettingsDto, actor: AuditContext) {
    validateConfig(dto.config);
    return this.repo.database.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '8s'`);
      const [old] = await tx.select().from(recommendationSettings).where(eq(recommendationSettings.id, 1)).for('update');
      if (!old) throw new NotFoundException('Chưa khởi tạo cấu hình.');
      if (old.updatedAt.toISOString() !== new Date(dto.expectedUpdatedAt).toISOString()) throw new ConflictException('Cấu hình đã được người khác sửa. Tải lại trước khi lưu để tránh ghi đè.');
      const [row] = await tx.update(recommendationSettings).set({ enabled: dto.enabled, retentionDays: dto.retentionDays, config: dto.config, updatedBy: actor.actorProfileId, updatedAt: changedAt(old.updatedAt) }).where(eq(recommendationSettings.id, 1)).returning();
      await this.audit(tx, actor, 'settings.update', 'recommendation_settings', null, old, row);
      return row;
    });
  }
  async profile(id: string) {
    const [car] = await this.repo.database.db.select({ id: cars.id, name: cars.name, slug: cars.slug, status: cars.status, year: cars.year, price: cars.price, seatCount: cars.seatCount }).from(cars).where(and(eq(cars.id, id), isNull(cars.deletedAt)));
    if (!car) throw new NotFoundException('Xe không tồn tại hoặc đã xóa.');
    const [profile] = await this.repo.database.db.select().from(carRecommendationProfiles).where(eq(carRecommendationProfiles.carId, id));
    return { car, assessments: profile?.assessments || {}, updatedAt: profile?.updatedAt || null, updatedBy: profile?.updatedBy || null };
  }
  async saveProfiles(dto: BatchProfilesDto, actor: AuditContext) {
    if (new Set(dto.items.map(item => item.carId)).size !== dto.items.length) throw new BadRequestException('Không được trùng xe trong một lần lưu.');
    dto.items.forEach(validateAssessments);
    return this.repo.database.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '8s'`);
      // Consistent lock order serializes single/batch edits, including the first profile insert.
      const ids = dto.items.map(item => item.carId).sort();
      const locked = await tx.select({ id: cars.id }).from(cars).where(and(inArray(cars.id, ids), isNull(cars.deletedAt))).orderBy(asc(cars.id)).for('update');
      if (locked.length !== ids.length) throw new NotFoundException('Một xe đã xóa hoặc không còn tồn tại. Không có thay đổi nào được lưu.');
      const oldRows = await tx.select().from(carRecommendationProfiles).where(inArray(carRecommendationProfiles.carId, ids));
      const rows = [];
      for (const item of dto.items) {
        const old = oldRows.find(row => row.carId === item.carId);
        if ((old?.updatedAt.toISOString() || null) !== (item.expectedUpdatedAt ? new Date(item.expectedUpdatedAt).toISOString() : null)) throw new ConflictException('Hồ sơ xe đã được người khác sửa. Tải lại và đối chiếu trước khi lưu.');
        const assessments = item.merge ? { ...old?.assessments, ...item.assessments } : item.assessments;
        validateAssessments({ assessments });
        const updated = { assessments, updatedBy: actor.actorProfileId, updatedAt: changedAt(old?.updatedAt) };
        const [row] = await tx.insert(carRecommendationProfiles).values({ carId: item.carId, ...updated }).onConflictDoUpdate({ target: carRecommendationProfiles.carId, set: updated }).returning();
        await this.audit(tx, actor, 'profile.update', 'car_recommendation_profile', item.carId, old || null, row); rows.push(row);
      }
      return { data: rows };
    });
  }
  async preview(dto: PreviewDto) {
    const criteria = normalizeAnswers(dto.answers, dto.config), inventory = await this.repo.inventory();
    return { criteria, results: rankCars(inventory, criteria, { ...dto.config, maxResults: Math.min(6, dto.config.maxResults) }), weights: dto.config.weights, saved: false };
  }
  private async audit(tx: RecommendationTx, actor: AuditContext, action: string, entityType: string, entityId: string | null, oldData: unknown, newData: unknown) {
    await tx.insert(auditLogs).values({ ...actor, action: `car_recommendation.${action}`, entityType, entityId, oldData, newData });
  }
}
