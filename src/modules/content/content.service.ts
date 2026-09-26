import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { AuditContext } from '../../common/audit.js';
import { throwOnConstraint } from '../../common/database-errors.js';
import { DatabaseService } from '../../database/database.service.js';
import { auditLogs, contentEntries, siteSettings } from '../../database/schema/index.js';
import { CreateContentEntryDto, UpdateContentEntryDto, UpsertSettingDto } from './content.dto.js';

@Injectable()
export class ContentService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  entries(group?: string, admin = false) {
    const predicates = [group ? eq(contentEntries.group, group) : undefined,
      !admin ? eq(contentEntries.status, 'active') : undefined].filter((item) => item !== undefined);
    return this.database.db.select().from(contentEntries).where(and(...predicates)).orderBy(asc(contentEntries.group), asc(contentEntries.sortOrder), asc(contentEntries.createdAt));
  }

  async entry(group: string, key: string, admin = false) {
    const [row] = await this.database.db.select().from(contentEntries).where(and(eq(contentEntries.group, group),
      eq(contentEntries.key, key), admin ? undefined : eq(contentEntries.status, 'active')));
    if (!row) throw new NotFoundException('Content entry not found');
    return row;
  }

  async createEntry(dto: CreateContentEntryDto, audit: AuditContext) {
    if (!dto.title.trim()) throw new BadRequestException('title is required');
    try {
      return await this.database.db.transaction(async (tx) => {
        const [created] = await tx.insert(contentEntries).values({ ...dto, title: dto.title.trim(), updatedBy: audit.actorProfileId }).returning();
        await tx.insert(auditLogs).values({ ...audit, action: 'content.create', entityType: 'content_entries', entityId: created.id, newData: created });
        return created;
      });
    } catch (error) { return throwOnConstraint(error); }
  }

  async updateEntry(group: string, key: string, dto: UpdateContentEntryDto, audit: AuditContext) {
    if (!Object.keys(dto).length) throw new BadRequestException('At least one field is required');
    if (dto.title !== undefined && !dto.title.trim()) throw new BadRequestException('title is required');
    return this.database.db.transaction(async (tx) => {
      const [old] = await tx.select().from(contentEntries).where(and(eq(contentEntries.group, group), eq(contentEntries.key, key))).for('update');
      if (!old) throw new NotFoundException('Content entry not found');
      const [updated] = await tx.update(contentEntries).set({ ...dto, title: dto.title?.trim(), updatedBy: audit.actorProfileId,
        updatedAt: new Date() }).where(eq(contentEntries.id, old.id)).returning();
      await tx.insert(auditLogs).values({ ...audit, action: 'content.update', entityType: 'content_entries', entityId: old.id, oldData: old, newData: updated });
      return updated;
    });
  }

  async deleteEntry(group: string, key: string, audit: AuditContext): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [old] = await tx.delete(contentEntries).where(and(eq(contentEntries.group, group), eq(contentEntries.key, key))).returning();
      if (!old) throw new NotFoundException('Content entry not found');
      await tx.insert(auditLogs).values({ ...audit, action: 'content.delete', entityType: 'content_entries', entityId: old.id, oldData: old });
    });
  }

  settings(group: string) {
    return this.database.db.select({ key: siteSettings.key, value: siteSettings.value, valueType: siteSettings.valueType,
      description: siteSettings.description, updatedAt: siteSettings.updatedAt })
      .from(siteSettings).where(eq(siteSettings.group, group)).orderBy(asc(siteSettings.key));
  }

  async upsertSetting(group: string, key: string, dto: UpsertSettingDto, audit: AuditContext) {
    const type = dto.valueType ?? 'text';
    if (type === 'number' && !Number.isFinite(Number(dto.value))) throw new BadRequestException('Invalid number setting');
    if (type === 'boolean' && !['true', 'false'].includes(dto.value)) throw new BadRequestException('Invalid boolean setting');
    if (type === 'json') { try { JSON.parse(dto.value); } catch { throw new BadRequestException('Invalid JSON setting'); } }
    if (type === 'url') { try { const url = new URL(dto.value); if (url.protocol !== 'https:') throw new Error(); }
      catch { throw new BadRequestException('URL setting must use HTTPS'); } }
    return this.database.db.transaction(async (tx) => {
      const [old] = await tx.select().from(siteSettings).where(and(eq(siteSettings.group, group), eq(siteSettings.key, key))).for('update');
      const [updated] = await tx.insert(siteSettings).values({ group, key, value: dto.value, valueType: type,
        description: dto.description, updatedBy: audit.actorProfileId }).onConflictDoUpdate({ target: [siteSettings.group, siteSettings.key],
          set: { value: dto.value, valueType: type, ...(dto.description !== undefined ? { description: dto.description } : {}),
            updatedBy: audit.actorProfileId, updatedAt: new Date() } }).returning();
      await tx.insert(auditLogs).values({ ...audit, action: 'setting.upsert', entityType: 'site_settings', entityId: updated.id,
        oldData: old ?? null, newData: updated });
      return updated;
    });
  }
}
