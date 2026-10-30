import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { FastifyRequest } from 'fastify';
import { DatabaseService } from '../src/database/database.service.js';
import * as schema from '../src/database/schema/index.js';
import { FormProtectionService, FormRateLimitException, normalizeFormPhone } from '../src/modules/leads/form-protection.service.js';
import { LeadsService } from '../src/modules/leads/leads.service.js';

test('protected forms retain idempotency, dedupe and shared PostgreSQL quotas', { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  try {
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    for (const entry of journal.entries)
      await pg.exec((await readFile(`drizzle/${entry.tag}.sql`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema });
    const database = { db } as unknown as DatabaseService;
    const config = new ConfigService({ FORM_DEDUPE_HMAC_KEY: 'dummy-hmac-key-at-least-thirty-two-characters',
      FORM_PROTECTION_SELL_ENABLED: true, TURNSTILE_ENABLED: false, NODE_ENV: 'test' });
    const service = new FormProtectionService(database, config);
    const request = { ip: '203.0.113.11' } as FastifyRequest;
    const accept = (submissionId: string, phone: string, vehicle = 'toyota|vios', source = service, ip = request.ip) =>
      source.accept('sell', submissionId, undefined, { phone, vehicle }, [normalizeFormPhone(phone), vehicle],
        { ip } as FastifyRequest, async tx => { await tx.insert(schema.leads).values({ type: 'sell', phone: normalizeFormPhone(phone) }); });
    const firstId = randomUUID();
    assert.deepEqual(await accept(firstId, '0900000000'), { accepted: true });
    assert.deepEqual(await accept(firstId, '0900000000'), { accepted: true });
    await assert.rejects(accept(firstId, '0911111111'), ConflictException);
    await accept(randomUUID(), '+84900000000');
    assert.equal((await db.select().from(schema.leads)).length, 1, '0 and +84 are the same customer request');
    await accept(randomUUID(), '0900000000', 'toyota|camry');
    assert.equal((await db.select().from(schema.leads)).length, 2, 'a different vehicle remains a valid request');
    const second = new FormProtectionService(database, config);
    const sameId = randomUUID();
    assert.deepEqual(await Promise.all([accept(sameId, '0900000000', 'honda|city', service),
      accept(sameId, '0900000000', 'honda|city', second)]), [{ accepted: true }, { accepted: true }]);
    assert.equal((await db.select().from(schema.leads)).length, 3);
    await accept(randomUUID(), '0900000000', 'ford|ranger');
    await assert.rejects(accept(randomUUID(), '0900000000', 'mazda|cx5'), FormRateLimitException);
    assert.equal((await db.select().from(schema.formRateEvents)).length, 5, 'a completed retry does not consume quota');
    assert.equal((await db.select().from(schema.leads)).length, 4);
    const otherIp = await accept(randomUUID(), '0900000000', 'mazda|cx5', second, '203.0.113.12');
    assert.deepEqual(otherIp, { accepted: true });
    await db.update(schema.formRateEvents).set({ createdAt: new Date(Date.now() - 901_000) });
    await db.update(schema.formDedupe).set({ expiresAt: new Date(0) });
    await accept(randomUUID(), '0900000000', 'toyota|vios', second);
    assert.equal((await db.select().from(schema.leads)).length, 6, 'an expired dedupe window accepts a new request');
    const ipHash = createHmac('sha256', 'dummy-hmac-key-at-least-thirty-two-characters').update('ip:203.0.113.13').digest('hex');
    await db.insert(schema.formRateEvents).values(Array.from({ length: 19 }, () => ({ bucket: 'contact', ipHash,
      createdAt: new Date(Date.now() - 120_000) })));
    await accept(randomUUID(), '0900000000', 'kia|morning', second, '203.0.113.13');
    await assert.rejects(accept(randomUUID(), '0900000000', 'hyundai|accent', second, '203.0.113.13'), FormRateLimitException);
    await db.insert(schema.newsletterSubscribers).values({ email: '  Existing@Example.Test  ' });
    const newsletterConfig = new ConfigService({ FORM_DEDUPE_HMAC_KEY: 'dummy-hmac-key-at-least-thirty-two-characters',
      FORM_PROTECTION_NEWSLETTER_ENABLED: true, TURNSTILE_ENABLED: false, NODE_ENV: 'test' });
    const newsletter = new LeadsService(database, new FormProtectionService(database, newsletterConfig));
    assert.deepEqual(await newsletter.subscribe({ email: 'existing@example.test', submissionId: randomUUID() }, request),
      { accepted: true });
    assert.equal((await db.select().from(schema.newsletterSubscribers)).length, 1,
      'legacy mixed-case email is treated as an existing subscription');
  } finally { await pg.close(); }
});

test('Turnstile rejects absent, reused, wrong-action and wrong-host tokens without creating a submission', { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  const oldFetch = globalThis.fetch;
  try {
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    for (const entry of journal.entries)
      await pg.exec((await readFile(`drizzle/${entry.tag}.sql`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema });
    const service = new FormProtectionService({ db } as unknown as DatabaseService, new ConfigService({
      FORM_DEDUPE_HMAC_KEY: 'dummy-hmac-key-at-least-thirty-two-characters', TURNSTILE_ENABLED: true,
      TURNSTILE_SECRET_KEY: 'dummy-secret', TURNSTILE_EXPECTED_HOSTNAMES: 'example.test', NODE_ENV: 'test',
    }));
    const request = { ip: '203.0.113.20' } as FastifyRequest;
    const submit = (token?: string) => service.accept('newsletter', randomUUID(), token, { email: 'test@example.test' },
      ['test@example.test'], request, async tx => { await tx.insert(schema.newsletterSubscribers).values({ email: 'test@example.test' }).onConflictDoNothing(); });
    await assert.rejects(submit(), BadRequestException);
    globalThis.fetch = async (_input, init) => {
      const token = (init?.body as FormData).get('response');
      return new Response(JSON.stringify({ success: token !== 'reused', action: token === 'wrong-action' ? 'callback' : 'newsletter',
        hostname: token === 'wrong-host' ? 'evil.test' : 'example.test' }), { status: 200 });
    };
    for (const token of ['reused', 'wrong-action', 'wrong-host']) await assert.rejects(submit(token), BadRequestException);
    assert.deepEqual(await submit('valid'), { accepted: true });
    assert.equal((await db.select().from(schema.newsletterSubscribers)).length, 1);
    assert.equal((await db.select().from(schema.formRateEvents)).length, 5, 'invalid checks consume shared quota');
    globalThis.fetch = async () => { throw new Error('fixture network unavailable'); };
    await assert.rejects(service.accept('newsletter', randomUUID(), 'new-token', { email: 'other@example.test' },
      ['other@example.test'], { ip: '203.0.113.21' } as FastifyRequest,
      async tx => { await tx.insert(schema.newsletterSubscribers).values({ email: 'other@example.test' }); }), ServiceUnavailableException);
    assert.equal((await db.select().from(schema.newsletterSubscribers)).length, 1, 'a verification outage fails closed');
  } finally { globalThis.fetch = oldFetch; await pg.close(); }
});

test('newsletter notifications count only subscriptions that Admin has not viewed', { timeout: 120_000 }, async () => {
  const pg = new PGlite();
  try {
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    for (const entry of journal.entries)
      await pg.exec((await readFile(`drizzle/${entry.tag}.sql`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema });
    const leads = new LeadsService({ db } as unknown as DatabaseService);
    const [profile] = await db.insert(schema.profiles).values({ authUserId: randomUUID(), fullName: 'Fixture Admin' })
      .returning({ id: schema.profiles.id });
    const audit = { actorProfileId: profile.id, ipAddress: '203.0.113.30', userAgent: null, requestId: 'fixture' };
    const [subscriber] = await db.insert(schema.newsletterSubscribers).values({ email: 'new@example.test' })
      .returning({ id: schema.newsletterSubscribers.id });
    await db.insert(schema.leads).values({ type: 'callback', phone: '0900000000' });
    assert.deepEqual(await leads.unreadCounts(), { sell: 0, trade_in: 0, callback: 1, newsletter: 1 });
    await leads.markSubscriberViewed(subscriber.id, audit);
    await leads.markSubscriberViewed(subscriber.id, audit);
    assert.deepEqual(await leads.unreadCounts(), { sell: 0, trade_in: 0, callback: 1, newsletter: 0 });
    assert.equal((await db.select().from(schema.auditLogs)).length, 1, 'repeat views do not create duplicate audit rows');
    await assert.rejects(leads.markSubscriberViewed(randomUUID(), audit), NotFoundException);
    await leads.subscribe({ email: 'another@example.test' });
    assert.equal((await leads.unreadCounts()).newsletter, 1, 'a later signup raises the badge again');
  } finally { await pg.close(); }
});
