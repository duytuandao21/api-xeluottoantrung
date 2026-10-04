import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { Module, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema/index.js';
import { DatabaseService } from '../src/database/database.service.js';
import { AuspiciousDateModule } from '../src/modules/auspicious-date/auspicious-date.module.js';
import { AuspiciousRepository } from '../src/modules/auspicious-date/repository.js';
import { AuspiciousAdminService } from '../src/modules/auspicious-date/admin.service.js';
import { AuspiciousVersionsService } from '../src/modules/auspicious-date/versions.service.js';
import { ReferenceValidation } from '../src/modules/auspicious-date/engine/reference-validation.js';
import { AuspiciousPublicService } from '../src/modules/auspicious-date/public.service.js';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard.js';
import { JwtVerifierService } from '../src/modules/auth/jwt-verifier.service.js';
import { PermissionsGuard } from '../src/modules/auth/permissions.guard.js';
import { AdminAccessService } from '../src/modules/auth/admin-access.service.js';

test('auspicious API: migration, JWT/RBAC, DTO, immutable publishing, regression and stateless public contract', async () => {
  const pg = new PGlite();
  let app: NestFastifyApplication | undefined;
  try {
    for (const file of (await readdir('drizzle')).filter(file => file.endsWith('.sql')).sort()) await pg.exec((await readFile(`drizzle/${file}`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema });
    await db.insert(schema.auspiciousSettings).values({ id: 1 });
    const [profile] = await db.insert(schema.profiles).values({ authUserId: '49332fa0-8244-4b20-a8d0-9793b72ef689', fullName: 'Calendar tester' }).returning();
    const database = { db } as unknown as DatabaseService;
    const repo = new AuspiciousRepository(database), validation = new ReferenceValidation(repo);
    const admin = new AuspiciousAdminService(repo), versions = new AuspiciousVersionsService(repo, validation);
    const publicService = new AuspiciousPublicService(repo), actor = { id: profile.id };
    const set = await versions.create({ version: '1.0.0', purpose: 'BUY_CAR', name: 'Test rules (not production source)', reason: 'Isolated test fixture' }, actor);
    assert.equal((await publicService.config()).enabled, false);
    await assert.rejects(() => publicService.search({ birthDate: '1998-08-15', purpose: 'BUY_CAR', from: '2026-10-01', to: '2026-10-31' }));
    await versions.review(set.id, { reason: 'Review fixture' }, actor);
    assert.equal((await versions.validate(set.id, { reason: 'Validate missing references' }, actor)).report.passed, false);
    await assert.rejects(() => versions.publish(set.id, { reason: 'Reject invalid publish', confirmed: true }, actor));
    const snapshot = await repo.snapshot(set.id);
    const officer = snapshot.rules.find(rule => rule.engineHandler === 'PURPOSE_OFFICER')!;
    await admin.updateRule(officer.id, { ...officer, isEnabled: true, parameters: { officers: [8, 10] }, reason: 'Test specific purpose officers' }, actor);
    for (const rule of (await repo.snapshot(set.id)).rules.filter(rule => rule.isEnabled)) await admin.source(rule.id, null, {
      title: 'Synthetic test fixture, not a real business source', author: 'Test', publisher: '', edition: '', pageReference: '', url: 'https://example.test/calendar',
      note: 'Test source gating only; never seed into production.', verificationStatus: 'VERIFIED', reason: 'Exercise review workflow',
    }, actor);
    // Expectations generated only for exercising snapshot/regression mechanics in this isolated DB.
    // Actual production references must be entered independently; the system never auto-overwrites them.
    for (let day = 1; day <= 36; day++) {
      const date = new Date(Date.UTC(2026, 1, day)).toISOString().slice(0, 10);
      const result = (await admin.simulate({ birthDate: '1998-08-15', purpose: 'BUY_CAR', targetDate: date, ruleSetId: set.id })).primary;
      await admin.reference(set.id, null, { name: `Fixture ${day}`, birthDate: '1998-08-15', purpose: 'BUY_CAR', targetDate: date,
        expected: { classification: result.classification, rules: result.trace.map(rule => ({ code: rule.code, matched: rule.matched })) },
        sourceNote: 'Synthetic workflow fixture; not traditional reference data', isActive: true, reason: 'Test reference handling' }, actor);
    }
    await versions.review(set.id, { reason: 'Review complete fixture' }, actor);
    const report = await versions.validate(set.id, { reason: 'Run reference gate' }, actor);
    assert.equal(report.report.passed, true, JSON.stringify(report.report));
    await versions.publish(set.id, { reason: 'Test atomic publication', confirmed: true }, actor);
    await assert.rejects(() => admin.updateRule(officer.id, { ...officer, reason: 'Try editing published snapshot' }, actor));
    const settings = await repo.settings();
    const { id: _id, createdAt: _created, updatedAt: _updated, ...values } = settings; void _id; void _created; void _updated;
    await admin.saveSettings({ ...values, isEnabled: true, reason: 'Enable isolated public test' }, actor);
    const input = { birthDate: '1998-08-15', purpose: 'BUY_CAR' as const, from: '2026-10-01', to: '2026-10-31' };
    const beforeAudit = await db.select().from(schema.auspiciousChangeLogs);
    const results = await publicService.search(input);
    assert.deepEqual(results, await publicService.search(input));
    assert.equal(results.results.length, 31);
    assert.equal(results.months.length, 1);
    assert.equal('trace' in results.results[0], false);
    assert.equal('score' in results.results[0], false);
    assert.equal('sources' in results, false);
    assert.deepEqual(await db.select().from(schema.auspiciousChangeLogs), beforeAudit);
    await assert.rejects(() => publicService.search({ ...input, to: '2027-01-01' }));
    await assert.rejects(() => publicService.search({ ...input, from: '2026-10-31', to: '2026-10-01' }));
    await assert.rejects(() => publicService.search({ ...input, birthDate: '2099-12-31' }));
    await assert.rejects(() => publicService.detail({ ...input, targetDate: '2026-10-01', expectedRulesetVersion: '0.0.0' }));
    const clone = await versions.create({ version: '1.1.0', purpose: 'BUY_CAR', name: 'New snapshot', reason: 'Test cloning' }, actor, set.id);
    const cloneSnapshot = await repo.snapshot(clone.id);
    assert.equal(cloneSnapshot.rules.length, snapshot.rules.length);
    assert.equal(validation.run(cloneSnapshot).passed, true);
    const reference = cloneSnapshot.cases[0];
    await admin.reference('', reference.id, { ...reference, gender: undefined, expected: { ...reference.expected, classification: reference.expected.classification === 'AVOID' ? 'VERY_GOOD' : 'AVOID' }, reason: 'Exercise failed reference case' }, actor);
    assert.ok(validation.run(await repo.snapshot(clone.id)).fail > 0);
    await versions.review(clone.id, { reason: 'Review mismatch' }, actor);
    assert.equal((await versions.validate(clone.id, { reason: 'Reject changed expectation' }, actor)).report.passed, false);
    await assert.rejects(() => versions.publish(clone.id, { reason: 'Reject regression', confirmed: true }, actor));

    @Module({ imports: [AuspiciousDateModule], providers: [
      { provide: DatabaseService, useValue: database },
      { provide: JwtVerifierService, useValue: { verify: async (token: string) => { if (!['reader', 'admin'].includes(token)) throw new UnauthorizedException(); return { id: token }; } } },
      { provide: AdminAccessService, useValue: { forAuthUser: async (id: string) => ({ profile, roles: ['ADMIN'], permissions: id === 'admin' ? ['auspicious_date.read', 'auspicious_date.rules.read', 'auspicious_date.rules.update', 'auspicious_date.simulate'] : [] }) } },
      { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
    ], exports: [DatabaseService] })
    class TestModule {}
    // Module providers in a parent are not visible to imported feature modules: override via global wrapper.
    const { Global } = await import('@nestjs/common');
    Global()(TestModule);
    app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    const server = app.getHttpAdapter().getInstance();
    assert.equal((await server.inject({ method: 'GET', url: '/api/v1/admin/auspicious-dates/overview' })).statusCode, 401);
    assert.equal((await server.inject({ method: 'GET', url: '/api/v1/admin/auspicious-dates/overview', headers: { authorization: 'Bearer reader' } })).statusCode, 403);
    assert.equal((await server.inject({ method: 'GET', url: '/api/v1/admin/auspicious-dates/overview', headers: { authorization: 'Bearer admin' } })).statusCode, 200);
    const ruleInput = { priority: 'MEDIUM', effect: 'POSITIVE', weight: 10, hardExclusion: false, isEnabled: true, sortOrder: 0, reason: 'Malformed parameters test' };
    for (const payload of [ruleInput, { ...ruleInput, parameters: null }, { ...ruleInput, parameters: [] }, { ...ruleInput, parameters: { executableCode: 'bad' } }])
      assert.equal((await server.inject({ method: 'PATCH', url: `/api/v1/admin/auspicious-dates/rules/${officer.id}`, headers: { authorization: 'Bearer admin' }, payload })).statusCode, 400);
    for (const payload of [{ ...input, purpose: 'HACK' }, { ...input, birthDate: '2026-02-30' }, { ...input, from: '2026-10-01T00:00:00Z' }, { ...input, weight: 100 }])
      assert.equal((await server.inject({ method: 'POST', url: '/api/v1/auspicious-dates/search', payload })).statusCode, 400);
    assert.equal((await server.inject({ method: 'POST', url: '/api/v1/auspicious-dates/search', payload: input })).statusCode, 201);
    await db.update(schema.auspiciousSettings).set({ isEnabled: false }).where(eq(schema.auspiciousSettings.id, 1));
    assert.equal((await server.inject({ method: 'POST', url: '/api/v1/auspicious-dates/search', payload: input })).statusCode, 503);
  } finally { if (app) await app.close(); await pg.close(); }
});
