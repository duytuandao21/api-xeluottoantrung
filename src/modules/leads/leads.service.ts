import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import type { AuditContext } from '../../common/audit.js';
import { DatabaseService } from '../../database/database.service.js';
import { auditLogs, cars, leads, newsletterSubscribers } from '../../database/schema/index.js';
import { CreateLeadDto, LeadQuery, NewsletterDto, NewsletterQuery, UpdateLeadDto, UpdateNewsletterDto } from './leads.dto.js';

function normalizePhone(value: string): string {
  const phone = value.replace(/[()\s.-]/g, '');
  if (!/^(?:\+84|0)[0-9]{9,10}$/.test(phone)) throw new BadRequestException('Invalid Vietnamese phone number');
  return phone;
}
function required(value: string | undefined, field: string): void {
  if (!value?.trim()) throw new BadRequestException(`${field} is required`);
}

@Injectable()
export class LeadsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async create(dto: CreateLeadDto) {
    if (dto.type === 'sell' || dto.type === 'trade_in') {
      required(dto.offeredBrand, 'offeredBrand'); required(dto.offeredModel, 'offeredModel');
      required(dto.offeredYear, 'offeredYear');
    }
    if (dto.type === 'trade_in') required(dto.desiredCar, 'desiredCar');
    if (dto.type === 'finance') { required(dto.name, 'name'); required(dto.financeAmount, 'financeAmount'); required(dto.financeTerm, 'financeTerm'); }
    if (dto.carId) {
      const [car] = await this.database.db.select({ id: cars.id }).from(cars).where(and(eq(cars.id, dto.carId), isNull(cars.deletedAt)));
      if (!car) throw new BadRequestException('carId does not exist');
    }
    const [created] = await this.database.db.insert(leads).values({ ...dto, phone: normalizePhone(dto.phone),
      email: dto.email?.trim().toLowerCase(), name: dto.name?.trim() }).returning({ id: leads.id, createdAt: leads.createdAt });
    return { id: created.id, createdAt: created.createdAt, accepted: true };
  }

  async list(query: LeadQuery) {
    const filters: SQL[] = [];
    if (query.type) filters.push(eq(leads.type, query.type));
    if (query.status) filters.push(eq(leads.status, query.status));
    if (query.search?.trim()) {
      const term = `%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%`;
      const clause = or(ilike(leads.phone, term), ilike(leads.name, term), ilike(leads.carName, term));
      if (clause) filters.push(clause);
    }
    const where = and(...filters);
    const [data, totalResult] = await Promise.all([
      this.database.db.select().from(leads).where(where).orderBy(desc(leads.createdAt), asc(leads.id))
        .limit(query.limit).offset((query.page - 1) * query.limit),
      this.database.db.select({ total: count() }).from(leads).where(where),
    ]);
    const total = totalResult[0]?.total ?? 0;
    return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  async detail(id: string) {
    const [row] = await this.database.db.select().from(leads).where(eq(leads.id, id));
    if (!row) throw new NotFoundException('Lead not found');
    return row;
  }

  async update(id: string, dto: UpdateLeadDto, audit: AuditContext) {
    return this.database.db.transaction(async (tx) => {
      const [old] = await tx.select().from(leads).where(eq(leads.id, id)).for('update');
      if (!old) throw new NotFoundException('Lead not found');
      const [updated] = await tx.update(leads).set({ status: dto.status, handledBy: audit.actorProfileId, updatedAt: new Date() })
        .where(eq(leads.id, id)).returning();
      await tx.insert(auditLogs).values({ ...audit, action: 'lead.status_change', entityType: 'lead', entityId: id,
        oldData: { status: old.status }, newData: { status: updated.status } });
      return updated;
    });
  }

  async delete(id: string, audit: AuditContext): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [removed] = await tx.delete(leads).where(eq(leads.id, id)).returning({ id: leads.id, type: leads.type, status: leads.status });
      if (!removed) throw new NotFoundException('Lead not found');
      await tx.insert(auditLogs).values({ ...audit, action: 'lead.delete', entityType: 'lead', entityId: id,
        oldData: { type: removed.type, status: removed.status } });
    });
  }

  async subscribe(dto: NewsletterDto) {
    const email = dto.email.trim().toLowerCase();
    await this.database.db.insert(newsletterSubscribers).values({ email, source: 'website' })
      .onConflictDoUpdate({ target: newsletterSubscribers.email,
        set: { status: 'active', updatedAt: new Date() } });
    return { accepted: true };
  }

  async subscribers(query: NewsletterQuery) {
    const where = query.search?.trim() ? ilike(newsletterSubscribers.email, `%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%`) : undefined;
    const [data, totalResult] = await Promise.all([
      this.database.db.select().from(newsletterSubscribers).where(where).orderBy(desc(newsletterSubscribers.createdAt))
        .limit(query.limit).offset((query.page - 1) * query.limit),
      this.database.db.select({ total: count() }).from(newsletterSubscribers).where(where),
    ]);
    const total = totalResult[0]?.total ?? 0;
    return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  async exportSubscribers() {
    const rows = await this.database.db.select({ email: newsletterSubscribers.email, status: newsletterSubscribers.status,
      createdAt: newsletterSubscribers.createdAt }).from(newsletterSubscribers).orderBy(asc(newsletterSubscribers.createdAt));
    const cell = (value: string) => {
      const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    return '\uFEFFemail,status,createdAt\r\n' + rows.map((row) =>
      [row.email, row.status, row.createdAt.toISOString()].map(cell).join(',')).join('\r\n');
  }

  async updateSubscriber(id: string, dto: UpdateNewsletterDto, audit: AuditContext) {
    return this.database.db.transaction(async (tx) => {
      const [old] = await tx.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, id)).for('update');
      if (!old) throw new NotFoundException('Subscriber not found');
      const [updated] = await tx.update(newsletterSubscribers).set({ status: dto.status, updatedAt: new Date() })
        .where(eq(newsletterSubscribers.id, id)).returning();
      await tx.insert(auditLogs).values({ ...audit, action: 'newsletter.status_change', entityType: 'newsletter_subscriber',
        entityId: id, oldData: { status: old.status }, newData: { status: updated.status } });
      return updated;
    });
  }

  async deleteSubscriber(id: string, audit: AuditContext): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [removed] = await tx.delete(newsletterSubscribers).where(eq(newsletterSubscribers.id, id)).returning({ id: newsletterSubscribers.id });
      if (!removed) throw new NotFoundException('Subscriber not found');
      await tx.insert(auditLogs).values({ ...audit, action: 'newsletter.delete', entityType: 'newsletter_subscriber', entityId: id });
    });
  }
}
