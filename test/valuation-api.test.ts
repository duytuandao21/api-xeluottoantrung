import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { Global, Module, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema/index.js';
import { DatabaseService } from '../src/database/database.service.js';
import { seedValuation } from '../src/database/seed/valuation.js';
import { ValuationModule } from '../src/modules/valuation/valuation.module.js';
import { VALUATION_PERMISSIONS } from '../src/modules/valuation/domain.js';
import { vietnamDate } from '../src/modules/valuation/valuation-engine.service.js';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard.js';
import { JwtVerifierService } from '../src/modules/auth/jwt-verifier.service.js';
import { PermissionsGuard } from '../src/modules/auth/permissions.guard.js';
import { AdminAccessService } from '../src/modules/auth/admin-access.service.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import { PinoLoggerService } from '../src/common/logging/pino-logger.service.js';
import { fixtureId, valuationFixture } from './valuation-fixture.js';

test('valuation Phase 2 API: guarded simulation, published public data, privacy, validation, throttling and disable/cache behavior', async () => {
  const pg = new PGlite(); let app: NestFastifyApplication | undefined;
  try {
    for (const file of (await readdir('drizzle')).filter(file => file.endsWith('.sql')).sort()) await pg.exec((await readFile(`drizzle/${file}`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const rawDb = drizzle(pg, { schema }), db = rawDb as unknown as DatabaseService['db'];
    const [profile] = await db.insert(schema.profiles).values({ authUserId: fixtureId(300), fullName: 'Valuation test' }).returning();
    const seeded = await seedValuation(db), policyId = seeded.policyId;
    await db.insert(schema.brands).values({ id: fixtureId(3), name: 'Test brand', slug: 'test-brand' });
    await db.insert(schema.carModels).values({ id: fixtureId(4), brandId: fixtureId(3), name: 'Test model', slug: 'test-model' });
    await db.insert(schema.carVersions).values({ id: fixtureId(5), modelId: fixtureId(4), name: 'Test variant', slug: 'test-variant' });
    await db.insert(schema.carColors).values({ id: fixtureId(6), name: 'Test color', slug: 'test-color' });
    const { input, snapshot } = valuationFixture(), year = Number(vietnamDate(new Date()).slice(0, 4)); input.modelYear = year - 3;
    await db.insert(schema.valuationReferencePrices).values({ ...snapshot.references[0], policyId, modelYear: input.modelYear });
    await db.insert(schema.valuationReferencePrices).values([
      { ...snapshot.references[0], id: fixtureId(201), policyId, modelYear: input.modelYear - 1 },
      { ...snapshot.references[0], id: fixtureId(202), policyId, modelYear: input.modelYear + 1, active: false },
      { ...snapshot.references[0], id: fixtureId(203), policyId, modelYear: input.modelYear + 2, effectiveTo: new Date('2021-01-01T00:00:00Z') },
    ]);
    @Global() @Module({ imports: [ValuationModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 200 }])], providers: [
      { provide: DatabaseService, useValue: { db } },
      { provide: JwtVerifierService, useValue: { verify: async (token: string) => { if (!['admin', 'reader'].includes(token)) throw new UnauthorizedException(); return { id: token }; } } },
      { provide: AdminAccessService, useValue: { forAuthUser: async (id: string) => ({ profile, roles: ['ADMIN'], permissions: id === 'admin' ? VALUATION_PERMISSIONS : ['valuation.read'] }) } },
      { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard }, { provide: APP_GUARD, useClass: ThrottlerGuard },
    ], exports: [DatabaseService] }) class TestModule {}
    app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter(new PinoLoggerService()));
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    const docs = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
    assert.ok(docs.paths['/api/v1/valuation/estimate'].post?.responses['200']);
    assert.ok(docs.components?.schemas?.SimulationResponse);
    const server = app.getHttpAdapter().getInstance();
    let ip = 1;
    const send = (method: 'GET' | 'POST' | 'PATCH', path: string, payload?: object, token?: string, address?: string) => server.inject({ method, url: `/api/v1/${path}`, ...(payload ? { payload } : {}), headers: token ? { authorization: `Bearer ${token}` } : {}, remoteAddress: address ?? `192.0.2.${ip++}` });
    const simulate = { ...input, policyId, expectedRevision: 1, asOf: `${year}-10-06T12:00:00+07:00` };
    assert.equal((await send('GET', 'valuation/config')).json().enabled, false);
    assert.equal((await send('GET', 'valuation/brands')).statusCode, 503);
    assert.equal((await send('POST', 'valuation/estimate', input)).statusCode, 503);
    assert.equal((await send('POST', 'admin/valuation/simulate', simulate)).statusCode, 401);
    assert.equal((await send('POST', 'admin/valuation/simulate', simulate, 'reader')).statusCode, 403);
    assert.equal((await send('POST', 'admin/valuation/simulate', { ...simulate, expectedRevision: 9 }, 'admin')).statusCode, 409);
    const beforeSimulation = (await db.select().from(schema.valuationPolicies))[0];
    const simulated = await send('POST', 'admin/valuation/simulate', simulate, 'admin'); assert.equal(simulated.statusCode, 200, simulated.body);
    assert.equal(simulated.json().estimatedMarketValue, 684000000); assert.equal(simulated.json().policyStatus, 'DRAFT'); assert.equal(simulated.json().adjustments.length, 13);
    assert.deepEqual((await db.select().from(schema.valuationPolicies))[0], beforeSimulation, 'Read-only simulation must not change policy');
    assert.equal((await db.select().from(schema.auditLogs)).length, 0, 'Read-only simulation does not record a valuation lead/history');
    assert.equal((await db.select().from(schema.valuationRecords)).length, 0, 'Simulation must not create history');
    await db.update(schema.valuationSettings).set({ isEnabled: true, activePolicyId: policyId });
    assert.equal((await send('GET', 'valuation/brands')).statusCode, 503, 'Draft must never be public even if pointer is set');
    await db.update(schema.valuationSettings).set({ isEnabled: false });
    const [originalOption] = await db.select().from(schema.valuationOptions).where(eq(schema.valuationOptions.code, 'ORIGINAL'));
    await db.update(schema.valuationOptions).set({ isUnknown: true }).where(eq(schema.valuationOptions.id, originalOption.id));
    const ambiguousUnknown = await send('POST', `admin/valuation/policies/${policyId}/validate`, { expectedRevision: 1, reason: 'Reject ambiguous unknown option' }, 'admin');
    assert.equal(ambiguousUnknown.json().report.passed, false); assert.ok(ambiguousUnknown.json().report.errors.some((message: string) => message.includes('đúng một')));
    await db.update(schema.valuationOptions).set({ isUnknown: false }).where(eq(schema.valuationOptions.id, originalOption.id));
    const validated = await send('POST', `admin/valuation/policies/${policyId}/validate`, { expectedRevision: 1, reason: 'Validate isolated fixture' }, 'admin');
    assert.equal(validated.json().report.passed, true, validated.body);
    assert.equal((await send('POST', `admin/valuation/policies/${policyId}/publish`, { expectedRevision: 1, reason: 'Publish isolated fixture', confirmed: true }, 'admin')).statusCode, 201);
    assert.equal((await db.select().from(schema.valuationSettings))[0].isEnabled, false, 'Publish does not enable the real customer workflow');
    // Only the isolated fixture enables public APIs. Real development DB stays disabled.
    await db.update(schema.valuationSettings).set({ isEnabled: true });
    const configuration = (await send('GET', 'valuation/config')).json();
    assert.equal(configuration.enabled, true); assert.equal(configuration.conditionOptions.length, 50);
    assert.equal(configuration.conditionOptions[0].adjustmentPercent, undefined); assert.equal(configuration.limits.maxOdometerKm, 2000000);
    assert.equal((await send('GET', 'valuation/brands')).json().data[0].id, input.brandId);
    assert.equal((await send('GET', `valuation/models?brandId=${input.brandId}`)).json().data[0].id, input.modelId);
    assert.equal((await send('GET', `valuation/variants?modelId=${input.modelId}`)).json().data[0].id, input.variantId);
    assert.deepEqual((await send('GET', `valuation/years?variantId=${input.variantId}`)).json().data, [input.modelYear, input.modelYear - 1], 'Supported years descend; inactive and expired prices are excluded');
    assert.equal((await send('GET', 'valuation/models?brandId=invalid')).statusCode, 400);
    assert.equal((await send('GET', 'valuation/models')).statusCode, 400);
    assert.equal((await send('GET', `valuation/years?variantId=${input.variantId}&extra=true`)).statusCode, 400);
    const estimated = await send('POST', 'valuation/estimate', input); assert.equal(estimated.statusCode, 200, estimated.body);
    const publicResult = estimated.json(); assert.equal(publicResult.status, 'ESTIMATED'); assert.equal(publicResult.confidenceScore, 100);
    assert.deepEqual(publicResult.marketRange, { min: 663000000, max: 705000000 });
    for (const key of ['adjustments', 'policyId', 'referenceId', 'referenceBasis', 'cap', 'estimatedMarketValue', 'candidateMarketRange']) assert.equal(publicResult[key], undefined);
    assert.ok(publicResult.summaryFactors.length <= 5); assert.ok(!estimated.body.includes('Synthetic')); assert.ok(!estimated.body.includes('configuredPercentage'));
    for (const bad of [{ odometerKm: -1 }, { odometerKm: 1.5 }, { odometerKm: '45000' }, { modelYear: year + 1 }, { modelId: fixtureId(666) }, { colorId: fixtureId(667) }, { accidentLevel: 'HACKED' }, { manufacturingDate: `${year - 3}-02-30` }, { unexpected: true }, { policyId }, { asOf: '2020-01-01T00:00:00Z' }]) assert.equal((await send('POST', 'valuation/estimate', { ...input, ...bad })).statusCode, 400, JSON.stringify(bad));
    const missing = (await send('POST', 'valuation/estimate', { ...input, modelYear: input.modelYear + 2 })).json(); assert.equal(missing.status, 'MISSING_REFERENCE'); assert.equal(missing.marketRange, null);
    const severe = (await send('POST', 'valuation/estimate', { ...input, floodLevel: 'HYDROLOCK' })).json(); assert.equal(severe.status, 'MANUAL_INSPECTION'); assert.equal(severe.marketRange, null); assert.equal(severe.candidateMarketRange, undefined);
    // Phase 4: actual snapshot persistence, capability-bound optional contact,
    // independent history permission, filters, status concurrency and privacy.
    assert.ok(docs.paths['/api/v1/valuation/records/{id}/lead']); assert.ok(docs.paths['/api/v1/admin/valuation/records/{id}/status']);
    const [stored] = await db.select().from(schema.valuationRecords).where(eq(schema.valuationRecords.id, publicResult.recordId));
    assert.ok(stored); assert.equal(stored.snapshot.schemaVersion, 1); assert.deepEqual(stored.snapshot.input, input);
    assert.equal(stored.snapshot.result.estimatedMarketValue, 684000000); assert.deepEqual(new Set(stored.snapshot.resolvedRules.map(rule => rule.id)), new Set(stored.snapshot.result.adjustments.map(row => row.ruleId).filter(Boolean))); assert.equal(stored.snapshot.conditionOptions.length, 8);
    assert.notEqual(stored.leadTokenHash, publicResult.leadToken); assert.match(publicResult.leadToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal((await db.select().from(schema.leads)).length, 0, 'Results are available before entering contact');
    assert.equal((await send('GET', 'admin/valuation/records')).statusCode, 401);
    assert.equal((await send('GET', 'admin/valuation/records', undefined, 'reader')).statusCode, 403);
    assert.equal((await send('GET', `admin/valuation/records/${stored.id}`, undefined, 'reader')).statusCode, 403);
    assert.equal((await send('GET', `valuation/records/${stored.id}`)).statusCode, 404, 'No public history read route');
    const contactPath = `valuation/records/${stored.id}/lead`, contact = { leadToken: publicResult.leadToken, phone: '0901 234 567', city: 'TP. Hồ Chí Minh', note: 'Cần kiểm định trước khi bán', consent: true };
    const beforeContact = stored.snapshot;
    for (const bad of [{ consent: false }, { phone: 'abcdefghij' }, { name: '  ' }, { marketRange: { min: 1, max: 2 } }]) assert.equal((await send('POST', contactPath, { ...contact, ...bad })).statusCode, 400);
    assert.equal((await send('POST', contactPath, { ...contact, leadToken: 'x'.repeat(43) })).statusCode, 404);
    assert.equal((await send('POST', `valuation/records/${missing.recordId}/lead`, contact)).statusCode, 404, 'Token is bound to its record');
    const contacts = await Promise.all([send('POST', contactPath, contact), send('POST', contactPath, contact)]);
    assert.ok(contacts.every(response => response.statusCode === 200), contacts.map(response => response.body).join('\n'));
    assert.equal((await db.select().from(schema.leads)).length, 1, 'Concurrent/retried submit creates one lead');
    const lead = (await db.select().from(schema.leads))[0]; assert.equal(lead.phone, '0901234567'); assert.equal(lead.type, 'sell'); assert.ok(lead.content?.includes(stored.id));
    assert.equal(lead.name, null, 'Selling enquiry only requires phone, as on the sell page');
    assert.equal(lead.offeredBrand, stored.snapshot.vehicle.brandName); assert.equal(lead.offeredModel, stored.snapshot.vehicle.modelName);
    assert.equal(lead.offeredVersion, stored.snapshot.vehicle.variantName); assert.equal(lead.offeredYear, String(input.modelYear));
    assert.equal(lead.offeredMileage, String(input.odometerKm));
    let historyDetail = (await send('GET', `admin/valuation/records/${stored.id}`, undefined, 'admin')).json();
    assert.equal(historyDetail.contact.phone, '0901234567'); assert.equal(historyDetail.leadStatus, 'NEW'); assert.deepEqual(historyDetail.snapshot, beforeContact);
    assert.equal(historyDetail.leadTokenHash, undefined); assert.equal(historyDetail.leadToken, undefined);
    assert.equal((await send('GET', `admin/valuation/records?brandId=${input.brandId}&modelId=${input.modelId}&leadStatus=NEW&priceMin=680000000&priceMax=690000000&dateFrom=${vietnamDate(new Date())}&dateTo=${vietnamDate(new Date())}`, undefined, 'admin')).json().meta.total, 1);
    const historyList = (await send('GET', 'admin/valuation/records?limit=1&page=2', undefined, 'admin')).json(); assert.equal(historyList.data.length, 1); assert.equal(historyList.data[0].snapshot, undefined); assert.equal(historyList.data[0].leadTokenHash, undefined);
    for (const invalidQuery of ['dateFrom=2026-02-30', 'dateFrom=2026-10-06&dateTo=2026-10-01', 'priceMin=2&priceMax=1', 'page=0', 'limit=101', 'brandId=invalid', 'leadStatus=HACKED']) assert.equal((await send('GET', `admin/valuation/records?${invalidQuery}`, undefined, 'admin')).statusCode, 400);
    const statusPath = `admin/valuation/records/${stored.id}/status`, update = { leadStatus: 'CONTACTED', expectedUpdatedAt: historyDetail.updatedAt, reason: 'Đã gọi tư vấn khách' };
    assert.equal((await send('PATCH', statusPath, update, 'reader')).statusCode, 403);
    const updated = await send('PATCH', statusPath, update, 'admin'); assert.equal(updated.statusCode, 200, updated.body); historyDetail = updated.json(); assert.equal(historyDetail.leadStatus, 'CONTACTED');
    assert.deepEqual(historyDetail.snapshot, beforeContact); assert.equal((await db.select().from(schema.leads))[0].status, 'read');
    assert.equal((await send('PATCH', statusPath, update, 'admin')).statusCode, 409, 'Stale status update is rejected');
    assert.equal((await send('PATCH', statusPath, { ...update, expectedUpdatedAt: historyDetail.updatedAt, snapshot: {} }, 'admin')).statusCode, 400);
    assert.equal((await send('PATCH', `admin/valuation/records/${missing.recordId}/status`, { ...update, expectedUpdatedAt: missing.calculatedAt }, 'admin')).statusCode, 400, 'No contact means no lead status update');
    const statusAudit = (await db.select().from(schema.auditLogs)).find(row => row.action === 'valuation.history.status'); assert.ok(statusAudit); assert.ok(!JSON.stringify(statusAudit).includes(lead.phone));
    await db.update(schema.valuationRecords).set({ leadTokenExpiresAt: new Date(Date.now() - 1) }).where(eq(schema.valuationRecords.id, missing.recordId));
    assert.equal((await send('POST', `valuation/records/${missing.recordId}/lead`, { ...contact, leadToken: missing.leadToken })).statusCode, 404, 'Expired capability cannot submit');
    const cloneResponse = await send('POST', `admin/valuation/policies/${policyId}/clone`, { name: 'New policy fixture', version: '1.0.0', reason: 'Verify historical snapshot' }, 'admin'); assert.equal(cloneResponse.statusCode, 201, cloneResponse.body);
    const clone = cloneResponse.json();
    const cloneRules = (await send('GET', `admin/valuation/rules?policyId=${clone.id}&category=AGE`, undefined, 'admin')).json().data;
    const age = cloneRules.find((rule: { minValue: number | null; maxValue: number | null }) => rule.minValue === 3 && rule.maxValue === 4);
    assert.ok(age);
    const agePayload = Object.fromEntries(['policyId', 'category', 'scope', 'brandId', 'modelId', 'variantId', 'optionId', 'colorId', 'minValue', 'maxValue', 'manualInspectionRequired', 'active', 'label', 'note', 'effectiveFrom', 'effectiveTo'].map(key => [key, age[key]]));
    const changed = await send('PATCH', `admin/valuation/rules/${age.id}`, { ...agePayload, expectedRevision: 1, adjustmentPercent: -30, reason: 'Change future age rule' }, 'admin'); assert.equal(changed.statusCode, 200, changed.body);
    assert.equal((await send('POST', `admin/valuation/policies/${clone.id}/validate`, { expectedRevision: 2, reason: 'Validate cloned fixture' }, 'admin')).json().report.passed, true);
    assert.equal((await send('POST', `admin/valuation/policies/${clone.id}/publish`, { expectedRevision: 2, reason: 'Publish cloned fixture', confirmed: true }, 'admin')).statusCode, 201);
    await db.update(schema.valuationSettings).set({ isEnabled: true });
    const newEstimate = (await send('POST', 'valuation/estimate', input)).json(); assert.notDeepEqual(newEstimate.marketRange, publicResult.marketRange);
    assert.deepEqual((await send('GET', `admin/valuation/records/${stored.id}`, undefined, 'admin')).json().snapshot, beforeContact, 'New policy publication must not rewrite past evaluation/rules/reference');
    const recordCount = (await db.select().from(schema.valuationRecords)).length;
    for (let i = 0; i < 5; i++) assert.equal((await send('POST', `valuation/records/${newEstimate.recordId}/lead`, { ...contact, leadToken: newEstimate.leadToken }, undefined, '198.51.100.8')).statusCode, 200);
    assert.equal((await send('POST', `valuation/records/${newEstimate.recordId}/lead`, { ...contact, leadToken: newEstimate.leadToken }, undefined, '198.51.100.8')).statusCode, 429);
    assert.equal((await db.select().from(schema.valuationRecords)).length, recordCount, 'Contact does not re-run valuation');
    await db.update(schema.brands).set({ status: 'inactive' }).where(eq(schema.brands.id, input.brandId));
    assert.deepEqual((await send('GET', 'valuation/brands')).json().data, [], 'Cached policy must not cache catalog activity');
    assert.equal((await send('POST', 'valuation/estimate', input)).statusCode, 400);
    await db.update(schema.brands).set({ status: 'active' }).where(eq(schema.brands.id, input.brandId));
    const throttleIp = '198.51.100.7';
    for (let i = 0; i < 20; i++) assert.equal((await send('POST', 'valuation/estimate', input, undefined, throttleIp)).statusCode, 200);
    const limited = await send('POST', 'valuation/estimate', input, undefined, throttleIp); assert.equal(limited.statusCode, 429); assert.equal(limited.json().stack, undefined);
    await db.update(schema.valuationSettings).set({ isEnabled: false });
    assert.equal((await send('GET', 'valuation/config')).json().enabled, false);
    assert.equal((await send('POST', 'valuation/estimate', input)).statusCode, 503, 'Disabling must take effect even with cached published snapshot');
  } finally { if (app) await app.close(); await pg.close(); }
});
