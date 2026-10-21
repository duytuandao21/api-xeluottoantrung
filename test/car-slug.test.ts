import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import * as schema from '../src/database/schema/index.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';
import { CarsService } from '../src/modules/cars/cars.service.js';
import { CreateCarDto, UpdateCarDto } from '../src/modules/cars/cars.dto.js';
import { carSlugCandidate } from '../src/modules/cars/car-slug.js';

test('duplicate cars require confirmation, keep old URLs and allocate numbered slugs without changing catalog/schema', async () => {
  const pg = new PGlite();
  try {
    for (const migration of ['0000_wild_carmella_unuscione', '0001_unusual_nomad', '0021_car_listing_order'])
      await pg.exec((await readFile(`drizzle/${migration}.sql`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema }), connection = { db } as unknown as DatabaseService;
    const service = new CarsService(connection), catalog = new CatalogService(connection);
    const [profile] = await db.insert(schema.profiles).values({ authUserId: '49332fa0-8244-4b20-a8d0-9793b72ef689', fullName: 'Slug fixture' }).returning();
    const audit = { actorProfileId: profile.id, ipAddress: '127.0.0.1', userAgent: 'test', requestId: 'slug-test' };
    const brand = await catalog.createBrand({ name: 'Toyota' });
    const model = await catalog.createModel({ name: 'Vios', brandId: brand.id });
    const fields = { name: 'Toyota Vios E CVT 2025', brandId: brand.id, modelId: model.id, year: 2025, price: 450000000 };
    const first = await service.create(fields, audit);
    assert.equal(first.slug, 'toyota-vios-e-cvt-2025');
    const expectConfirmation = async (input = fields) => {
      const rows = await db.select().from(schema.cars), logs = await db.select().from(schema.auditLogs);
      await assert.rejects(service.create(input, audit), error => {
        assert(error instanceof ConflictException);
        assert.equal((error.getResponse() as { details: { code: string } }).details.code, 'CAR_SLUG_CONFIRMATION_REQUIRED');return true;
      });
      assert.deepEqual(await db.select().from(schema.cars), rows, 'No car is created/changed before confirmation');
      assert.deepEqual(await db.select().from(schema.auditLogs), logs, 'Rejected attempt leaves no create audit');
    };
    const duplicates = [];
    for (const [i, state] of ['active', 'sold', 'inactive', 'deleted'].entries()) {
      await db.update(schema.cars).set({ status: state === 'sold' ? 'sold' : state === 'inactive' ? 'inactive' : 'active', deletedAt: state === 'deleted' ? new Date() : null }).where(eq(schema.cars.id, first.id));
      await expectConfirmation();
      const previous = (await db.select().from(schema.cars).where(eq(schema.cars.id, first.id)))[0];
      const created = await service.create({ ...fields, confirmDuplicateSlug: true }, audit);
      assert.equal(created.slug, `${first.slug}-${i + 2}`);assert.equal(created.name, first.name);
      assert.equal(created.newArrival, true);assert.equal(created.publishedAt, null);
      assert.deepEqual((await db.select().from(schema.cars).where(eq(schema.cars.id, first.id)))[0], previous);
      duplicates.push(created);
    }
    await service.update(duplicates[0].id, { name: 'Tên xe đã sửa', status: 'sold' }, audit);
    await service.publish(duplicates[0].id, audit);
    const detail = await service.publicDetail(duplicates[0].slug);
    assert.equal(detail.id, duplicates[0].id);assert.equal(detail.slug, duplicates[0].slug);
    const renamed = await service.create({ ...fields, name: 'Tên khác do admin chọn' }, audit);
    assert.equal(renamed.slug, 'ten-khac-do-admin-chon');
    await expectConfirmation({ ...fields, name: 'Bán xe' });
    assert.equal((await service.create({ ...fields, name: 'Bán xe', confirmDuplicateSlug: true }, audit)).slug, 'ban-xe-2');
    await expectConfirmation({ ...fields, name: 'Toyota' });
    assert.equal((await service.create({ ...fields, name: 'Toyota', confirmDuplicateSlug: true }, audit)).slug, 'toyota-2');
    await service.create({ ...fields, name: 'Collision' }, audit);
    await db.insert(schema.articles).values([
      { title: 'Article two', slug: 'collision-2', content: '' },
      { title: 'Article three', slug: 'collision-3', content: '' },
    ]);
    assert.equal((await service.create({ ...fields, name: 'Collision', confirmDuplicateSlug: true }, audit)).slug, 'collision-4');
    const longName = 'X'.repeat(240);
    await service.create({ ...fields, name: longName }, audit);
    const long = await service.create({ ...fields, name: longName, confirmDuplicateSlug: true }, audit);
    assert.equal(long.slug.length, 240);assert(long.slug.endsWith('-2'));assert(!long.slug.includes('--'));
    assert(carSlugCandidate('x'.repeat(237) + '-ab', 12).length <= 240);
    await service.create({ ...fields, name: 'Unique SKU', sku: 'SKU-ONE' }, audit);
    const countBefore = (await db.select().from(schema.cars)).length;
    await assert.rejects(service.create({ ...fields, sku: 'SKU-ONE', confirmDuplicateSlug: true }, audit), error => {
      assert(error instanceof ConflictException);
      assert.notEqual((error.getResponse() as { details?: { code: string } }).details?.code, 'CAR_SLUG_CONFIRMATION_REQUIRED');return true;
    });
    assert.equal((await db.select().from(schema.cars)).length, countBefore, 'Other unique errors must not be bypassed');
    // PGlite serializes transactions. Competing car inserts still use the same
    // PostgreSQL ON CONFLICT statement and must produce distinct URLs/audit rows.
    const concurrent = await Promise.all(Array.from({ length: 6 }, () => service.create({ ...fields, name: 'Concurrent', confirmDuplicateSlug: true }, audit)));
    assert.equal(new Set(concurrent.map(car => car.slug)).size, 6);
    assert.deepEqual(concurrent.map(car => car.slug).sort(), ['concurrent', 'concurrent-2', 'concurrent-3', 'concurrent-4', 'concurrent-5', 'concurrent-6']);
    for (const car of concurrent) assert.equal((await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, car.id))).length, 1);
  } finally { await pg.close(); }
});

test('confirmation is a creation-only boolean; strings cannot bypass confirmation', async () => {
  const fields = { name: 'Toyota Vios', brandId: '49332fa0-8244-4b20-a8d0-9793b72ef689', modelId: '49332fa0-8244-4b20-a8d0-9793b72ef689', year: 2025, price: 500000000 };
  assert.equal((await validate(plainToInstance(CreateCarDto, { ...fields, confirmDuplicateSlug: true }))).length, 0);
  assert((await validate(plainToInstance(CreateCarDto, { ...fields, confirmDuplicateSlug: 'true' }))).some(e => e.property === 'confirmDuplicateSlug'));
  assert((await validate(plainToInstance(UpdateCarDto, { confirmDuplicateSlug: true }), { whitelist: true, forbidNonWhitelisted: true })).some(e => e.property === 'confirmDuplicateSlug'));
});
