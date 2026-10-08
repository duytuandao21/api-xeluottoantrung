import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Global, Module, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema/index.js';
import { DatabaseService } from '../src/database/database.service.js';
import { seedCarRecommendations } from '../src/database/seed/car-recommendations.js';
import { CarRecommendationsModule } from '../src/modules/car-recommendations/module.js';
import { DEFAULT_RECOMMENDATION_CONFIG } from '../src/modules/car-recommendations/defaults.js';
import { RecommendationService } from '../src/modules/car-recommendations/service.js';
import { pruneRecommendationSessions } from '../src/modules/car-recommendations/retention.js';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard.js';
import { JwtVerifierService } from '../src/modules/auth/jwt-verifier.service.js';
import { PermissionsGuard } from '../src/modules/auth/permissions.guard.js';
import { AdminAccessService } from '../src/modules/auth/admin-access.service.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import { PinoLoggerService } from '../src/common/logging/pino-logger.service.js';
test('car recommendations API, real migrations and isolated PostgreSQL', async t => {
  const pg = new PGlite(); let app: NestFastifyApplication | undefined;
  try {
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    for (const file of (await readdir('drizzle')).filter(file => file.endsWith('.sql')).sort()) await pg.exec((await readFile(`drizzle/${file}`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema }) as unknown as DatabaseService['db'];
    const [profile] = await db.insert(schema.profiles).values({ authUserId: randomUUID(), fullName: 'Recommendation fixture admin' }).returning();
    const [brand] = await db.insert(schema.brands).values({ name: 'Toyota', slug: 'toyota' }).returning();
    const [model] = await db.insert(schema.carModels).values({ brandId: brand.id, name: 'Vios', slug: 'vios' }).returning();
    const baseCar = { brandId: brand.id, modelId: model.id, year: 2023, price: 300000000, seatCount: 5, mileage: 40000, fuel: 'Xăng', publishedAt: new Date(), status: 'active' as const };
    const inserted = await db.insert(schema.cars).values([
      { ...baseCar, name: 'Xe A', slug: 'xe-a' }, { ...baseCar, name: 'Xe B', slug: 'xe-b', price: 400000000 },
      { ...baseCar, name: 'Đã bán', slug: 'sold', status: 'sold' }, { ...baseCar, name: 'Đã cọc', slug: 'deposit', status: 'deposit' },
      { ...baseCar, name: 'Chưa công khai', slug: 'unpublished', publishedAt: null }, { ...baseCar, name: 'Giá chưa rõ', slug: 'unpriced', price: 0 },
      { ...baseCar, name: 'Thiếu số ghế', slug: 'missing-seats', seatCount: null }, { ...baseCar, name: 'Vượt ngân sách', slug: 'over-budget', price: 800000000 },
      { ...baseCar, name: 'Đã xóa', slug: 'deleted', deletedAt: new Date() },
    ]).returning();
    await seedCarRecommendations(db); await seedCarRecommendations(db);
    @Global() @Module({ imports: [CarRecommendationsModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 200 }])], providers: [
      { provide: DatabaseService, useValue: { db } },
      { provide: JwtVerifierService, useValue: { verify: async (token: string) => { if (!['admin', 'reader'].includes(token)) throw new UnauthorizedException(); return { id: token }; } } },
      { provide: AdminAccessService, useValue: { forAuthUser: async (id: string) => ({ profile, roles: ['ADMIN'], permissions: id === 'admin' ? ['car_recommendation.sessions.read'] : ['car.read'] }) } },
      { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard }, { provide: APP_GUARD, useClass: ThrottlerGuard },
    ], exports: [DatabaseService] }) class TestModule {}
    app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    const logger = new PinoLoggerService(), logs: unknown[] = []; logger.instance.error = ((entry: unknown) => { logs.push(entry); }) as typeof logger.instance.error;
    app.useGlobalFilters(new ApiExceptionFilter(logger)); await app.init(); await app.getHttpAdapter().getInstance().ready();
    const server = app.getHttpAdapter().getInstance(); let ip = 1;
    const send = (method: 'GET' | 'POST', path: string, payload?: object, token?: string, address?: string) => server.inject({ method, url: `/api/v1/${path}`, ...(payload ? { payload } : {}), headers: token ? { authorization: `Bearer ${token}` } : {}, remoteAddress: address || `192.0.2.${ip++}` });
    const input = { requestId: randomUUID(), capability: 'a'.repeat(43), noticeAccepted: true, completionMs: 90000, answers: { purposes: ['family'], budget: { min: 200000000, max: 500000000 }, passengers: '3_5', requireSeats: true, environment: 'city', priorities: ['safety', 'space'], technical: { required: [] } } };
    let result: { sessionId: string; results: { car: { id: string; slug: string }; score: number }[]; unavailableCarIds: string[] };
    await t.test('singleton seed, public safe config, no direct anon DB reads', async () => {
      const oldConfig = { ...DEFAULT_RECOMMENDATION_CONFIG, maxResults: 5 };
      await db.update(schema.recommendationSettings).set({ config: oldConfig, updatedAt: new Date('2026-01-01') });
      await pg.exec((await readFile('drizzle/0016_peaceful_iron_lad.sql', 'utf8')).replaceAll('--> statement-breakpoint', ''));
      const [upgraded] = await db.select().from(schema.recommendationSettings);
      assert.deepEqual(upgraded.config, { ...oldConfig, maxResults: 5000 });
      assert.ok(upgraded.updatedAt.getTime() > new Date('2026-01-01').getTime());
      assert.equal((await db.select().from(schema.recommendationSettings)).length, 1);
      assert.equal((await db.select().from(schema.carRecommendationProfiles)).length, 0);
      const response = await send('GET', 'car-recommendations/config'); assert.equal(response.statusCode, 200);
      assert.equal(response.json().questions.length, 7); assert.equal(response.json().weights, undefined); assert.equal(response.json().technicalOptions.fuel[0].key, 'Xăng');
      await assert.rejects(() => db.insert(schema.recommendationSettings).values({ id: 2, config: DEFAULT_RECOMMENDATION_CONFIG }));
      await pg.exec('SET ROLE anon;');
      try { await assert.rejects(() => pg.query('SELECT * FROM recommendation_sessions')); } finally { await pg.exec('RESET ROLE;'); }
    });
    await t.test('strict DTO input/notice validation and no PII', async () => {
      for (const bad of [{ noticeAccepted: false }, { phone: '0901234567' }, { capability: 'bad' }, { answers: { ...input.answers, budget: { min: 900000000, max: 500000000 } } }, { answers: { ...input.answers, priorities: ['safety', 'safety'] } }, { answers: { ...input.answers, extras: { phone: '0901234567' } } }, { answers: { ...input.answers, technical: { brand: 'not-a-brand' } } }]) {
        const response = await send('POST', 'car-recommendations/sessions', { ...input, ...bad }); assert.equal(response.statusCode, 400, response.body);
      }
      assert.equal((await db.select().from(schema.recommendationSessions)).length, 0);
    });
    await t.test('atomic persistence, concurrent retry dedupe and hard inventory filtering', async () => {
      const responses = await Promise.all([send('POST', 'car-recommendations/sessions', input), send('POST', 'car-recommendations/sessions', input)]);
      assert.ok(responses.every(r => r.statusCode === 200), responses.map(r => r.body).join('\n')); result = responses[0].json();
      assert.equal(result!.sessionId, responses[1].json().sessionId); assert.deepEqual(result!.results.map(r => r.car.slug), ['xe-a', 'xe-b']);
      assert.equal((await db.select().from(schema.recommendationSessions)).length, 1);
      const stored = (await db.select().from(schema.recommendationSessions))[0]; assert.deepEqual(stored.answers, input.answers); assert.equal(stored.snapshot.questions.length, 7);
      assert.notEqual(stored.capabilityHash, input.capability); assert.equal(JSON.stringify(stored).includes(input.capability), false);
      assert.equal((await send('POST', 'car-recommendations/sessions', { ...input, answers: { ...input.answers, style: 'sporty' } })).statusCode, 409);
      assert.equal((await send('POST', 'car-recommendations/sessions', { ...input, capability: 'b'.repeat(43) })).statusCode, 409);
    });
    await t.test('capability events whitelist, server-owned car membership and dedupe', async () => {
      const path = `car-recommendations/sessions/${result!.sessionId}/events`;
      assert.equal((await send('POST', path, { capability: 'b'.repeat(43), type: 'result_viewed' })).statusCode, 404);
      assert.equal((await send('POST', path, { capability: input.capability, type: 'hack' })).statusCode, 400);
      assert.equal((await send('POST', path, { capability: input.capability, type: 'car_clicked', carId: inserted[2].id })).statusCode, 400);
      assert.equal((await send('POST', path, { capability: input.capability, type: 'car_clicked', carId: result!.results[0].car.id, score: 100 })).statusCode, 400);
      for (const type of ['result_viewed', 'contact_clicked', 'quiz_restarted', 'car_clicked']) {
        const payload = { capability: input.capability, type, ...(type === 'car_clicked' ? { carId: result!.results[0].car.id } : {}) };
        for (let i = 0; i < 2; i++) assert.equal((await send('POST', path, payload)).statusCode, 200);
      }
      assert.equal((await db.select().from(schema.recommendationEvents)).length, 4);
    });
    await t.test('admin history auth/pagination and immutable snapshot after config/inventory changes', async () => {
      const path = `admin/car-recommendations/sessions/${result!.sessionId}`;
      assert.equal((await send('GET', path)).statusCode, 401); assert.equal((await send('GET', path, undefined, 'reader')).statusCode, 403);
      assert.equal((await send('GET', `car-recommendations/sessions/${result!.sessionId}`)).statusCode, 404);
      const before = (await send('GET', path, undefined, 'admin')).json(); assert.equal(before.events.length, 4); assert.equal(before.capabilityHash, undefined);
      const changed = structuredClone(DEFAULT_RECOMMENDATION_CONFIG); changed.questions[0].title = 'Câu hỏi đã chỉnh';
      await db.update(schema.recommendationSettings).set({ config: changed });
      await db.update(schema.cars).set({ status: 'sold' }).where(eq(schema.cars.id, inserted[0].id));
      const resumed = await send('POST', `car-recommendations/sessions/${result!.sessionId}/resume`, { capability: input.capability }); assert.equal(resumed.statusCode, 200, resumed.body);
      assert.deepEqual(resumed.json().results.map((r: { car: { slug: string } }) => r.car.slug), ['xe-b']); assert.equal(resumed.json().unavailableCarIds.length, 1);
      assert.deepEqual((await send('GET', path, undefined, 'admin')).json().snapshot, before.snapshot);
      assert.equal((await send('GET', 'admin/car-recommendations/sessions?page=1&limit=1', undefined, 'admin')).json().meta.total, 1);
      assert.equal((await send('GET', 'admin/car-recommendations/sessions?limit=101', undefined, 'admin')).statusCode, 400);
      assert.equal((await send('GET', 'admin/car-recommendations/sessions?page=2&limit=1', undefined, 'admin')).json().data.length, 0);
    });
    await t.test('six per page, immutable cursor, authorization, stock revalidation and history above five', async () => {
      const extra = await db.insert(schema.cars).values(Array.from({ length: 13 }, (_, i) => ({ ...baseCar, name: `Pagination ${i}`, slug: `pagination-${i}`, price: 410000000 + i * 1000000 }))).returning();
      const payload = { ...input, requestId: randomUUID(), capability: 'c'.repeat(43) };
      let ownId: string | undefined;
      try {
        const response = await send('POST', 'car-recommendations/sessions', payload); assert.equal(response.statusCode, 200, response.body);
        const first = response.json(); ownId = first.sessionId;
        assert.equal(first.results.length, 6); assert.equal(first.totalAvailable, 14); assert.equal(first.nextOffset, 6); assert.equal(first.hasMore, true);
        const [stored] = await db.select().from(schema.recommendationSessions).where(eq(schema.recommendationSessions.id, ownId!));
        assert.equal(stored.resultCount, 14); assert.equal(stored.snapshot.results.length, 14);
        const path = `car-recommendations/sessions/${ownId}/results`, page = (offset: number) => send('POST', path, { capability: payload.capability, offset });
        assert.equal((await send('POST', path, { capability: input.capability, offset: 6 })).statusCode, 404);
        for (const offset of [-1, 0.5, 5001, '6']) assert.equal((await send('POST', path, { capability: payload.capability, offset })).statusCode, 400);
        const second = (await page(6)).json(), last = (await page(second.nextOffset)).json();
        assert.equal(second.results.length, 6); assert.equal(last.results.length, 2); assert.equal(last.hasMore, false);
        assert.deepEqual((await page(6)).json(), second, 'Retry returns the same page');
        assert.deepEqual([...first.results, ...second.results, ...last.results].map(item => item.car.id), stored.snapshot.results.map(item => item.car.id));
        assert.equal((await send('GET', 'admin/car-recommendations/sessions?resultCount=14', undefined, 'admin')).json().meta.total, 1);
        // Remove an earlier result and change a future price without moving the snapshot cursor.
        await db.update(schema.cars).set({ status: 'sold' }).where(eq(schema.cars.id, first.results[1].car.id));
        await db.update(schema.cars).set({ price: 450000000 }).where(eq(schema.cars.id, second.results[0].car.id));
        const refreshed = (await page(6)).json();
        assert.equal(refreshed.results.length, 6); assert.equal(refreshed.totalAvailable, 12); assert.equal(refreshed.nextOffset, 13);
        assert.deepEqual(refreshed.results.map((item: { car: { id: string } }) => item.car.id), stored.snapshot.results.slice(7, 13).map(item => item.car.id));
        assert.deepEqual((await page(13)).json().results.map((item: { car: { id: string } }) => item.car.id), [stored.snapshot.results[13].car.id]);
        assert.equal((await page(14)).json().hasMore, false);
        assert.deepEqual((await db.select().from(schema.recommendationSessions).where(eq(schema.recommendationSessions.id, ownId!)))[0].snapshot, stored.snapshot);
        await db.update(schema.recommendationSessions).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(schema.recommendationSessions.id, ownId!));
        assert.equal((await page(6)).statusCode, 404);
      } finally {
        if (ownId) await db.delete(schema.recommendationSessions).where(eq(schema.recommendationSessions.id, ownId));
        for (const car of extra) await db.delete(schema.cars).where(eq(schema.cars.id, car.id));
      }
    });
    await t.test('zero-result is saved, disable and expired tokens, cascade retention', async () => {
      const empty = await send('POST', 'car-recommendations/sessions', { ...input, requestId: randomUUID(), answers: { ...input.answers, budget: { min: 0, max: 50000000 } } }); assert.equal(empty.statusCode, 200, empty.body); assert.equal(empty.json().results.length, 0);
      await db.update(schema.recommendationSettings).set({ enabled: false });
      assert.equal((await send('GET', 'car-recommendations/config')).json().enabled, false);
      assert.equal((await send('POST', 'car-recommendations/sessions', { ...input, requestId: randomUUID() })).statusCode, 503);
      await db.update(schema.recommendationSettings).set({ enabled: true });
      await db.update(schema.recommendationSessions).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(schema.recommendationSessions.id, result!.sessionId));
      assert.equal((await send('POST', `car-recommendations/sessions/${result!.sessionId}/resume`, { capability: input.capability })).statusCode, 404);
      const beforePrune = (await db.select().from(schema.recommendationSessions)).length;
      assert.equal((await pruneRecommendationSessions(db)).expired, 1);
      assert.equal((await db.select().from(schema.recommendationSessions)).length, beforePrune, 'Dry run preserves sessions');
      assert.equal((await pruneRecommendationSessions(db, { apply: true })).deleted, 1);
      assert.equal((await db.select().from(schema.recommendationEvents)).length, 0);
      await db.update(schema.recommendationSessions).set({ createdAt: new Date(Date.now() - 3 * 86400000) }).where(eq(schema.recommendationSessions.id, empty.json().sessionId));
      await db.update(schema.recommendationSettings).set({ retentionDays: 1 });
      assert.equal((await pruneRecommendationSessions(db, { apply: true })).deleted, 1, 'Shorter current retention also applies to older sessions');
    });
    await t.test('rate limiting and sanitized error logs', async () => {
      const repeat = { ...input, requestId: randomUUID() };
      for (let i = 0; i < 20; i++) assert.equal((await send('POST', 'car-recommendations/sessions', repeat, undefined, '198.51.100.8')).statusCode, 200);
      assert.equal((await send('POST', 'car-recommendations/sessions', repeat, undefined, '198.51.100.8')).statusCode, 429);
      const service = app!.get(RecommendationService), original = service.submit;
      service.submit = async () => { throw new Error('Failed SQL params capability-secret 0901234567'); };
      try {
        const response = await send('POST', 'car-recommendations/sessions', { ...input, requestId: randomUUID() }); assert.equal(response.statusCode, 500); assert.equal(response.json().message, 'Internal server error');
        assert.doesNotMatch(response.body + JSON.stringify(logs), /capability-secret|0901234567|Failed SQL/);
      } finally { service.submit = original; }
      assert.equal((await db.select().from(schema.leads)).length, 0, 'Quiz never creates identifying leads');
    });
  } finally { if (app) await app.close(); await pg.close(); }
});
