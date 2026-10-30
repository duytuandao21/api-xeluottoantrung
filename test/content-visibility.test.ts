import assert from 'node:assert/strict';
import test from 'node:test';
import { createQueryCacheFixture } from './fixtures/query-cache-fixture.js';

test('content visibility uses the existing status contract and preserves content and featured flags', async () => {
  const fixture = await createQueryCacheFixture();
  const instance = await fixture.createApp(true);
  const server = instance.app.getHttpAdapter().getInstance();
  const headers = { authorization: 'Bearer phase3-local', 'content-type': 'application/json' };
  const body = '<p>Visibility fixture content stays intact.</p>';
  const cases = [
    { kind: 'articles', visible: 'published', hidden: 'draft', contentField: 'content',
      payload: { title: 'Visibility news', slug: 'visibility-news', content: body } },
    { kind: 'driving-experiences', visible: 'published', hidden: 'draft', contentField: 'content',
      payload: { title: 'Visibility experience', slug: 'visibility-experience', content: body } },
    { kind: 'faqs', visible: 'active', hidden: 'inactive', contentField: 'answer',
      payload: { question: 'Visibility FAQ', answer: body } },
    { kind: 'testimonials', visible: 'active', hidden: 'inactive', contentField: 'content',
      payload: { name: 'Visibility customer', content: body, rating: 5 } },
  ];
  const publicGet = (path: string) => server.inject({ method: 'GET', url: `/api/v1${path}` });
  try {
    for (const item of cases) {
      const adminPath = `/api/v1/admin/collections/${item.kind}`;
      const createdResponse = await server.inject({ method: 'POST', url: adminPath, headers,
        payload: { ...item.payload, featured: true, status: item.visible } });
      assert.equal(createdResponse.statusCode, 201, createdResponse.body);
      const created = createdResponse.json();
      const publicPath = `/${item.kind}?limit=100`;
      const visible = await publicGet(publicPath);
      assert.equal(visible.statusCode, 200, visible.body);
      assert(visible.json().data.some((row: { id: string }) => row.id === created.id));
      // Prime the public cache before changing visibility.
      await publicGet(publicPath);
      const patch = (status: string) => server.inject({ method: 'PATCH', url: `${adminPath}/${created.id}`,
        headers, payload: { status } });
      const hidden = await patch(item.hidden);
      assert.equal(hidden.statusCode, 200, hidden.body);
      assert.equal((await publicGet(publicPath)).json().data.some((row: { id: string }) => row.id === created.id), false);
      if (item.kind !== 'testimonials')
        assert.equal((await publicGet(`/${item.kind}/${created.slug}`)).statusCode, 404);
      const stored = await server.inject({ method: 'GET', url: `${adminPath}/${created.id}`, headers });
      assert.equal(stored.statusCode, 200, stored.body);
      assert.equal(stored.json()[item.contentField], body);
      assert.equal(stored.json().featured, true, 'Visibility must not change homepage priority');
      assert.equal(stored.json().slug, created.slug);
      const restored = await patch(item.visible);
      assert.equal(restored.statusCode, 200, restored.body);
      assert.equal(restored.json()[item.contentField], body);
      assert.equal((await publicGet(publicPath)).json().data.some((row: { id: string }) => row.id === created.id), true);
      assert.equal((await patch(item.visible === 'published' ? 'active' : 'published')).statusCode, 400,
        'Article and active/inactive contracts must stay distinct');
    }
  } finally { await instance.app.close(); await fixture.pg.close(); }
});
