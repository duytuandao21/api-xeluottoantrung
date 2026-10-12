import assert from 'node:assert/strict';
import test from 'node:test';
import { createQueryCacheFixture } from './fixtures/query-cache-fixture.js';

test('local HTTP application restart starts cold and reads committed SEO', async () => {
  const fixture = await createQueryCacheFixture();
  let server = await fixture.createApp(true);
  try {
    const read = async () => {
      const response = await fetch(`${server.url}/api/v1/seo?route=%2F`);
      assert.equal(response.status, 200);
      return response.json();
    };
    const first = await read();
    assert.deepEqual(await read(), first);
    assert.equal(server.metrics.selects, 1);
    assert.equal(server.cache.snapshot().entries, 1);
    const update = await fetch(`${server.url}/api/v1/admin/seo`, {
      method: 'PUT',
      headers: { authorization: 'Bearer phase3-local', 'content-type': 'application/json' },
      body: JSON.stringify({ routePath: '/', metaTitle: 'Committed before restart' }),
    });
    assert.equal(update.status, 200);
    const committed = await read();
    assert.equal(committed.metaTitle, 'Committed before restart');
    assert.equal(server.cache.snapshot().entries, 1);
    await server.app.close();
    server = await fixture.createApp(true);
    assert.equal(server.cache.snapshot().entries, 0);
    assert.equal(server.cache.snapshot().pending, 0);
    assert.deepEqual(await read(), committed);
    assert.equal(server.metrics.selects, 1);
    assert.deepEqual(await read(), committed);
    assert.equal(server.metrics.selects, 1);
  } finally {
    await server.app.close();
    await fixture.pg.close();
  }
});
