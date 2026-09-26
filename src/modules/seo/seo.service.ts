import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { AuditContext } from '../../common/audit.js';
import { DatabaseService } from '../../database/database.service.js';
import { auditLogs, seoMetadata } from '../../database/schema/index.js';
import { UpsertSeoDto } from './seo.dto.js';

@Injectable()
export class SeoService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  list() { return this.database.db.select().from(seoMetadata).orderBy(asc(seoMetadata.routePath)); }
  async byRoute(route: string) {
    const [row] = await this.database.db.select().from(seoMetadata).where(eq(seoMetadata.routePath, route));
    if (!row) throw new NotFoundException('SEO metadata not found');
    return row;
  }
  async upsert(dto: UpsertSeoDto, audit: AuditContext) {
    return this.database.db.transaction(async (tx) => {
      const [old] = await tx.select().from(seoMetadata).where(eq(seoMetadata.routePath, dto.routePath)).for('update');
      const [updated] = await tx.insert(seoMetadata).values({ ...dto, updatedBy: audit.actorProfileId })
        .onConflictDoUpdate({ target: seoMetadata.routePath, set: { ...dto, updatedBy: audit.actorProfileId, updatedAt: new Date() } }).returning();
      await tx.insert(auditLogs).values({ ...audit, action: 'seo.upsert', entityType: 'seo_metadata', entityId: updated.id,
        oldData: old ?? null, newData: updated });
      return updated;
    });
  }
  async delete(route: string, audit: AuditContext): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [old] = await tx.delete(seoMetadata).where(eq(seoMetadata.routePath, route)).returning();
      if (!old) throw new NotFoundException('SEO metadata not found');
      await tx.insert(auditLogs).values({ ...audit, action: 'seo.delete', entityType: 'seo_metadata', entityId: old.id, oldData: old });
    });
  }
}
