import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { contentEntries } from '../schema/index.js';

const policies = [
  {
    key: 'chinh-sach-quyen-rieng-tu', title: 'Chính sách quyền riêng tư', sortOrder: 1,
    body: `<p>Toàn Trung tiếp nhận thông tin bạn cung cấp để tư vấn mua xe, bán xe, lên đời xe và các dịch vụ liên quan. Chính sách này giải thích cách sử dụng thông tin khi bạn liên hệ qua website.</p>
<h2>Thông tin được tiếp nhận</h2><p>Tùy yêu cầu, bạn có thể cung cấp họ tên, số điện thoại, email, nội dung cần tư vấn và thông tin về xe như hãng, dòng xe, năm sản xuất, tình trạng, hình ảnh hoặc giấy tờ liên quan. Chỉ cung cấp những thông tin cần thiết cho yêu cầu của bạn.</p>
<h2>Mục đích sử dụng</h2><ul><li>Liên hệ để xác nhận yêu cầu, tư vấn sản phẩm và sắp xếp lịch xem xe, thẩm định hoặc lắp đặt phụ kiện.</li><li>Tiếp nhận phản hồi và hỗ trợ bạn trong quá trình giao dịch.</li><li>Gửi bản tin hoặc chương trình ưu đãi khi bạn đăng ký nhận tin; bạn có thể yêu cầu ngừng nhận.</li></ul>
<h2>Phạm vi chia sẻ</h2><p>Thông tin được sử dụng trong phạm vi nhân sự phụ trách xử lý yêu cầu. Việc chuyển thông tin cho đối tác hỗ trợ giao dịch cần phù hợp với mục đích đã thông báo và sự đồng ý của bạn, trừ trường hợp pháp luật quy định khác.</p>
<h2>Lưu giữ và quyền của bạn</h2><p>Thông tin cần được lưu giữ trong thời gian phù hợp với mục đích xử lý và các nghĩa vụ có liên quan. Bạn có thể liên hệ Toàn Trung để hỏi về thông tin của mình, yêu cầu chỉnh sửa, rút lại sự đồng ý hoặc đề nghị xóa dữ liệu. Yêu cầu sẽ được xem xét theo quy định áp dụng và phạm vi giao dịch.</p>
<h2>Liên hệ và cập nhật</h2><p>Để gửi yêu cầu về quyền riêng tư, vui lòng sử dụng các kênh tại <a href="/#tt-footer-contact">phần liên hệ của Toàn Trung</a>. Nội dung chính sách có thể được cập nhật khi cách sử dụng website hoặc dịch vụ thay đổi.</p>`,
  },
  {
    key: 'dieu-khoan-su-dung', title: 'Điều khoản sử dụng', sortOrder: 2,
    body: `<p>Website Toàn Trung cung cấp thông tin về ô tô, phụ kiện, dịch vụ và các công cụ tham khảo, giúp bạn tìm hiểu sản phẩm và kết nối với đội ngũ tư vấn.</p>
<h2>Sử dụng website</h2><p>Bạn có thể xem sản phẩm và gửi yêu cầu tư vấn. Khi gửi thông tin, vui lòng cung cấp dữ liệu chính xác và sử dụng nội dung, hình ảnh mà bạn có quyền chia sẻ. Không sử dụng website để đăng thông tin sai lệch, làm gián đoạn hoạt động hoặc truy cập dữ liệu không được phép.</p>
<h2>Thông tin sản phẩm và dịch vụ</h2><p>Giá, tình trạng còn hàng, hình ảnh và mô tả được cập nhật theo thông tin tại từng thời điểm. Vui lòng xác nhận lại với nhân viên trước khi đặt cọc hoặc giao dịch. Thông tin trên website không thay thế việc kiểm tra sản phẩm và các thỏa thuận bằng văn bản.</p>
<h2>Các tiện ích tham khảo</h2><p>Kết quả tính trả góp và dữ liệu từ các nguồn bên ngoài mang tính tham khảo. Điều kiện vay thực tế, lãi suất, phí và việc phê duyệt do đơn vị cung cấp khoản vay xác nhận; giá xăng dầu phụ thuộc thời điểm và khu vực công bố.</p>
<h2>Giao dịch và hỗ trợ</h2><p>Việc đặt cọc, thanh toán, bàn giao, bảo hành hoặc xử lý phát sinh được thực hiện theo nội dung đã thống nhất cho từng giao dịch và quy định áp dụng. Khi có thắc mắc, bạn có thể liên hệ Toàn Trung để được hướng dẫn.</p>
<h2>Liên kết và nội dung</h2><p>Website có thể dẫn đến bản đồ, mạng xã hội hoặc trang của đối tác. Các dịch vụ đó có điều kiện sử dụng riêng. Khi sử dụng lại hình ảnh, bài viết hoặc nhận diện của Toàn Trung, vui lòng liên hệ để thống nhất phạm vi sử dụng.</p>
<h2>Liên hệ</h2><p>Gửi phản hồi qua <a href="/#tt-footer-contact">các kênh liên hệ trên website</a>. Những điều khoản bổ sung cho một dịch vụ sẽ được thông báo khi bạn sử dụng dịch vụ đó.</p>`,
  },
  {
    key: 'dieu-khoan-dieu-kien-niem-yet', title: 'Điều khoản và điều kiện niêm yết', sortOrder: 3,
    body: `<p>Nội dung này áp dụng khi bạn gửi thông tin xe để Toàn Trung tư vấn thu mua, trao đổi hoặc hỗ trợ giới thiệu xe. Việc gửi biểu mẫu là bước tiếp nhận yêu cầu; các điều kiện giao dịch sẽ được xác nhận sau khi thẩm định.</p>
<h2>Thông tin và quyền đối với xe</h2><p>Người gửi cần là chủ sở hữu hoặc được chủ sở hữu đồng ý, ủy quyền phù hợp. Thông tin xe, giấy tờ và hình ảnh cung cấp phải phản ánh đúng tình trạng thực tế và có thể được đối chiếu khi thẩm định.</p>
<h2>Nội dung cần cung cấp</h2><ul><li>Hãng xe, dòng xe, phiên bản và năm sản xuất.</li><li>Số km đã sử dụng, tình trạng vận hành và lịch sử sửa chữa, bảo dưỡng mà bạn biết.</li><li>Tình trạng giấy tờ, nghĩa vụ tài chính hoặc hạn chế chuyển nhượng liên quan.</li><li>Hình ảnh thực tế và cách liên hệ để sắp xếp kiểm tra xe.</li></ul>
<h2>Thẩm định và giá</h2><p>Giá tư vấn ban đầu có thể thay đổi sau khi kiểm tra xe, hồ sơ và tình hình thị trường. Giá mua bán, phương thức thanh toán và thời gian bàn giao chỉ được áp dụng khi hai bên xác nhận thỏa thuận cho xe cụ thể.</p>
<h2>Giới thiệu và cập nhật thông tin</h2><p>Khi có sự đồng ý của chủ xe, Toàn Trung có thể sử dụng mô tả và hình ảnh được cung cấp để giới thiệu xe trong phạm vi đã thống nhất. Chủ xe cần thông báo khi xe đã bán hoặc thông tin thay đổi để nội dung được cập nhật. Thông tin liên hệ và giấy tờ cá nhân được xử lý theo <a href="/chinh-sach-quyen-rieng-tu">Chính sách quyền riêng tư</a>.</p>
<h2>Chi phí và xử lý phát sinh</h2><p>Các chi phí dịch vụ, hồ sơ, vận chuyển hoặc khoản thanh toán khác, nếu có, cần được thông báo và thống nhất trước khi thực hiện. Mọi đề nghị chỉnh sửa, ngừng giới thiệu xe hoặc phản hồi về giao dịch có thể gửi qua <a href="/#tt-footer-contact">các kênh liên hệ của Toàn Trung</a>.</p>`,
  },
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const why = JSON.parse(readFileSync(new URL('./why-choose.json', import.meta.url), 'utf8')) as typeof contentEntries.$inferInsert[];
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const db = drizzle(pool);
  try {
    await db.transaction(async tx => {
      const added = await tx.insert(contentEntries).values(why).onConflictDoNothing({ target: [contentEntries.group, contentEntries.key] }).returning({ key: contentEntries.key });
      let written = 0;
      for (const policy of policies) {
        const rows = await tx.insert(contentEntries).values({ ...policy, group: 'thiet-lap-chinh-sach-dieu-kien', status: 'active' })
          .onConflictDoUpdate({ target: [contentEntries.group, contentEntries.key],
            set: { title: policy.title, body: policy.body, sortOrder: policy.sortOrder, updatedAt: new Date() },
            setWhere: sql`${contentEntries.body} IS NULL OR btrim(${contentEntries.body}) = ''` }).returning({ key: contentEntries.key });
        written += rows.length;
      }
      console.log(`Imported ${added.length} missing website reasons and filled ${written} empty policies; existing article edits were preserved.`);
    });
  } finally { await pool.end(); }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
