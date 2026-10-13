import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { promotionPopup, promotions } from '../src/database/schema/index.js';
import { promotionStatus, promotionToday } from '../src/modules/promotions/service.js';
import { promotionsFixture } from './fixtures/promotions.js';

let f: Awaited<ReturnType<typeof promotionsFixture>>;
before(async () => { f = await promotionsFixture({ beforeDateMigration: async pg => {
  await pg.exec("INSERT INTO promotions (title,image_url,starts_at,ends_at,is_published,deleted_at) VALUES ('Legacy date migration','/legacy.png','2026-10-12T18:00:00Z','2026-10-13T14:00:00Z',false,now())");
} }); }); after(async () => { await f?.close(); });
const headers = { authorization: 'Bearer promotion-admin' };
const day = 86400000, iso = (offset: number) => promotionToday(new Date(Date.now() + offset * day));
const payload = (title: string, starts = -1, ends = 1) => ({ title, imageUrl: 'https://fixture.test/promotion.png', content: '<p>Nội dung chương trình</p>', startsAt: iso(starts), endsAt: iso(ends) });
const create = async (title: string, starts = -1, ends = 1) => {
  const response = await f.server.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers, payload: payload(title, starts, ends) });
  assert.equal(response.statusCode, 201, response.body); return response.json();
};
const toggle = (id: string, enabled: boolean) => f.server.inject({ method: 'PATCH', url: `/api/v1/admin/promotions/${id}/popup`, headers, payload: { enabled } });
test('Date boundaries include the full end date and use the Vietnam calendar', () => {
  assert.equal(promotionStatus('2026-10-13', '2026-10-14', '2026-10-12'), 'upcoming');
  assert.equal(promotionStatus('2026-10-13', '2026-10-14', '2026-10-13'), 'ongoing');
  assert.equal(promotionStatus('2026-10-13', '2026-10-14', '2026-10-14'), 'ongoing');
  assert.equal(promotionStatus('2026-10-13', '2026-10-14', '2026-10-15'), 'ended');
  assert.equal(promotionToday(new Date('2026-10-14T16:59:59.999Z')), '2026-10-14');
  assert.equal(promotionToday(new Date('2026-10-14T17:00:00.000Z')), '2026-10-15');
});
test('Migration preserves Vietnam dates and removes the old time values', async () => {
  const migrated = await f.pg.query<{ starts_at: string; ends_at: string }>("SELECT starts_at::text,ends_at::text FROM promotions WHERE title='Legacy date migration'");
  assert.deepEqual(migrated.rows, [{ starts_at: '2026-10-13', ends_at: '2026-10-13' }]);
});
test('Public popup starts empty; mutation and read permissions are enforced', async () => {
  assert.equal((await f.server.inject('/api/v1/promotions/popup')).json(), null);
  assert.equal((await f.server.inject('/api/v1/admin/promotions')).statusCode, 401);
  assert.equal((await f.server.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers: { authorization: 'Bearer promotion-reader' }, payload: payload('Denied') })).statusCode, 403);
  assert.equal((await f.server.inject({ url: '/api/v1/admin/promotions', headers: { authorization: 'Bearer other' } })).statusCode, 403);
});
test('Same-day programs save date columns without time and stay eligible through today', async () => {
  const row = await create('One day', 0, 0);
  assert.equal(row.startsAt, iso(0)); assert.equal(row.endsAt, iso(0)); assert.equal(row.status, 'ongoing');
  assert.equal((await toggle(row.id, true)).statusCode, 200);
  assert.equal((await f.server.inject('/api/v1/promotions/popup')).json().id, row.id);
  const types = await f.pg.query<{ data_type: string }>("SELECT data_type FROM information_schema.columns WHERE table_name='promotions' AND column_name IN ('starts_at','ends_at')");
  assert.deepEqual(types.rows.map(row => row.data_type), ['date', 'date']);
  await f.server.inject({ method: 'DELETE', url: `/api/v1/admin/promotions/${row.id}`, headers });
});
test('Validate dates, images, nulls and unknown fields', async () => {
  for(const bad of [ { endsAt: iso(-2) }, { title: '   ' }, { imageUrl: 'javascript:alert(1)' }, { startsAt: '2026-10-13T10:00:00' }, { startsAt: '2026-10-13T10:00:00+07:00' }, { startsAt: '2026-02-30' }, { endsAt: '0000-01-01' }, { content: null }, { status: 'ongoing' } ]) {
    const response = await f.server.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers, payload: { ...payload('Bad'), ...bad } });
    assert.equal(response.statusCode, 400, response.body);
  }
});
test('Sort all statuses, paginate six, omit full content and hide drafts', async () => {
  for(let i = 0; i < 3; i++) { await create(`Ended ${i}`, -4, -3); await create(`Upcoming ${i}`, 2 + i, 4 + i); await create(`Ongoing ${i}`, -1, 2); }
  const response = await f.server.inject('/api/v1/promotions?limit=6'); assert.equal(response.statusCode, 200, response.body);
  const first = response.json(); assert.equal(first.meta.total, 9); assert.equal(first.meta.totalPages, 2); assert.equal(first.data.length, 6);
  assert.deepEqual(first.data.map((row: { status: string }) => row.status), ['ongoing','ongoing','ongoing','upcoming','upcoming','upcoming']);
  assert(first.data.every((row: Record<string, unknown>) => !('content' in row)));
  const second = (await f.server.inject('/api/v1/promotions?page=2&limit=6')).json(); assert(second.data.every((row: { status: string }) => row.status === 'ended'));
  const draft = await f.server.inject({ method: 'POST', url: '/api/v1/admin/promotions', headers, payload: { ...payload('Draft'), isPublished: false } });
  assert.equal(draft.statusCode, 201); assert.equal((await f.server.inject(`/api/v1/promotions/${draft.json().id}`)).statusCode, 404);
  assert.equal((await f.server.inject({ url: '/api/v1/admin/promotions?search=Draft', headers })).json().meta.total, 1);
});
test('A single pointer replaces the previous ad; stale disable cannot clear another ad', async () => {
  const a = await create('Ad A'), b = await create('Ad B', 1, 3);
  assert.equal((await toggle(a.id, true)).statusCode, 200);
  assert.equal((await toggle(b.id, true)).statusCode, 200);
  const current = (await f.server.inject('/api/v1/promotions/popup')).json(); assert.equal(current.id, b.id); assert.equal(current.status, 'upcoming');
  await toggle(a.id, false); assert.equal((await f.server.inject('/api/v1/promotions/popup')).json().id, b.id);
  const all = (await f.server.inject({ url: '/api/v1/admin/promotions?limit=100', headers })).json(); assert.equal(all.data.filter((row: { popupEnabled: boolean }) => row.popupEnabled).length, 1);
  await toggle(b.id, false); assert.equal((await f.server.inject('/api/v1/promotions/popup')).json(), null);
});
test('Concurrent selections still leave exactly one selected image', async () => {
  const a = await create('Concurrent A'), b = await create('Concurrent B');
  const responses = await Promise.all([toggle(a.id, true), toggle(b.id, true)]);
  assert(responses.every(response => response.statusCode === 200));
  const [selected] = await f.db.select().from(promotionPopup); assert([a.id, b.id].includes(selected.promotionId));
  const all = (await f.server.inject({ url: '/api/v1/admin/promotions?limit=100', headers })).json(); assert.equal(all.data.filter((row: { popupEnabled: boolean }) => row.popupEnabled).length, 1);
});
test('The selected image stops automatically at expiration and cannot be enabled again', async () => {
  const row = await create('Expires'); await toggle(row.id, true);
  await f.db.update(promotions).set({ startsAt: iso(-2), endsAt: iso(-1) }).where(eq(promotions.id, row.id));
  assert.equal((await f.server.inject('/api/v1/promotions/popup')).json(), null); assert.equal((await toggle(row.id, true)).statusCode, 400);
  const ended = (await f.server.inject({ url: `/api/v1/admin/promotions/${row.id}`, headers })).json(); assert.equal(ended.status, 'ended'); assert.equal(ended.popupEnabled, false);
});
test('Editing times changes status; unpublishing and deleting clear ads', async () => {
  const row = await create('Editable'); await toggle(row.id, true);
  let response = await f.server.inject({ method: 'PATCH', url: `/api/v1/admin/promotions/${row.id}`, headers, payload: { startsAt: iso(1), endsAt: iso(2) } });
  assert.equal(response.statusCode, 200); assert.equal(response.json().status, 'upcoming');
  response = await f.server.inject({ method: 'PATCH', url: `/api/v1/admin/promotions/${row.id}`, headers, payload: { isPublished: false } });
  assert.equal(response.statusCode, 200); assert.equal((await f.server.inject('/api/v1/promotions/popup')).json(), null);
  await f.server.inject({ method: 'PATCH', url: `/api/v1/admin/promotions/${row.id}`, headers, payload: { isPublished: true, popupEnabled: true } });
  assert.equal((await f.server.inject('/api/v1/promotions/popup')).json().id, row.id);
  assert.equal((await f.server.inject({ method: 'DELETE', url: `/api/v1/admin/promotions/${row.id}`, headers })).statusCode, 204);
  assert.equal((await f.server.inject('/api/v1/promotions/popup')).json(), null);
  assert.equal((await f.server.inject({ url: `/api/v1/admin/promotions/${row.id}`, headers })).statusCode, 404);
});
