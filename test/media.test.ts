import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../src/database/database.service.js';
import { auditLogs, brands, carMedia, carModels, cars, profiles } from '../src/database/schema/index.js';
import * as schema from '../src/database/schema/index.js';
import { PERMISSIONS_KEY } from '../src/modules/auth/auth.decorators.js';
import { CarMediaController, MediaUploadController } from '../src/modules/media/media.controller.js';
import { MediaService } from '../src/modules/media/media.service.js';
import type { StorageService, StoredObject } from '../src/modules/media/storage.service.js';

test('R2 media registration, cover, ordering, ownership and retryable removal', async () => {
  const pg = new PGlite();
  try {
    for (const name of ['0000_wild_carmella_unuscione', '0001_unusual_nomad']) {
      await pg.exec((await readFile(`drizzle/${name}.sql`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    }
    const db = drizzle(pg, { schema });
    const [profile] = await db.insert(profiles).values({ authUserId: '49332fa0-8244-4b20-a8d0-9793b72ef689', fullName: 'Admin' }).returning();
    const audit = { actorProfileId: profile.id, ipAddress: '127.0.0.1', userAgent: 'test', requestId: 'media-test' };
    const [brand] = await db.insert(brands).values({ name: 'Toyota', slug: 'toyota' }).returning();
    const [model] = await db.insert(carModels).values({ brandId: brand.id, name: 'Vios', slug: 'vios' }).returning();
    const [car] = await db.insert(cars).values({ name: 'Vios', slug: 'vios-2022', brandId: brand.id, modelId: model.id, year: 2022, price: 400_000_000 }).returning();
    const [other] = await db.insert(cars).values({ name: 'Vios 2', slug: 'vios-2023', brandId: brand.id, modelId: model.id, year: 2023, price: 500_000_000 }).returning();
    const objects = new Map<string, StoredObject>();
    let failDelete = false;
    const storage: StorageService = {
      presignPut: async (key) => `https://upload.example/${key}`,
      head: async (key) => objects.get(key) ?? null,
      delete: async (key) => { if (failDelete) throw new Error('R2 unavailable'); objects.delete(key); },
      publicUrl: (key) => `https://media.example/${key}`,
      ping: async () => {},
    };
    const service = new MediaService({ db } as unknown as DatabaseService, storage);
    assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, MediaUploadController.prototype.presign), ['media.create']);
    assert.equal(Reflect.getMetadata(PERMISSIONS_KEY, MediaUploadController.prototype.presignAsset), undefined);
    assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, CarMediaController.prototype.delete), ['media.delete']);
    assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, CarMediaController.prototype.reorder), ['media.update']);
    await assert.rejects(service.presign({ carId: other.id, type: 'video', mimeType: 'image/jpeg', sizeBytes: 1 }), BadRequestException);
    const asset = await service.presignAsset({ mimeType: 'image/png', sizeBytes: 100 });
    assert.match(asset.storageKey, /^assets\/[0-9a-f-]{36}\.png$/);
    assert.equal(asset.publicUrl, `https://media.example/${asset.storageKey}`);
    const icon = await service.presignAsset({ mimeType: 'image/x-icon', sizeBytes: 100 });
    assert.match(icon.storageKey, /^assets\/[0-9a-f-]{36}\.ico$/);
    await assert.rejects(service.presignAsset({ mimeType: 'image/png', sizeBytes: 10_000_001 }), BadRequestException);
    await assert.rejects(service.presign({ carId: car.id, type: 'image', mimeType: 'image/jpeg', sizeBytes: 10_000_001 }), BadRequestException);
    const first = await service.presign({ carId: car.id, type: 'image', mimeType: 'image/jpeg', sizeBytes: 100 });
    assert.equal(first.headers['Content-Type'], 'image/jpeg');
    assert.match(first.storageKey, new RegExp(`^cars/${car.id}/[0-9a-f-]{36}\\.jpg$`));
    const firstDto = { storageKey: first.storageKey, type: 'image' as const, mimeType: 'image/jpeg' as const, sizeBytes: 100 };
    await assert.rejects(service.add(car.id, firstDto, audit), BadRequestException);
    objects.set(first.storageKey, { mimeType: 'image/jpeg', sizeBytes: 101 });
    await assert.rejects(service.add(car.id, firstDto, audit), BadRequestException);
    objects.set(first.storageKey, { mimeType: 'image/jpeg', sizeBytes: 100 });
    await assert.rejects(service.add(other.id, firstDto, audit), BadRequestException);
    const savedFirst = await service.add(car.id, firstDto, audit);
    assert.equal(savedFirst.isCover, true);
    await assert.rejects(service.add(car.id, firstDto, audit), /already exists|unique/i);
    const second = await service.presign({ carId: car.id, type: 'image', mimeType: 'image/png', sizeBytes: 200 });
    objects.set(second.storageKey, { mimeType: 'image/png', sizeBytes: 200 });
    const savedSecond = await service.add(car.id, { storageKey: second.storageKey, type: 'image', mimeType: 'image/png', sizeBytes: 200 }, audit);
    await service.update(car.id, savedSecond.id, { isCover: true, altText: 'Mặt trước' }, audit);
    assert.equal((await service.list(car.id)).filter((item) => item.isCover).length, 1);
    assert.equal((await service.list(car.id)).find((item) => item.isCover)?.id, savedSecond.id);
    await assert.rejects(service.update(other.id, savedFirst.id, { altText: 'wrong car' }, audit), NotFoundException);
    await assert.rejects(service.reorder(car.id, { mediaIds: [savedFirst.id, savedFirst.id] }, audit), BadRequestException);
    assert.deepEqual((await service.reorder(car.id, { mediaIds: [savedSecond.id, savedFirst.id] }, audit)).map((item) => item.id), [savedSecond.id, savedFirst.id]);
    failDelete = true;
    await assert.rejects(service.delete(car.id, savedSecond.id, audit), /R2 unavailable/);
    assert.equal((await service.list(car.id)).length, 1);
    assert.equal((await service.list(car.id))[0].isCover, true);
    assert.ok((await db.select().from(carMedia).where(eq(carMedia.id, savedSecond.id)))[0].deletionPendingAt);
    failDelete = false;
    await service.delete(car.id, savedSecond.id, audit);
    assert.equal(objects.has(second.storageKey), false);
    assert.equal((await db.select().from(carMedia).where(eq(carMedia.id, savedSecond.id))).length, 0);
    const actions = (await db.select({ action: auditLogs.action }).from(auditLogs)).map((item) => item.action);
    for (const action of ['media.create', 'media.update', 'media.cover_change', 'media.reorder', 'media.delete']) assert.ok(actions.includes(action));
  } finally { await pg.close(); }
});
