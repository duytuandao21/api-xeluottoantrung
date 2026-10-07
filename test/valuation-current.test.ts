import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { Global, Module, UnauthorizedException, ValidationPipe } from '@nestjs/common';
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
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard.js';
import { JwtVerifierService } from '../src/modules/auth/jwt-verifier.service.js';
import { AdminAccessService } from '../src/modules/auth/admin-access.service.js';
import { PermissionsGuard } from '../src/modules/auth/permissions.guard.js';
import { VALUATION_PERMISSIONS } from '../src/modules/valuation/domain.js';
import { valuationFixture } from './valuation-fixture.js';

test('single valuation configuration applies live edits atomically without a version workflow', async t => {
  const pg = new PGlite(); let app: NestFastifyApplication | undefined;
  try {
    for (const file of (await readdir('drizzle')).filter(file => file.endsWith('.sql')).sort()) await pg.exec((await readFile(`drizzle/${file}`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema }) as unknown as DatabaseService['db'], { policyId } = await seedValuation(db);
    const { input, snapshot } = valuationFixture();
    input.modelYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric' }).format(new Date())) - 3;
    const [profile] = await db.insert(schema.profiles).values({ authUserId: '49332fa0-8244-4b20-a8d0-9793b72ef689', fullName: 'Current config fixture' }).returning();
    await db.insert(schema.brands).values({ id: input.brandId, name: 'Test', slug: 'current-brand' });
    await db.insert(schema.carModels).values({ id: input.modelId, brandId: input.brandId, name: 'Model', slug: 'current-model' });
    await db.insert(schema.carVersions).values({ id: input.variantId, modelId: input.modelId, name: 'Variant', slug: 'current-variant' });
    await db.insert(schema.carColors).values({ id: input.colorId!, name: 'Trắng', slug: 'current-white' });
    await db.insert(schema.valuationReferencePrices).values({ ...snapshot.references[0], policyId, modelYear: input.modelYear });
    @Global() @Module({ imports: [ValuationModule], providers: [
      { provide: DatabaseService, useValue: { db } },
      { provide: JwtVerifierService, useValue: { verify: async (token: string) => { if (!['admin','reader','settings'].includes(token)) throw new UnauthorizedException(); return { id: token }; } } },
      { provide: AdminAccessService, useValue: { forAuthUser: async (id: string) => ({ profile, roles: ['ADMIN'], permissions: id === 'admin' ? VALUATION_PERMISSIONS : id === 'settings' ? ['valuation.read','valuation.settings.update'] : ['valuation.read'] }) } },
      { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
    ], exports: [DatabaseService] }) class FixtureModule {}
    app = await NestFactory.create<NestFastifyApplication>(FixtureModule, new FastifyAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    const server = app.getHttpAdapter().getInstance(), repo = app.get(ValuationRepository);
    const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, payload?: object, token = 'admin') => server.inject({ method, url: `/api/v1/${path}`, ...(payload ? { payload } : {}), headers: token ? { authorization: `Bearer ${token}` } : {} });
    const revision = async () => (await repo.policy(policyId)).revision;
    const reason = 'Apply isolated current configuration fixture';
    const settingsBody = async (isEnabled: boolean, confirmed = true) => { const value = await repo.settings(); return { isEnabled, confirmed, disclaimer: value.disclaimer, ctaLabel: value.ctaLabel, expectedUpdatedAt: value.updatedAt.toISOString(), reason }; };
    const estimate = async () => { const response = await send('POST','valuation/estimate',input,''); assert.equal(response.statusCode,200,response.body); const record = (await db.select().from(schema.valuationRecords).where(eq(schema.valuationRecords.id,response.json().recordId)))[0]; return record; };
    const fields = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map(key => [key,row[key]]));
    const ruleFields = ['category','scope','brandId','modelId','variantId','optionId','colorId','minValue','maxValue','adjustmentPercent','manualInspectionRequired','active','label','note','effectiveFrom','effectiveTo'];
    await t.test('current data hides configuration versions and enables directly with settings permission', async () => {
      const response = await send('GET','admin/valuation/current'); assert.equal(response.statusCode,200);
      assert.equal(response.json().configuration.id,policyId); assert.equal(response.json().configuration.version,undefined); assert.equal(response.json().policies,undefined);
      assert.equal((await send('PUT','admin/valuation/current/settings',await settingsBody(true),'reader')).statusCode,403);
      assert.equal((await send('PUT','admin/valuation/current/settings',await settingsBody(true,false),'settings')).statusCode,400);
      const enabled = await send('PUT','admin/valuation/current/settings',await settingsBody(true),'settings'); assert.equal(enabled.statusCode,200,enabled.body);
      assert.equal((await repo.settings()).isEnabled,true); assert.equal((await repo.policy(policyId)).validatedRevision,1);
    });
    const old = await estimate(); assert.equal(old.estimatedMarketValue,684000000);
    await t.test('changing age percentage applies immediately to warmed public estimates', async () => {
      const rules = (await repo.snapshot(policyId)).rules, age = rules.find(row => row.category === 'AGE' && row.minValue === 3)!;
      const beforeKey = (await send('GET','valuation/config',undefined,'')).json().configurationKey;
      const response = await send('PATCH',`admin/valuation/current/rules/${age.id}`, { ...fields(age,ruleFields), adjustmentPercent: -35, expectedRevision: await revision(), reason });
      assert.equal(response.statusCode,200,response.body); assert.equal((await estimate()).estimatedMarketValue,585000000);
      assert.notEqual((await send('GET','valuation/config',undefined,'')).json().configurationKey,beforeKey);
      assert.equal((await repo.settings()).isEnabled,true);
    });
    await t.test('market and reference edits apply on the same configuration and preserve old snapshots', async () => {
      const market = await send('POST','admin/valuation/current/rules',{ category:'MARKET',scope:'GLOBAL',adjustmentPercent:10,manualInspectionRequired:false,active:true,label:'Current market fixture',note:'',expectedRevision:await revision(),reason });
      assert.equal(market.statusCode,201,market.body); assert.equal((await estimate()).estimatedMarketValue,644000000);
      const price = (await repo.snapshot(policyId)).references[0];
      const priceFields = ['variantId','modelYear','originalMsrp','currentMsrp','marketReference','basePriceType','source','note','referenceAgeYears','referenceOdometerKm','basisNote','active'];
      const updated = await send('PATCH',`admin/valuation/current/reference-prices/${price.id}`, { ...fields(price,priceFields), originalMsrp:1000000000,effectiveFrom:price.effectiveFrom.toISOString(),effectiveTo:null,expectedRevision:await revision(),reason });
      assert.equal(updated.statusCode,200,updated.body); assert.equal((await estimate()).estimatedMarketValue,715000000);
      const unchanged = (await db.select().from(schema.valuationRecords).where(eq(schema.valuationRecords.id,old.id)))[0]; assert.deepEqual(unchanged.snapshot,old.snapshot);
      assert.equal((await db.select().from(schema.valuationPolicies)).length,1,'Live edits do not create configuration versions');
    });
    await t.test('invalid rules roll back the entire edit instead of breaking public configuration', async () => {
      const age = (await repo.snapshot(policyId)).rules.find(row => row.category === 'AGE' && row.minValue === 3)!, before = await revision();
      const rejected = await send('DELETE',`admin/valuation/current/rules/${age.id}`,{ expectedRevision:before,reason }); assert.equal(rejected.statusCode,400,rejected.body);
      assert.equal(await revision(),before); assert.ok((await repo.snapshot(policyId)).rules.some(row => row.id === age.id)); assert.equal((await estimate()).estimatedMarketValue,715000000);
      assert.equal((await send('PATCH',`admin/valuation/current/rules/${age.id}`,{ ...fields(age,ruleFields),expectedRevision:before-1,reason })).statusCode,409);
      assert.equal((await send('PATCH',`admin/valuation/current/rules/${age.id}`,{ ...fields(age,ruleFields),expectedRevision:before,policyId,reason })).statusCode,400,'Caller cannot choose another policy');
      assert.equal((await send('GET',`admin/valuation/current/rules?policyId=${policyId}`)).statusCode,400);
      assert.equal((await send('PATCH',`admin/valuation/current/rules/${age.id}`,{ ...fields(age,ruleFields),expectedRevision:before,reason },'reader')).statusCode,403);
    });
    await t.test('direct shared config edits reject stale simultaneous changes', async () => {
      const before = await repo.policy(policyId), payload = { config:{ ...before.config,dealerMarginMinPercent:8,dealerMarginMaxPercent:12 },expectedRevision:before.revision,reason };
      const responses = await Promise.all([send('PATCH','admin/valuation/current/config',payload,'settings'),send('PATCH','admin/valuation/current/config',payload,'settings')]);
      assert.deepEqual(responses.map(response => response.statusCode).sort(),[200,409]);
      const record = await estimate(); assert.deepEqual({ min:record.buyingMin,max:record.buyingMax },{ min:629000000,max:658000000 });
      const current = await repo.policy(policyId); assert.equal(current.validatedRevision,current.revision);
    });
    await t.test('disabled editing supports preparing option and rule together before activation', async () => {
      assert.equal((await send('PUT','admin/valuation/current/settings',await settingsBody(false),'settings')).statusCode,200);
      const option = { category:'EXTERIOR',code:'CUSTOM',label:'Custom condition',description:'',isUnknown:false,requiresInspection:false,active:true,sortOrder:100,reason };
      const created = await send('POST','admin/valuation/current/options',{ ...option,expectedRevision:await revision() }); assert.equal(created.statusCode,201,created.body);
      assert.equal((await send('PUT','admin/valuation/current/settings',await settingsBody(true),'settings')).statusCode,400,'Incomplete global rules cannot be enabled');
      const rule = await send('POST','admin/valuation/current/rules',{ category:'EXTERIOR',scope:'GLOBAL',optionId:created.json().id,adjustmentPercent:-3,manualInspectionRequired:false,active:true,label:'Custom fixture',note:'',expectedRevision:await revision(),reason }); assert.equal(rule.statusCode,201,rule.body);
      assert.equal((await send('PUT','admin/valuation/current/settings',await settingsBody(true),'settings')).statusCode,200);
      const audit = await send('GET','admin/valuation/audit?limit=100'); assert.ok(audit.json().data.some((row:{action:string}) => row.action === 'valuation.configuration.apply'));
    });
  } finally { if (app) await app.close(); await pg.close(); }
});
