import assert from 'node:assert/strict';
import test from 'node:test';
import { createQueryCacheFixture } from './fixtures/query-cache-fixture.js';
import { CollectionsService } from '../src/modules/content/collections.service.js';
import { ContentService } from '../src/modules/content/content.service.js';
import { profiles } from '../src/database/schema/index.js';

test('display order saves a complete list in one request and rejects stale edits', async () => {
  const fixture = await createQueryCacheFixture();
  const instance = await fixture.createApp(true);
  const server = instance.app.getHttpAdapter().getInstance();
  const headers = { authorization: 'Bearer phase3-local' };
  const [profile] = await fixture.db.select({ id: profiles.id }).from(profiles);
  const audit = { actorProfileId: profile.id, ipAddress: '127.0.0.1', userAgent: 'test', requestId: 'display-order' };
  const collections = new CollectionsService(fixture.connection);
  const content = new ContentService(fixture.connection);
  const get = (path: string) => server.inject({ method: 'GET', url: `/api/v1${path}`, headers });
  const patch = (path: string, body: object) => server.inject({ method: 'PATCH', url: `/api/v1${path}`,
    headers: { ...headers, 'content-type': 'application/json' }, payload: body });
  try {
    const first = await collections.create('faqs', { question: 'First', answer: 'A' }, audit);
    const second = await collections.create('faqs', { question: 'Second', answer: 'B' }, audit);
    const path = '/admin/collections/faqs/order';
    const before = instance.metrics.selects;
    const listing = await get(path);
    assert.equal(listing.statusCode, 200, listing.body);
    assert.equal(instance.metrics.selects - before, 1, 'Order mode reads only id and label in one SELECT');
    const original = (listing.json() as { id: string }[]).map(row => row.id);
    assert.equal(original.length, 3);
    assert(original.includes(String(first.id)) && original.includes(String(second.id)));
    const reversed = [...original].reverse();
    const saveRequests = instance.metrics.requests;
    const saveSelects = instance.metrics.selects;
    const saved = await patch(path, { expectedIds: original, ids: reversed });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(instance.metrics.requests - saveRequests, 1);
    assert.equal(instance.metrics.selects - saveSelects, 1, 'Save checks the current order once');
    assert.deepEqual((await get(path)).json().map((row: { id: string }) => row.id), reversed);
    assert.equal((await patch(path, { expectedIds: original, ids: reversed })).statusCode, 409);
    assert.equal((await patch(path, { expectedIds: reversed, ids: [reversed[0], reversed[0], ...reversed.slice(2)] })).statusCode, 400);
    assert.equal((await get('/admin/collections/articles/order')).statusCode, 404);

    const entryPath = '/admin/content/order/thiet-lap-cac-buoc-mua-xe';
    await content.createEntry({ group: 'thiet-lap-cac-buoc-mua-xe', key: 'step-two', title: 'Second step' }, audit);
    const entries = (await get(entryPath)).json() as { id: string }[];
    const entryIds = entries.map(row => row.id);
    assert.equal(entryIds.length, 2);
    assert.equal((await patch(entryPath, { expectedIds: entryIds, ids: [...entryIds].reverse() })).statusCode, 200);
    assert.deepEqual((await get(entryPath)).json().map((row: { id: string }) => row.id), [...entryIds].reverse());
    assert.equal((await get('/admin/content/order/INVALID!')).statusCode, 400);
  } finally { await instance.app.close(); await fixture.pg.close(); }
});
