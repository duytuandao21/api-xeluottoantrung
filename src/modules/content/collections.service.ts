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
  'driving-experiences': { table: 'driving_experiences', fields: ['title', 'slug', 'categoryId', 'excerpt', 'content', 'imageUrl', 'authorName', 'featured', 'status'],
    required: ['title', 'slug', 'content'], search: 'title', publicStatus: 'published', order: 'published_at', softDelete: true, detailColumn: 'slug' },
  'article-categories': { table: 'article_categories', fields: ['name', 'slug'], required: ['name', 'slug'], search: 'name', order: 'created_at' },
  pages: { table: 'pages', fields: ['path', 'title', 'body', 'status'], required: ['path', 'title'],
    search: 'title', publicStatus: 'published', order: 'published_at', softDelete: true, detailColumn: 'path' },
  faqs: { table: 'faqs', fields: ['question', 'answer', 'excerpt', 'imageUrl', 'featured', 'sortOrder', 'status'],
    required: ['question', 'answer'], search: 'question', publicStatus: 'active', order: 'sort_order', detailColumn: 'slug' },
  testimonials: { table: 'testimonials', fields: ['name', 'content', 'rating', 'avatarUrl', 'carBought', 'purchaseDate', 'featured', 'sortOrder', 'status'],
    required: ['name', 'content', 'rating'], search: 'name', publicStatus: 'active', order: 'sort_order' },
  services: { table: 'services', fields: ['title', 'description', 'imageUrl', 'icon', 'sortOrder', 'status'],
    required: ['title', 'description'], search: 'title', publicStatus: 'active', order: 'sort_order', detailColumn: 'slug' },
  recruitments: { table: 'recruitments', fields: ['title', 'description', 'excerpt', 'imageUrl', 'status'],
    required: ['title', 'description'], search: 'title', publicStatus: 'active', order: 'created_at', detailColumn: 'slug' },
  slides: { table: 'slides', fields: ['title', 'imageUrl', 'link', 'sortOrder', 'status'],
    required: ['title', 'imageUrl'], search: 'title', publicStatus: 'active', order: 'sort_order' },
  accessories: { table: 'accessories', fields: ['name', 'brandId', 'categoryId', 'price', 'imageUrl', 'imageUrls', 'description', 'sortOrder', 'status'],
    required: ['name', 'brandId', 'price', 'imageUrl'], search: 'name', publicStatus: 'active', order: 'sort_order' },
  'accessory-brands': { table: 'accessory_brands', fields: ['name', 'imageUrl', 'sortOrder', 'status'],
    required: ['name'], search: 'name', publicStatus: 'active', order: 'sort_order' },
  'accessory-categories': { table: 'accessory_categories', fields: ['name', 'sortOrder', 'status'],
    required: ['name'], search: 'name', publicStatus: 'active', order: 'sort_order' },
};

function configFor(name: string): CollectionConfig {
  if (!collectionNames.includes(name as CollectionName)) throw new NotFoundException('Content collection not found');
  return configs[name as CollectionName];
}
function serviceSlugBase(title: string): string {
  return title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 220).replace(/-$/, '');
}
function availableServiceSlug(base: string, taken: Set<string>): string {
  let slug = base;
  for (let suffix = 2; taken.has(slug); suffix++) slug = `${base}-${suffix}`;
  return slug;
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
  return result;
}
function fieldValueSql(key: string, value: unknown): SQL {
  if (key === 'image_urls' && Array.isArray(value))
    return sql`ARRAY[${sql.join(value.map((url) => sql`${url}`), sql`, `)}]::text[]`;
  return sql`${value}`;
}
function valuesSql(data: Record<string, unknown>): SQL {
  return sql`(${sql.join(Object.keys(data).map((key) => sql.identifier(key)), sql`, `)}) VALUES (${sql.join(Object.entries(data).map(([key, value]) => fieldValueSql(key, value)), sql`, `)})`;
}
function setsSql(data: Record<string, unknown>): SQL {
  return sql.join(Object.entries(data).map(([key, value]) => sql`${sql.identifier(key)} = ${fieldValueSql(key, value)}`), sql`, `);
}

@Injectable()
export class CollectionsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async list(name: string, query: CollectionQuery, publicOnly: boolean) {
    const config = configFor(name);
    if (name !== 'accessories' && (query.brandId || query.categoryId || query.sort)) throw new BadRequestException('Unsupported filters');
    if (query.status && !config.fields.includes('status')) throw new BadRequestException('This collection has no status');
    const filters: SQL[] = [];
    if (config.softDelete) filters.push(sql`deleted_at IS NULL`);
    if (publicOnly && config.publicStatus) filters.push(sql`status = ${config.publicStatus}`);
    if (query.status && !publicOnly) filters.push(sql`status = ${query.status}`);
    if (query.search?.trim()) {
      const term = `%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%`;
      filters.push(name === 'accessories'
        ? sql`(name ILIKE ${term} OR brand ILIKE ${term})`
        : sql`${sql.identifier(config.search)} ILIKE ${term}`);
    }
    if (name === 'accessories' && query.brandId) filters.push(sql`brand_id = ${query.brandId}`);
    if (name === 'accessories' && query.categoryId) filters.push(sql`category_id = ${query.categoryId}`);
    const where = filters.length ? sql` WHERE ${sql.join(filters, sql` AND `)}` : sql``;
    const table = sql.identifier(config.table);
    const order = name === 'accessories' && query.sort ? query.sort === 'price-asc' ? sql`price ASC, id ASC`
      : query.sort === 'price-desc' ? sql`price DESC, id ASC` : sql`created_at DESC, id ASC`
      : sql`${sql.identifier(config.order)} ${config.order === 'sort_order' ? sql`ASC` : sql`DESC`}, id ASC`;
    const [items, totalResult] = await Promise.all([
      this.database.db.execute(sql`SELECT * FROM ${table}${where} ORDER BY ${order} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`),
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
        if (name === 'services' || name === 'recruitments' || name === 'faqs') {
          const base = serviceSlugBase(String(name === 'faqs' ? data.question : data.title));
          if (!base) throw new BadRequestException('Tiêu đề cần có chữ hoặc số để tạo liên kết');
          const existing = await tx.execute(sql`SELECT slug FROM ${sql.identifier(config.table)} WHERE slug = ${base} OR slug LIKE ${`${base}-%`}`);
          data.slug = availableServiceSlug(base, new Set(existing.rows.map(row => String(row.slug))));
        }
        if (name === 'accessories') {
          if (data.brand_id) {
            const brand = await tx.execute(sql`SELECT name FROM accessory_brands WHERE id = ${data.brand_id} LIMIT 1`);
            if (!brand.rows[0]) throw new BadRequestException('Thương hiệu phụ kiện không tồn tại');
            data.brand = brand.rows[0].name;
          }
        }
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
        const titleField = name === 'faqs' ? 'question' : 'title';
        if ((name === 'services' || name === 'recruitments' || name === 'faqs') && data[titleField] !== undefined && data[titleField] !== old[titleField]) {
          const base = serviceSlugBase(String(data[titleField]));
          if (!base) throw new BadRequestException('Tiêu đề cần có chữ hoặc số để tạo liên kết');
          const existing = await tx.execute(sql`SELECT slug FROM ${sql.identifier(config.table)} WHERE id <> ${id} AND (slug = ${base} OR slug LIKE ${`${base}-%`})`);
          data.slug = availableServiceSlug(base, new Set(existing.rows.map(row => String(row.slug))));
        }
        if (name === 'accessories' && data.brand_id) {
          const brand = await tx.execute(sql`SELECT name FROM accessory_brands WHERE id = ${data.brand_id} LIMIT 1`);
          if (!brand.rows[0]) throw new BadRequestException('Thương hiệu phụ kiện không tồn tại');
          data.brand = brand.rows[0].name;
        }
        if (data.published_at instanceof Date && old.publishedAt instanceof Date) data.published_at = old.publishedAt;
        const updatedResult = await tx.execute(sql`UPDATE ${sql.identifier(config.table)} SET ${setsSql(data)} WHERE id = ${id} RETURNING *`);
        const updated = rows(updatedResult)[0];
        if (name === 'accessory-brands' && data.name !== undefined)
          await tx.execute(sql`UPDATE accessories SET brand = ${data.name}, updated_at = now() WHERE brand_id = ${id}`);
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
