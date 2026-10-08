import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Global, Module, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema/index.js';
import { DatabaseService } from '../src/database/database.service.js';
import { seedCarRecommendations } from '../src/database/seed/car-recommendations.js';
import { CarRecommendationsModule } from '../src/modules/car-recommendations/module.js';
import { DEFAULT_RECOMMENDATION_CONFIG } from '../src/modules/car-recommendations/defaults.js';
import { RecommendationReporting } from '../src/modules/car-recommendations/reporting.js';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard.js';
import { JwtVerifierService } from '../src/modules/auth/jwt-verifier.service.js';
import { PermissionsGuard } from '../src/modules/auth/permissions.guard.js';
import { AdminAccessService } from '../src/modules/auth/admin-access.service.js';

test('recommendation admin: actual PostgreSQL aggregates, guards and atomic edits', async t => {
  const pg = new PGlite(); let app: NestFastifyApplication | undefined;
  try {
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    for (const file of (await readdir('drizzle')).filter(f => f.endsWith('.sql')).sort()) await pg.exec((await readFile(`drizzle/${file}`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema }) as unknown as DatabaseService['db'];
    const [actor] = await db.insert(schema.profiles).values({ authUserId: randomUUID(), fullName: 'Isolated admin' }).returning();
    const [brand] = await db.insert(schema.brands).values({ name: 'Toyota original', slug: 'toyota' }).returning();
    const [model] = await db.insert(schema.carModels).values({ brandId: brand.id, name: 'Vios', slug: 'vios' }).returning();
    const cars = await db.insert(schema.cars).values([300000000, 400000000].map((price, i) => ({ brandId: brand.id, modelId: model.id, name: `Fixture ${i}`, slug: `fixture-${i}`, price, year: 2023, seatCount: 5, status: 'active' as const, publishedAt: new Date() }))).returning();
    await seedCarRecommendations(db);
    @Global() @Module({ imports: [CarRecommendationsModule], providers: [
      { provide: DatabaseService, useValue: { db } },
      { provide: JwtVerifierService, useValue: { verify: async (token: string) => { if (!['admin', 'reader', 'denied'].includes(token)) throw new UnauthorizedException(); return { id: token }; } } },
      { provide: AdminAccessService, useValue: { forAuthUser: async (id: string) => ({ profile: actor, roles: ['ADMIN'], permissions: id === 'admin' ? ['car_recommendation.sessions.read', 'car_recommendation.settings.update', 'car_recommendation.profiles.update'] : id === 'reader' ? ['car_recommendation.sessions.read'] : [] }) } },
      { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
    ], exports: [DatabaseService] }) class FixtureModule {}
    app = await NestFactory.create<NestFastifyApplication>(FixtureModule, new FastifyAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    const server = app.getHttpAdapter().getInstance(), base = 'admin/car-recommendations';
    const send = (method: 'GET' | 'PUT' | 'POST', path: string, payload?: object, token = 'admin') => server.inject({ method, url: `/api/v1/${path}`, ...(payload ? { payload } : {}), headers: token ? { authorization: `Bearer ${token}` } : {} });
    const answers = { purposes: ['family', 'travel'], budget: { min: 200000000, max: 500000000 }, passengers: '3_5', requireSeats: true, environment: 'city', priorities: ['space', 'safety'], technical: { brand: 'toyota', required: [] } };
    const input = { requestId: randomUUID(), capability: 'x'.repeat(43), noticeAccepted: true, completionMs: 1000, answers };
    const submit = async (max = 500000000) => { const response = await send('POST', 'car-recommendations/sessions', { ...input, requestId: randomUUID(), answers: { ...answers, budget: { min: 0, max } } }, ''); assert.equal(response.statusCode, 200, response.body); return response.json().sessionId as string; };
    const ids = [await submit(), await submit(), await submit(50000000), await submit()];
    // Exact business-day boundaries: three inside, one one millisecond before.
    for (const [i, at] of ['2026-10-06T17:00:00.000Z', '2026-10-07T16:59:59.999Z', '2026-10-07T17:00:00.000Z', '2026-10-06T16:59:59.999Z'].entries()) await db.update(schema.recommendationSessions).set({ createdAt: new Date(at) }).where(eq(schema.recommendationSessions.id, ids[i]));
    for (const [id, types] of [[ids[0], ['result_viewed', 'car_clicked', 'contact_clicked']], [ids[1], ['result_viewed']], [ids[3], ['result_viewed']]] as const) for (const type of types) {
      const response = await send('POST', `car-recommendations/sessions/${id}/events`, { capability: input.capability, type, ...(type === 'car_clicked' ? { carId: cars[0].id } : {}) }, ''); assert.equal(response.statusCode, 200);
    }
    await send('POST', `car-recommendations/sessions/${ids[0]}/events`, { capability: input.capability, type: 'car_clicked', carId: cars[1].id }, '');
    await send('POST', `car-recommendations/sessions/${ids[0]}/events`, { capability: input.capability, type: 'contact_clicked', carId: cars[0].id }, '');
    const dates = 'from=2026-10-07&to=2026-10-09';
    await t.test('all admin reads/writes enforce backend permissions', async () => {
      for (const path of ['overview', 'settings', 'sessions', `sessions/${ids[0]}`, 'car-profiles', `car-profiles/${cars[0].id}`]) {
        assert.equal((await send('GET', `${base}/${path}`, undefined, '')).statusCode, 401);
        assert.equal((await send('GET', `${base}/${path}`, undefined, 'denied')).statusCode, 403);
        assert.equal((await send('GET', `${base}/${path}`, undefined, 'reader')).statusCode, 200);
      }
      assert.equal((await send('PUT', `${base}/settings`, {}, 'reader')).statusCode, 403);
      assert.equal((await send('PUT', `${base}/car-profiles/${cars[0].id}`, {}, 'reader')).statusCode, 403);
      assert.equal((await send('PUT', `${base}/car-profiles/batch`, {}, 'reader')).statusCode, 403);
      assert.equal((await send('POST', `${base}/preview`, {}, 'denied')).statusCode, 403);
      await pg.exec('SET ROLE anon;'); try { await assert.rejects(() => pg.query('SELECT * FROM recommendation_sessions')); } finally { await pg.exec('RESET ROLE;'); }
    });
    await t.test('aggregate matches raw fixtures, distinct session denominators, timezone and zero days', async () => {
      try { await app!.get(RecommendationReporting).overview({ from: '2026-10-07', to: '2026-10-09' }); } catch (failure) { throw (failure as Error & { cause: Error }).cause || failure; }
      const response = await send('GET', `${base}/overview?${dates}`); assert.equal(response.statusCode, 200, response.body);
      const d = response.json(); assert.equal(d.total, 3); assert.equal(d.empty, 1); assert.equal(d.viewed, 2); assert.equal(d.carClicked, 1); assert.equal(d.contactClicked, 1); assert.equal(d.eventCount, 6);
      assert.deepEqual(d.rates, { viewed: 66.7, carClicked: 33.3, contactClicked: 33.3, empty: 33.3 });
      assert.deepEqual(d.trend, [{ day: '2026-10-07', count: 2, unmet: 0 }, { day: '2026-10-08', count: 1, unmet: 1 }, { day: '2026-10-09', count: 0, unmet: 0 }]);
      assert.equal(d.distributions.find((r: { field: string; key: string }) => r.field === 'purposes' && r.key === 'family').count, 3);
      assert.equal(d.budgets.find((r: { key: string }) => r.key === 'under300').unmet, 1);
      assert.ok(d.topCars.every((r: { recommendations: number; clicks: number; clickRate: number }) => r.recommendations === 2 && r.clicks === 1 && r.clickRate === 50));
      const raw = await pg.query<{ n: number }>("SELECT count(*)::int n FROM recommendation_sessions WHERE created_at >= '2026-10-06 17:00:00+00' AND created_at < '2026-10-09 17:00:00+00'"); assert.equal(d.total, raw.rows[0].n);
      const zero = (await send('GET', `${base}/overview?from=2025-01-01&to=2025-01-02`)).json(); assert.equal(zero.total, 0); assert.equal(zero.rates.carClicked, 0); assert.equal(zero.trend.length, 2); assert.deepEqual(zero.topCars, []);
    });
    await t.test('validated date/filter bounds, server pagination and safe literal queries', async () => {
      for (const query of ['from=2026-02-30', 'from=2027-01-01&to=2026-01-01', 'from=2024-01-01&to=2026-01-01', 'limit=101', 'priority=hack', 'minBudget=600000000&maxBudget=500000000', 'search=%27%20OR%201=1']) assert.equal((await send('GET', `${base}/sessions?${query}`)).statusCode, 400, query);
      const list = await send('GET', `${base}/sessions?${dates}&page=1&limit=1`); assert.equal(list.statusCode, 200); assert.equal(list.json().data.length, 1); assert.equal(list.json().meta.total, 3); assert.equal(list.json().data[0].capabilityHash, undefined); assert.equal(list.json().data[0].snapshot, undefined);
      for (const [filter, total] of [['resultCount=0', 1], ['interaction=car_clicked', 1], ['interaction=none', 1], ['priority=space&purpose=family&passengers=3_5', 3], ['minBudget=300000000', 2], [`search=${ids[0].slice(0, 8)}`, 1]] as const) assert.equal((await send('GET', `${base}/sessions?${dates}&${filter}`)).json().meta.total, total, filter);
      assert.equal((await send('GET', `${base}/sessions?${dates}&page=4&limit=1`)).json().data.length, 0);
    });
    await t.test('singleton saves atomically, preserves historical wording and detects stale client/admin edits', async () => {
      const before = (await send('GET', `${base}/sessions/${ids[0]}`)).json(), settings = (await send('GET', `${base}/settings`)).json();
      const changed = structuredClone(DEFAULT_RECOMMENDATION_CONFIG); changed.questions[0].title = 'Mục đích đã thay đổi'; changed.questions[0].options.find(o => o.key === 'family')!.label = 'Gia đình mới'; changed.weights.budget += 5; changed.weights.purposes -= 5;
      const payload = { expectedUpdatedAt: settings.updatedAt, enabled: true, retentionDays: 180, config: changed };
      const responses = await Promise.all([send('PUT', `${base}/settings`, payload), send('PUT', `${base}/settings`, payload)]); assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 409]);
      assert.equal((await db.select().from(schema.recommendationSettings)).length, 1);
      assert.deepEqual((await send('GET', `${base}/sessions/${ids[0]}`)).json().snapshot, before.snapshot);
      assert.equal((await send('GET', 'car-recommendations/config', undefined, '')).json().questions[0].title, changed.questions[0].title);
      const id = await submit(); assert.equal((await send('GET', `${base}/sessions/${id}`)).json().snapshot.questions[0].title, changed.questions[0].title);
      assert.equal((await send('POST', 'car-recommendations/sessions', { ...input, requestId: randomUUID(), configUpdatedAt: settings.updatedAt }, '')).statusCode, 409);
      const current = (await send('GET', `${base}/settings`)).json();
      const invalid = structuredClone(changed); invalid.questions[0].options[0].key = 'deleted_scoring_key'; assert.equal((await send('PUT', `${base}/settings`, { ...payload, expectedUpdatedAt: current.updatedAt, config: invalid })).statusCode, 400);
      invalid.questions = changed.questions; invalid.weights.budget++; assert.equal((await send('PUT', `${base}/settings`, { ...payload, expectedUpdatedAt: current.updatedAt, config: invalid })).statusCode, 400);
      assert.equal((await db.select().from(schema.auditLogs)).length, 1);
    });
    await t.test('sourced assessments alter scoring; profile unknown, catalog/filter/audit and concurrent writes', async () => {
      const assessments = { 'purposes.family': { score: 5, source: 'Synthetic inspection fixture only' }, 'priorities.space': { score: 5, source: 'Synthetic measurements fixture only' } };
      for (const invalid of [{ 'priorities.safety': { score: 5, source: '' } }, { 'made_up': { score: 5, source: 'source' } }, { 'priorities.space': { score: 6, source: 'source' } }, { 'priorities.space': { score: 4, source: 'source', fake: true } }]) assert.equal((await send('PUT', `${base}/car-profiles/${cars[1].id}`, { expectedUpdatedAt: null, assessments: invalid })).statusCode, 400);
      const responses = await Promise.all([send('PUT', `${base}/car-profiles/${cars[1].id}`, { expectedUpdatedAt: null, assessments }), send('PUT', `${base}/car-profiles/${cars[1].id}`, { expectedUpdatedAt: null, assessments })]); assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 409]);
      const list = (await send('GET', `${base}/car-profiles?missing=true&brandId=${brand.id}&modelId=${model.id}&status=active`)).json(); assert.equal(list.meta.total, 2); assert.equal(list.data.find((r: { id: string }) => r.id === cars[1].id).knownCount, 2);
      assert.equal((await send('GET', `${base}/car-profiles?missing=false`)).json().meta.total, 0);
      assert.equal((await send('GET', `${base}/car-profiles?search=%25`)).json().meta.total, 0, 'LIKE wildcards are escaped');
      const id = await submit(), detail = (await send('GET', `${base}/sessions/${id}`)).json(); assert.equal(detail.snapshot.results[0].car.id, cars[1].id);
      assert.equal(detail.snapshot.technicalOptions.brand[0].label, 'Toyota original');
      await db.update(schema.brands).set({ name: 'Renamed brand' }).where(eq(schema.brands.id, brand.id)); assert.equal((await send('GET', `${base}/sessions/${id}`)).json().snapshot.technicalOptions.brand[0].label, 'Toyota original');
      const profile = (await send('GET', `${base}/car-profiles/${cars[1].id}`)).json(); assert.equal(profile.updatedBy, actor.id);
      assert.equal((await db.select().from(schema.auditLogs)).length, 2);
    });
    await t.test('bulk edits merge chosen criteria and roll back every row on stale/missing car', async () => {
      const old = (await send('GET', `${base}/car-profiles/${cars[1].id}`)).json();
      const assessment = { 'environment.city': { score: 4, source: 'Isolated road test fixture' } }, item = (carId: string, expectedUpdatedAt: string | null) => ({ carId, expectedUpdatedAt, assessments: assessment, merge: true });
      const good = await send('PUT', `${base}/car-profiles/batch`, { items: [item(cars[0].id, null), item(cars[1].id, old.updatedAt)] }); assert.equal(good.statusCode, 200, good.body);
      const latest = (await send('GET', `${base}/car-profiles/${cars[1].id}`)).json(); assert.equal(Object.keys(latest.assessments).length, 3);
      const first = (await send('GET', `${base}/car-profiles/${cars[0].id}`)).json();
      assert.equal((await send('PUT', `${base}/car-profiles/batch`, { items: [item(cars[0].id, first.updatedAt), item(cars[1].id, old.updatedAt)] })).statusCode, 409);
      assert.deepEqual((await send('GET', `${base}/car-profiles/${cars[0].id}`)).json(), first);
      assert.equal((await send('PUT', `${base}/car-profiles/batch`, { items: [item(cars[0].id, first.updatedAt), item(randomUUID(), null)] })).statusCode, 404);
      assert.equal((await send('PUT', `${base}/car-profiles/batch`, { items: [item(cars[0].id, first.updatedAt), item(cars[0].id, first.updatedAt)] })).statusCode, 400);
      assert.equal((await send('PUT', `${base}/car-profiles/batch`, { items: Array.from({ length: 51 }, () => item(randomUUID(), null)) })).statusCode, 400);
    });
    await t.test('preview never saves sessions; current stock differs from preserved recommendation', async () => {
      const count = (await db.select().from(schema.recommendationSessions)).length;
      const preview = await send('POST', `${base}/preview`, { config: DEFAULT_RECOMMENDATION_CONFIG, answers }, 'reader'); assert.equal(preview.statusCode, 200, preview.body); assert.equal(preview.json().saved, false); assert.ok(preview.json().results[0].components.length); assert.equal((await db.select().from(schema.recommendationSessions)).length, count);
      const before = (await send('GET', `${base}/sessions/${ids[0]}`)).json(); await db.update(schema.cars).set({ status: 'sold', price: 123000000 }).where(eq(schema.cars.id, cars[0].id));
      const after = (await send('GET', `${base}/sessions/${ids[0]}`)).json(); assert.deepEqual(after.snapshot, before.snapshot); assert.equal(after.currentCars.find((c: { id: string }) => c.id === cars[0].id).isAvailable, false);
      assert.equal((await send('GET', `${base}/overview?${dates}`)).json().topCars.find((c: { car_id: string }) => c.car_id === cars[0].id).status, 'sold');
      await db.update(schema.cars).set({ deletedAt: new Date() }).where(eq(schema.cars.id, cars[0].id)); assert.equal((await send('GET', `${base}/car-profiles/${cars[0].id}`)).statusCode, 404);
    });
  } finally { if (app) await app.close(); await pg.close(); }
});
