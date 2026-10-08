import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { recommendationEvents, recommendationSessions } from '../../database/schema/index.js';
import { ALGORITHM, RESULT_PAGE_SIZE, type Candidate, type Snapshot } from './domain.js';
import { passesHardFilters, rankCars } from './engine.js';
import { normalizeAnswers, validateConfig } from './validation.js';
import { RecommendationRepository, type RecommendationTx, type SavedSession } from './repository.js';
import type { EventDto, SessionDto } from './dto.js';
export const capabilityHash = (value: string) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
function authorized(row: SavedSession | undefined, capability: string): row is SavedSession {
  return !!row && row.expiresAt.getTime() > Date.now() && timingSafeEqual(Buffer.from(row.capabilityHash, 'hex'), Buffer.from(capabilityHash(capability), 'hex'));
}
@Injectable()
export class RecommendationService {
  constructor(@Inject(RecommendationRepository) private readonly repo: RecommendationRepository) {}
  async config() {
    const settings = await this.repo.settings();
    if (!settings.enabled) return { enabled: false };
    try { validateConfig(settings.config); } catch { throw new ServiceUnavailableException('Cấu hình tiện ích đang được cập nhật.'); }
    return { enabled: true, questions: settings.config.questions.filter(q => q.enabled), minBudget: settings.config.minBudget, maxBudget: settings.config.maxBudget,
      budgetPresets: settings.config.budgetPresets, technicalOptions: await this.repo.lookups(), updatedAt: settings.updatedAt.toISOString() };
  }
  private async present(row: SavedSession, tx: RecommendationTx, inventory?: Candidate[], offset = 0) {
    const current = inventory || await this.repo.inventory(tx, row.snapshot.results.map(item => item.car.id));
    const live = new Map(current.map(car => [car.id, car]));
    const available = row.snapshot.results.filter(item => {
      const car = live.get(item.car.id);
      return car && passesHardFilters(car, row.criteria) && car.price === item.car.price && car.seatCount === item.car.seatCount && car.slug === item.car.slug
        && car.year === item.car.year && car.name === item.car.name && car.mileage === item.car.mileage
        && car.brand.slug === item.car.brand.slug && car.model.slug === item.car.model.slug && car.bodyStyle.slug === item.car.bodyStyle.slug
        && car.transmission.slug === item.car.transmission.slug && car.fuel === item.car.fuel;
    });
    // Cursor refers to immutable snapshot positions, so removal of an earlier car cannot skip the next car.
    const availableIds = new Set(available.map(item => item.car.id));
    const indexed = row.snapshot.results.map((result, index) => ({ result, index })).filter(item => availableIds.has(item.result.car.id));
    const page = indexed.filter(item => item.index >= offset).slice(0, RESULT_PAGE_SIZE);
    const nextOffset = page.length ? page[page.length - 1].index + 1 : row.snapshot.results.length;
    return { sessionId: row.id, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), criteria: row.criteria,
      pageSize: RESULT_PAGE_SIZE, nextOffset, hasMore: indexed.some(item => item.index >= nextOffset), totalAvailable: available.length,
      results: page.map(({ result: { components: _components, ...result } }) => {
        void _components;
        const { assessments: _assessments, ...car } = live.get(result.car.id)!;
        void _assessments;
        return { ...result, car };
      }),
      unavailableCarIds: row.snapshot.results.filter(item => !availableIds.has(item.car.id)).map(item => item.car.id), eligibleCount: row.snapshot.eligibleCount };
  }
  async submit(dto: SessionDto) {
    const hash = capabilityHash(canonical(dto.answers));
    return this.repo.database.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '8s'`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${dto.requestId}, 620241))`);
      const [existing] = await tx.select().from(recommendationSessions).where(eq(recommendationSessions.requestId, dto.requestId));
      if (existing) {
        if (!authorized(existing, dto.capability) || existing.answersHash !== hash) throw new ConflictException('Yêu cầu khảo sát đã thay đổi hoặc hết hạn. Vui lòng gửi một khảo sát mới.');
        return this.present(existing, tx);
      }
      const settings = await this.repo.settings(tx);
      if (!settings.enabled) throw new ServiceUnavailableException('Tiện ích đang tạm ngừng. Vui lòng quay lại sau.');
      if (dto.configUpdatedAt && dto.configUpdatedAt !== settings.updatedAt.toISOString()) throw new ConflictException('Bộ câu hỏi đã được cập nhật. Vui lòng tải lại khảo sát và kiểm tra câu trả lời.');
      const criteria = normalizeAnswers(dto.answers, settings.config);
      const lookups = Object.keys(criteria.technical).length ? await this.repo.lookups(tx) : null;
      for (const [key, value] of Object.entries(criteria.technical)) {
        if (!lookups?.[key as 'brand' | 'bodyStyle' | 'transmission' | 'fuel']?.some(option => option.key === value)) throw new BadRequestException('Thông số xe đã thay đổi. Vui lòng tải lại danh mục và chọn lại.');
      }
      const inventory = await this.repo.inventory(tx), results = rankCars(inventory, criteria, settings.config);
      const snapshot: Snapshot = { algorithm: ALGORITHM, questions: settings.config.questions.filter(q => q.enabled), ...(lookups ? { technicalOptions: lookups } : {}), config: settings.config, criteria, results,
        profiles: results.map(result => ({ carId: result.car.id, assessments: inventory.find(car => car.id === result.car.id)?.assessments || null })),
        eligibleCount: inventory.filter(car => passesHardFilters(car, criteria)).length, unavailableCount: inventory.length - inventory.filter(car => passesHardFilters(car, criteria)).length };
      const [row] = await tx.insert(recommendationSessions).values({ requestId: dto.requestId, capabilityHash: capabilityHash(dto.capability), answersHash: hash,
        answers: dto.answers, criteria, snapshot, resultCount: results.length, topScore: results[0]?.score ?? null, completionMs: dto.completionMs,
        expiresAt: new Date(Date.now() + settings.retentionDays * 86400000) }).returning();
      return this.present(row, tx, inventory);
    });
  }
  async resume(id: string, capability: string, offset = 0) {
    return this.repo.database.db.transaction(async tx => {
      const [row] = await tx.select().from(recommendationSessions).where(eq(recommendationSessions.id, id));
      if (!authorized(row, capability)) throw new NotFoundException('Phiên khảo sát không hợp lệ hoặc đã hết hạn.');
      return this.present(row, tx, undefined, offset);
    });
  }
  async event(id: string, dto: EventDto) {
    return this.repo.database.db.transaction(async tx => {
      const [row] = await tx.select().from(recommendationSessions).where(eq(recommendationSessions.id, id)).for('update');
      if (!authorized(row, dto.capability)) throw new NotFoundException('Phiên khảo sát không hợp lệ hoặc đã hết hạn.');
      if (dto.type === 'car_clicked' && !dto.carId || ['result_viewed', 'quiz_restarted'].includes(dto.type) && dto.carId) throw new BadRequestException('Sự kiện không hợp lệ.');
      if (dto.carId && !row.snapshot.results.some(result => result.car.id === dto.carId)) throw new BadRequestException('Xe không thuộc kết quả khảo sát.');
      const dedupeKey = `${dto.type}:${dto.carId || 'all'}`;
      await tx.insert(recommendationEvents).values({ sessionId: row.id, type: dto.type, carId: dto.carId || null, dedupeKey }).onConflictDoNothing();
      return { accepted: true };
    });
  }
  async detail(id: string) {
    const row = await this.repo.detail(id);
    if (!row) throw new NotFoundException('Không tìm thấy khảo sát.');
    return row;
  }
}
