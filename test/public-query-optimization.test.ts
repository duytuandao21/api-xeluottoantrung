import assert from 'node:assert/strict';
import test from 'node:test';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { NotFoundException } from '@nestjs/common';
import { createQueryCacheFixture } from './fixtures/query-cache-fixture.js';
import * as schema from '../src/database/schema/index.js';
import { DatabaseService } from '../src/database/database.service.js';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';
import { CarsService } from '../src/modules/cars/cars.service.js';
import type { ListCarsQuery } from '../src/modules/cars/cars.dto.js';

test('public models use one SELECT and preserve empty/unknown/inactive brands and ordering', async () => {
  const fixture = await createQueryCacheFixture();
  try {
    const statements: string[] = [];
    const db = drizzle(fixture.pg, { schema, logger: { logQuery: sql => { if (/^select\b/i.test(sql)) statements.push(sql); } } });
    const catalog = new CatalogService({ db } as unknown as DatabaseService);
    const toyota = fixture.brands[0];
    await catalog.createModel({ brandId: toyota.id, name: 'First', sortOrder: -1 });
    await catalog.createModel({ brandId: toyota.id, name: 'Hidden', status: 'inactive' });
    statements.length = 0;
    const rows = await catalog.publicModels('toyota');
    assert.equal(statements.length, 1, 'Brand existence and active models share a single round trip');
    assert.deepEqual(rows.map(row => row.name), ['First', 'Vios']);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['id', 'imageUrl', 'name', 'slug']);
    const empty = await catalog.createBrand({ name: 'Empty' });
    await catalog.createModel({ brandId: empty.id, name: 'Inactive only', status: 'inactive' });
    statements.length = 0;
    assert.deepEqual(await catalog.publicModels('empty'), []);
    assert.equal(statements.length, 1);
    await catalog.updateBrand(empty.id, { status: 'inactive' });
    for (const slug of ['empty', 'unknown']) {
      statements.length = 0;
      await assert.rejects(catalog.publicModels(slug), NotFoundException);
      assert.equal(statements.length, 1);
    }
  } finally { await fixture.pg.close(); }
});

test('public car queries omit unused private columns while preserving public/admin/sale contracts', async () => {
  const fixture = await createQueryCacheFixture();
  try {
    const statements: string[] = [];
    const db = drizzle(fixture.pg, { schema, logger: { logQuery: sql => { if (/^select\b/i.test(sql)) statements.push(sql); } } });
    const cars = new CarsService({ db } as unknown as DatabaseService);
    const car = fixture.cars[0];
    await db.update(schema.cars).set({ sku: 'LOCAL-SKU', licensePlate: '30A-12345',
      sourceUrl: 'https://fixture.invalid/private-source', sourceKind: 'private-source-kind',
      legacyId: 'private-legacy', description: 'Full public description' }).where(eq(schema.cars.id, car.id));
    const query: ListCarsQuery = { page: 1, limit: 20, sort: 'newest', brand: 'toyota' };
    statements.length = 0;
    const publicList = await cars.list(query);
    assert.equal(statements.length, 2);
    const projection = statements[1].split(/\sfrom\s/i)[0];
    for (const column of ['sku', 'license_plate', 'transmission_id', 'published_at'])
      assert.equal(projection.includes(`"cars"."${column}"`), false, `Public list must not transfer ${column}`);
    assert.equal(projection.includes('"car_versions"."name"'), false, 'Public list omits the unused version name');
    assert.equal(publicList.data[0].slug, car.slug);
    assert.equal(publicList.data[0].price, car.price);
    assert.equal('licensePlate' in publicList.data[0], false);
    const saleList = await cars.list({ ...query, search: '30A12345' }, false, true);
    assert.deepEqual(saleList, publicList, 'Sale plate matching keeps the same public response');
    const adminList = await cars.list(query, true);
    const adminRow = adminList.data[0];
    assert.ok('sku' in adminRow && 'licensePlate' in adminRow && 'id' in adminRow && 'publishedAt' in adminRow);
    assert.equal(adminRow.sku, 'LOCAL-SKU');
    assert.equal(adminRow.licensePlate, '30A-12345');
    assert.equal(adminRow.id, car.id);
    assert.ok(adminRow.publishedAt);
    assert.ok('version' in adminRow);
    assert.equal(adminRow.version, 'Standard');
    statements.length = 0;
    const detail = await cars.publicDetail(car.slug);
    assert.equal(statements.length, 3);
    const detailProjection = statements[0].split(/\sfrom\s/i)[0];
    for (const column of ['sku', 'license_plate', 'legacy_id', 'source_url', 'source_kind', 'updated_at', 'deleted_at', 'published_at'])
      assert.equal(detailProjection.includes(`"cars"."${column}"`), false, `Public detail must not transfer ${column}`);
    assert.equal(detail.description, 'Full public description');
    assert.equal(detail.price, car.price);
    assert.equal(detail.originalPrice, car.originalPrice);
    assert.equal(detail.media.length, 1);
    assert.ok(detail.branch);
    assert.equal('licensePlate' in detail, false);
    assert.deepEqual((await cars.list({ ...query, page: 99, limit: 1 })).data, []);
    assert.equal((await cars.list({ ...query, page: 99, limit: 1 })).meta.total, 1);
  } finally { await fixture.pg.close(); }
});
