import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { AuditContext } from '../../common/audit.js';
import { throwOnConstraint } from '../../common/database-errors.js';
import { DatabaseService } from '../../database/database.service.js';
import { auditLogs, carMedia, cars } from '../../database/schema/index.js';
import { AddMediaDto, mediaMimeTypes, PresignAssetDto, PresignMediaDto, ReorderMediaDto, UpdateMediaDto } from './media.dto.js';
import { STORAGE_SERVICE, type StorageService } from './storage.service.js';

@Injectable()
export class MediaService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

  private async carExists(carId: string): Promise<void> {
    const [car] = await this.database.db.select({ id: cars.id }).from(cars).where(and(eq(cars.id, carId), isNull(cars.deletedAt)));
    if (!car) throw new NotFoundException('Car not found');
  }

  async presign(dto: PresignMediaDto) {
    await this.carExists(dto.carId);
    const policy = mediaMimeTypes[dto.mimeType];
    if (policy.type !== dto.type || dto.sizeBytes > policy.maxBytes) throw new BadRequestException('Media type or size is not allowed');
    const key = `cars/${dto.carId}/${randomUUID()}.${policy.extension}`;
    return { storageKey: key, uploadUrl: await this.storage.presignPut(key, dto.mimeType),
      method: 'PUT', headers: { 'Content-Type': dto.mimeType }, expiresIn: 300,
      publicUrl: this.storage.publicUrl(key) };
  }

  async presignAsset(dto: PresignAssetDto) {
    const policy = dto.mimeType === 'image/vnd.microsoft.icon' || dto.mimeType === 'image/x-icon'
      ? { type: 'image', extension: 'ico', maxBytes: 10_000_000 } : mediaMimeTypes[dto.mimeType];
    if (!policy || policy.type !== 'image' || dto.sizeBytes > policy.maxBytes) throw new BadRequestException('Image type or size is not allowed');
    const key = `assets/${randomUUID()}.${policy.extension}`;
    return { storageKey: key, uploadUrl: await this.storage.presignPut(key, dto.mimeType), method: 'PUT',
      headers: { 'Content-Type': dto.mimeType }, expiresIn: 300, publicUrl: this.storage.publicUrl(key) };
  }

  async list(carId: string) {
    await this.carExists(carId);
    return this.database.db.select().from(carMedia).where(and(eq(carMedia.carId, carId), isNull(carMedia.deletionPendingAt)))
      .orderBy(asc(carMedia.sortOrder), asc(carMedia.createdAt));
  }

  async add(carId: string, dto: AddMediaDto, audit: AuditContext) {
    await this.carExists(carId);
    const policy = mediaMimeTypes[dto.mimeType];
    if (policy.type !== dto.type || dto.sizeBytes > policy.maxBytes || !dto.storageKey.startsWith(`cars/${carId}/`) ||
      !dto.storageKey.endsWith(`.${policy.extension}`)) throw new BadRequestException('Media key, type or size is invalid');
    const object = await this.storage.head(dto.storageKey);
    if (!object) throw new BadRequestException('Uploaded object was not found in R2');
    if (object.mimeType !== dto.mimeType || object.sizeBytes !== dto.sizeBytes || object.sizeBytes < 1 || object.sizeBytes > policy.maxBytes)
      throw new BadRequestException('Uploaded object metadata does not match');
    try {
      return await this.database.db.transaction(async (tx) => {
        const [car] = await tx.select({ id: cars.id }).from(cars).where(and(eq(cars.id, carId), isNull(cars.deletedAt))).for('update');
        if (!car) throw new NotFoundException('Car not found');
        const current = await tx.select().from(carMedia).where(and(eq(carMedia.carId, carId), isNull(carMedia.deletionPendingAt)));
        if (current.length >= 20 || (dto.type === 'image' && current.filter((item) => item.type === 'image').length >= 10))
          throw new ConflictException('Media limit reached');
        if (dto.type === 'video' && dto.isCover) throw new BadRequestException('Video cannot be a cover');
        const cover = dto.type === 'image' && (dto.isCover === true || !current.some((item) => item.isCover));
        if (cover) await tx.update(carMedia).set({ isCover: false }).where(eq(carMedia.carId, carId));
        const [created] = await tx.insert(carMedia).values({ carId, type: dto.type, storageKey: dto.storageKey,
          publicUrl: this.storage.publicUrl(dto.storageKey), altText: dto.altText, width: dto.width, height: dto.height,
          sizeBytes: object.sizeBytes, mimeType: object.mimeType, sortOrder: current.length,
          isCover: cover }).returning();
        await tx.insert(auditLogs).values({ ...audit, action: 'media.create', entityType: 'car_media', entityId: created.id,
          newData: { carId, storageKey: created.storageKey, type: created.type, isCover: cover } });
        if (cover) await tx.insert(auditLogs).values({ ...audit, action: 'media.cover_change', entityType: 'car', entityId: carId,
          oldData: { mediaId: current.find((item) => item.isCover)?.id ?? null }, newData: { mediaId: created.id } });
        return created;
      });
    } catch (error) { return throwOnConstraint(error); }
  }

  async update(carId: string, mediaId: string, dto: UpdateMediaDto, audit: AuditContext) {
    if (!Object.keys(dto).length) throw new BadRequestException('At least one field is required');
    return this.database.db.transaction(async (tx) => {
      const [car] = await tx.select({ id: cars.id }).from(cars).where(and(eq(cars.id, carId), isNull(cars.deletedAt))).for('update');
      if (!car) throw new NotFoundException('Car not found');
      const [old] = await tx.select().from(carMedia).where(and(eq(carMedia.id, mediaId), eq(carMedia.carId, carId), isNull(carMedia.deletionPendingAt)));
      if (!old) throw new NotFoundException('Media not found for car');
      if (dto.isCover === true && old.type !== 'image') throw new BadRequestException('Video cannot be a cover');
      if (dto.isCover === false && old.isCover) throw new BadRequestException('Choose another cover instead');
      const previousCover = dto.isCover === true && !old.isCover
        ? (await tx.select({ id: carMedia.id }).from(carMedia).where(and(eq(carMedia.carId, carId), eq(carMedia.isCover, true))))[0]?.id : undefined;
      if (dto.isCover === true && !old.isCover) await tx.update(carMedia).set({ isCover: false }).where(eq(carMedia.carId, carId));
      const [updated] = await tx.update(carMedia).set(dto).where(eq(carMedia.id, mediaId)).returning();
      await tx.insert(auditLogs).values({ ...audit, action: 'media.update', entityType: 'car_media', entityId: mediaId,
        oldData: { altText: old.altText, sortOrder: old.sortOrder, isCover: old.isCover },
        newData: { altText: updated.altText, sortOrder: updated.sortOrder, isCover: updated.isCover } });
      if (dto.isCover === true && !old.isCover) await tx.insert(auditLogs).values({ ...audit, action: 'media.cover_change', entityType: 'car', entityId: carId,
        oldData: { mediaId: previousCover ?? null }, newData: { mediaId } });
      if (dto.sortOrder !== undefined && dto.sortOrder !== old.sortOrder) await tx.insert(auditLogs).values({ ...audit,
        action: 'media.reorder', entityType: 'car_media', entityId: mediaId,
        oldData: { sortOrder: old.sortOrder }, newData: { sortOrder: dto.sortOrder } });
      return updated;
    });
  }

  async reorder(carId: string, dto: ReorderMediaDto, audit: AuditContext) {
    return this.database.db.transaction(async (tx) => {
      const [car] = await tx.select({ id: cars.id }).from(cars).where(and(eq(cars.id, carId), isNull(cars.deletedAt))).for('update');
      if (!car) throw new NotFoundException('Car not found');
      const current = await tx.select({ id: carMedia.id, sortOrder: carMedia.sortOrder }).from(carMedia)
        .where(and(eq(carMedia.carId, carId), isNull(carMedia.deletionPendingAt))).orderBy(asc(carMedia.sortOrder));
      if (current.length !== dto.mediaIds.length || new Set(dto.mediaIds).size !== current.length ||
        !dto.mediaIds.every((id) => current.some((item) => item.id === id))) throw new BadRequestException('Provide every media ID exactly once');
      for (const [position, id] of dto.mediaIds.entries()) await tx.update(carMedia).set({ sortOrder: position }).where(eq(carMedia.id, id));
      await tx.insert(auditLogs).values({ ...audit, action: 'media.reorder', entityType: 'car', entityId: carId,
        oldData: { mediaIds: current.map((item) => item.id) }, newData: { mediaIds: dto.mediaIds } });
      return tx.select().from(carMedia).where(and(eq(carMedia.carId, carId), isNull(carMedia.deletionPendingAt))).orderBy(asc(carMedia.sortOrder));
    });
  }

  async delete(carId: string, mediaId: string, audit: AuditContext): Promise<void> {
    const media = await this.database.db.transaction(async (tx) => {
      const [car] = await tx.select({ id: cars.id }).from(cars).where(and(eq(cars.id, carId), isNull(cars.deletedAt))).for('update');
      if (!car) throw new NotFoundException('Car not found');
      const [row] = await tx.select().from(carMedia).where(and(eq(carMedia.id, mediaId), eq(carMedia.carId, carId)));
      if (!row) throw new NotFoundException('Media not found for car');
      if (!row.deletionPendingAt) {
        await tx.update(carMedia).set({ deletionPendingAt: new Date(), isCover: false }).where(eq(carMedia.id, mediaId));
        if (row.isCover) {
          const [replacement] = await tx.select().from(carMedia).where(and(eq(carMedia.carId, carId),
            eq(carMedia.type, 'image'), isNull(carMedia.deletionPendingAt))).orderBy(asc(carMedia.sortOrder)).limit(1);
          if (replacement) await tx.update(carMedia).set({ isCover: true }).where(eq(carMedia.id, replacement.id));
          await tx.insert(auditLogs).values({ ...audit, action: 'media.cover_change', entityType: 'car', entityId: carId,
            oldData: { mediaId }, newData: { mediaId: replacement?.id ?? null } });
        }
      }
      return row;
    });
    if (media.storageKey) await this.storage.delete(media.storageKey);
    await this.database.db.transaction(async (tx) => {
      const [removed] = await tx.delete(carMedia).where(and(eq(carMedia.id, mediaId), eq(carMedia.carId, carId),
        sql`${carMedia.deletionPendingAt} IS NOT NULL`)).returning();
      if (removed) await tx.insert(auditLogs).values({ ...audit, action: 'media.delete', entityType: 'car_media', entityId: mediaId,
        oldData: { carId, storageKey: removed.storageKey, type: removed.type }, newData: null });
    });
  }
}
