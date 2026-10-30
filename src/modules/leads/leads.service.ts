import { adminOrder } from '../../common/admin-list-query.js';
import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { AuditContext } from '../../common/audit.js';
import { DatabaseService } from '../../database/database.service.js';
import type { FastifyRequest } from 'fastify';
import { auditLogs, cars, leads, newsletterSubscribers } from '../../database/schema/index.js';
import { BulkLeadStatusDto, BulkNewsletterViewDto, CreateLeadDto, LeadQuery, NewsletterDto, NewsletterQuery, UpdateLeadDto, UpdateNewsletterDto } from './leads.dto.js';
import { FormProtectionService, normalizeFormPhone, normalizeFormText } from './form-protection.service.js';

function required(value: string | undefined, field: string): void {
  if (!value?.trim()) throw new BadRequestException(`${field} is required`);
}

@Injectable()
export class LeadsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional() @Inject(FormProtectionService) private readonly protection?: FormProtectionService) {}

  create(dto: CreateLeadDto): Promise<{ id: string; createdAt: Date; accepted: true }>;
  create(dto: CreateLeadDto, request: FastifyRequest): Promise<{ accepted: true } | { id: string; createdAt: Date; accepted: true }>;
  async create(dto: CreateLeadDto, request?: FastifyRequest): Promise<{ accepted: true } | { id: string; createdAt: Date; accepted: true }> {
    if (dto.type === 'sell' || dto.type === 'trade_in') {
      required(dto.offeredBrand, 'offeredBrand'); required(dto.offeredModel, 'offeredModel');
      required(dto.offeredYear, 'offeredYear');
      required(dto.offeredVersion, 'offeredVersion'); required(dto.offeredMileage, 'offeredMileage');
    }
    if (dto.type === 'trade_in') required(dto.desiredCar, 'desiredCar');
    if (dto.type === 'finance') { required(dto.name, 'name'); required(dto.financeAmount, 'financeAmount'); required(dto.financeTerm, 'financeTerm'); }
    const { submissionId, turnstileToken, productId, ...lead } = dto;
    const normalized = { ...lead, phone: normalizeFormPhone(dto.phone), email: dto.email?.trim().toLowerCase(), name: dto.name?.trim() };
    if (dto.type !== 'finance' && this.protection?.enabled(dto.type)) {
      if (!request) throw new BadRequestException('Request context is required');
      const vehicle = dto.carId ? `id:${dto.carId}` :
        [dto.offeredBrand, dto.offeredModel, dto.offeredVersion, dto.offeredYear, dto.offeredMileage].map(normalizeFormText).join('|');
      const fingerprintParts = dto.type === 'callback'
        ? [normalized.phone, dto.carId ? `car:${dto.carId}` : productId ? `product:${productId}` : normalizeFormText(dto.carName)]
        : dto.type === 'trade_in'
          ? [normalized.phone, vehicle, normalizeFormText(dto.currentCar), normalizeFormText(dto.desiredCar)]
          : [normalized.phone, vehicle];
      const canonical = Object.fromEntries(Object.entries({ ...normalized, productId }).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : value]));
      return this.protection.accept(dto.type, submissionId, turnstileToken, canonical, fingerprintParts, request,
        async tx => {
          if (dto.carId) {
            const [car] = await tx.select({ id: cars.id }).from(cars).where(and(eq(cars.id, dto.carId), isNull(cars.deletedAt)));
            if (!car) throw new BadRequestException('carId does not exist');
          }
          await tx.insert(leads).values(normalized);
        });
    }
    if (dto.carId) {
      const [car] = await this.database.db.select({ id: cars.id }).from(cars).where(and(eq(cars.id, dto.carId), isNull(cars.deletedAt)));
      if (!car) throw new BadRequestException('carId does not exist');
    }
    const [created] = await this.database.db.insert(leads).values(normalized).returning({ id: leads.id, createdAt: leads.createdAt });
    return { id: created.id, createdAt: created.createdAt, accepted: true };
  }

  async unreadCounts() {
    const [[result], [newsletter]] = await Promise.all([
      this.database.db.select({
        sell: sql<number>`count(*) FILTER (WHERE type = 'sell')::int`,
        trade_in: sql<number>`count(*) FILTER (WHERE type = 'trade_in')::int`,
        callback: sql<number>`count(*) FILTER (WHERE type = 'callback')::int`,
      }).from(leads).where(eq(leads.status, 'unread')),
      this.database.db.select({ count: count() }).from(newsletterSubscribers).where(isNull(newsletterSubscribers.viewedAt)),
    ]);
    return { ...result, newsletter: newsletter.count };
  }
  async list(query: LeadQuery) {
    const filters: SQL[] = [];
    if (query.type) filters.push(eq(leads.type, query.type));
    if (query.search?.trim()) {
      const term = `%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%`;
      const clause = or(ilike(leads.phone, term), ilike(leads.name, term), ilike(leads.carName, term),
        ilike(leads.offeredBrand, term), ilike(leads.offeredModel, term), ilike(leads.desiredCar, term));
      if (clause) filters.push(clause);
    }
    const base = and(...filters);
    const [data, [summary]] = await Promise.all([
      this.database.db.select().from(leads).where(and(base, query.status ? eq(leads.status, query.status) : undefined))
        .orderBy(adminOrder(query, ['created_at']) ?? desc(leads.createdAt), asc(leads.id))
        .limit(query.limit).offset((query.page - 1) * query.limit),
      this.database.db.select({ total: count(),
        unread: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'unread')::int`,
        read: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'read')::int`,
        replied: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'replied')::int`,
      }).from(leads).where(base),
    ]);
    const counts = { all: summary.total, unread: summary.unread, read: summary.read, replied: summary.replied };
    const total = query.status ? counts[query.status] : counts.all;
    return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit), counts } };
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

  async bulkUpdate(ids: BulkLeadStatusDto['ids'], status: BulkLeadStatusDto['status'], audit: AuditContext) {
    const unique = [...new Set(ids)];
    return this.database.db.transaction(async tx => {
      const rows = await tx.select({ id: leads.id, status: leads.status }).from(leads).where(inArray(leads.id, unique)).for('update');
      const changed = rows.filter(row => row.status !== status);
      if (!changed.length) return { updated: 0 };
      const changedIds = changed.map(row => row.id);
      await tx.update(leads).set({ status, handledBy: audit.actorProfileId, updatedAt: new Date() }).where(inArray(leads.id, changedIds));
      await tx.insert(auditLogs).values(changed.map(row => ({ ...audit, action: 'lead.status_change', entityType: 'lead', entityId: row.id,
        oldData: { status: row.status }, newData: { status } })));
      return { updated: changed.length };
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

  async subscribe(dto: NewsletterDto, request?: FastifyRequest) {
    const email = dto.email.trim().toLowerCase();
    if (this.protection?.enabled('newsletter')) {
      if (!request) throw new BadRequestException('Request context is required');
      return this.protection.accept('newsletter', dto.submissionId, dto.turnstileToken, { email }, [email], request,
        async tx => {
          // Older rows may retain mixed case or surrounding spaces. Treat them
          // as the same address without modifying existing subscriber data.
          const [existing] = await tx.select({ id: newsletterSubscribers.id }).from(newsletterSubscribers)
            .where(sql`lower(btrim(${newsletterSubscribers.email})) = ${email}`).limit(1);
          if (!existing) await tx.insert(newsletterSubscribers).values({ email, source: 'website' })
            .onConflictDoNothing({ target: newsletterSubscribers.email });
        });
    }
    await this.database.db.insert(newsletterSubscribers).values({ email, source: 'website' })
      .onConflictDoUpdate({ target: newsletterSubscribers.email,
        set: { status: 'active', updatedAt: new Date() } });
    return { accepted: true };
  }

  async subscribers(query: NewsletterQuery) {
    const base = query.search?.trim() ? ilike(newsletterSubscribers.email, `%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%`) : undefined;
    const [data, [summary]] = await Promise.all([
      this.database.db.select().from(newsletterSubscribers).where(and(base, query.view === 'unviewed' ? isNull(newsletterSubscribers.viewedAt) : query.view === 'viewed' ? isNotNull(newsletterSubscribers.viewedAt) : undefined))
        .orderBy(adminOrder(query, ['created_at']) ?? desc(newsletterSubscribers.createdAt), asc(newsletterSubscribers.id))
        .limit(query.limit).offset((query.page - 1) * query.limit),
      this.database.db.select({ total: count(), unviewed: sql<number>`count(*) FILTER (WHERE ${newsletterSubscribers.viewedAt} IS NULL)::int`,
        viewed: sql<number>`count(*) FILTER (WHERE ${newsletterSubscribers.viewedAt} IS NOT NULL)::int` }).from(newsletterSubscribers).where(base),
    ]);
    const counts = { all: summary.total, unviewed: summary.unviewed, viewed: summary.viewed };
    const total = query.view ? counts[query.view] : counts.all;
    return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit), counts } };
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

  async markSubscriberViewed(id: string, audit: AuditContext): Promise<void> {
    await this.database.db.transaction(async tx => {
      const [subscriber] = await tx.select({ id: newsletterSubscribers.id, viewedAt: newsletterSubscribers.viewedAt })
        .from(newsletterSubscribers).where(eq(newsletterSubscribers.id, id)).for('update');
      if (!subscriber) throw new NotFoundException('Subscriber not found');
      if (subscriber.viewedAt) return;
      const viewedAt = new Date();
      await tx.update(newsletterSubscribers).set({ viewedAt }).where(eq(newsletterSubscribers.id, id));
      await tx.insert(auditLogs).values({ ...audit, action: 'newsletter.view', entityType: 'newsletter_subscriber', entityId: id,
        oldData: { viewedAt: null }, newData: { viewedAt: viewedAt.toISOString() } });
    });
  }

  async setSubscriberViewed(ids: BulkNewsletterViewDto['ids'], viewed: boolean, audit: AuditContext) {
    const unique = [...new Set(ids)];
    return this.database.db.transaction(async tx => {
      const rows = await tx.select({ id: newsletterSubscribers.id, viewedAt: newsletterSubscribers.viewedAt })
        .from(newsletterSubscribers).where(inArray(newsletterSubscribers.id, unique)).for('update');
      if (!rows.length && unique.length === 1) throw new NotFoundException('Subscriber not found');
      const changed = rows.filter(row => Boolean(row.viewedAt) !== viewed);
      if (!changed.length) return { updated: 0 };
      const viewedAt = viewed ? new Date() : null;
      await tx.update(newsletterSubscribers).set({ viewedAt }).where(inArray(newsletterSubscribers.id, changed.map(row => row.id)));
      await tx.insert(auditLogs).values(changed.map(row => ({ ...audit, action: viewed ? 'newsletter.view' : 'newsletter.unview',
        entityType: 'newsletter_subscriber', entityId: row.id, oldData: { viewedAt: row.viewedAt?.toISOString() ?? null },
        newData: { viewedAt: viewedAt?.toISOString() ?? null } })));
      return { updated: changed.length };
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
