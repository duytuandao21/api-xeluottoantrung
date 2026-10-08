import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { bodyStyles, brands, carMedia, carModels, cars, transmissions, branches, carRecommendationProfiles, recommendationSettings, recommendationSessions, recommendationEvents } from '../../database/schema/index.js';
import type { Candidate } from './domain.js';
export type RecommendationDb = DatabaseService['db'];
export type RecommendationTx = Parameters<Parameters<RecommendationDb['transaction']>[0]>[0];
export type SavedSession = typeof recommendationSessions.$inferSelect;
@Injectable()
export class RecommendationRepository {
  constructor(@Inject(DatabaseService) readonly database: DatabaseService) {}
  async settings(tx: RecommendationDb | RecommendationTx = this.database.db) {
    const [settings] = await tx.select().from(recommendationSettings).where(eq(recommendationSettings.id, 1));
    if (!settings) throw new ServiceUnavailableException('Tiện ích đang được chuẩn bị. Vui lòng quay lại sau.');
    return settings;
  }
  async inventory(tx: RecommendationDb | RecommendationTx = this.database.db, ids?: string[]): Promise<Candidate[]> {
    if (ids && !ids.length) return [];
    const rows = await tx.select({ id: cars.id, slug: cars.slug, name: cars.name, price: cars.price, year: cars.year, mileage: cars.mileage, seatCount: cars.seatCount,
      brand: { name: brands.name, slug: brands.slug }, model: { name: carModels.name, slug: carModels.slug },
      bodyStyle: { name: bodyStyles.name, slug: bodyStyles.slug }, transmission: { name: transmissions.name, slug: transmissions.slug },
      fuel: cars.fuel, cover: carMedia.publicUrl, branch: branches.name, assessments: carRecommendationProfiles.assessments,
    }).from(cars).innerJoin(brands, eq(brands.id, cars.brandId)).innerJoin(carModels, and(eq(carModels.id, cars.modelId), eq(carModels.brandId, cars.brandId)))
      .leftJoin(bodyStyles, and(eq(bodyStyles.id, cars.bodyStyleId), eq(bodyStyles.status, 'active')))
      .leftJoin(transmissions, and(eq(transmissions.id, cars.transmissionId), eq(transmissions.status, 'active')))
      .leftJoin(branches, eq(branches.id, cars.branchId))
      .leftJoin(carMedia, and(eq(carMedia.carId, cars.id), eq(carMedia.isCover, true), isNull(carMedia.deletionPendingAt), eq(carMedia.type, 'image')))
      .leftJoin(carRecommendationProfiles, eq(carRecommendationProfiles.carId, cars.id))
      .where(and(eq(cars.status, 'active'), isNotNull(cars.publishedAt), isNull(cars.deletedAt), gt(cars.price, 0), eq(brands.status, 'active'), eq(carModels.status, 'active'), ids ? inArray(cars.id, ids) : undefined))
      .orderBy(asc(cars.id)).limit(5001);
    if (rows.length > 5000) throw new ServiceUnavailableException('Kho xe đang cập nhật. Vui lòng liên hệ để được tư vấn.');
    return rows.map(row => ({ ...row, bodyStyle: row.bodyStyle || { name: null, slug: null }, transmission: row.transmission || { name: null, slug: null } }));
  }
  async lookups(db: RecommendationDb | RecommendationTx = this.database.db) {
    const [brandRows, bodyRows, transmissionRows, fuelRows] = await Promise.all([
      db.select({ key: brands.slug, label: brands.name }).from(brands).where(eq(brands.status, 'active')).orderBy(asc(brands.name)),
      db.select({ key: bodyStyles.slug, label: bodyStyles.name }).from(bodyStyles).where(eq(bodyStyles.status, 'active')).orderBy(asc(bodyStyles.name)),
      db.select({ key: transmissions.slug, label: transmissions.name }).from(transmissions).where(eq(transmissions.status, 'active')).orderBy(asc(transmissions.name)),
      db.selectDistinct({ key: cars.fuel, label: cars.fuel }).from(cars).where(and(eq(cars.status, 'active'), isNotNull(cars.publishedAt), isNull(cars.deletedAt), isNotNull(cars.fuel))).orderBy(asc(cars.fuel)),
    ]);
    return { brand: brandRows, bodyStyle: bodyRows, transmission: transmissionRows, fuel: fuelRows.filter(row => row.key?.trim()).map(row => ({ key: row.key!, label: row.label! })) };
  }
  async sessions(page: number, limit: number) {
    const db = this.database.db;
    const [rows, totals] = await Promise.all([db.select({ id: recommendationSessions.id, createdAt: recommendationSessions.createdAt, criteria: recommendationSessions.criteria, resultCount: recommendationSessions.resultCount, topScore: recommendationSessions.topScore, completionMs: recommendationSessions.completionMs })
      .from(recommendationSessions).orderBy(desc(recommendationSessions.createdAt), asc(recommendationSessions.id)).limit(limit).offset((page - 1) * limit), db.select({ total: count() }).from(recommendationSessions)]);
    return { data: rows, meta: { page, limit, total: totals[0].total, totalPages: Math.ceil(totals[0].total / limit) } };
  }
  async detail(id: string) {
    const [row] = await this.database.db.select({ id: recommendationSessions.id, createdAt: recommendationSessions.createdAt, answers: recommendationSessions.answers, criteria: recommendationSessions.criteria, snapshot: recommendationSessions.snapshot, completionMs: recommendationSessions.completionMs, expiresAt: recommendationSessions.expiresAt }).from(recommendationSessions).where(eq(recommendationSessions.id, id));
    if (!row) return null;
    const events = await this.database.db.select({ type: recommendationEvents.type, carId: recommendationEvents.carId, createdAt: recommendationEvents.createdAt }).from(recommendationEvents).where(eq(recommendationEvents.sessionId, id)).orderBy(asc(recommendationEvents.createdAt));
    return { ...row, events };
  }
}
