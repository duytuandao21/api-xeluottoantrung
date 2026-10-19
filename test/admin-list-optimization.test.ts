import assert from 'node:assert/strict';
import test from 'node:test';
import { createQueryCacheFixture } from './fixtures/query-cache-fixture.js';
import { articles, carVersions, leads } from '../src/database/schema/index.js';

test('admin lists page/search/sort/filter without changing public or legacy contracts', async () => {
  const fixture = await createQueryCacheFixture();
  const instance = await fixture.createApp(true);
  const server = instance.app.getHttpAdapter().getInstance();
  const headers = { authorization: 'Bearer phase3-local' };
  const get = async (path: string) => {
    const response = await server.inject({ method: 'GET', url: `/api/v1${path}`, headers });
    assert.equal(response.statusCode, 200, response.body); return response.json();
  };
  try {
    await fixture.db.insert(carVersions).values(Array.from({ length: 31 }, (_, i) => ({ modelId: fixture.models[0].id, name: `Version ${String(i).padStart(3, '0')}`, slug: `version-${i}` })));
    const publicBefore = await get('/cars?limit=10');
    const legacy = await get('/admin/brands'); assert(Array.isArray(legacy));
    const pagedBrands = await get('/admin/brands?page=1&limit=1&sortBy=name&sortDirection=desc');
    assert.equal(pagedBrands.data.length, 1); assert.equal(pagedBrands.meta.total, legacy.length);
    const models = await get(`/admin/car-models?page=1&limit=10&brandId=${fixture.brands[0].id}&search=Vios`);
    assert.equal(models.data.length, 1); assert.equal(models.data[0].name, 'Vios'); assert.equal(models.data[0].brandId, fixture.brands[0].id);
    const suffix = `&brandId=${fixture.brands[0].id}&modelId=${fixture.models[0].id}&search=version&sortBy=name&sortDirection=desc`;
    const first = await get(`/admin/lookups/car-versions?page=1&limit=10${suffix}`);
    const second = await get(`/admin/lookups/car-versions?page=2&limit=10${suffix}`);
    const last = await get(`/admin/lookups/car-versions?page=4&limit=10${suffix}`);
    assert.equal(first.meta.total, 31); assert.equal(first.data[0].name, 'Version 030');
    assert.equal(first.data.length, 10); assert.equal(last.data.length, 1);
    assert.equal(new Set([...first.data, ...second.data].map(row => row.id)).size, 20);
    assert.equal((await get(`/admin/lookups/car-versions?page=99&limit=10${suffix}`)).data.length, 0);
    assert.equal((await get(`/admin/lookups/car-versions?modelId=${fixture.models[1].id}&search=version`)).meta.total, 0);
    for (const path of ['/admin/brands?page=1&limit=101', '/admin/car-models?page=0', '/admin/lookups/car-versions?brandId=invalid', '/admin/lookups/car-versions?sortBy=name%3BDROP', '/admin/collections/articles?sortBy=price', '/admin/cars?sortBy=title']) {
      const response = await server.inject({ method: 'GET', url: `/api/v1${path}`, headers }); assert.equal(response.statusCode, 400, path);
    }
    assert.equal((await get('/admin/lookups/car-versions?search=%25%27%20OR%201%3D1--')).meta.total, 0);
    const [article] = await fixture.db.insert(articles).values({ title: 'Payload fixture', slug: 'payload-fixture', content: '<p>' + 'x'.repeat(39000) + '</p>', status: 'published', publishedAt: new Date() }).returning();
    const full = await get('/admin/collections/articles?limit=10');
    const slim = await get('/admin/collections/articles?limit=10&view=table');
    assert.equal('content' in slim.data[0], false); assert.equal(full.meta.total, slim.meta.total);
    assert.equal((await get(`/admin/collections/articles/${article.id}`)).content, article.content);
    assert.equal((await get('/articles?view=table')).data[0].content, article.content, 'Public projection unchanged');
    const countsStart = instance.metrics.selects;
    await get('/admin/leads/counts'); assert.equal(instance.metrics.selects - countsStart, 1, 'Counts use one SELECT');
    await fixture.db.insert(leads).values([{ type: 'sell', phone: '0900000000', status: 'unread' }, { type: 'callback', phone: '0900000001', status: 'read' }, { type: 'trade_in', phone: '0900000002', status: 'unread' }]);
    assert.deepEqual(await get('/admin/leads/counts'), { sell: 1, trade_in: 1, callback: 0 });
    const freshCars = await get('/cars?limit=10'); assert.deepEqual(freshCars, publicBefore);
    const noAuth = await server.inject({ method: 'GET', url: '/api/v1/admin/leads/counts' }); assert.equal(noAuth.statusCode, 401);
    const unauthorized = await fixture.createApp(false, 0, false, ['lead.read', 'model.read']);
    try {
      for (const path of ['/admin/leads/counts', '/admin/car-models?page=1']) {
        const response = await unauthorized.app.getHttpAdapter().getInstance().inject({ method: 'GET', url: `/api/v1${path}`, headers }); assert.equal(response.statusCode, 403, path);
      }
    } finally { await unauthorized.app.close(); }
    console.log(JSON.stringify({ fixture: 'admin-list', versionPageRows: first.data.length, versionsTotal: first.meta.total, articleFullBytes: Buffer.byteLength(JSON.stringify(full)), articleTableBytes: Buffer.byteLength(JSON.stringify(slim)), headerCountSelects: 1 }));
  } finally { await instance.app.close(); await fixture.pg.close(); }
});
