import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { AuditContext } from '../../common/audit.js';
import { DatabaseService } from '../../database/database.service.js';
import { auditLogs } from '../../database/schema/index.js';
import type { SaveDisplayOrderDto } from './display-order.dto.js';
import { contentKeyPattern } from './content.dto.js';

const collectionLabels = {
  faqs: ['faqs', 'question'],
  testimonials: ['testimonials', 'name'],
  services: ['services', 'title'],
  slides: ['slides', 'title'],
  accessories: ['accessories', 'name'],
  'accessory-brands': ['accessory_brands', 'name'],
  'accessory-categories': ['accessory_categories', 'name'],
} as const;

type Scope = { table: string; label: string; group?: string };

function collectionScope(name: string): Scope {
  const config = collectionLabels[name as keyof typeof collectionLabels];
  if (!config) throw new NotFoundException('Collection does not support display order');
  return { table: config[0], label: config[1] };
}

function entryScope(group: string): Scope {
  if (group.length > 80 || !contentKeyPattern.test(group)) throw new BadRequestException('Invalid content group');
  return { table: 'content_entries', label: 'title', group };
}

function orderSql(scope: Scope): SQL {
  return scope.group ? sql`sort_order ASC, created_at ASC, id ASC` : sql`sort_order ASC, id ASC`;
}

function whereSql(scope: Scope): SQL {
  return scope.group ? sql`WHERE "group" = ${scope.group}` : sql``;
}

@Injectable()
export class DisplayOrderService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  collection(name: string) { return this.list(collectionScope(name)); }
  entries(group: string) { return this.list(entryScope(group)); }
  saveCollection(name: string, dto: SaveDisplayOrderDto, audit: AuditContext) { return this.save(collectionScope(name), dto, audit); }
  saveEntries(group: string, dto: SaveDisplayOrderDto, audit: AuditContext) { return this.save(entryScope(group), dto, audit); }

  private async list(scope: Scope) {
    const result = await this.database.db.execute(sql`SELECT id, ${sql.identifier(scope.label)} AS label
      FROM ${sql.identifier(scope.table)} ${whereSql(scope)} ORDER BY ${orderSql(scope)}`);
    return result.rows.map(row => ({ id: String(row.id), label: String(row.label ?? '') }));
  }

  private async save(scope: Scope, dto: SaveDisplayOrderDto, audit: AuditContext) {
    const { ids, expectedIds } = dto;
    const expected = new Set(expectedIds);
    if (ids.length !== expectedIds.length || expected.size !== expectedIds.length ||
      new Set(ids).size !== ids.length || ids.some(id => !expected.has(id)) || !ids.length)
      throw new BadRequestException('Display order must contain every item exactly once');
    await this.database.db.transaction(async tx => {
      // Serialize order writes and inserts/deletes, so the saved permutation covers the entire scope.
      await tx.execute(sql`LOCK TABLE ${sql.identifier(scope.table)} IN SHARE ROW EXCLUSIVE MODE`);
      const current = await tx.execute(sql`SELECT id FROM ${sql.identifier(scope.table)} ${whereSql(scope)} ORDER BY ${orderSql(scope)}`);
      const currentIds = current.rows.map(row => String(row.id));
      if (currentIds.length !== expectedIds.length || currentIds.some((id, index) => id !== expectedIds[index]))
        throw new ConflictException('Danh sách đã thay đổi. Vui lòng tải lại trước khi sắp xếp.');
      if (ids.every((id, index) => id === expectedIds[index])) return;
      const values = sql.join(ids.map((id, index) => sql`(${id}::uuid, ${index}::integer)`), sql`, `);
      await tx.execute(sql`UPDATE ${sql.identifier(scope.table)} AS item
        SET sort_order = ordered.position, updated_at = now()
        FROM (VALUES ${values}) AS ordered(id, position)
        WHERE item.id = ordered.id ${scope.group ? sql`AND item."group" = ${scope.group}` : sql``}`);
      await tx.insert(auditLogs).values({ ...audit, action: 'content.reorder', entityType: scope.table,
        entityId: ids[0], oldData: { group: scope.group, count: ids.length, firstId: expectedIds[0] },
        newData: { group: scope.group, count: ids.length, firstId: ids[0] } });
    });
    return { saved: true };
  }
}
