import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { DatabaseService } from '../src/database/database.service.js';
import * as schema from '../src/database/schema/index.js';
import { CollectionsService } from '../src/modules/content/collections.service.js';

test('recruitment migration preserves old job details and admin article publishing controls public pages', async () => {
  const pg = new PGlite();
  try {
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    for (const { tag } of journal.entries.filter(entry => !entry.tag.startsWith('0007_')))
      await pg.exec((await readFile(`drizzle/${tag}.sql`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    await pg.query(`INSERT INTO recruitments (title, description, requirements, salary, location, status)
      VALUES ('Tuyển nhân viên', '<p>Công việc hiện tại.</p>', '<p>Yêu cầu hiện tại.</p>', '10 triệu', 'TP.HCM <Quận 1>', 'inactive')`);
    await pg.exec((await readFile('drizzle/0007_jittery_captain_flint.sql', 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema });
    const [profile] = await db.insert(schema.profiles).values({ authUserId: '49332fa0-8244-4b20-a8d0-9793b72ef689', fullName: 'Admin' }).returning();
    const service = new CollectionsService({ db } as unknown as DatabaseService);
    const audit = { actorProfileId: profile.id, ipAddress: '127.0.0.1', userAgent: 'test', requestId: 'recruitments' };
    const query = { page: 1, limit: 20 };
    const legacy = (await service.list('recruitments', query, false)).data[0];
    assert.equal(legacy.slug, 'tuyen-nhan-vien');
    assert.match(String(legacy.description), /Yêu cầu hiện tại/);
    assert.match(String(legacy.description), /10 triệu/);
    assert.match(String(legacy.description), /TP.HCM &lt;Quận 1&gt;/);
    assert.equal((await service.list('recruitments', query, true)).meta.total, 0);

    // Only article fields are needed, with no separate requirements, salary or location.
    const body = '<p>Toàn Trung đang tìm đồng nghiệp mới.</p><h2>Quyền lợi</h2><ul><li>Đào tạo chuyên môn</li></ul>';
    const created = await service.create('recruitments', { title: 'Tuyển nhân viên', description: body, excerpt: 'Cơ hội nghề nghiệp tại Toàn Trung', status: 'active' }, audit);
    const id = String(created.id);
    assert.equal(created.slug, 'tuyen-nhan-vien-2');
    assert.equal((await service.list('recruitments', query, true)).meta.total, 1);
    assert.equal((await service.detail('recruitments', String(created.slug), true, true)).description, body);
    await service.update('recruitments', id, { status: 'inactive' }, audit);
    await assert.rejects(() => service.detail('recruitments', String(created.slug), true, true));
    assert.equal((await service.list('recruitments', query, true)).meta.total, 0);
    await service.update('recruitments', id, { status: 'active', title: 'Tuyển nhân viên kinh doanh' }, audit);
    const updated = await service.detail('recruitments', 'tuyen-nhan-vien-kinh-doanh', true, true);
    assert.equal(updated.description, body);
    assert.equal(updated.excerpt, 'Cơ hội nghề nghiệp tại Toàn Trung');
    await service.delete('recruitments', id, audit);
    assert.equal((await service.list('recruitments', query, true)).meta.total, 0);
  } finally { await pg.close(); }
});
