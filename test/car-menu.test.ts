import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { CarsService } from '../src/modules/cars/cars.service.js';
import { NEW_ARRIVAL_DURATION_MS } from '../src/modules/cars/new-arrival.js';
import type { DatabaseService } from '../src/database/database.service.js';
import * as schema from '../src/database/schema/index.js';
import { publicCachePolicy } from '../src/common/cache/public-cache.policy.js';

test('menu uses one limited query and matches public filters without private/specification data', async () => {
  const pg = new PGlite();
  try {
    await pg.exec((await readFile('drizzle/0000_wild_carmella_unuscione.sql', 'utf8')).replaceAll('--> statement-breakpoint', ''));
    await pg.exec(await readFile('drizzle/0001_unusual_nomad.sql', 'utf8'));
    const queries: string[] = [];
    const db = drizzle(pg, { schema, logger: { logQuery(query) { queries.push(query); } } });
    const service = new CarsService({ db } as unknown as DatabaseService);
    const [brand] = await db.insert(schema.brands).values({ name: 'Toyota', slug: 'toyota' }).returning();
    const [model] = await db.insert(schema.carModels).values({ name: 'Vios', slug: 'vios', brandId: brand.id }).returning();
    const now = Date.now();
    const fixtures = [
      { slug: 'first', age: 1000 }, { slug: 'second', age: 2000 }, { slug: 'third', age: 3000 }, { slug: 'fourth', age: 4000 },
      { slug: 'expired', age: NEW_ARRIVAL_DURATION_MS },
      { slug: 'future', age: -60_000 },
      { slug: 'disabled', age: 500, newArrival: false },
      { slug: 'sold', age: 500, status: 'sold' as const },
      { slug: 'deposit', age: 500, status: 'deposit' as const },
      { slug: 'unpublished', age: 500, publishedAt: null },
      { slug: 'deleted', age: 500, deletedAt: new Date() },
    ];
    for (const item of fixtures) await db.insert(schema.cars).values({ name: item.slug, brandId: brand.id, modelId: model.id,
      year: 2025, price: 433_000_000, originalPrice: 453_000_000, status: 'active', publishedAt: new Date(), newArrival: true,
      ...item, createdAt: new Date(now - item.age) });
    const [first] = await db.select().from(schema.cars).where(eq(schema.cars.slug, 'first'));
    await db.insert(schema.carMedia).values({ carId: first.id, isCover: true, publicUrl: 'https://media.test/cover.jpg' });
    queries.length = 0;
    const arrivals = await service.menu('new-arrivals');
    assert.equal(queries.length, 1, 'Only one select; no count or per-car fetch');
    assert.match(queries[0], /limit/);
    assert.doesNotMatch(queries[0], /count\(|car_specifications|car_versions|transmissions|license_plate|description/i);
    assert.deepEqual(arrivals.data.map(car => car.slug), ['first', 'second', 'third']);
    assert.equal(arrivals.data[0].cover, 'https://media.test/cover.jpg');
    assert.equal('id' in arrivals.data[0], false);
    const filter = { page: 1, limit: 3, sort: 'newest' as const, new_arrival: 'true' as const };
    assert.deepEqual((await service.list(filter)).data.map(car => car.slug), arrivals.data.map(car => car.slug));
    assert.equal((await service.list(filter)).meta.total, 4);
    queries.length = 0;
    const discounts = await service.menu('discounts');
    assert.equal(queries.length, 1);
    assert.equal(discounts.data.length, 3);
    assert.doesNotMatch(queries[0], /random\(|count\(/i);
    assert.ok(discounts.data.every(car => car.originalPrice! > car.price));
    await db.update(schema.cars).set({ originalPrice: 433_000_000 }).where(eq(schema.cars.id, first.id));
    assert.ok(!(await service.menu('discounts')).data.some(car => car.slug === 'first'), 'Equal price is not discounted');
    await db.update(schema.brands).set({ status: 'inactive' }).where(eq(schema.brands.id, brand.id));
    assert.deepEqual((await service.menu('new-arrivals')).data, []);
    assert.deepEqual((await service.menu('discounts')).data, []);
  } finally { await pg.close(); }
});

test('menu and new filtered lists have short cache keys; normal inventory and text searches stay live', () => {
  const policy = (path: string) => publicCachePolicy(`/api/v1${path}`);
  assert.equal(policy('/cars/menu?section=new-arrivals')?.ttlMs, 30_000);
  assert.equal(policy('/cars/menu?section=discounts')?.ttlMs, 30_000);
  assert.notEqual(policy('/cars/menu?section=new-arrivals')?.key, policy('/cars/menu?section=discounts')?.key);
  assert.equal(policy('/cars/menu?section=invalid'), undefined);
  assert.equal(policy('/cars/menu?section=discounts&limit=100'), undefined);
  assert.equal(policy('/cars?discounted=true&limit=6&page=1')?.key, policy('/cars?page=1&limit=6&discounted=true')?.key);
  assert.notEqual(policy('/cars?discounted=true&page=1')?.key, policy('/cars?discounted=true&page=2')?.key);
  assert.equal(policy('/cars?new_arrival=true&search=private'), undefined);
  assert.equal(policy('/cars?discounted=true&q=private'), undefined);
  assert.equal(policy('/cars?limit=6'), undefined);
  assert.equal(policy('/cars/first'), undefined);
});
