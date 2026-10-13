import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { ownershipFixture } from './fixtures/ownership.js';
import { cars, ownershipSettings, ownershipSurveys } from '../src/database/schema/index.js';
import { DEFAULT_POLICY, DEFAULT_SETTINGS } from '../src/modules/ownership/defaults.js';
import { OwnershipService, OwnershipCache } from '../src/modules/ownership/service.js';
test('ownership API and admin with additive migrations in isolated PostgreSQL', async t => {
  const f = await ownershipFixture(); let ip = 1;
  const send = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, payload?: object, token?: string, address?: string) => f.server.inject({ method, url: `/api/v1/${path}`, ...(payload ? { payload } : {}), headers: token ? { authorization: `Bearer ${token}` } : {}, remoteAddress: address || `192.0.2.${ip++}` });
  const path = `cars/${f.car.id}/ownership-calculate`;
  const input = { interactionId: randomUUID(), requestId: randomUUID(), capability: 'a'.repeat(48), expectedRevision: 0, answers: structuredClone(DEFAULT_SETTINGS.defaults) };
  let revision = 0, surveyId = '';
  try {
    await t.test('public config whitelist, disabled handling, no direct anon DB access', async () => {
      const response = await send('GET', `cars/${f.car.id}/ownership-config`); assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().vehicle.id, f.car.id); assert.equal(response.json().vehicle.price, f.car.price); assert.equal(response.json().fees, undefined); assert.equal(response.json().vehicle.licensePlate, undefined);
      assert.equal(response.json().defaults.energyPrice, 24000); assert.equal((await send('GET', `cars/${f.hidden.id}/ownership-config`)).statusCode, 404);
      await f.db.update(cars).set({ price: 0 }).where(eq(cars.id, f.car.id));
      assert.equal((await send('GET', `cars/${f.car.id}/ownership-config`)).statusCode, 400, 'Missing essential price stops survey before three steps');
      await f.db.update(cars).set({ price: f.car.price }).where(eq(cars.id, f.car.id));
      await f.pg.exec('SET ROLE anon'); try { await assert.rejects(() => f.pg.query('SELECT * FROM vehicle_ownership_surveys')); } finally { await f.pg.exec('RESET ROLE'); }
    });
    await t.test('bad DTO/nested input and spoofed vehicle parameters create no records', async () => {
      for (const patch of [{ price: 1 }, { answers: { ...input.answers, phone: '0900000000' } }, { answers: { ...input.answers, monthlyKm: -1 } }, { answers: { ...input.answers, energyPrice: 0 } }, { capability: 'bad' }, { expectedRevision: 1 }]) {
        const response = await send('POST', path, { ...input, ...patch }); assert.ok([400, 409].includes(response.statusCode), response.body);
      }
      assert.equal((await f.db.select().from(ownershipSurveys)).length, 0);
    });
    await t.test('concurrent retries persist one anonymous record', async () => {
      const responses = await Promise.all([send('POST', path, input), send('POST', path, input)]); assert.ok(responses.every(r => r.statusCode === 200), responses.map(r => r.body).join('\n'));
      const output = responses[0].json(); surveyId = output.surveyId; revision = output.revision; assert.equal(responses[1].json().surveyId, surveyId);
      const rows = await f.db.select().from(ownershipSurveys); assert.equal(rows.length, 1); assert.notEqual(rows[0].capabilityHash, input.capability); assert.equal(JSON.stringify(rows[0]).includes(input.capability), false);
      assert.equal(output.result.breakdown.reduce((sum: number, row: { monthly: number }) => sum + row.monthly, 0), output.result.operatingMonthly);
    });
    await t.test('edit capability/revision bound to car, expired/guessed token rejected', async () => {
      const edited = { ...input, requestId: randomUUID(), expectedRevision: revision, answers: { ...input.answers, monthlyKm: 1600 } };
      assert.equal((await send('POST', path, { ...edited, capability: 'b'.repeat(48) })).statusCode, 404);
      assert.equal((await send('POST', `cars/${f.hidden.id}/ownership-calculate`, edited)).statusCode, 404);
      const success = await send('POST', path, edited); assert.equal(success.statusCode, 200, success.body); revision = success.json().revision;
      assert.equal((await f.db.select().from(ownershipSurveys)).length, 1); assert.equal(success.json().surveyId, surveyId);
      const stale = await send('POST', path, { ...input, requestId: randomUUID(), expectedRevision: 1 }); assert.equal(stale.statusCode, 409); assert.equal(stale.json().details.revision, revision, 'Production filter preserves revision recovery details');
      const [saved] = await f.db.select().from(ownershipSurveys); assert.equal(saved.monthlyKm, 1600);
      await f.db.update(ownershipSurveys).set({ expiresAt: new Date(0) }).where(eq(ownershipSurveys.id, surveyId));
      assert.equal((await send('POST', path, { ...edited, expectedRevision: revision, requestId: randomUUID() })).statusCode, 404);
      await f.db.update(ownershipSurveys).set({ expiresAt: new Date(Date.now() + 3600000) }).where(eq(ownershipSurveys.id, surveyId));
    });
    await t.test('new deliberate survey creates a new record; authoritative price always fresh', async () => {
      await f.db.update(cars).set({ price: 450000000 }).where(eq(cars.id, f.car.id));
      assert.equal((await send('GET', `cars/${f.car.id}/ownership-config`)).json().vehicle.price, 450000000);
      const response = await send('POST', path, { ...input, interactionId: randomUUID(), requestId: randomUUID() }); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().result.vehicle.price, 450000000);
      assert.equal((await f.db.select().from(ownershipSurveys)).length, 2);
    });
    await t.test('admin authentication and dedicated read/write permissions', async () => {
      assert.equal((await send('GET', 'admin/ownership/settings')).statusCode, 401);
      assert.equal((await send('GET', 'admin/ownership/settings', undefined, 'other')).statusCode, 403);
      assert.equal((await send('GET', 'admin/ownership/settings', undefined, 'ownership-reader')).statusCode, 200);
      assert.equal((await send('PATCH', 'admin/ownership/settings', { enabled: true, config: DEFAULT_SETTINGS, updatedAt: new Date().toISOString() }, 'ownership-reader')).statusCode, 403);
    });
    await t.test('validated settings and profile writes invalidate caches; stale edits conflict', async () => {
      const old = (await send('GET', 'admin/ownership/settings', undefined, 'ownership-admin')).json();
      const c = structuredClone(DEFAULT_SETTINGS); c.energyPrices.gasoline = 26000; c.policy.consumption.gasoline = 9;
      const bad = structuredClone(c); bad.policy.maintenancePerKm = -1;
      assert.equal((await send('PATCH', 'admin/ownership/settings', { config: bad, enabled: true, updatedAt: old.updatedAt }, 'ownership-admin')).statusCode, 400);
      const save = await send('PATCH', 'admin/ownership/settings', { config: c, enabled: true, updatedAt: old.updatedAt }, 'ownership-admin'); assert.equal(save.statusCode, 200, save.body);
      assert.equal((await send('GET', `cars/${f.car.id}/ownership-config`)).json().defaults.energyPrice, 26000);
      assert.equal((await send('PATCH', 'admin/ownership/settings', { config: c, enabled: true, updatedAt: old.updatedAt }, 'ownership-admin')).statusCode, 409);
      const id = randomUUID(), p = { scope: 'car', target: f.car.id, name: 'Xe này', policy: { ...DEFAULT_POLICY, consumption: { gasoline: 6, diesel: 7, electric: 16 } } };
      assert.equal((await send('PUT', `admin/ownership/profiles/${id}`, p, 'ownership-admin')).statusCode, 200);
      assert.equal((await send('GET', `cars/${f.car.id}/ownership-config`)).json().consumption, 6);
      assert.equal((await send('DELETE', `admin/ownership/profiles/${id}`, undefined, 'ownership-admin')).statusCode, 200);
      assert.equal((await send('GET', `cars/${f.car.id}/ownership-config`)).json().consumption, 9);
    });
    await t.test('server pagination, filters, compact detail and range-bounded SQL stats', async () => {
      const page = await send('GET', 'admin/ownership/surveys?limit=1&page=2', undefined, 'ownership-admin'); assert.equal(page.statusCode, 200, page.body); assert.equal(page.json().data.length, 1); assert.equal(page.json().meta.total, 2);
      assert.equal((await send('GET', 'admin/ownership/surveys?finance=loan', undefined, 'ownership-admin')).json().meta.total, 0);
      assert.equal((await send('GET', `admin/ownership/surveys?vehicleId=${f.hidden.id}`, undefined, 'ownership-admin')).json().meta.total, 0);
      const detail = (await send('GET', `admin/ownership/surveys/${surveyId}`, undefined, 'ownership-admin')).json(); assert.equal(detail.capabilityHash, undefined); assert.equal(detail.monthlyKm, 1600);
      const summary = await send('GET', 'admin/ownership/summary', undefined, 'ownership-admin'); assert.equal(summary.statusCode, 200, summary.body); assert.equal(summary.json().total, 2); assert.equal(summary.json().averageKm, 1300); assert.equal(summary.json().topCars[0].total, 2);
      assert.equal((await send('GET', 'admin/ownership/summary?from=2024-01-01&to=2026-01-01', undefined, 'ownership-admin')).statusCode, 400);
      assert.equal((await send('GET', 'admin/ownership/summary?from=2026-02-31', undefined, 'ownership-admin')).statusCode, 400);
    });
    await t.test('public request size, rate limit and disabled calculation', async () => {
      assert.equal((await send('POST', path, { ...input, extra: 'x'.repeat(9000) })).statusCode, 413);
      const codes = []; for (let i = 0; i < 16; i++) codes.push((await send('POST', path, input, undefined, '198.51.100.250')).statusCode); assert.equal(codes.at(-1), 429);
      await f.db.update(ownershipSettings).set({ enabled: false }); f.app.get(OwnershipService).cache.clear();
      assert.equal((await send('GET', `cars/${f.car.id}/ownership-config`)).json().enabled, false); assert.equal((await send('POST', path, input)).statusCode, 503);
    });
  } finally { await f.close(); }
});
test('cache invalidation cannot repopulate from detached pending reads', async () => {
  const cache = new OwnershipCache(); let resolve!: (n: number) => void;
  const old = cache.get('a', () => new Promise<number>(r => { resolve = r; })); await Promise.resolve(); cache.clear();
  assert.equal(await cache.get('a', async () => 2), 2); resolve(1); assert.equal(await old, 1); assert.equal(await cache.get('a', async () => 3), 2);
});
