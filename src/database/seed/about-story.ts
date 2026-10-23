import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { aboutMilestones, aboutStoryPages, aboutStorySections } from '../schema/index.js';
import { ABOUT_PAGE_ID } from '../../modules/about-story/service.js';

// Initial content for the single-record editor. Never overwrite existing admin edits.
const sections = [
  ['opening', 'Hành trình tạo dựng niềm tin'],
  ['milestones', 'Các cột mốc'],
  ['stories', 'Những chiếc xe – những câu chuyện'],
  ['people', 'Con người Toàn Trung'],
  ['future', 'Chặng đường phía trước'],
] as const;

const milestones = [
  { slug: '1997-khoi-nguon', periodLabel: '1997', stage: '1997-2017', title: 'Khởi nguồn hành trình', summary: 'Bắt đầu kinh doanh xe máy tại Gia Lai.', featured: true },
  { slug: '2010-nen-tang-doanh-nghiep', periodLabel: '2010', stage: '1997-2017', title: 'Hình thành nền tảng doanh nghiệp', summary: 'Thành lập Công ty TNHH MTV Toàn Trung, đặt nền tảng quản lý và phát triển hệ thống.', featured: false },
  { slug: '2011-head-thai-hung', periodLabel: '2011', stage: '1997-2017', title: 'Bước ngoặt Honda ủy nhiệm', summary: 'Ông Trần Văn Tư tiếp nhận HEAD Thái Hùng tại Chư Prông, Gia Lai.', featured: false },
  { slug: '2017-head-toan-trung', periodLabel: '2017', stage: '1997-2017', title: 'Chính thức mang tên HEAD Toàn Trung', summary: 'Thay tên HEAD Thái Hùng, xây dựng thương hiệu Toàn Trung.', featured: true },
  { slug: '2018-2019-mo-rong', periodLabel: '2018–2019', stage: '2018-2022', title: 'Mở rộng quy mô', summary: 'Mở rộng tại Gia Lai và Bình Định; năm 2019 được ghi nhận thứ 18 trong 770 đại lý Honda hoạt động hiệu quả.', featured: false },
  { slug: '2020-2021-thanh-tich-doi-ngu', periodLabel: '2020–2021', stage: '2018-2022', title: 'Ghi dấu thành tích đội ngũ', summary: 'Đội ngũ đạt giải Nhất nhân viên phụ tùng năm 2020 và 2021, cùng giải Nhì nhân viên bán hàng toàn quốc năm 2021.', featured: false },
  { slug: '2021-11-01-oto-luot', periodLabel: '01/11/2021', eventDate: '2021-11-01', stage: '2018-2022', title: 'Phát triển hệ thống Ô tô Lướt Toàn Trung', summary: 'Toàn Trung 9 và Toàn Trung 10 tại TP. Thủ Đức theo lịch sử nội bộ.', featured: true },
  { slug: '2022-honda-ghi-nhan', periodLabel: '2022', stage: '2018-2022', title: 'Tiếp tục được ghi nhận', summary: 'Được ghi nhận thứ 25 trong khoảng 800 đại lý Honda hoạt động hiệu quả và thuộc nhóm Top 29 công ty hoạt động xuất sắc.', featured: false },
  { slug: '2024-luxury-car', periodLabel: '09–10/2024', stage: '2024-2025', title: 'Khai trương Toàn Trung Luxury Car', summary: 'Showroom xe lướt cao cấp tại 787–789 Quốc lộ 13, TP. Thủ Đức.', featured: true },
  { slug: '2024-2025-top-19', periodLabel: '2024–2025', stage: '2024-2025', title: 'Tiếp nối thành tích toàn quốc', summary: 'Hệ thống được ghi nhận trong Top 19 công ty toàn quốc theo thông tin truyền thông của HEAD Toàn Trung.', featured: false },
  { slug: '2025-chuyen-doi-so', periodLabel: '2025', stage: '2024-2025', title: 'Đẩy mạnh chuyển đổi số', summary: 'Phát triển nền tảng trực tuyến xeluottoantrung.com để khách hàng tra cứu và kết nối tư vấn xe.', featured: false },
  { slug: '2026-dp-auto', periodLabel: '06/2026', stage: '2026', title: 'Ra mắt trạm dịch vụ ô tô DP Auto', summary: 'Trạm dịch vụ tại 787–789 Quốc lộ 13, TP. Thủ Đức.', featured: true },
] as const;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool);
    await db.transaction(async tx => {
      await tx.insert(aboutStoryPages).values({ id: ABOUT_PAGE_ID }).onConflictDoNothing();
      await tx.insert(aboutStorySections).values(sections.map(([chapterKey, title]) => ({ chapterKey, title })))
        .onConflictDoNothing({ target: aboutStorySections.chapterKey });
      await tx.insert(aboutMilestones).values(milestones.map((row, sortOrder) => ({ ...row, sortOrder })))
        .onConflictDoNothing({ target: aboutMilestones.slug });
    });
    console.log('About story initial content applied; existing admin edits were preserved.');
  } finally { await pool.end(); }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
