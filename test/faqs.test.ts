import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { DatabaseService } from '../src/database/database.service.js';
import * as schema from '../src/database/schema/index.js';
import { CollectionsService } from '../src/modules/content/collections.service.js';

test('FAQ migration preserves content; admin edits and visibility control public articles', async () => {
  const pg = new PGlite();
  try {
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    for (const { tag } of journal.entries.filter(entry => !entry.tag.startsWith('0008_')))
      await pg.exec((await readFile(`drizzle/${tag}.sql`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    await pg.query(`INSERT INTO faqs (question, answer, status) VALUES
      ('Quy trình mua xe?', '<p>Nội dung cũ.</p>', 'active'),
      ('Đổi xe thế nào?', '<p>Giữ nguyên bài ẩn.</p>', 'inactive'),
      ('Đổi xe thế nào?', '<p>Giữ nguyên bài trùng tên.</p>', 'active')`);
    await pg.exec((await readFile('drizzle/0008_long_guardsmen.sql', 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema });
    const [profile] = await db.insert(schema.profiles).values({ authUserId: '49332fa0-8244-4b20-a8d0-9793b72ef689', fullName: 'Admin' }).returning();
    const service = new CollectionsService({ db } as unknown as DatabaseService);
    const audit = { actorProfileId: profile.id, ipAddress: '127.0.0.1', userAgent: 'test', requestId: 'faqs' };
    const query = { page: 1, limit: 20 };
    const migrated = (await service.list('faqs', query, false)).data;
    assert.equal(new Set(migrated.map(item => item.slug)).size, 3);
    assert(migrated.every(item => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(item.slug))));
    assert.equal((await service.detail('faqs', 'quy-trinh-mua-xe', true, true)).answer, '<p>Nội dung cũ.</p>');
    assert.equal((await service.list('faqs', query, true)).meta.total, 2);
    const body = '<h2>Hồ sơ cần chuẩn bị</h2><p>Nội dung giải đáp từ admin.</p><ul><li>Giấy tờ xe</li></ul>';
    const created = await service.create('faqs', { question: 'Quy trình mua xe?', answer: body, excerpt: 'Mô tả ngắn', imageUrl: '/images/faq.jpg', status: 'active', sortOrder: 1 }, audit);
    assert.equal(created.slug, 'quy-trinh-mua-xe-2');
    const id = String(created.id);
    await service.update('faqs', id, { status: 'inactive' }, audit);
    await assert.rejects(() => service.detail('faqs', String(created.slug), true, true));
    assert.equal((await service.detail('faqs', id, false)).answer, body);
    await service.update('faqs', id, { status: 'active', question: 'Mua xe cần giấy tờ gì?', imageUrl: null, excerpt: '' }, audit);
    const updated = await service.detail('faqs', 'mua-xe-can-giay-to-gi', true, true);
    assert.equal(updated.answer, body);
    assert.equal(updated.imageUrl, null);
    assert.equal(updated.excerpt, '');
    await assert.rejects(() => service.detail('faqs', String(created.slug), true, true));
    await service.delete('faqs', id, audit);
    await assert.rejects(() => service.detail('faqs', 'mua-xe-can-giay-to-gi', true, true));
  } finally { await pg.close(); }
});
