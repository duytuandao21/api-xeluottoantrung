import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { DatabaseService } from '../src/database/database.service.js';
import * as schema from '../src/database/schema/index.js';
import { CollectionsService } from '../src/modules/content/collections.service.js';

test('Driving experiences: independent news, four per page, drafts, editing, duplicate slug and soft deletion', async () => {
  const pg = new PGlite();
  try {
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    for (const { tag } of journal.entries)
      await pg.exec((await readFile(`drizzle/${tag}.sql`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema });
    const [profile] = await db.insert(schema.profiles).values({ authUserId: 'edb1c10d-f5f8-490d-95b5-7d5e648d45ae', fullName: 'Admin' }).returning();
    const service = new CollectionsService({ db } as unknown as DatabaseService);
    const audit = { actorProfileId: profile.id, ipAddress: '127.0.0.1', userAgent: 'test', requestId: 'driving-experiences' };
    const body = '<h2>Kiểm tra trước chuyến đi</h2><p>Kiểm tra áp suất lốp và các mức chất lỏng.</p>';
    const category = await service.create('article-categories', { name: 'Kinh nghiệm', slug: 'kinh-nghiem' }, audit);
    await service.create('articles', { title: 'Tin tức cửa hàng', slug: 'kiem-tra-xe-1', content: body, status: 'published' }, audit);
    const draft = await service.create('driving-experiences', { title: 'Bài chưa đăng', slug: 'bai-chua-dang', content: body }, audit);
    assert.equal(draft.status, 'draft');
    await assert.rejects(() => service.detail('driving-experiences', 'bai-chua-dang', true, true));
    for (let index = 1; index <= 6; index++) await service.create('driving-experiences', {
      title: `Kiểm tra xe ${index}`, slug: `kiem-tra-xe-${index}`, content: body, excerpt: 'Tóm tắt', imageUrl: '/images/experience.jpg',
      categoryId: String(category.id), status: 'published',
    }, audit);
    const first = await service.list('driving-experiences', { page: 1, limit: 4 }, true);
    const second = await service.list('driving-experiences', { page: 2, limit: 4 }, true);
    assert.equal(first.data.length, 4);
    assert.equal(second.data.length, 2);
    assert.deepEqual(first.meta, { page: 1, limit: 4, total: 6, totalPages: 2 });
    assert.equal(new Set([...first.data, ...second.data].map(row => row.id)).size, 6);
    assert.equal((await service.list('articles', { page: 1, limit: 4 }, true)).meta.total, 1);
    assert.equal((await service.list('driving-experiences', { page: 1, limit: 20 }, false)).meta.total, 7);
    assert.equal((await service.list('driving-experiences', { page: 1, limit: 4, search: 'Kiểm tra xe 2' }, true)).meta.total, 1);
    await assert.rejects(() => service.create('driving-experiences', { title: 'Trùng slug', slug: 'kiem-tra-xe-1', content: body }, audit));
    await assert.rejects(() => service.update('driving-experiences', String(draft.id), { status: 'active' }, audit));
    const live = await service.detail('driving-experiences', 'kiem-tra-xe-1', true, true);
    await service.update('driving-experiences', String(live.id), { title: 'Tiêu đề mới', excerpt: '', imageUrl: null, featured: true }, audit);
    const edited = await service.detail('driving-experiences', 'kiem-tra-xe-1', true, true);
    assert.equal(edited.title, 'Tiêu đề mới');
    assert.equal(edited.content, body);
    assert.equal(edited.imageUrl, null);
    assert.equal(edited.excerpt, '');
    assert.equal(edited.featured, true);
    await service.update('driving-experiences', String(live.id), { status: 'draft' }, audit);
    await assert.rejects(() => service.detail('driving-experiences', 'kiem-tra-xe-1', true, true));
    await service.update('driving-experiences', String(live.id), { status: 'published' }, audit);
    assert.equal((await service.detail('driving-experiences', 'kiem-tra-xe-1', true, true)).content, body);
    await service.delete('driving-experiences', String(live.id), audit);
    await assert.rejects(() => service.detail('driving-experiences', 'kiem-tra-xe-1', true, true));
    const stored = await db.select().from(schema.drivingExperiences);
    assert(stored.find(row => row.id === live.id)?.deletedAt);
    assert.equal((await service.detail('articles', 'kiem-tra-xe-1', true, true)).title, 'Tin tức cửa hàng');
  } finally { await pg.close(); }
});
