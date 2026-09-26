import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import type { AuditContext } from '../../common/audit.js';
import { DatabaseService } from '../../database/database.service.js';
import { auditLogs, customers } from '../../database/schema/index.js';
import { CreateCustomerDto, CustomerQuery, UpdateCustomerDto } from './customers.dto.js';

function snapshot(row: typeof customers.$inferSelect) {
  return { status: row.status, hasAuthAccount: !!row.authUserId };
}
@Injectable()
export class CustomersService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  async list(query: CustomerQuery) {
    const filters: SQL[] = [isNull(customers.deletedAt)];
    if (query.status) filters.push(eq(customers.status, query.status));
    if (query.search?.trim()) {
      const term = `%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%`;
      const clause = or(ilike(customers.name, term), ilike(customers.email, term), ilike(customers.phone, term));
      if (clause) filters.push(clause);
    }
    const where = and(...filters);
    const [data, totalResult] = await Promise.all([
      this.database.db.select().from(customers).where(where).orderBy(desc(customers.createdAt), asc(customers.id))
        .limit(query.limit).offset((query.page - 1) * query.limit),
      this.database.db.select({ total: count() }).from(customers).where(where),
    ]);
    const total = totalResult[0]?.total ?? 0;
    return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }
  async detail(id: string) {
    const [row] = await this.database.db.select().from(customers).where(and(eq(customers.id, id), isNull(customers.deletedAt)));
    if (!row) throw new NotFoundException('Customer not found');
    return row;
  }
  async create(dto: CreateCustomerDto, audit: AuditContext) {
    if (!dto.name.trim() || !dto.phone.trim()) throw new BadRequestException('name and phone are required');
    return this.database.db.transaction(async (tx) => {
      const [created] = await tx.insert(customers).values({ ...dto, name: dto.name.trim(), email: dto.email.trim().toLowerCase(),
        phone: dto.phone.trim() }).returning();
      await tx.insert(auditLogs).values({ ...audit, action: 'customer.create', entityType: 'customer', entityId: created.id,
        newData: snapshot(created) });
      return created;
    });
  }
  async update(id: string, dto: UpdateCustomerDto, audit: AuditContext) {
    if (!Object.keys(dto).length) throw new BadRequestException('At least one field is required');
    if (dto.name !== undefined && !dto.name.trim()) throw new BadRequestException('name is required');
    if (dto.phone !== undefined && !dto.phone.trim()) throw new BadRequestException('phone is required');
    return this.database.db.transaction(async (tx) => {
      const [old] = await tx.select().from(customers).where(and(eq(customers.id, id), isNull(customers.deletedAt))).for('update');
      if (!old) throw new NotFoundException('Customer not found');
      const [updated] = await tx.update(customers).set({ ...dto, name: dto.name?.trim(),
        email: dto.email?.trim().toLowerCase(), phone: dto.phone?.trim(), updatedAt: new Date() })
        .where(eq(customers.id, id)).returning();
      await tx.insert(auditLogs).values({ ...audit, action: 'customer.update', entityType: 'customer', entityId: id,
        oldData: snapshot(old), newData: snapshot(updated) });
      return updated;
    });
  }
  async delete(id: string, audit: AuditContext): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [old] = await tx.select().from(customers).where(and(eq(customers.id, id), isNull(customers.deletedAt))).for('update');
      if (!old) throw new NotFoundException('Customer not found');
      await tx.update(customers).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(customers.id, id));
      await tx.insert(auditLogs).values({ ...audit, action: 'customer.delete', entityType: 'customer', entityId: id,
        oldData: snapshot(old) });
    });
  }
}
