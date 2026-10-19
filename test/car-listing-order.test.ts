import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { asc, eq } from 'drizzle-orm';
import { createQueryCacheFixture } from './fixtures/query-cache-fixture.js';
import { auditLogs, carMedia, cars } from '../src/database/schema/index.js';

const ids = {
  older: 'cf0b8914-8d73-4926-a175-cbd00909acdf',
  newer: 'c8e62fba-60ad-4b95-b9e9-f790c16a3152',
  target: '1763061e-1a16-49c7-8864-0b95f24dcc3b',
};
const placementSql = await readFile('scripts/place-imported-car-115.sql', 'utf8');
const rollbackSql = await readFile('scripts/rollback-imported-car-115.sql', 'utf8');

test('manual placement shares default Admin/public pagination without changing creation, inventory or permissions', async () => {
  const f = await createQueryCacheFixture();
  let instance: Awaited<ReturnType<typeof f.createApp>> | undefined;
  try {
    await f.db.update(cars).set({ createdAt: new Date('2020-01-01T00:00:00Z') });
    const base = { brandId: f.brands[0].id, modelId: f.models[0].id, year: 2024, mileage: 21000,
      price: 535000000, originalPrice: 550000000, status: 'active' as const, publishedAt: new Date(), newArrival: false };
    await f.db.insert(cars).values([
      { ...base, id: ids.older, name: 'Imported 063', slug: 'mitsubishi-xpander-cross-2023', price: 499000000,
        createdAt: new Date('2026-10-18T16:19:09.837Z') },
      { ...base, id: ids.newer, name: 'Imported 065', slug: 'ford-ranger-xls-at-4x4-2022', price: 583000000, originalPrice: 600000000,
        createdAt: new Date('2026-10-18T16:19:24.825Z') },
      { ...base, id: ids.target, name: 'Imported 115', slug: 'mitsubishi-xforce-exceed-2024',
        createdAt: new Date('2026-10-18T17:13:12.454Z') },
      { ...base, name: 'Unrelated newer car', slug: 'unrelated-newer', createdAt: new Date('2026-10-19T00:00:00Z') },
    ]);
    await f.db.insert(carMedia).values({ carId: ids.target, isCover: true, publicUrl: 'https://fixture.invalid/115.jpg' });
    instance = await f.createApp(true);
    const headers = { authorization: 'Bearer phase3-local' };
    const get = async (path: string, admin = false) => {
      const r = await instance!.app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/api/v1' + path, headers: admin ? headers : {} });
      assert.equal(r.statusCode, 200, r.body); return r.json();
    };
    const slugs = (result: { data: { slug: string }[] }): string[] => result.data.map(c => c.slug);
    const publicBefore = await get('/cars?limit=100');
    assert.deepEqual(slugs(await get('/admin/cars?limit=100', true)), slugs(publicBefore));
    const detailBefore = await get('/cars/mitsubishi-xforce-exceed-2024');
    const before = await f.db.select().from(cars).orderBy(asc(cars.id));
    const mediaBefore = await f.db.select().from(carMedia).orderBy(asc(carMedia.id));
    const explicit = new Map<string, string[]>();
    for (const sort of ['oldest', 'price_asc', 'price_desc', 'year_desc', 'mileage_asc'])
      explicit.set(sort, slugs(await get('/cars?limit=100&sort=' + sort)));
    const dateBefore = slugs(await get('/admin/cars?limit=100&sortBy=createdAt&sortDirection=desc', true));
    await get('/cars?limit=6&discounted=true'); // warm API cache; operation requires restart
    await instance.app.close(); instance = undefined;

    await f.pg.exec(placementSql);
    const after = await f.db.select().from(cars).orderBy(asc(cars.id));
    for (let i = 0; i < before.length; i++) {
      const { listingOrderAt: oldOrder, ...oldFields } = before[i];
      const { listingOrderAt: newOrder, ...newFields } = after[i];
      assert.deepEqual(newFields, oldFields, 'No creation date, price, state, description or other field may change');
      if (before[i].id !== ids.target) assert.deepEqual(newOrder, oldOrder, 'Only target order changes');
    }
    assert.deepEqual(await f.db.select().from(carMedia).orderBy(asc(carMedia.id)), mediaBefore);
    const target = after.find(c => c.id === ids.target)!;
    assert.ok(target.listingOrderAt);
    assert.ok(target.listingOrderAt > after.find(c => c.id === ids.older)!.createdAt);
    assert.ok(target.listingOrderAt < after.find(c => c.id === ids.newer)!.createdAt);
    await f.pg.exec(placementSql);
    assert.equal((await f.db.select().from(auditLogs).where(eq(auditLogs.action, 'car.listing_order.update'))).length, 1, 'Idempotent placement');

    instance = await f.createApp(true); // same lifecycle as documented deployment; no cache policy change
    const publicAfter = await get('/cars?limit=100');
    const expected = ['unrelated-newer', 'ford-ranger-xls-at-4x4-2022', 'mitsubishi-xforce-exceed-2024', 'mitsubishi-xpander-cross-2023'];
    assert.deepEqual(slugs(publicAfter).slice(0, 4), expected);
    assert.deepEqual(slugs(await get('/admin/cars?limit=100', true)), slugs(publicAfter));
    assert.equal(publicAfter.meta.total, publicBefore.meta.total);
    assert.equal('listingOrderAt' in publicAfter.data[0], false, 'Public response projection unchanged');
    assert.deepEqual(await get('/cars/mitsubishi-xforce-exceed-2024'), detailBefore);
    assert.deepEqual(slugs(await get('/cars?limit=6&discounted=true')).filter(s => expected.includes(s)), expected);
    const paged: string[] = [];
    for (let page = 1; page <= Math.ceil(publicAfter.meta.total / 2); page++) paged.push(...slugs(await get(`/cars?limit=2&page=${page}`)));
    assert.deepEqual(paged, slugs(publicAfter)); assert.equal(new Set(paged).size, paged.length);
    for (const [sort, expectedSort] of explicit) assert.deepEqual(slugs(await get('/cars?limit=100&sort=' + sort)), expectedSort);
    assert.deepEqual(slugs(await get('/admin/cars?limit=100&sortBy=createdAt&sortDirection=desc', true)), dateBefore);
    assert.ok(!(slugs(await get('/cars?new_arrival=true'))).includes('mitsubishi-xforce-exceed-2024'));
    const server = instance.app.getHttpAdapter().getInstance();
    assert.equal((await server.inject({ method: 'GET', url: '/api/v1/admin/cars' })).statusCode, 401);
    assert.equal((await server.inject({ method: 'PATCH', url: '/api/v1/admin/cars/' + ids.target, headers,
      payload: { listingOrderAt: '2000-01-01T00:00:00Z' } })).statusCode, 400, 'Internal ordering cannot be written through undocumented HTTP properties');
    const priceEdit = await server.inject({ method: 'PATCH', url: '/api/v1/admin/cars/' + ids.target,
      headers, payload: { price: 536000000 } });
    assert.equal(priceEdit.statusCode, 200, priceEdit.body);
    assert.equal(priceEdit.json().price, 536000000);
    assert.equal(priceEdit.json().createdAt, target.createdAt.toISOString());
    assert.equal(priceEdit.json().listingOrderAt, target.listingOrderAt.toISOString(), 'Normal Admin edits preserve the manual position');
    assert.deepEqual(slugs(await get('/cars?limit=100')).slice(0, 4), expected);
    const beforeRollback = await f.db.select().from(cars).orderBy(asc(cars.id));

    await instance.app.close(); instance = undefined;
    await f.pg.exec(rollbackSql); await f.pg.exec(rollbackSql);
    assert.deepEqual(await f.db.select().from(cars).orderBy(asc(cars.id)),
      beforeRollback.map(c => c.id === ids.target ? { ...c, listingOrderAt: null } : c),
      'Rollback restores position while preserving subsequent price edits and all other fields');
    assert.equal((await f.db.select().from(auditLogs).where(eq(auditLogs.action, 'car.listing_order.rollback'))).length, 1);
    await f.db.update(cars).set({ deletedAt: new Date() }).where(eq(cars.id, ids.older));
    await assert.rejects(f.pg.exec(placementSql)); await f.pg.exec('ROLLBACK');
    assert.equal((await f.db.select().from(cars).where(eq(cars.id, ids.target)))[0].listingOrderAt, null, 'Missing anchor aborts without changing target');
  } finally { await instance?.app.close(); await f.pg.close(); }
});
