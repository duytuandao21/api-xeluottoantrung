import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { Global, Module, UnauthorizedException, ValidationPipe, type ArgumentsHost } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema/index.js';
import { DatabaseService } from '../src/database/database.service.js';
import { seedValuation } from '../src/database/seed/valuation.js';
import { ValuationModule } from '../src/modules/valuation/valuation.module.js';
import { ValuationRepository } from '../src/modules/valuation/valuation.repository.js';
import { ValuationHistoryService } from '../src/modules/valuation/history.service.js';
import { VALUATION_PERMISSIONS } from '../src/modules/valuation/domain.js';
import { configureValuationTransport, VALUATION_PUBLIC_BODY_LIMIT, VALUATION_ADMIN_BODY_LIMIT } from '../src/modules/valuation/valuation.transport.js';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard.js';
import { JwtVerifierService } from '../src/modules/auth/jwt-verifier.service.js';
import { PermissionsGuard } from '../src/modules/auth/permissions.guard.js';
import { AdminAccessService } from '../src/modules/auth/admin-access.service.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import { PinoLoggerService } from '../src/common/logging/pino-logger.service.js';
import { fixtureId, valuationFixture } from './valuation-fixture.js';

test('Phase 5 release: guarded activation, E2E matrix A–H, rollback, SQL safety and constant query count', async t => {
  const pg = new PGlite(); let app: NestFastifyApplication | undefined;
  try {
    for (const file of (await readdir('drizzle')).filter(file => file.endsWith('.sql')).sort()) await pg.exec((await readFile(`drizzle/${file}`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const queries: string[] = [], rawDb = drizzle(pg, { schema, logger: { logQuery: query => { queries.push(query); } } }), db = rawDb as unknown as DatabaseService['db'];
    const [profile] = await db.insert(schema.profiles).values({ authUserId: fixtureId(300), fullName: 'Release fixture' }).returning();
    const { policyId } = await seedValuation(db), { input, snapshot } = valuationFixture();
    const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric' }).format(new Date()));
    await db.insert(schema.brands).values({ id: input.brandId, name: 'Release brand', slug: 'release-brand' });
    await db.insert(schema.carModels).values({ id: input.modelId, brandId: input.brandId, name: 'Release model', slug: 'release-model' });
    await db.insert(schema.carVersions).values({ id: input.variantId, modelId: input.modelId, name: 'Release variant', slug: 'release-variant' });
    await db.insert(schema.carColors).values({ id: input.colorId!, name: 'Trắng', slug: 'white' });
    await db.insert(schema.valuationReferencePrices).values([2, 3, 5].map(age => ({ ...snapshot.references[0], id: fixtureId(400 + age), policyId, modelYear: year - age })));
    const logs: unknown[] = [], logger = { instance: { error: (entry: unknown) => logs.push(entry) } } as unknown as PinoLoggerService;
    @Global() @Module({ imports: [ValuationModule], providers: [
      { provide: DatabaseService, useValue: { db } },
      { provide: JwtVerifierService, useValue: { verify: async (token: string) => { if (!['admin', 'settings', 'reader'].includes(token)) throw new UnauthorizedException(); return { id: token }; } } },
      { provide: AdminAccessService, useValue: { forAuthUser: async (id: string) => ({ profile, roles: ['ADMIN'], permissions: id === 'admin' ? VALUATION_PERMISSIONS : id === 'settings' ? ['valuation.read', 'valuation.settings.update'] : ['valuation.read'] }) } },
      { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
    ], exports: [DatabaseService] }) class TestModule {}
    app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), { logger: false });
    configureValuationTransport(app.getHttpAdapter().getInstance());
    app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter(logger));
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    const server = app.getHttpAdapter().getInstance(), repo = app.get(ValuationRepository);
    const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, payload?: object, token?: string) => server.inject({ method, url: `/api/v1/${path}`, ...(payload ? { payload } : {}), headers: token ? { authorization: `Bearer ${token}` } : {} });
    const settingBody = async (enabled: boolean, confirmed = true) => { const current = await repo.settings(); return { isEnabled: enabled, confirmed, disclaimer: current.disclaimer, ctaLabel: current.ctaLabel, expectedUpdatedAt: current.updatedAt.toISOString(), reason: 'Review release fixture only' }; };
    const publish = async (id: string, revision: number) => {
      const validation = await send('POST', `admin/valuation/policies/${id}/validate`, { expectedRevision: revision, reason: 'Validate release fixture' }, 'admin');
      assert.equal(validation.statusCode, 201, validation.body); assert.equal(validation.json().report.passed, true, validation.body);
      const published = await send('POST', `admin/valuation/policies/${id}/publish`, { expectedRevision: revision, confirmed: true, reason: 'Review and publish release fixture' }, 'admin');
      assert.equal(published.statusCode, 201, published.body);
    };
    const estimate = async (patch: object = {}) => { const response = await send('POST', 'valuation/estimate', { ...input, modelYear: year - 5, odometerKm: 75000, ...patch }); assert.equal(response.statusCode, 200, response.body); return response.json(); };
    const simulation = async (patch: object = {}) => { const current = (await repo.settings()).activePolicyId!; const response = await send('POST', 'admin/valuation/simulate', { ...input, modelYear: year - 5, odometerKm: 75000, ...patch, policyId: current, expectedRevision: (await repo.policy(current)).revision }, 'admin'); assert.equal(response.statusCode, 200, response.body); return response.json(); };

    await t.test('activation requires publication, permission, confirmation and current data', async () => {
      assert.equal((await send('PUT', 'admin/valuation/settings', await settingBody(true), 'admin')).statusCode, 409);
      await publish(policyId, 1);
      assert.equal((await repo.settings()).isEnabled, false, 'First publication must not enable public');
      assert.equal((await send('PUT', 'admin/valuation/settings', await settingBody(true), 'reader')).statusCode, 403);
      assert.equal((await send('PUT', 'admin/valuation/settings', await settingBody(true), 'settings')).statusCode, 403);
      assert.equal((await send('PUT', 'admin/valuation/settings', await settingBody(true, false), 'admin')).statusCode, 400);
      await db.update(schema.carVersions).set({ status: 'inactive' }).where(eq(schema.carVersions.id, input.variantId));
      assert.equal((await send('PUT', 'admin/valuation/settings', await settingBody(true), 'admin')).statusCode, 409);
      await db.update(schema.carVersions).set({ status: 'active' }).where(eq(schema.carVersions.id, input.variantId));
      await db.update(schema.valuationReferencePrices).set({ effectiveTo: new Date('2021-01-01T00:00:00Z') });
      assert.equal((await send('PUT', 'admin/valuation/settings', await settingBody(true), 'admin')).statusCode, 409);
      await db.update(schema.valuationReferencePrices).set({ effectiveTo: null });
      const enableBody = await settingBody(true); assert.equal((await send('PUT', 'admin/valuation/settings', enableBody, 'admin')).statusCode, 200);
      assert.equal((await send('PUT', 'admin/valuation/settings', enableBody, 'admin')).statusCode, 409, 'Stale settings cannot overwrite state');
      assert.equal((await send('GET', 'valuation/config')).json().enabled, true);
      assert.equal((await send('PUT', 'admin/valuation/settings', await settingBody(true), 'settings')).statusCode, 200, 'Copy editor may preserve enabled state');
    });

    let a: Awaited<ReturnType<typeof estimate>>, b: Awaited<ReturnType<typeof estimate>>;
    await t.test('A/B/C: 2-year low ODO/full service > 5-year normal > 5-year high ODO/service/repaint', async () => {
      a = await estimate({ modelYear: year - 2, odometerKm: 15000, ownerCount: 1, serviceHistory: 'FULL' });
      b = await estimate();
      const c = await estimate({ odometerKm: 200000, usageType: 'SERVICE', exteriorCondition: 'FULL_REPAINT' });
      const [internalA, internalB, internalC] = await Promise.all([simulation({ modelYear: year - 2, odometerKm: 15000, ownerCount: 1, serviceHistory: 'FULL' }), simulation(), simulation({ odometerKm: 200000, usageType: 'SERVICE', exteriorCondition: 'FULL_REPAINT' })]);
      assert.equal(a.confidenceLevel, 'HIGH'); assert.equal(a.confidenceScore, 100);
      assert.ok(internalA.estimatedMarketValue > internalB.estimatedMarketValue && internalB.estimatedMarketValue > internalC.estimatedMarketValue);
      assert.equal(c.status, 'ESTIMATED'); assert.ok(internalC.adjustments.filter((row: { type: string; percentage: number }) => ['ODO', 'USAGE', 'EXTERIOR'].includes(row.type)).every((row: { percentage: number }) => row.percentage < 0));
      assert.equal(internalB.estimatedMarketValue, 585000000);
      t.diagnostic(`A/B/C market midpoint VND: ${internalA.estimatedMarketValue}/${internalB.estimatedMarketValue}/${internalC.estimatedMarketValue}`);
    });
    await t.test('D/E: chassis and severe flood require inspection, hidden ranges and complete saved breakdown', async () => {
      for (const patch of [{ accidentLevel: 'CHASSIS' }, { floodLevel: 'SEVERE' }]) {
        const result = await estimate(patch); assert.equal(result.manualInspectionRequired, true); assert.equal(result.status, 'MANUAL_INSPECTION'); assert.equal(result.marketRange, null); assert.equal(result.dealerBuyingRange, null);
        const [record] = await db.select().from(schema.valuationRecords).where(eq(schema.valuationRecords.id, result.recordId)); assert.equal(record.snapshot.result.adjustments.length, 13); assert.ok(record.snapshot.result.candidateMarketRange);
      }
    });
    const [oldRecord] = await db.select().from(schema.valuationRecords).where(eq(schema.valuationRecords.id, b!.recordId));
    const cloneAndChange = async (version: string, change: (policy: Awaited<ReturnType<typeof repo.policy>>) => Promise<number>) => {
      const original = (await repo.settings()).activePolicyId!;
      const created = await send('POST', `admin/valuation/policies/${original}/clone`, { name: 'Release fixture', version, reason: 'Clone for matrix validation' }, 'admin'); assert.equal(created.statusCode, 201, created.body);
      const policy = await repo.policy(created.json().id), revision = await change(policy); await publish(policy.id, revision);
      assert.equal((await repo.settings()).isEnabled, true, 'Publishing a reviewed replacement preserves enabled state');
    };
    await t.test('F: changing depreciation via Admin changes the next estimate immediately', async () => {
      await cloneAndChange('1.0.1', async policy => {
        const rule = (await repo.snapshot(policy.id)).rules.find(row => row.category === 'AGE' && row.minValue === 5)!;
        const response = await send('PATCH', `admin/valuation/rules/${rule.id}`, { ...Object.fromEntries(['category', 'scope', 'brandId', 'modelId', 'variantId', 'optionId', 'colorId', 'minValue', 'maxValue', 'active', 'manualInspectionRequired', 'label', 'note'].map(key => [key, rule[key as keyof typeof rule]])), adjustmentPercent: -45, effectiveFrom: null, effectiveTo: null, policyId: policy.id, expectedRevision: policy.revision, reason: 'Change depreciation fixture' }, 'admin'); assert.equal(response.statusCode, 200, response.body); return policy.revision + 1;
      });
      assert.equal((await simulation()).estimatedMarketValue, 495000000); await estimate();
    });
    await t.test('G: changing market adjustment via Admin changes the next estimate immediately', async () => {
      await cloneAndChange('1.0.2', async policy => {
        const response = await send('POST', 'admin/valuation/rules', { policyId: policy.id, expectedRevision: policy.revision, category: 'MARKET', scope: 'GLOBAL', adjustmentPercent: 10, manualInspectionRequired: false, active: true, label: 'Market fixture +10%', note: '', reason: 'Change market fixture' }, 'admin'); assert.equal(response.statusCode, 201, response.body); return policy.revision + 1;
      });
      assert.equal((await simulation()).estimatedMarketValue, 545000000); await estimate();
    });
    await t.test('H: changing reference price via Admin uses the new price without changing old history', async () => {
      await cloneAndChange('1.0.3', async policy => {
        const price = (await repo.snapshot(policy.id)).references.find(row => row.modelYear === year - 5)!;
        const response = await send('PATCH', `admin/valuation/reference-prices/${price.id}`, { policyId: policy.id, expectedRevision: policy.revision, variantId: price.variantId, modelYear: price.modelYear, originalMsrp: 1000000000, currentMsrp: price.currentMsrp, marketReference: price.marketReference, basePriceType: price.basePriceType, source: price.source, note: price.note, basisNote: price.basisNote, referenceAgeYears: price.referenceAgeYears, referenceOdometerKm: price.referenceOdometerKm, effectiveFrom: price.effectiveFrom.toISOString(), effectiveTo: null, active: true, reason: 'Change reference fixture' }, 'admin'); assert.equal(response.statusCode, 200, response.body); return policy.revision + 1;
      });
      assert.equal((await simulation()).estimatedMarketValue, 605000000); assert.equal((await estimate()).referencePrice, 1000000000);
      assert.deepEqual((await db.select().from(schema.valuationRecords).where(eq(schema.valuationRecords.id, oldRecord.id)))[0].snapshot, oldRecord.snapshot);
    });
    await t.test('rollback clones the original snapshot policy, publishes and restores its estimate', async () => {
      const clone = await send('POST', `admin/valuation/policies/${policyId}/clone`, { name: 'Rollback fixture', version: '1.0.4', reason: 'Restore original reviewed policy' }, 'admin'); assert.equal(clone.statusCode, 201); await publish(clone.json().id, 1);
      assert.equal((await simulation()).estimatedMarketValue, 585000000);
      assert.equal((await estimate()).policyVersion, '1.0.4');
    });
    await t.test('security: body limits, invalid IDs, mass assignment, escaped SQL and safe errors/logs', async () => {
      assert.equal((await send('POST', 'valuation/estimate', { ...input, originalMsrp: 1 })).statusCode, 400);
      assert.equal((await send('POST', 'valuation/estimate', { ...input, brandId: "' OR 1=1--" })).statusCode, 400);
      assert.equal((await send('GET', 'admin/valuation/records/not-a-uuid', undefined, 'admin')).statusCode, 400);
      const injection = await send('GET', 'admin/valuation/records?search=' + encodeURIComponent("%' OR 1=1; DROP TABLE leads; --"), undefined, 'admin'); assert.equal(injection.statusCode, 200); assert.equal(injection.json().meta.total, 0);
      const tableStillThere = await db.select().from(schema.leads); assert.equal(tableStillThere.length, 0);
      assert.equal((await send('POST', 'valuation/estimate', { ...input, noise: 'x'.repeat(VALUATION_PUBLIC_BODY_LIMIT) })).statusCode, 413);
      assert.equal((await send('POST', 'admin/valuation/simulate', { noise: 'x'.repeat(VALUATION_ADMIN_BODY_LIMIT) }, 'admin')).statusCode, 413);
      const history = app!.get(ValuationHistoryService), originalContact = history.contact;
      history.contact = async () => { throw new Error('Failed query, params private-name 0901234567 capability-secret'); };
      try { const response = await send('POST', `valuation/records/${a!.recordId}/lead`, { leadToken: a!.leadToken, name: 'Name', phone: '0901234567', consent: true }); assert.equal(response.statusCode, 500); assert.equal(response.json().message, 'Internal server error'); assert.doesNotMatch(response.body + JSON.stringify(logs), /private-name|0901234567|capability-secret|stack|Failed query/); } finally { history.contact = originalContact; }
      await assert.rejects(() => db.update(schema.valuationRecords).set({ marketMin: null, marketMax: 10 }).where(eq(schema.valuationRecords.id, b!.recordId)), 'Partial price ranges must fail the database check');
    });
    await t.test('performance: rules loaded in batches, warm snapshot skips bulk reads, record rows do not increase query count', async () => {
      const times: number[] = [], counts: number[] = [];
      for (let index = 0; index < 10; index++) { queries.length = 0; const start = performance.now(); await estimate(); times.push(performance.now() - start); counts.push(queries.filter(query => !/^(begin|commit|set transaction)/i.test(query)).length); assert.equal(queries.filter(query => /from "valuation_rules"/.test(query)).length, 0, 'Published snapshot cache avoids repeated rule loads'); }
      assert.ok(counts.every(value => value === counts[0]), 'Query count must not grow with saved history'); assert.ok(counts[0] <= 7);
      const sorted = times.sort((x, y) => x - y); t.diagnostic(`Warm API fixture: queries=${counts[0]}, median=${sorted[5].toFixed(1)}ms, max=${sorted.at(-1)!.toFixed(1)}ms; synthetic local measurements, not production latency.`);
      const disable = await send('PUT', 'admin/valuation/settings', await settingBody(false), 'settings'); assert.equal(disable.statusCode, 200); assert.equal((await send('POST', 'valuation/estimate', input)).statusCode, 503);
      const cachedContact = await send('POST', `valuation/records/${a!.recordId}/lead`, { leadToken: a!.leadToken, name: 'After disable', phone: '0901234567', consent: true }); assert.equal(cachedContact.statusCode, 200);
      assert.equal((await send('PUT', 'admin/valuation/settings', await settingBody(true), 'admin')).statusCode, 200);
    });
  } finally { if (app) await app.close(); await pg.close(); }
});

test('valuation error redaction preserves diagnostics on unrelated API routes', () => {
  let entry: unknown, result: unknown;
  const filter = new ApiExceptionFilter({ instance: { error: (value: unknown) => { entry = value; } } } as unknown as PinoLoggerService);
  const host = { switchToHttp: () => ({ getRequest: () => ({ id: 'fixture', method: 'GET', url: '/api/v1/cars' }), getResponse: () => ({ status: () => ({ send: (value: unknown) => { result = value; } }) }) }) } as unknown as ArgumentsHost;
  filter.catch(new Error('Existing safe diagnostic'), host);
  assert.match(JSON.stringify(entry), /Existing safe diagnostic/); assert.doesNotMatch(JSON.stringify(result), /Existing safe diagnostic|stack/);
});
