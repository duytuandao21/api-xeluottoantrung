import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { AuditContext } from '../../common/audit.js';
import { throwOnConstraint } from '../../common/database-errors.js';
import { DatabaseService } from '../../database/database.service.js';
import { auditLogs } from '../../database/schema/index.js';
import { CollectionPayloadDto, CollectionQuery, type CollectionName, collectionNames } from './collections.dto.js';

type CollectionConfig = { table: string; fields: readonly string[]; required: readonly string[];
  search: string; publicStatus?: string; order: string; softDelete?: boolean; detailColumn?: string };
const configs: Record<CollectionName, CollectionConfig> = {
  articles: { table: 'articles', fields: ['title', 'slug', 'categoryId', 'excerpt', 'content', 'imageUrl', 'authorName', 'featured', 'status'],
    required: ['title', 'slug', 'content'], search: 'title', publicStatus: 'published', order: 'published_at', softDelete: true, detailColumn: 'slug' },
  'article-categories': { table: 'article_categories', fields: ['name', 'slug'], required: ['name', 'slug'], search: 'name', order: 'created_at' },
  pages: { table: 'pages', fields: ['path', 'title', 'body', 'status'], required: ['path', 'title'],
    search: 'title', publicStatus: 'published', order: 'published_at', softDelete: true, detailColumn: 'path' },
  faqs: { table: 'faqs', fields: ['question', 'answer', 'featured', 'sortOrder', 'status'],
    required: ['question', 'answer'], search: 'question', publicStatus: 'active', order: 'sort_order' },
  testimonials: { table: 'testimonials', fields: ['name', 'content', 'rating', 'avatarUrl', 'carBought', 'purchaseDate', 'featured', 'sortOrder', 'status'],
    required: ['name', 'content', 'rating'], search: 'name', publicStatus: 'active', order: 'sort_order' },
  services: { table: 'services', fields: ['title', 'description', 'imageUrl', 'icon', 'sortOrder', 'status'],
    required: ['title', 'description'], search: 'title', publicStatus: 'active', order: 'sort_order' },
  recruitments: { table: 'recruitments', fields: ['title', 'description', 'requirements', 'salary', 'location', 'imageUrl', 'deadline', 'status'],
    required: ['title', 'description', 'requirements', 'location'], search: 'title', publicStatus: 'active', order: 'created_at' },
  slides: { table: 'slides', fields: ['title', 'imageUrl', 'link', 'sortOrder', 'status'],
    required: ['title', 'imageUrl'], search: 'title', publicStatus: 'active', order: 'sort_order' },
};

function configFor(name: string): CollectionConfig {
  if (!collectionNames.includes(name as CollectionName)) throw new NotFoundException('Content collection not found');
  return configs[name as CollectionName];
}
function dbName(key: string): string { return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`); }
function camelize(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));
}
function rows(result: { rows: Record<string, unknown>[] }): Record<string, unknown>[] { return result.rows.map(camelize); }
function payloadFor(config: CollectionConfig, dto: CollectionPayloadDto, creating: boolean): Record<string, unknown> {
  const raw = Object.fromEntries(Object.entries(dto as Record<string, unknown>)
    .filter(([, value]) => value !== undefined));
  const unexpected = Object.keys(raw).filter((key) => !config.fields.includes(key));
  if (unexpected.length) throw new BadRequestException(`Unsupported fields: ${unexpected.join(', ')}`);
  for (const field of config.required) if ((creating || field in raw) && (raw[field] === undefined || raw[field] === null || String(raw[field]).trim() === ''))
    throw new BadRequestException(`${field} is required`);
  if (!creating && !Object.keys(raw).length) throw new BadRequestException('At least one field is required');
  if (raw.status !== undefined) {
    const allowed = config.publicStatus === 'published' ? ['draft', 'published'] : ['active', 'inactive'];
    if (!allowed.includes(String(raw.status))) throw new BadRequestException('Invalid status for collection');
  }
  if (config.table === 'testimonials' && raw.purchaseDate != null) {
    const [year, month, day] = String(raw.purchaseDate).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day)
      throw new BadRequestException('purchaseDate must be a valid date');
  }
  const result = Object.fromEntries(Object.entries(raw).map(([key, value]) => [dbName(key), value]));
  if (config.publicStatus === 'published' && raw.status !== undefined) result.published_at = raw.status === 'published' ? new Date() : null;
  if (config.table === 'recruitments' && raw.deadline !== undefined) {
    const date = raw.deadline === null ? null : new Date(String(raw.deadline));
    if (date && Number.isNaN(date.getTime())) throw new BadRequestException('deadline must be a valid date');
    result.deadline = date;
  }
  return result;
}
function valuesSql(data: Record<string, unknown>): SQL {
  return sql`(${sql.join(Object.keys(data).map((key) => sql.identifier(key)), sql`, `)}) VALUES (${sql.join(Object.values(data).map((value) => sql`${value}`), sql`, `)})`;
}
function setsSql(data: Record<string, unknown>): SQL {
  return sql.join(Object.entries(data).map(([key, value]) => sql`${sql.identifier(key)} = ${value}`), sql`, `);
}

@Injectable()
export class CollectionsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async list(name: string, query: CollectionQuery, publicOnly: boolean) {
    const config = configFor(name);
    if (query.status && !config.fields.includes('status')) throw new BadRequestException('This collection has no status');
    const filters: SQL[] = [];
    if (config.softDelete) filters.push(sql`deleted_at IS NULL`);
    if (publicOnly && config.publicStatus) filters.push(sql`status = ${config.publicStatus}`);
    if (query.status && !publicOnly) filters.push(sql`status = ${query.status}`);
    if (query.search?.trim()) filters.push(sql`${sql.identifier(config.search)} ILIKE ${`%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%`}`);
    const where = filters.length ? sql` WHERE ${sql.join(filters, sql` AND `)}` : sql``;
    const table = sql.identifier(config.table);
    const [items, totalResult] = await Promise.all([
      this.database.db.execute(sql`SELECT * FROM ${table}${where} ORDER BY ${sql.identifier(config.order)} ${config.order === 'sort_order' ? sql`ASC` : sql`DESC`}, id ASC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`),
      this.database.db.execute(sql`SELECT count(*)::int AS total FROM ${table}${where}`),
    ]);
    const total = Number(totalResult.rows[0]?.total ?? 0);
    return { data: rows(items), meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  async detail(name: string, id: string, publicOnly: boolean, byPublicKey = false) {
    const config = configFor(name);
    if (byPublicKey && !config.detailColumn) throw new NotFoundException('Public detail is unavailable');
    const column = byPublicKey ? config.detailColumn! : 'id';
    const filters: SQL[] = [sql`${sql.identifier(column)} = ${id}`];
    if (config.softDelete) filters.push(sql`deleted_at IS NULL`);
    if (publicOnly && config.publicStatus) filters.push(sql`status = ${config.publicStatus}`);
    const result = await this.database.db.execute(sql`SELECT * FROM ${sql.identifier(config.table)} WHERE ${sql.join(filters, sql` AND `)} LIMIT 1`);
    const row = rows(result)[0];
    if (!row) throw new NotFoundException('Content not found');
    return row;
  }

  async create(name: string, dto: CollectionPayloadDto, audit: AuditContext) {
    const config = configFor(name);
    const data = payloadFor(config, dto, true);
    try {
      return await this.database.db.transaction(async (tx) => {
        const result = await tx.execute(sql`INSERT INTO ${sql.identifier(config.table)} ${valuesSql(data)} RETURNING *`);
        const created = rows(result)[0];
        await tx.insert(auditLogs).values({ ...audit, action: 'content.create', entityType: config.table,
          entityId: String(created.id), newData: created });
        return created;
      });
    } catch (error) { return throwOnConstraint(error); }
  }

  async update(name: string, id: string, dto: CollectionPayloadDto, audit: AuditContext) {
    const config = configFor(name);
    const data = payloadFor(config, dto, false);
    data.updated_at = new Date();
    try {
      return await this.database.db.transaction(async (tx) => {
        const oldResult = await tx.execute(sql`SELECT * FROM ${sql.identifier(config.table)} WHERE id = ${id} ${config.softDelete ? sql`AND deleted_at IS NULL` : sql``} FOR UPDATE`);
        const old = rows(oldResult)[0];
        if (!old) throw new NotFoundException('Content not found');
        if (data.published_at instanceof Date && old.publishedAt instanceof Date) data.published_at = old.publishedAt;
        const updatedResult = await tx.execute(sql`UPDATE ${sql.identifier(config.table)} SET ${setsSql(data)} WHERE id = ${id} RETURNING *`);
        const updated = rows(updatedResult)[0];
        await tx.insert(auditLogs).values({ ...audit, action: 'content.update', entityType: config.table,
          entityId: id, oldData: old, newData: updated });
        return updated;
      });
    } catch (error) { return throwOnConstraint(error); }
  }

  async delete(name: string, id: string, audit: AuditContext): Promise<void> {
    const config = configFor(name);
    try {
      await this.database.db.transaction(async (tx) => {
        const oldResult = await tx.execute(sql`SELECT * FROM ${sql.identifier(config.table)} WHERE id = ${id} ${config.softDelete ? sql`AND deleted_at IS NULL` : sql``} FOR UPDATE`);
        const old = rows(oldResult)[0];
        if (!old) throw new NotFoundException('Content not found');
        if (config.softDelete) await tx.execute(sql`UPDATE ${sql.identifier(config.table)} SET deleted_at = now(), updated_at = now() WHERE id = ${id}`);
        else await tx.execute(sql`DELETE FROM ${sql.identifier(config.table)} WHERE id = ${id}`);
        await tx.insert(auditLogs).values({ ...audit, action: 'content.delete', entityType: config.table, entityId: id, oldData: old });
      });
    } catch (error) { return throwOnConstraint(error); }
  }
}
