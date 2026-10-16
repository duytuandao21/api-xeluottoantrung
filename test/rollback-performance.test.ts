import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createQueryCacheFixture } from './fixtures/query-cache-fixture.js';

test('rollback removes the experimental route while preserving warm/cold original CMS, Admin writes and auth', async () => {
  const fixture = await createQueryCacheFixture();
  const server = await fixture.createApp(true);
  const http = server.app.getHttpAdapter().getInstance();
  try {
    for (const url of ['/api/v1/content/home', '/api/v1/content/home?group=thiet-lap-nut-goi']) {
      const response = await http.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 404);
    }
    const url = '/api/v1/content?group=thiet-lap-cac-buoc-mua-xe';
    const cold = await http.inject({ method: 'GET', url });
    assert.equal(cold.statusCode, 200);
    const warm = await http.inject({ method: 'GET', url });
    assert.deepEqual(warm.json(), cold.json());
    assert.equal(warm.headers['cache-control'], 'no-store');
    const updateUrl = '/api/v1/admin/content/thiet-lap-cac-buoc-mua-xe/step-one';
    assert.equal((await http.inject({ method: 'PATCH', url: updateUrl, payload: { title: 'Unauthorized change' } })).statusCode, 401);
    const updated = await http.inject({ method: 'PATCH', url: updateUrl, headers: { authorization: 'Bearer phase3-local' }, payload: { title: 'Rollback regression updated CMS' } });
    assert.equal(updated.statusCode, 200);
    const refreshed = await http.inject({ method: 'GET', url });
    assert.equal(refreshed.statusCode, 200);
    assert.equal(refreshed.json<{ title: string }[]>()[0].title, 'Rollback regression updated CMS');
    assert.notDeepEqual(refreshed.json(), cold.json());
    const inventory = await http.inject({ method: 'GET', url: '/api/v1/cars?limit=6&sort=newest' });
    assert.equal(inventory.statusCode, 200);
    assert.equal(inventory.json<{ data: unknown[] }>().data.length, 3);
  } finally { await server.app.close(); await fixture.pg.close(); }
});

test('original production throttle guard is restored without a composition override', async () => {
  const guard = await readFile('src/common/cache/public-read-throttler.guard.ts', 'utf8');
  assert(!guard.includes('HOME_CONTENT_VIEW'));
  assert(!guard.includes('override async canActivate'));
  assert(guard.includes('protected override async shouldSkip'));
  assert(guard.includes('request.headers.cookie'));
  assert(guard.includes('isLoopback(request.ip)'));
  assert(guard.includes('THROTTLER_LIMIT'));
});
