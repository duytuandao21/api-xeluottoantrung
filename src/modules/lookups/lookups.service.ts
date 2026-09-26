import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { AuditContext } from '../../common/audit.js';
import { throwOnConstraint } from '../../common/database-errors.js';
import { toSlug } from '../../common/slug.js';
import { DatabaseService } from '../../database/database.service.js';
import { auditLogs } from '../../database/schema/index.js';
import { LookupPayloadDto, LookupQuery, lookupNames, type LookupName } from './lookups.dto.js';

type LookupConfig = { table: string; permission: string; fields: readonly string[]; required: readonly string[] };
export const lookupConfigs: Record<LookupName, LookupConfig> = {
  'car-versions': { table: 'car_versions', permission: 'version',
    fields: ['name', 'slug', 'modelId', 'imageUrl', 'sortOrder', 'status'], required: ['name', 'modelId'] },
  'body-styles': { table: 'body_styles', permission: 'body_style',
    fields: ['name', 'slug', 'imageUrl', 'sortOrder', 'status'], required: ['name'] },
  transmissions: { table: 'transmissions', permission: 'transmission',
    fields: ['name', 'slug', 'sortOrder', 'status'], required: ['name'] },
  'car-colors': { table: 'car_colors', permission: 'color',
    fields: ['name', 'slug', 'colorCode', 'sortOrder', 'status'], required: ['name'] },
  'branch-regions': { table: 'branch_regions', permission: 'region',
    fields: ['name', 'slug', 'sortOrder', 'status'], required: ['name'] },
  branches: { table: 'branches', permission: 'branch',
    fields: ['name', 'slug', 'regionId', 'address', 'phone', 'mapUrl', 'imageUrl', 'sortOrder', 'status'],
    required: ['name', 'address', 'phone'] },
  'filter-options': { table: 'filter_options', permission: 'filter',
    fields: ['group', 'name', 'slug', 'minValue', 'maxValue', 'sortOrder', 'status'], required: ['group', 'name'] },
};
export function lookupConfig(name: string): LookupConfig {
  if (!lookupNames.includes(name as LookupName)) throw new NotFoundException('Lookup collection not found');
  return lookupConfigs[name as LookupName];
}
const dbName = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const camelize = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
  [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));
const rows = (result: { rows: Record<string, unknown>[] }) => result.rows.map(camelize);
const assignments = (data: Record<string, unknown>) => sql.join(Object.entries(data).map(([key, value]) =>
  sql`${sql.identifier(key)} = ${value}`), sql`, `);

function payload(config: LookupConfig, dto: LookupPayloadDto, creating: boolean,
  existing?: Record<string, unknown>): Record<string, unknown> {
  const raw = Object.fromEntries(Object.entries(dto as Record<string, unknown>)
    .filter(([, value]) => value !== undefined));
  const extra = Object.keys(raw).filter((key) => !config.fields.includes(key));
  if (extra.length) throw new BadRequestException(`Unsupported fields: ${extra.join(', ')}`);
  if (!creating && !Object.keys(raw).length) throw new BadRequestException('At least one field is required');
  for (const field of config.required) if ((creating || field in raw) &&
    (raw[field] === undefined || raw[field] === null || String(raw[field]).trim() === ''))
    throw new BadRequestException(`${field} is required`);
  if (creating && !raw.slug) raw.slug = toSlug(String(raw.name));
  const minValue = raw.minValue === undefined ? existing?.minValue : raw.minValue;
  const maxValue = raw.maxValue === undefined ? existing?.maxValue : raw.maxValue;
  if (minValue !== undefined && maxValue !== undefined && minValue !== null && maxValue !== null &&
    Number(minValue) > Number(maxValue)) throw new BadRequestException('minValue cannot exceed maxValue');
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [dbName(key), value]));
}

@Injectable()
export class LookupsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  async list(name: string, query: LookupQuery, publicOnly: boolean) {
    const config = lookupConfig(name);
    if (query.group && name !== 'filter-options') throw new BadRequestException('group filter is only valid for filter-options');
    if (query.modelId && name !== 'car-versions') throw new BadRequestException('modelId filter is only valid for car-versions');
    if (query.regionId && name !== 'branches') throw new BadRequestException('regionId filter is only valid for branches');
    const filters: SQL[] = [];
    if (publicOnly) filters.push(sql`status = 'active'`);
    else if (query.status) filters.push(sql`status = ${query.status}`);
    if (query.group) filters.push(sql`"group" = ${query.group}`);
    if (query.modelId) filters.push(sql`model_id = ${query.modelId}`);
    if (query.regionId) filters.push(sql`region_id = ${query.regionId}`);
    if (query.search?.trim()) filters.push(sql`name ILIKE ${`%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%`}`);
    const where = filters.length ? sql` WHERE ${sql.join(filters, sql` AND `)}` : sql``;
    const table = sql.identifier(config.table);
    const [items, countResult] = await Promise.all([
      this.database.db.execute(sql`SELECT * FROM ${table}${where} ORDER BY sort_order ASC, name ASC, id ASC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`),
      this.database.db.execute(sql`SELECT count(*)::int AS total FROM ${table}${where}`),
    ]);
    const total = Number(countResult.rows[0]?.total ?? 0);
    return { data: rows(items), meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  async detail(name: string, id: string, publicOnly: boolean, bySlug = false) {
    const config = lookupConfig(name);
    const result = await this.database.db.execute(sql`SELECT * FROM ${sql.identifier(config.table)} WHERE ${sql.identifier(bySlug ? 'slug' : 'id')} = ${id}
      ${publicOnly ? sql`AND status = 'active'` : sql``} LIMIT 1`);
    const row = rows(result)[0];
    if (!row) throw new NotFoundException('Lookup item not found');
    return row;
  }

  async create(name: string, dto: LookupPayloadDto, audit: AuditContext) {
    const config = lookupConfig(name);
    const data = payload(config, dto, true);
    try {
      return await this.database.db.transaction(async (tx) => {
        const result = await tx.execute(sql`INSERT INTO ${sql.identifier(config.table)}
          (${sql.join(Object.keys(data).map((key) => sql.identifier(key)), sql`, `)})
          VALUES (${sql.join(Object.values(data).map((value) => sql`${value}`), sql`, `)}) RETURNING *`);
        const created = rows(result)[0];
        await tx.insert(auditLogs).values({ ...audit, action: 'lookup.create', entityType: config.table,
          entityId: String(created.id), newData: created });
        return created;
      });
    } catch (error) { return throwOnConstraint(error); }
  }

  async update(name: string, id: string, dto: LookupPayloadDto, audit: AuditContext) {
    const config = lookupConfig(name);
    try {
      return await this.database.db.transaction(async (tx) => {
        const oldResult = await tx.execute(sql`SELECT * FROM ${sql.identifier(config.table)} WHERE id = ${id} FOR UPDATE`);
        const old = rows(oldResult)[0];
        if (!old) throw new NotFoundException('Lookup item not found');
        if (name === 'car-versions' && dto.modelId && dto.modelId !== old.modelId) {
          const linked = await tx.execute(sql`SELECT id FROM cars WHERE version_id = ${id} LIMIT 1`);
          if (linked.rows.length) throw new ConflictException('Version is used by cars and cannot move to another model');
        }
        const data = payload(config, dto, false, old);
        data.updated_at = new Date();
        const result = await tx.execute(sql`UPDATE ${sql.identifier(config.table)} SET ${assignments(data)} WHERE id = ${id} RETURNING *`);
        const updated = rows(result)[0];
        await tx.insert(auditLogs).values({ ...audit, action: 'lookup.update', entityType: config.table,
          entityId: id, oldData: old, newData: updated });
        return updated;
      });
    } catch (error) { return throwOnConstraint(error); }
  }

  async delete(name: string, id: string, audit: AuditContext): Promise<void> {
    const config = lookupConfig(name);
    try {
      await this.database.db.transaction(async (tx) => {
        const result = await tx.execute(sql`DELETE FROM ${sql.identifier(config.table)} WHERE id = ${id} RETURNING *`);
        const old = rows(result)[0];
        if (!old) throw new NotFoundException('Lookup item not found');
        await tx.insert(auditLogs).values({ ...audit, action: 'lookup.delete', entityType: config.table,
          entityId: id, oldData: old });
      });
    } catch (error) { return throwOnConstraint(error); }
  }
}
