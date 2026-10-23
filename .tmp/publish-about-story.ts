import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { aboutStoryPages, aboutStorySections, aboutMilestones, aboutCustomerStories,
  aboutStoryAssets, auditLogs } from '../src/database/schema/index.js';
import { ABOUT_PAGE_ID } from '../src/modules/about-story/service.js';
import { buildPublication } from '../src/modules/about-story/publication.js';

const apply = process.argv.includes('--apply');
const key = 'assets/51b213b2-e209-4a1a-9e93-d6a3205f5395.jpg';
const publicBase = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
if (!process.env.DATABASE_URL || !publicBase) throw new Error('DATABASE_URL and R2_PUBLIC_BASE_URL are required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

const sectionCopy = {
  opening: {
    subtitle: 'Từ kinh doanh xe máy tại Gia Lai đến hệ sinh thái ô tô tại TP. Hồ Chí Minh',
    body: 'Hành trình Toàn Trung bắt đầu từ năm 1997. Qua từng giai đoạn, chúng tôi mở rộng hoạt động kinh doanh xe máy, ô tô lướt và dịch vụ hậu mãi, với sự tin tưởng của khách hàng làm nền tảng.',
    ctaLabel: null, ctaHref: null,
  },
  milestones: {
    subtitle: 'Những dấu mốc từ 1997 đến 2026',
    body: 'Từ Gia Lai đến TP. Hồ Chí Minh, mỗi cột mốc đánh dấu một bước phát triển của hệ thống Toàn Trung.',
    ctaLabel: null, ctaHref: null,
  },
  stories: {
    subtitle: 'Lắng nghe những hành trình cùng khách hàng',
    body: 'Các câu chuyện khách hàng sẽ được bổ sung sau khi có nội dung và sự đồng ý công bố đầy đủ.',
    ctaLabel: null, ctaHref: null,
  },
  people: {
    subtitle: 'Những con người cùng xây dựng Toàn Trung',
    body: 'Đội ngũ Toàn Trung đã đồng hành qua các giai đoạn mở rộng kinh doanh và dịch vụ. Những thành tích của nhân viên phụ tùng, bán hàng là một phần trong hành trình ấy.',
    ctaLabel: null, ctaHref: null,
  },
  future: {
    subtitle: 'Tiếp tục kết nối mua bán xe và dịch vụ hậu mãi',
    body: 'Từ hệ thống ô tô lướt đến DP Auto, Toàn Trung tiếp tục phát triển các dịch vụ giúp khách hàng tìm xe, sử dụng xe và chăm sóc xe thuận tiện hơn.',
    ctaLabel: 'Khám phá xe đang bán', ctaHref: '/san-pham',
  },
} as const;

const summaries: Record<string, string> = {
  '1997-khoi-nguon': 'Bắt đầu kinh doanh xe máy tại Gia Lai, từng bước xây dựng nền tảng khách hàng và thương hiệu Toàn Trung.',
  '2010-nen-tang-doanh-nghiep': 'Thành lập Công ty TNHH MTV Toàn Trung, tạo nền tảng quản lý và phát triển hệ thống kinh doanh.',
  '2011-head-thai-hung': 'Tiếp nhận HEAD Thái Hùng tại Chư Prông, Gia Lai; mở rộng hoạt động kinh doanh và dịch vụ xe máy Honda.',
  '2017-head-toan-trung': 'HEAD Thái Hùng đổi tên thành HEAD Toàn Trung.',
  '2018-2019-mo-rong': 'Mở rộng hoạt động tại Gia Lai và Bình Định; năm 2019 được ghi nhận thứ 18 trong 770 đại lý Honda hoạt động hiệu quả.',
  '2020-2021-thanh-tich-doi-ngu': 'Đội ngũ đạt giải Nhất nhân viên phụ tùng năm 2020 và 2021, cùng giải Nhì nhân viên bán hàng toàn quốc năm 2021.',
  '2021-11-01-oto-luot': 'Thành lập Toàn Trung 9 tại 793 Quốc lộ 13 và Toàn Trung 10 tại 88 Quốc lộ 1A, TP. Thủ Đức.',
  '2022-honda-ghi-nhan': 'Được ghi nhận thứ 25 trong khoảng 800 đại lý Honda hoạt động hiệu quả và thuộc nhóm Top 29 công ty hoạt động xuất sắc.',
  '2024-luxury-car': 'Khai trương Toàn Trung Luxury Car tại 787–789 Quốc lộ 13, TP. Thủ Đức.',
  '2024-2025-top-19': 'Hệ thống được ghi nhận trong Top 19 công ty toàn quốc theo thông tin truyền thông của HEAD Toàn Trung.',
  '2025-chuyen-doi-so': 'Phát triển nền tảng trực tuyến xeluottoantrung.com để khách hàng tra cứu và kết nối tư vấn xe.',
  '2026-dp-auto': 'Ra mắt trạm dịch vụ ô tô DP Auto tại 787–789 Quốc lộ 13, TP. Thủ Đức.',
};

const sourceNote = 'Chủ dự án xác nhận đủ 12 mốc và cho phép công bố ngày 22/10/2026; nguồn biên tập: timeline-toan-trung-1997-2026.md.';

async function main() {
  const [pages, sections, milestones, stories, assets] = await Promise.all([
    db.select().from(aboutStoryPages).where(eq(aboutStoryPages.id, ABOUT_PAGE_ID)),
    db.select().from(aboutStorySections), db.select().from(aboutMilestones),
    db.select().from(aboutCustomerStories), db.select().from(aboutStoryAssets),
  ]);
  if (pages.length !== 1 || pages[0].revision !== 0 || pages[0].publishedSnapshot ||
      sections.length !== 5 || milestones.length !== 12 || stories.length !== 0 || assets.length !== 0 ||
      milestones.some(m => m.verificationStatus !== 'needs_review' || m.publishStatus !== 'draft') ||
      milestones.some(m => !summaries[m.slug])) throw new Error('Draft changed; stop and review instead of overwriting');
  const candidateSections = sections.map(s => ({ ...s, ...sectionCopy[s.chapterKey as keyof typeof sectionCopy] }));
  const candidateMilestones = milestones.map(m => ({ ...m, summary: summaries[m.slug],
    sourceNote, verificationStatus: 'verified', publishStatus: 'published' }));
  const candidateAsset = {
    ownerType: 'section', ownerKey: 'opening', placement: 'desktop', storageKey: key,
    publicUrl: `${publicBase}/${key}`, mimeType: 'image/jpeg', sizeBytes: 225254,
    width: 1301, height: 1301, altText: 'Nhận diện và đội ngũ Toàn Trung tại cơ sở kinh doanh',
    rightsStatus: 'verified', sortOrder: 0,
  };
  // The existing object was HEAD-checked against R2 before this script was run.
  const preview = buildPublication(candidateSections, candidateMilestones, stories,
    [{ ...candidateAsset, id: randomUUID(), createdAt: new Date(), updatedAt: new Date() }]);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', chapters: preview.chapters.length,
    milestones: preview.milestones.length, stories: preview.stories.length,
    hero: preview.chapters[0]?.images[0]?.url, nextRevision: 1 }));
  if (!apply) return;

  writeFileSync('.tmp/about-story-before-publish-2026-10-22.json',
    JSON.stringify({ pages, sections, milestones, stories, assets }, null, 2));
  await db.transaction(async tx => {
    const [locked] = await tx.select().from(aboutStoryPages)
      .where(eq(aboutStoryPages.id, ABOUT_PAGE_ID)).for('update');
    if (!locked || locked.revision !== 0 || locked.publishedSnapshot) throw new Error('Draft changed during preparation');
    const updatedSections = [];
    for (const s of sections) {
      const [updated] = await tx.update(aboutStorySections).set({ ...sectionCopy[s.chapterKey as keyof typeof sectionCopy], updatedAt: new Date() })
        .where(eq(aboutStorySections.id, s.id)).returning();
      updatedSections.push(updated);
    }
    const updatedMilestones = [];
    for (const m of milestones) {
      const [updated] = await tx.update(aboutMilestones).set({ summary: summaries[m.slug], sourceNote,
        verificationStatus: 'verified', publishStatus: 'published', updatedAt: new Date() })
        .where(eq(aboutMilestones.id, m.id)).returning();
      updatedMilestones.push(updated);
    }
    const [asset] = await tx.insert(aboutStoryAssets).values(candidateAsset).returning();
    const snapshot = buildPublication(updatedSections, updatedMilestones, stories, [asset]);
    const now = new Date();
    await tx.update(aboutStoryPages).set({ revision: 1, publishedRevision: 1,
      publishedSnapshot: snapshot, publishedAt: now, updatedAt: now, updatedBy: null })
      .where(eq(aboutStoryPages.id, ABOUT_PAGE_ID));
    await tx.insert(auditLogs).values({ actorProfileId: null, action: 'about.publish.operator',
      entityType: 'about_story', entityId: ABOUT_PAGE_ID,
      oldData: { revision: 0, publishedRevision: null },
      newData: { revision: 1, publishedRevision: 1, milestones: 12,
        source: 'User confirmed all milestones and existing intro image in Codex session 2026-10-22' },
      ipAddress: '127.0.0.1', userAgent: 'Codex local operator script', requestId: randomUUID() });
  });
  console.log('Published revision 1 in one transaction.');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
