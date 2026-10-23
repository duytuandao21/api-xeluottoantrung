import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../src/database/database.service.js';
import * as schema from '../src/database/schema/index.js';
import { validateTVDisplaySetting } from '../src/modules/content/tv-display.settings.js';
import { ContentService } from '../src/modules/content/content.service.js';
import { AdminSettingsController, PublicContentController } from '../src/modules/content/content.controller.js';
import { PERMISSIONS_KEY, PUBLIC_KEY } from '../src/modules/auth/auth.decorators.js';
import { publicCachePolicy } from '../src/common/cache/public-cache.policy.js';

const config = { logoUrl: '', title: 'Bảng giá xe đang bán', hotlineTitle: 'Hotline', carIntervalSeconds: 15,
  hotlineIntervalSeconds: 5, syncSalesContacts: false, hotlines: [{ name: 'Sale', phone: '0777 393 913' }] };
const validate = (patch: Record<string, unknown> = {}) => JSON.parse(validateTVDisplaySetting('config', JSON.stringify({ ...config, ...patch }), 'json'));

test('TV settings validate ranges, complete payloads, phone safety and duplicate numbers', () => {
  assert.equal(validate().hotlines[0].phone, '0777393913');
  assert.equal(validate({ syncSalesContacts: true, hotlines: [] }).hotlines.length, 0);
  for (const patch of [{ title: '' }, { title: 'a'.repeat(61) }, { hotlineTitle: 'a'.repeat(25) },
    { logoUrl: 'javascript:alert(1)' }, { logoUrl: '//external.test/image.png' },
    { carIntervalSeconds: 0 }, { carIntervalSeconds: 301 }, { carIntervalSeconds: 5.5 },
    { hotlineIntervalSeconds: 1 }, { hotlineIntervalSeconds: 121 }, { syncSalesContacts: 'true' },
    { hotlines: [] }, { hotlines: [{ name: '', phone: '123' }] },
    { hotlines: [{ name: '', phone: '0777393913' }, { name: '', phone: '+84777393913' }] },
    { hotlines: [{ name: '', phone: '0777393913', secret: true }] }, { unsupported: true }])
    assert.throws(() => validate(patch), Error, JSON.stringify(patch));
  assert.throws(() => validateTVDisplaySetting('other', '{}', 'json'));
  assert.throws(() => validateTVDisplaySetting('config', JSON.stringify(config), 'text'));
});

test('TV config persists atomically in existing settings and retains logo cleanup', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    for (const file of (await readdir('drizzle')).filter(name => name.endsWith('.sql')).sort())
      await pg.exec((await readFile(`drizzle/${file}`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema }) as unknown as DatabaseService['db'];
    const [actor] = await db.insert(schema.profiles).values({ authUserId: randomUUID(), fullName: 'TV editor' }).returning();
    const audit = { actorProfileId: actor.id, requestId: 'tv-display-test', ipAddress: '127.0.0.1', userAgent: 'test' };
    const service = new ContentService({ db } as DatabaseService);
    const dto = (data: unknown) => ({ valueType: 'json' as const, value: JSON.stringify(data) });
    const first = { ...config, logoUrl: 'https://cdn.example.test/assets/old.png' };
    await service.upsertSetting('tv-display', 'config', dto(first), audit);
    assert.equal(JSON.parse((await service.settings('tv-display'))[0].value!).logoUrl, first.logoUrl);
    await assert.rejects(service.upsertSetting('tv-display', 'config', dto({ ...config, carIntervalSeconds: 0 }), audit));
    assert.equal(JSON.parse((await service.settings('tv-display'))[0].value!).logoUrl, first.logoUrl, 'invalid save leaves current setting unchanged');
    await service.upsertSetting('tv-display', 'config', dto(config), audit);
    const settings = await service.settings('tv-display');
    assert.equal(settings.length, 1);
    assert.equal(JSON.parse(settings[0].value!).hotlines[0].phone, '0777393913');
    const logs = await db.select().from(schema.auditLogs);
    assert.equal(logs.filter(row => row.action === 'setting.upsert').length, 2);
    assert.equal(logs.some(row => row.action === 'storage.delete_pending' && JSON.stringify(row.newData).includes(first.logoUrl)), true);
    await service.upsertSetting('other-group', 'text', { value: 'Unchanged generic settings' }, audit);
    assert.equal((await service.settings('other-group'))[0].value, 'Unchanged generic settings');
  } finally { await pg.close(); }
});

test('TV uses existing backend permissions, public settings cache and admin bypass', () => {
  const reflector = new Reflector();
  assert.equal(reflector.get(PUBLIC_KEY, PublicContentController), true);
  assert.deepEqual(reflector.get(PERMISSIONS_KEY, AdminSettingsController.prototype.list), ['content.read']);
  assert.deepEqual(reflector.get(PERMISSIONS_KEY, AdminSettingsController.prototype.upsert), ['content.update']);
  assert.equal(publicCachePolicy('/api/v1/site-settings/tv-display')?.ttlMs, 300000);
  assert.equal(publicCachePolicy('/api/v1/admin/site-settings/tv-display'), undefined);
});
