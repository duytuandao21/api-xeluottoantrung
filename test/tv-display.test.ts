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
import { defaultTVAnniversary, parseTVAnniversary } from '../src/modules/content/tv-anniversary-settings.js';

const config = { logoUrl: '', title: 'Bảng giá xe đang bán', hotlineTitle: 'Hotline', carIntervalSeconds: 15,
  hotlineIntervalSeconds: 5, syncSalesContacts: false, hotlines: [{ name: 'Sale', phone: '0777 393 913' }] };
const validate = (patch: Record<string, unknown> = {}) => JSON.parse(validateTVDisplaySetting('config', JSON.stringify({ ...config, ...patch }), 'json'));

test('TV settings validate ranges, complete payloads, phone safety and duplicate numbers', () => {
  assert.equal(validate().theme, 'standard', 'existing settings without a theme keep the original UI');
  assert.equal(validate({ theme: 'anniversary-4' }).theme, 'anniversary-4');
  assert.equal(validate({ theme: 'standard' }).theme, 'standard');
  assert.equal(validate().hotlines[0].phone, '0777393913');
  assert.equal(validate({ syncSalesContacts: true, hotlines: [] }).hotlines.length, 0);
  for (const patch of [{ title: '' }, { title: 'a'.repeat(61) }, { hotlineTitle: 'a'.repeat(25) },
    { logoUrl: 'javascript:alert(1)' }, { logoUrl: '//external.test/image.png' },
    { carIntervalSeconds: 0 }, { carIntervalSeconds: 301 }, { carIntervalSeconds: 5.5 },
    { hotlineIntervalSeconds: 1 }, { hotlineIntervalSeconds: 121 }, { syncSalesContacts: 'true' },
    { hotlines: [] }, { hotlines: [{ name: '', phone: '123' }] },
    { hotlines: [{ name: '', phone: '0777393913' }, { name: '', phone: '+84777393913' }] },
    { hotlines: [{ name: '', phone: '0777393913', secret: true }] }, { theme: null }, { theme: 'custom' }, { unsupported: true }])
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
    const event = structuredClone(defaultTVAnniversary);
    event.slides[0].imageUrl = 'https://cdn.example.test/assets/old-tribute.png';
    const first = { ...config, anniversary: event, logoUrl: 'https://cdn.example.test/assets/old.png' };
    await service.upsertSetting('tv-display', 'config', dto(first), audit);
    assert.equal(JSON.parse((await service.settings('tv-display'))[0].value!).logoUrl, first.logoUrl);
    await assert.rejects(service.upsertSetting('tv-display', 'config', dto({ ...config, carIntervalSeconds: 0 }), audit));
    assert.equal(JSON.parse((await service.settings('tv-display'))[0].value!).logoUrl, first.logoUrl, 'invalid save leaves current setting unchanged');
    const edited = structuredClone(event); edited.slides[0].imageUrl = 'https://cdn.example.test/assets/new-tribute.png';
    edited.slides[0].title = 'Tri ân khách hàng';
    await service.upsertSetting('tv-display', 'config', dto({ ...config, anniversary: edited, theme: 'anniversary-4' }), audit);
    const settings = await service.settings('tv-display');
    assert.equal(settings.length, 1);
    assert.equal(JSON.parse(settings[0].value!).hotlines[0].phone, '0777393913');
    assert.equal(JSON.parse(settings[0].value!).theme, 'anniversary-4');
    const logs = await db.select().from(schema.auditLogs);
    assert.equal(logs.filter(row => row.action === 'setting.upsert').length, 2);
    assert.equal(logs.some(row => row.action === 'storage.delete_pending' && JSON.stringify(row.newData).includes(first.logoUrl)), true);
    assert.equal(logs.some(row => row.action === 'storage.delete_pending' && JSON.stringify(row.newData).includes(event.slides[0].imageUrl)), true);
    await service.upsertSetting('tv-display', 'config', dto({ ...config, anniversary: edited, theme: 'standard' }), audit);
    assert.equal(JSON.parse((await service.settings('tv-display'))[0].value!).theme, 'standard', 'turning off the event restores the standard setting');
    assert.deepEqual(JSON.parse((await service.settings('tv-display'))[0].value!).anniversary, edited, 'standard mode retains event content');
    await service.upsertSetting('other-group', 'text', { value: 'Unchanged generic settings' }, audit);
    assert.equal((await service.settings('other-group'))[0].value, 'Unchanged generic settings');
  } finally { await pg.close(); }
});

test('anniversary JSON rejects unsafe or oversized settings and retains legacy defaults', () => {
  assert.deepEqual(validate().anniversary, defaultTVAnniversary);
  const good = structuredClone(defaultTVAnniversary);
  good.slides.push({...good.slides[0],id:'second',title:'Cảm ơn quý khách'});
  assert.deepEqual(validate({anniversary:good}).anniversary,good);
  for (const count of [1,2,5]) assert.equal(validate({anniversary:{...good,messages:Array(count).fill('Tri ân khách hàng')}}).anniversary.messages.length,count);
  const invalid = [null, {}, {...good,confetti:'true'}, {...good,slideSeconds:0}, {...good,slideSeconds:61},
    {...good,pagesBetweenSlides:1.5}, {...good,pagesBetweenSlides:31}, {...good,messageSeconds:4},
    {...good,messages:[]}, {...good,messages:Array(6).fill('Tri ân')}, {...good,messages:['']}, {...good,messages:['a'.repeat(101),'two']}, {...good,years:'2021–2026'},
    {...good,slides:Array(7).fill(good.slides[0])}, {...good,slides:[good.slides[0],good.slides[0]]},
    ...['javascript:alert(1)','//evil.test/img.png','https://user:password@evil.test/img.png','/\\evil.test/a.png'].map(imageUrl=>({...good,slides:[{...good.slides[0],imageUrl}]})),
    {...good,slides:[{...good.slides[0],title:'x'.repeat(61)}]}];
  for (const item of invalid) assert.throws(()=>validate({anniversary:item}));
  assert.doesNotThrow(()=>parseTVAnniversary({...good,slides:[]}));
});

test('TV uses existing backend permissions, public settings cache and admin bypass', () => {
  const reflector = new Reflector();
  assert.equal(reflector.get(PUBLIC_KEY, PublicContentController), true);
  assert.deepEqual(reflector.get(PERMISSIONS_KEY, AdminSettingsController.prototype.list), ['content.read']);
  assert.deepEqual(reflector.get(PERMISSIONS_KEY, AdminSettingsController.prototype.upsert), ['content.update']);
  assert.equal(publicCachePolicy('/api/v1/site-settings/tv-display')?.ttlMs, 300000);
  assert.equal(publicCachePolicy('/api/v1/admin/site-settings/tv-display'), undefined);
});
