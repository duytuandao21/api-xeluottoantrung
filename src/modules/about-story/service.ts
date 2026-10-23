import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { AuditContext } from '../../common/audit.js';
import { throwOnConstraint } from '../../common/database-errors.js';
import { DatabaseService } from '../../database/database.service.js';
import { aboutCustomerStories, aboutMilestones, aboutStoryAssets, aboutStoryPages, aboutStorySections, auditLogs } from '../../database/schema/index.js';
import { STORAGE_SERVICE, type StorageService } from '../media/storage.service.js';
import { queueRemovedImages } from '../media/storage-cleanup.js';
import { AssetDto, AssetUpdateDto, chapterKeys, MilestoneDto, OrderDto, RevisionDto, SectionDto, StoryDto } from './dto.js';
import { buildPublication } from './publication.js';

export const ABOUT_PAGE_ID = '00000000-0000-4000-8000-000000000001';
type Tx = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];

@Injectable()
export class AboutStoryService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

  private async pageForUpdate(tx: Tx, expectedRevision: number) {
    const [page] = await tx.select().from(aboutStoryPages).where(eq(aboutStoryPages.id, ABOUT_PAGE_ID)).for('update');
    if (!page) throw new NotFoundException('About story seed has not been applied');
    if (page.revision !== expectedRevision) throw new ConflictException('Content has changed; reload before saving');
    return page;
  }

  private async bump(tx: Tx, audit: AuditContext, action: string, oldData: unknown, newData: unknown) {
    await tx.update(aboutStoryPages).set({ revision: (oldData as { revision: number }).revision + 1,
      updatedBy: audit.actorProfileId, updatedAt: new Date(),
      publishedSnapshot: null, publishedRevision: null, publishedAt: null }).where(eq(aboutStoryPages.id, ABOUT_PAGE_ID));
    await tx.insert(auditLogs).values({ ...audit, action, entityType: 'about_story', entityId: ABOUT_PAGE_ID,
      oldData, newData });
  }

  // The editable rows are the single source of truth. No publication/approval layer.
  async publicPage() {
    return this.database.db.transaction(async tx => {
      const [page] = await tx.select().from(aboutStoryPages).where(eq(aboutStoryPages.id, ABOUT_PAGE_ID));
      if (!page) throw new NotFoundException('About story content is not configured');
      const [sections, milestones, stories, assets] = await Promise.all([
        tx.select().from(aboutStorySections), tx.select().from(aboutMilestones),
        tx.select().from(aboutCustomerStories), tx.select().from(aboutStoryAssets),
      ]);
      return { ...buildPublication(sections, milestones, stories, assets),
        revision: page.revision, updatedAt: page.updatedAt, publishedAt: page.updatedAt };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  async content() {
    const [page] = await this.database.db.select().from(aboutStoryPages).where(eq(aboutStoryPages.id, ABOUT_PAGE_ID));
    if (!page) throw new NotFoundException('About story seed has not been applied');
    const [sections, milestones, stories, assets] = await Promise.all([
      this.database.db.select().from(aboutStorySections),
      this.database.db.select().from(aboutMilestones).orderBy(asc(aboutMilestones.sortOrder), asc(aboutMilestones.id)),
      this.database.db.select().from(aboutCustomerStories).orderBy(asc(aboutCustomerStories.sortOrder), asc(aboutCustomerStories.id)),
      this.database.db.select().from(aboutStoryAssets).orderBy(asc(aboutStoryAssets.sortOrder), asc(aboutStoryAssets.id)),
    ]);
    return { revision: page.revision, updatedAt: page.updatedAt,
      sections: chapterKeys.map(key => sections.find(s => s.chapterKey === key)).filter(Boolean),
      milestones, stories, assets };
  }

  async section(key: string, dto: SectionDto, audit: AuditContext) {
    if (!chapterKeys.includes(key as typeof chapterKeys[number]) || !dto.title.trim()) throw new BadRequestException('Invalid chapter');
    if (Boolean(dto.ctaLabel?.trim()) !== Boolean(dto.ctaHref?.trim())) throw new BadRequestException('CTA needs both a label and a path');
    return this.database.db.transaction(async tx => {
      const page = await this.pageForUpdate(tx, dto.expectedRevision);
      const [old] = await tx.select().from(aboutStorySections).where(eq(aboutStorySections.chapterKey, key));
      if (!old) throw new NotFoundException('Chapter not found');
      const [saved] = await tx.update(aboutStorySections).set({ title: dto.title.trim(), subtitle: dto.subtitle,
        body: dto.body, ctaLabel: dto.ctaLabel, ctaHref: dto.ctaHref, visible: dto.visible,
        updatedAt: new Date() }).where(eq(aboutStorySections.id, old.id)).returning();
      await this.bump(tx, audit, 'about.section.update', page, { key, id: saved.id });
      return { ...saved, revision: page.revision + 1 };
    });
  }

  async createMilestone(dto: MilestoneDto, audit: AuditContext) {
    this.checkMilestone(dto);
    try { return await this.database.db.transaction(async tx => {
      const page = await this.pageForUpdate(tx, dto.expectedRevision);
      const { expectedRevision, ...values } = dto; void expectedRevision;
      const [created] = await tx.insert(aboutMilestones).values(values).returning();
      await this.bump(tx, audit, 'about.milestone.create', page, { id: created.id });
      return { ...created, revision: page.revision + 1 };
    }); } catch (error) { return throwOnConstraint(error); }
  }

  async updateMilestone(id: string, dto: MilestoneDto, audit: AuditContext) {
    this.checkMilestone(dto);
    try { return await this.database.db.transaction(async tx => {
      const page = await this.pageForUpdate(tx, dto.expectedRevision);
      const [old] = await tx.select().from(aboutMilestones).where(eq(aboutMilestones.id, id));
      if (!old) throw new NotFoundException('Milestone not found');
      const { expectedRevision, ...values } = dto; void expectedRevision;
      const [saved] = await tx.update(aboutMilestones).set({ ...values, updatedAt: new Date() })
        .where(eq(aboutMilestones.id, id)).returning();
      await this.bump(tx, audit, 'about.milestone.update', page, { id, old });
      return { ...saved, revision: page.revision + 1 };
    }); } catch (error) { return throwOnConstraint(error); }
  }

  private checkMilestone(dto: MilestoneDto) {
    if (!dto.title.trim() || !dto.summary.trim() || !dto.periodLabel.trim()) throw new BadRequestException('Milestone title, period and summary are required');
    if (dto.eventDate) {
      const date = new Date(`${dto.eventDate}T00:00:00Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dto.eventDate)
        throw new BadRequestException('Invalid event date');
    }
  }

  async deleteMilestone(id: string, dto: RevisionDto, audit: AuditContext) {
    return this.database.db.transaction(async tx => {
      const page = await this.pageForUpdate(tx, dto.expectedRevision);
      const [old] = await tx.select().from(aboutMilestones).where(eq(aboutMilestones.id, id));
      if (!old) throw new NotFoundException('Milestone not found');
      const removed = await tx.delete(aboutStoryAssets)
        .where(and(eq(aboutStoryAssets.ownerType, 'milestone'), eq(aboutStoryAssets.ownerKey, id))).returning();
      await queueRemovedImages(tx, removed.map(asset => asset.publicUrl), null, audit);
      await tx.delete(aboutMilestones).where(eq(aboutMilestones.id, id));
      await this.bump(tx, audit, 'about.milestone.delete', page, { id, old });
    });
  }

  private checkStory(dto: StoryDto) {
    if (!dto.title.trim() || !dto.body.trim()) throw new BadRequestException('Story title and body are required');
  }

  async createStory(dto: StoryDto, audit: AuditContext) {
    this.checkStory(dto);
    return this.database.db.transaction(async tx => {
      const page = await this.pageForUpdate(tx, dto.expectedRevision);
      const { expectedRevision, ...values } = dto; void expectedRevision;
      const [created] = await tx.insert(aboutCustomerStories).values(values).returning();
      await this.bump(tx, audit, 'about.story.create', page, { id: created.id });
      return { ...created, revision: page.revision + 1 };
    });
  }

  async updateStory(id: string, dto: StoryDto, audit: AuditContext) {
    this.checkStory(dto);
    return this.database.db.transaction(async tx => {
      const page = await this.pageForUpdate(tx, dto.expectedRevision);
      const [old] = await tx.select().from(aboutCustomerStories).where(eq(aboutCustomerStories.id, id));
      if (!old) throw new NotFoundException('Story not found');
      const { expectedRevision, ...values } = dto; void expectedRevision;
      const [saved] = await tx.update(aboutCustomerStories).set({ ...values, updatedAt: new Date() })
        .where(eq(aboutCustomerStories.id, id)).returning();
      await this.bump(tx, audit, 'about.story.update', page, { id, old });
      return { ...saved, revision: page.revision + 1 };
    });
  }

  async deleteStory(id: string, dto: RevisionDto, audit: AuditContext) {
    return this.database.db.transaction(async tx => {
      const page = await this.pageForUpdate(tx, dto.expectedRevision);
      const [old] = await tx.select().from(aboutCustomerStories).where(eq(aboutCustomerStories.id, id));
      if (!old) throw new NotFoundException('Story not found');
      const removed = await tx.delete(aboutStoryAssets)
        .where(and(eq(aboutStoryAssets.ownerType, 'story'), eq(aboutStoryAssets.ownerKey, id))).returning();
      await queueRemovedImages(tx, removed.map(asset => asset.publicUrl), null, audit);
      await tx.delete(aboutCustomerStories).where(eq(aboutCustomerStories.id, id));
      await this.bump(tx, audit, 'about.story.delete', page, { id, old });
    });
  }

  async addAsset(dto: AssetDto, audit: AuditContext) {
    if (!dto.altText.trim()) throw new BadRequestException('Alt text is required');
    // Never trust the caller's URL, MIME or byte count. R2 object must already exist.
    const object = await this.storage.head(dto.storageKey);
    if (!object || object.sizeBytes < 1 || object.sizeBytes > 10_000_000 ||
      !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(object.mimeType))
      throw new BadRequestException('Uploaded image is missing or invalid');
    const extension = dto.storageKey.split('.').at(-1);
    if (({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' } as Record<string, string>)[extension ?? ''] !== object.mimeType)
      throw new BadRequestException('Image MIME does not match storage key');
    try { return await this.database.db.transaction(async tx => {
      const page = await this.pageForUpdate(tx, dto.expectedRevision);
      if (dto.ownerType === 'section') {
        if (!chapterKeys.includes(dto.ownerKey as typeof chapterKeys[number])) throw new BadRequestException('Invalid asset owner');
      } else {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.ownerKey))
          throw new BadRequestException('Invalid asset owner ID');
        const table = dto.ownerType === 'milestone' ? aboutMilestones : aboutCustomerStories;
        const [owner] = await tx.select({ id: table.id }).from(table).where(eq(table.id, dto.ownerKey)).limit(1);
        if (!owner) throw new NotFoundException('Asset owner not found');
      }
      const { expectedRevision, ...values } = dto; void expectedRevision;
      const [created] = await tx.insert(aboutStoryAssets).values({ ...values, publicUrl: this.storage.publicUrl(dto.storageKey),
        mimeType: object.mimeType, sizeBytes: object.sizeBytes }).returning();
      await this.bump(tx, audit, 'about.asset.create', page, { id: created.id });
      return { ...created, revision: page.revision + 1 };
    }); } catch (error) { return throwOnConstraint(error); }
  }

  async updateAsset(id: string, dto: AssetUpdateDto, audit: AuditContext) {
    if (!dto.altText.trim()) throw new BadRequestException('Alt text is required');
    return this.database.db.transaction(async tx => {
      const page = await this.pageForUpdate(tx, dto.expectedRevision);
      const [old] = await tx.select().from(aboutStoryAssets).where(eq(aboutStoryAssets.id, id));
      if (!old) throw new NotFoundException('Asset not found');
      const [saved] = await tx.update(aboutStoryAssets).set({ altText: dto.altText.trim(),
        placement: dto.placement, sortOrder: dto.sortOrder, updatedAt: new Date() })
        .where(eq(aboutStoryAssets.id, id)).returning();
      await this.bump(tx, audit, 'about.asset.update', page, { id, old });
      return { ...saved, revision: page.revision + 1 };
    });
  }

  async deleteAsset(id: string, dto: RevisionDto, audit: AuditContext) {
    return this.database.db.transaction(async tx => {
      const page = await this.pageForUpdate(tx, dto.expectedRevision);
      const [old] = await tx.select().from(aboutStoryAssets).where(eq(aboutStoryAssets.id, id));
      if (!old) throw new NotFoundException('Asset not found');
      await tx.delete(aboutStoryAssets).where(eq(aboutStoryAssets.id, id));
      await queueRemovedImages(tx, { imageUrl: old.publicUrl }, null, audit);
      await this.bump(tx, audit, 'about.asset.delete', page, { id, old });
    });
  }

  async reorder(dto: OrderDto, audit: AuditContext) {
    return this.database.db.transaction(async tx => {
      const page = await this.pageForUpdate(tx, dto.expectedRevision);
      const table = dto.kind === 'milestone' ? aboutMilestones : dto.kind === 'story' ? aboutCustomerStories : aboutStoryAssets;
      const current = await tx.select({ id: table.id }).from(table);
      if (current.length !== dto.ids.length || new Set(dto.ids).size !== dto.ids.length ||
        !current.every(row => dto.ids.includes(row.id))) throw new BadRequestException('Order must include each item exactly once');
      for (const [sortOrder, id] of dto.ids.entries()) await tx.update(table).set({ sortOrder }).where(eq(table.id, id));
      await this.bump(tx, audit, 'about.order.update', page, { kind: dto.kind, ids: dto.ids });
      return { revision: page.revision + 1 };
    });
  }

}
