import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, isNotNull, isNull, lt, lte, or, type SQL } from 'drizzle-orm';
import { leads, valuationRecords } from '../../database/schema/index.js';
import type { AuditContext } from '../../common/audit.js';
import { ValuationRepository, type Tx } from './valuation.repository.js';
import { HistoryQuery, HistoryStatusDto, ValuationContactDto } from './history.dto.js';
import type { HistorySnapshot } from './history.types.js';
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const summaryColumns = {
  id: valuationRecords.id, createdAt: valuationRecords.createdAt, updatedAt: valuationRecords.updatedAt,
  vehicleName: valuationRecords.vehicleName, brandId: valuationRecords.brandId, modelId: valuationRecords.modelId, modelYear: valuationRecords.modelYear, odometerKm: valuationRecords.odometerKm,
  estimatedMarketValue: valuationRecords.estimatedMarketValue, marketMin: valuationRecords.marketMin, marketMax: valuationRecords.marketMax,
  buyingMin: valuationRecords.buyingMin, buyingMax: valuationRecords.buyingMax, confidenceScore: valuationRecords.confidenceScore, resultStatus: valuationRecords.resultStatus,
  policyVersion: valuationRecords.policyVersion, leadId: valuationRecords.leadId, leadStatus: valuationRecords.leadStatus,
};
function calendarDate(value: string): Date {
  const utc = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== value) throw new BadRequestException('Ngày lọc không hợp lệ.');
  return new Date(`${value}T00:00:00+07:00`);
}
@Injectable()
export class ValuationHistoryService {
  constructor(@Inject(ValuationRepository) private readonly repo: ValuationRepository) {}
  async capture(tx: Tx, snapshot: HistorySnapshot) {
    const leadToken = randomBytes(32).toString('base64url'), leadTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000), result = snapshot.result;
    const [record] = await tx.insert(valuationRecords).values({
      policyId: snapshot.policy.id, policyVersion: snapshot.policy.version, brandId: snapshot.vehicle.brandId, modelId: snapshot.vehicle.modelId,
      vehicleName: `${snapshot.vehicle.brandName} ${snapshot.vehicle.modelName} ${snapshot.vehicle.variantName}`, modelYear: snapshot.vehicle.modelYear, odometerKm: snapshot.input.odometerKm ?? null,
      estimatedMarketValue: result.estimatedMarketValue, marketMin: result.marketRange?.min ?? null, marketMax: result.marketRange?.max ?? null,
      buyingMin: result.dealerBuyingRange?.min ?? null, buyingMax: result.dealerBuyingRange?.max ?? null,
      confidenceScore: result.confidenceScore, resultStatus: result.status, snapshot,
      leadTokenHash: tokenHash(leadToken), leadTokenExpiresAt,
    }).returning({ recordId: valuationRecords.id });
    return { ...record, leadToken, leadTokenExpiresAt: leadTokenExpiresAt.toISOString() };
  }
  async contact(id: string, dto: ValuationContactDto) {
    const phone = dto.phone.replace(/[()\s.-]/g, '');
    if (!/^(?:\+84|0)[0-9]{9,10}$/.test(phone)) throw new BadRequestException('Số điện thoại Việt Nam không hợp lệ.');
    return this.repo.database.db.transaction(async tx => {
      const [record] = await tx.select().from(valuationRecords).where(eq(valuationRecords.id, id)).for('update');
      // Same response for missing/invalid capability. No public history read API.
      if (!record || record.leadTokenExpiresAt.getTime() <= Date.now() || !timingSafeEqual(Buffer.from(record.leadTokenHash, 'hex'), Buffer.from(tokenHash(dto.leadToken), 'hex'))) throw new NotFoundException('Phiên gửi thông tin không hợp lệ hoặc đã hết hạn. Vui lòng định giá lại.');
      if (record.leadId) return { accepted: true }; // Retry after response loss does not create another enquiry.
      const vehicle = record.snapshot.vehicle;
      const [lead] = await tx.insert(leads).values({ type: 'sell', status: 'unread', name: dto.name?.trim(), phone,
        carName: record.vehicleName, offeredBrand: vehicle.brandName, offeredModel: vehicle.modelName, offeredVersion: vehicle.variantName,
        offeredYear: String(vehicle.modelYear), offeredMileage: record.odometerKm === null ? null : String(record.odometerKm),
        content: [`Yêu cầu kiểm định sau định giá xe. Mã định giá: ${record.id}`, dto.city?.trim() ? `Tỉnh/thành: ${dto.city.trim()}` : '', dto.note?.trim() ? `Ghi chú: ${dto.note.trim()}` : '', 'Khách đã đồng ý sử dụng thông tin để liên hệ tư vấn.'].filter(Boolean).join('\n'),
      }).returning({ id: leads.id });
      await tx.update(valuationRecords).set({ leadId: lead.id, leadStatus: 'NEW', updatedAt: new Date() }).where(eq(valuationRecords.id, id));
      return { accepted: true };
    });
  }
  async list(query: HistoryQuery) {
    if (query.priceMin !== undefined && query.priceMax !== undefined && query.priceMin > query.priceMax) throw new BadRequestException('Khoảng giá lọc không hợp lệ.');
    const from = query.dateFrom ? calendarDate(query.dateFrom) : null, to = query.dateTo ? calendarDate(query.dateTo) : null;
    if (from && to && from > to) throw new BadRequestException('Khoảng ngày lọc không hợp lệ.');
    const filters: SQL[] = [];
    if (from) filters.push(gte(valuationRecords.createdAt, from));
    if (to) filters.push(lt(valuationRecords.createdAt, new Date(to.getTime() + 86400000)));
    if (query.brandId) filters.push(eq(valuationRecords.brandId, query.brandId));
    if (query.modelId) filters.push(eq(valuationRecords.modelId, query.modelId));
    if (query.leadStatus) filters.push(query.leadStatus === 'NONE' ? isNull(valuationRecords.leadId) : and(eq(valuationRecords.leadStatus, query.leadStatus), isNotNull(valuationRecords.leadId))!);
    if (query.priceMin !== undefined) filters.push(gte(valuationRecords.estimatedMarketValue, query.priceMin));
    if (query.priceMax !== undefined) filters.push(lte(valuationRecords.estimatedMarketValue, query.priceMax));
    if (query.search?.trim()) { const term = `%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%`; filters.push(or(ilike(valuationRecords.vehicleName, term), ilike(leads.name, term), ilike(leads.phone, term))!); }
    const where = and(...filters), db = this.repo.database.db;
    const [data, totals] = await Promise.all([
      db.select({ ...summaryColumns, contactName: leads.name, contactPhone: leads.phone }).from(valuationRecords).leftJoin(leads, eq(valuationRecords.leadId, leads.id)).where(where).orderBy(desc(valuationRecords.createdAt), asc(valuationRecords.id)).limit(query.limit).offset((query.page - 1) * query.limit),
      db.select({ total: count() }).from(valuationRecords).leftJoin(leads, eq(valuationRecords.leadId, leads.id)).where(where),
    ]);
    const total = totals[0]?.total ?? 0; return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }
  async detail(id: string) {
    const [record] = await this.repo.database.db.select({ ...summaryColumns, snapshot: valuationRecords.snapshot, contact: { id: leads.id, name: leads.name, phone: leads.phone, content: leads.content, status: leads.status, createdAt: leads.createdAt } }).from(valuationRecords).leftJoin(leads, eq(valuationRecords.leadId, leads.id)).where(eq(valuationRecords.id, id));
    if (!record) throw new NotFoundException('Không tìm thấy lịch sử định giá.');
    return record;
  }
  async status(id: string, dto: HistoryStatusDto, actor: AuditContext) {
    await this.repo.database.db.transaction(async tx => {
      const [old] = await tx.select().from(valuationRecords).where(eq(valuationRecords.id, id)).for('update');
      if (!old) throw new NotFoundException('Không tìm thấy lịch sử định giá.');
      if (!old.leadId) throw new BadRequestException('Lần định giá chưa có thông tin liên hệ.');
      if (old.updatedAt.getTime() !== new Date(dto.expectedUpdatedAt).getTime()) throw new ConflictException('Trạng thái đã thay đổi. Tải lại chi tiết trước khi lưu.');
      await tx.update(valuationRecords).set({ leadStatus: dto.leadStatus, updatedAt: new Date() }).where(eq(valuationRecords.id, id));
      await tx.update(leads).set({ status: dto.leadStatus === 'NEW' ? 'unread' : dto.leadStatus === 'CONTACTED' ? 'read' : 'replied', handledBy: actor.actorProfileId, updatedAt: new Date() }).where(eq(leads.id, old.leadId));
      await this.repo.log(tx, actor, 'history.status', 'record', id, { leadStatus: old.leadStatus }, { leadStatus: dto.leadStatus }, dto.reason);
    });
    return this.detail(id);
  }
}
