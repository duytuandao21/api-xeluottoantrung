import assert from 'node:assert/strict';
import test from 'node:test';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { BadRequestException } from '@nestjs/common';
import { createQueryCacheFixture } from './fixtures/query-cache-fixture.js';
import * as schema from '../src/database/schema/index.js';
import { DatabaseService } from '../src/database/database.service.js';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';
import { CarsService } from '../src/modules/cars/cars.service.js';
import type { ListCarsQuery } from '../src/modules/cars/cars.dto.js';

test('TV ranks brands exactly like filters without extra SELECTs or changing ordinary lists', async () => {
  const fixture = await createQueryCacheFixture();
  try {
    const statements: string[] = [];
    const db = drizzle(fixture.pg, { schema, logger: { logQuery: sql => { if (/^select\b/i.test(sql)) statements.push(sql); } } });
    const connection = { db } as unknown as DatabaseService;
    const service = new CarsService(connection), catalog = new CatalogService(connection);
    await db.update(schema.cars).set({ status: 'deposit' }).where(eq(schema.cars.id, fixture.cars[1].id));
    await db.update(schema.brands).set({ sortOrder: -1, imageUrl: 'https://fixture.invalid/toyota.png' }).where(eq(schema.brands.id, fixture.brands[0].id));
    await db.insert(schema.cars).values({ name: 'Honda second deposit', slug: 'honda-second-deposit',
      brandId: fixture.brands[1].id, modelId: fixture.models[1].id, year: 2025, price: 1, status: 'deposit', publishedAt: new Date() });
    for (const [slug, state] of [['hidden', { publishedAt: null }], ['sold', { status: 'sold' as const }], ['deleted', { deletedAt: new Date() }]] as const)
      await db.insert(schema.cars).values({ name: slug, slug, brandId: fixture.brands[2].id, modelId: fixture.models[2].id,
        year: 2025, price: 1, status: 'active', publishedAt: new Date(), ...state });
    const query: ListCarsQuery = { page: 1, limit: 100, sort: 'newest', status: 'active' };
    statements.length = 0;
    const baseline = await service.list(query);
    assert.equal(statements.length, 2);
    statements.length = 0;
    const tv = await service.list({ ...query, view: 'tv' });
    assert.equal(statements.length, 2, 'grouped metadata replaces existing count, no additional query');
    assert.deepEqual(tv.data, baseline.data);
    assert.equal(tv.meta.total, baseline.meta.total);
    assert.equal(tv.meta.totalPages, baseline.meta.totalPages);
    const filterBrands = (await catalog.publicBrands()).filter(brand => brand.stockCount > 0);
    assert.deepEqual(tv.meta.tvBrands?.map(({ id, name, slug, imageUrl, stockCount }) => ({ id, name, slug, imageUrl, stockCount })), filterBrands);
    assert.deepEqual(tv.meta.tvBrands?.map(brand => [brand.slug, brand.activeCount]), [['honda', 0], ['toyota', 1], ['chevrolet', 1]]);
    assert.equal(tv.meta.tvBrands?.find(brand => brand.slug === 'toyota')?.imageUrl, 'https://fixture.invalid/toyota.png');
    assert.equal('tvBrands' in baseline.meta, false);
    statements.length = 0;
    const next = await service.list({ ...query, page: 2 });
    assert.equal(statements.length, 2); assert.equal('tvBrands' in next.meta, false);
    for (const invalid of [{ ...query, view: 'tv' as const, page: 2 }, { ...query, view: 'tv' as const, brand: 'toyota' },
      { ...query, view: 'tv' as const, status: undefined }])
      await assert.rejects(service.list(invalid), BadRequestException);
    await assert.rejects(service.list({ ...query, view: 'tv' }, true), BadRequestException);
    await assert.rejects(service.list({ ...query, view: 'tv' }, false, true), BadRequestException);
    await db.update(schema.carModels).set({ status: 'inactive' }).where(eq(schema.carModels.id, fixture.models[2].id));
    const reduced = await service.list({ ...query, view: 'tv' });
    assert.equal(reduced.meta.total, 1);
    assert.deepEqual(reduced.meta.tvBrands?.map(brand => brand.slug), ['honda', 'toyota']);
    await db.update(schema.brands).set({ status: 'inactive' }).where(eq(schema.brands.id, fixture.brands[0].id));
    assert.equal((await service.list({ ...query, view: 'tv' })).meta.total, 0);
    const http = await fixture.createApp(false);
    try {
      const before = http.metrics.selects;
      const response = await fetch(`${http.url}/api/v1/cars?view=tv&page=1&limit=100&status=active`);
      assert.equal(response.status, 200, 'DTO allows the public TV projection');
      assert.ok(Array.isArray((await response.json()).meta.tvBrands));
      assert.equal(http.metrics.selects - before, 2);
      assert.equal((await fetch(`${http.url}/api/v1/cars?view=tv&page=2&limit=100&status=active`)).status, 400);
    } finally { await http.app.close(); }
  } finally { await fixture.pg.close(); }
});
