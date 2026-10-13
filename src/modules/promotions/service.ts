import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, gte, ilike, isNull, lt, lte, sql } from 'drizzle-orm';
import type { AuditContext } from '../../common/audit.js';
import { DatabaseService } from '../../database/database.service.js';
import { auditLogs, promotionPopup, promotions } from '../../database/schema/index.js';
import type { CreatePromotionDto, PromotionQuery, UpdatePromotionDto } from './dto.js';

type Promotion = typeof promotions.$inferSelect;
type Tx = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
export const promotionToday = (now = new Date()) => new Date(+now + 7 * 3600000).toISOString().slice(0, 10);
export function promotionStatus(startsAt: string, endsAt: string, today = promotionToday()) {
  return today < startsAt ? 'upcoming' : today > endsAt ? 'ended' : 'ongoing';
}
const listFields = {
  id: promotions.id, title: promotions.title, kind: promotions.kind, imageUrl: promotions.imageUrl,
  startsAt: promotions.startsAt, endsAt: promotions.endsAt, isPublished: promotions.isPublished, updatedAt: promotions.updatedAt,
};
@Injectable()
export class PromotionsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async list(query: PromotionQuery, admin = false) {
    const now = promotionToday(), page = query.page ?? 1, limit = query.limit ?? 6;
    const condition = and(isNull(promotions.deletedAt), admin ? undefined : eq(promotions.isPublished, true),
      query.search?.trim() ? ilike(promotions.title, `%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%`) : undefined,
      query.status === 'ongoing' ? and(lte(promotions.startsAt, now), gte(promotions.endsAt, now)) : undefined,
      query.status === 'upcoming' ? gt(promotions.startsAt, now) : undefined,
      query.status === 'ended' ? lt(promotions.endsAt, now) : undefined);
    const rank = sql`CASE WHEN ${promotions.endsAt} < ${now} THEN 2 WHEN ${promotions.startsAt} > ${now} THEN 1 ELSE 0 END`;
    const [rows, totals, popup] = await Promise.all([
      this.database.db.select({ ...listFields, selectedId: promotionPopup.promotionId }).from(promotions)
        .leftJoin(promotionPopup, eq(promotionPopup.id, 1)).where(condition)
        .orderBy(asc(rank), asc(sql`CASE WHEN ${promotions.startsAt} > ${now} THEN ${promotions.startsAt} END`), desc(promotions.startsAt), desc(promotions.id))
        .limit(limit).offset((page - 1) * limit),
      this.database.db.select({ total: count() }).from(promotions).where(condition),
      admin ? this.popup() : Promise.resolve(undefined),
    ]);
    return { data: rows.map(({ selectedId, ...row }) => ({ ...row, status: promotionStatus(row.startsAt, row.endsAt, now),
      ...(admin ? { popupEnabled: selectedId === row.id && row.isPublished && row.endsAt >= now } : {}) })),
      meta: { page, limit, total: totals[0].total, totalPages: Math.ceil(totals[0].total / limit) }, ...(admin ? { popup } : {}) };
  }
  async detail(id: string, admin = false) {
    const [row] = await this.database.db.select().from(promotions).where(and(eq(promotions.id, id), isNull(promotions.deletedAt),
      admin ? undefined : eq(promotions.isPublished, true)));
    if(!row) throw new NotFoundException('Không tìm thấy chương trình.');
    const [selected] = admin ? await this.database.db.select().from(promotionPopup).where(eq(promotionPopup.id, 1)) : [];
    return { ...row, deletedAt: undefined, status: promotionStatus(row.startsAt, row.endsAt),
      ...(admin ? { popupEnabled: selected?.promotionId === id && row.isPublished && row.endsAt >= promotionToday() } : {}) };
  }
  async popup() {
    const [row] = await this.database.db.select({ id: promotions.id, title: promotions.title, imageUrl: promotions.imageUrl,
      startsAt: promotions.startsAt, endsAt: promotions.endsAt }).from(promotionPopup)
      .innerJoin(promotions, eq(promotions.id, promotionPopup.promotionId))
      .where(and(eq(promotionPopup.id, 1), isNull(promotions.deletedAt), eq(promotions.isPublished, true), gte(promotions.endsAt, promotionToday())));
    return row ? { ...row, status: promotionStatus(row.startsAt, row.endsAt) } : null;
  }
  private validate(dto: CreatePromotionDto | UpdatePromotionDto, old?: Promotion) {
    if(Object.values(dto).some(value => value === null)) throw new BadRequestException('Các trường không được để null.');
    const data = { title: (dto.title ?? old?.title ?? '').trim(), kind: dto.kind ?? old?.kind ?? 'promotion',
      imageUrl: dto.imageUrl ?? old?.imageUrl ?? '', content: dto.content ?? old?.content ?? '',
      startsAt: dto.startsAt ?? old?.startsAt ?? '', endsAt: dto.endsAt ?? old?.endsAt ?? '',
      isPublished: dto.isPublished ?? old?.isPublished ?? true };
    if(!data.title || !data.imageUrl || !data.startsAt || !data.endsAt || data.endsAt < data.startsAt)
      throw new BadRequestException('Vui lòng nhập tiêu đề, ảnh và ngày kết thúc không trước ngày bắt đầu.');
    if(dto.popupEnabled && (!data.isPublished || data.endsAt < promotionToday()))
      throw new BadRequestException('Chỉ bật popup cho chương trình đã đăng và chưa kết thúc.');
    return data;
  }
  private async lockPopup(tx: Tx) {
    const [row] = await tx.select().from(promotionPopup).where(eq(promotionPopup.id, 1)).for('update');
    if(!row) throw new BadRequestException('Chưa khởi tạo cấu hình khuyến mãi.');
    return row;
  }
  async create(dto: CreatePromotionDto, audit: AuditContext) {
    const data = this.validate(dto);
    const row = await this.database.db.transaction(async tx => {
      await this.lockPopup(tx);
      const [created] = await tx.insert(promotions).values(data).returning();
      if(dto.popupEnabled) await tx.update(promotionPopup).set({ promotionId: created.id, updatedAt: new Date() }).where(eq(promotionPopup.id, 1));
      await tx.insert(auditLogs).values({ ...audit, action: 'promotion.create', entityType: 'promotions', entityId: created.id, newData: { ...created, popupEnabled: !!dto.popupEnabled } });
      return created;
    });
    return this.detail(row.id, true);
  }
  async update(id: string, dto: UpdatePromotionDto, audit: AuditContext) {
    if(!Object.keys(dto).length) throw new BadRequestException('Chưa có nội dung thay đổi.');
    await this.database.db.transaction(async tx => {
      const selected = await this.lockPopup(tx);
      const [old] = await tx.select().from(promotions).where(and(eq(promotions.id, id), isNull(promotions.deletedAt))).for('update');
      if(!old) throw new NotFoundException('Không tìm thấy chương trình.');
      const data = this.validate(dto, old);
      const [updated] = await tx.update(promotions).set({ ...data, updatedAt: new Date() }).where(eq(promotions.id, id)).returning();
      const disable = !data.isPublished || data.endsAt < promotionToday() || dto.popupEnabled === false;
      if(dto.popupEnabled || (disable && selected.promotionId === id)) await tx.update(promotionPopup)
        .set({ promotionId: dto.popupEnabled ? id : null, updatedAt: new Date() }).where(eq(promotionPopup.id, 1));
      await tx.insert(auditLogs).values({ ...audit, action: 'promotion.update', entityType: 'promotions', entityId: id, oldData: old, newData: updated });
    });
    return this.detail(id, true);
  }
  async togglePopup(id: string, enabled: boolean, audit: AuditContext) {
    await this.database.db.transaction(async tx => {
      const selected = await this.lockPopup(tx);
      const [row] = await tx.select().from(promotions).where(and(eq(promotions.id, id), isNull(promotions.deletedAt))).for('update');
      if(!row) throw new NotFoundException('Không tìm thấy chương trình.');
      if(enabled && (!row.isPublished || row.endsAt < promotionToday())) throw new BadRequestException('Chỉ bật popup cho chương trình đã đăng và chưa kết thúc.');
      await tx.update(promotionPopup).set({ promotionId: enabled ? id : selected.promotionId === id ? null : selected.promotionId,
        updatedAt: new Date() }).where(eq(promotionPopup.id, 1));
      await tx.insert(auditLogs).values({ ...audit, action: 'promotion.popup', entityType: 'promotions', entityId: id,
        oldData: { selectedId: selected.promotionId }, newData: { selectedId: enabled ? id : selected.promotionId === id ? null : selected.promotionId } });
    });
    return this.detail(id, true);
  }
  async delete(id: string, audit: AuditContext) {
    await this.database.db.transaction(async tx => {
      await this.lockPopup(tx);
      const [old] = await tx.update(promotions).set({ deletedAt: new Date(), updatedAt: new Date(), isPublished: false })
        .where(and(eq(promotions.id, id), isNull(promotions.deletedAt))).returning();
      if(!old) throw new NotFoundException('Không tìm thấy chương trình.');
      await tx.update(promotionPopup).set({ promotionId: null, updatedAt: new Date() }).where(and(eq(promotionPopup.id, 1), eq(promotionPopup.promotionId, id)));
      await tx.insert(auditLogs).values({ ...audit, action: 'promotion.delete', entityType: 'promotions', entityId: id, oldData: old });
    });
  }
}
