# Slug phụ kiện ô tô

## Hành vi

- URL chính: `/phu-kien-o-to/camera-70mai-a810`. UUID vẫn là khóa chính, khóa ngoại và định danh cho API quản trị.
- API public `GET /api/v1/accessories/:key` nhận slug hoặc UUID; chỉ trả phụ kiện active. Web chuyển URL UUID cũ sang URL slug bằng HTTP 308.
- Tên tiếng Việt được bỏ dấu, viết thường, phân cách bằng `-`. Tên trùng dùng `-2`, `-3`…; tính cả bản ghi đang ẩn. Tên không tạo được ký tự ASCII dùng `phu-kien`; tên giống UUID được thêm tiền tố để không nhầm với URL cũ.
- Phần tên dùng tối đa 80 ký tự, tổng slug tối đa 100 ký tự để tương thích giới hạn tham số của Fastify hiện tại. Không tăng giới hạn router toàn hệ thống.
- Đổi tên, giá, thương hiệu, danh mục, ảnh hoặc trạng thái không đổi slug. Slug do backend/database quản lý; API quản trị từ chối gán hoặc sửa slug trực tiếp.
- Admin hiển thị đường dẫn dự kiến khi thêm; khi sửa hiển thị đường dẫn đã lưu, chỉ đọc. Preview không kiểm tra trùng qua mạng; đường dẫn chính xác được cấp khi lưu.
- Xóa phụ kiện vẫn là xóa thật như trước. Slug duy nhất trong các bản ghi còn lưu, gồm cả bản ghi ẩn; không thêm bảng lịch sử giữ slug của bản ghi đã xóa. UUID của bản ghi đã xóa trả 404.

## Database và tương thích

Migration **`0023_accessory_slugs.sql`** thêm cột, unique index và CHECK; backfill toàn bộ phụ kiện theo `created_at, id`. Giá, tên, ảnh, trạng thái, khóa ngoại và timestamp cũ được giữ nguyên.

Ba hàm `accessory_slug_base`, `next_accessory_slug`, `assign_accessory_slug` và trigger `accessories_assign_slug` thuộc migration. Trigger cấp slug ngay trong INSERT, trước kiểm tra NOT NULL/unique, rồi `RETURNING` trả giá trị cho NestJS. Không thêm extension; chuẩn hóa NFD dùng PostgreSQL UTF-8.

Khóa `pg_advisory_xact_lock(71483, 1)` chỉ tuần tự hóa việc cấp slug trong transaction tạo phụ kiện; không khóa các lượt đọc trang hoặc module khác. Cấp slug và audit nằm trong transaction hiện có. Các API cũ không biết cột slug vẫn INSERT được nhờ trigger; điều này hỗ trợ triển khai lần lượt và rollback API. Không thêm request kiểm tra slug khi mở form hoặc đọc trang; truy vấn chi tiết dùng index.

**Phải chạy migration SQL đầy đủ.** Không dùng schema push thay migration: snapshot Drizzle không thể hiện các hàm/trigger tùy chỉnh. Backup/restore database cũng cần giữ các hàm và trigger này.

## SEO và liên kết

- Thẻ phụ kiện dùng chung cho trang chủ, danh sách và phụ kiện liên quan đều dùng slug. Kết quả tìm kiếm API và sitemap cũng dùng slug.
- Web vẫn nhận UUID; response API cũ chưa có slug tiếp tục dùng UUID trong giai đoạn triển khai. Không thực hiện thêm lượt tải danh sách để tra slug.
- Canonical/Open Graph của trang chi tiết lấy đường dẫn slug. Migration chuyển cấu hình SEO riêng từ đường dẫn UUID sang slug và giữ ID/các trường tùy chỉnh.
- Canonical trỏ đúng URL UUID cũ trên hai domain website hiện có được đổi sang slug, giữ domain. Canonical tùy chỉnh trỏ nơi khác được giữ nguyên.
- Nếu đường dẫn slug đã có cấu hình SEO, cấu hình đó được ưu tiên; record của URL UUID được giữ lại để đối chiếu, không ghi đè hoặc xóa.
- JSON-LD tùy chỉnh và URL nằm trong nội dung tự do được giữ nguyên. Nếu từng tự nhập URL UUID vào những phần đó, cần đối chiếu riêng; không thay chuỗi hàng loạt.

## Kiểm tra local

API: chạy `npm run build`, `npx tsc -p tsconfig.test.json`, rồi các test:

```powershell
node --test --test-concurrency=1 .test-dist/test/accessory-slugs.test.js .test-dist/test/accessories.test.js .test-dist/test/search.test.js .test-dist/test/storage-cleanup.test.js .test-dist/test/services.test.js .test-dist/test/faqs.test.js .test-dist/test/recruitments.test.js
npm.cmd run db:check
```

Build Web và Admin bằng `npm.cmd run build`. Từ thư mục Web chạy:

```powershell
node scripts/accessory-slug-check.mjs
```

Runner cần cổng 3123/3125 trống; tự tạo PGlite trong bộ nhớ, dùng API/auth/storage fixture và production build local, tự đóng server/browser. Nó đọc duy nhất public Supabase URL trong `.env` Admin để đặt khóa session giả đúng tên; mọi request browser tới API/auth/R2 được chặn hoặc chuyển về fixture. Không dùng database hoặc R2 thật. Artifact ở `web-xeluottoantrung/artifacts/accessory-slugs/`.

PGlite xác minh migration, constraint, tạo trùng/song song, giữ slug khi sửa và visibility. Đây không phải benchmark hoặc phép đo khóa giữa nhiều kết nối PostgreSQL production.

### Kết quả kiểm chứng — 26/10/2026

- Build API, Web và Admin đạt; typecheck nằm trong các lượt build và compile test. ESLint các file API/Admin thay đổi không có lỗi; còn warning ảnh native có sẵn. Web build còn bốn warning có sẵn ngoài phần slug.
- Migration kiểm tra trên dữ liệu cũ gồm tên trùng, tên đã có đuôi `-2`, tiếng Việt dựng sẵn/NFD, tên giống UUID, tên dài, tên không tạo được ASCII và bản ghi ẩn. Toàn bộ trường cũ/timestamp được đối chiếu nguyên vẹn. Cấu hình SEO, noindex, canonical ngoài domain và cấu hình đích đã có đều được kiểm tra.
- API kiểm tra tạo trùng, sáu lần tạo song song trong fixture, nhiều tên trùng trong một INSERT, unique/CHECK, từ chối sửa slug, đổi tên/giá/trạng thái giữ slug, lookup slug/UUID và 404 khi ẩn. Test phụ kiện, tìm kiếm, storage cleanup, dịch vụ, FAQ và tuyển dụng cũng đạt trong các lượt kiểm tra liên quan.
- Production browser runner cuối đạt ở 1440/390 px: HTTP 308 UUID → slug, canonical/custom SEO/sitemap; danh sách/tải thêm/lọc, gallery/phụ kiện liên quan và link trang chủ; Admin upload fixture/tạo trùng/preview chỉ đọc/sửa tên và giá. Form danh mục không xuất hiện trường slug. Không `pageerror` trong lượt cuối; các browser/server do runner tạo được đóng.
- Sitemap unit kiểm tra URL slug, fallback UUID khi API chưa nâng cấp, loại URL không hợp lệ và các gate cache/noindex/canonical hiện có. Artifact: `artifacts/accessory-slugs/browser-results.json`, `sitemap/unit-checks.json` và screenshots trong Web.
- Chưa áp dụng migration vào database thật; chưa deploy. Ảnh/upload dùng fixture local, không phải kiểm chứng R2 production hoặc thứ hạng Google.

## Thứ tự triển khai khi được yêu cầu

1. Backup database, xác nhận đúng database đích và các migration còn thiếu. `db:migrate` áp dụng tất cả migration đang chờ, không chỉ 0023.
2. Từ API chạy `npm.cmd run db:migrate` trên database đã xác nhận. Đối chiếu số phụ kiện, không có slug rỗng/trùng, cấu hình SEO cũ và các trường hợp cấu hình slug đã tồn tại.
3. Triển khai API, sau đó Web và Admin. Không đưa Web slug lên trước API hỗ trợ slug.
4. Kiểm tra một URL UUID chuyển hướng một lần sang slug; canonical, sitemap, tìm kiếm, phụ kiện ẩn/đã xóa; tạo hai tên trùng và đổi tên một bản ghi. Đối chiếu UI/gallery và giá.

## Rollback

Giữ migration/cột/index/hàm/trigger khi rollback code: API cũ vẫn ghi được và UUID vẫn được giữ. Không drop slug hoặc đảo migration trực tiếp khi đã công bố URL slug. Nếu cần rollback phần hiển thị, giữ resolver/redirect public để các URL đã chia sẻ tiếp tục hoạt động; record SEO đã chuyển cũng cần giữ hoặc đối chiếu bằng bản backup. Không dùng reset toàn repository.

Việc tạo migration và chạy test local không áp dụng migration lên database cấu hình trong `.env`, không deploy hoặc restart production.
