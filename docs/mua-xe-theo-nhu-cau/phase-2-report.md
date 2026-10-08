# Mua xe theo nhu cầu — Báo cáo Phase 2

> Cập nhật tiếp theo: [giao diện, phân trang 6 xe và migration 0016](ui-pagination-update.md). Giới hạn 0–5 trong báo cáo này đã được mở rộng thành 0–5000.

Ngày hoàn thành: 07/10/2026. Phạm vi: trang quản trị, API thống kê/lịch sử, cấu hình hiện hành, đánh giá xe và tương thích khảo sát công khai khi cấu hình thay đổi.

## 1. Chức năng hoàn thành

Admin → **Tiện ích → Mua xe theo nhu cầu**, URL `/tien-ich/mua-xe-theo-nhu-cau` trên ứng dụng admin.

| Tab | Chức năng |
| --- | --- |
| Tổng quan | Mặc định 30 ngày; lọc ngày Việt Nam; KPI khảo sát, xem kết quả, xem xe, liên hệ, không có kết quả; phân bố ngân sách/mục đích/ưu tiên/số người/môi trường/kỹ thuật; nhu cầu chưa đáp ứng; xu hướng ngày; hai bảng riêng cho xe được đề xuất và được bấm xem nhiều nhất. |
| Lịch sử khảo sát | Phân trang tại server; lọc ngày, khoảng ngân sách, mục đích, ưu tiên, số người, số kết quả và tương tác; tìm tiền tố mã phiên; mở chi tiết câu trả lời/câu hỏi lịch sử, điều kiện/trọng số, xe và giá/điểm/lý do lịch sử, kho hiện tại, timeline. |
| Cấu hình câu hỏi & thuật toán | Sửa trực tiếp một cấu hình: wording, thứ tự, nhãn lựa chọn, giới hạn chọn, ẩn/hiện mục tùy chọn, thêm/bỏ câu hỏi tham khảo, trọng số, ngân sách, số kết quả, retention và bật/tắt. Có xem thử theo kho thật, khôi phục mặc định trên form với xác nhận. |
| Đặc tính tư vấn xe | Dùng danh sách xe thật trong kho; lọc hãng/dòng/trạng thái/thiếu đánh giá; 21 tiêu chí hỗ trợ thuật toán; điểm 1–5 có nguồn hoặc chưa rõ; lưu một xe hoặc hàng loạt tối đa 50 xe. |

Giao diện tái sử dụng `PageHeader`, `StatsCard`, `DataTable`, `Input`, `Select`, `Textarea`, `Button`, `StatusBadge`, theme và client API có xác thực. Bốn tab có kích thước cột cố định khi đổi mục. Mobile thu gọn sidebar theo cách dùng của trang admin, form xếp dọc, bảng cuộn bên trong. Biểu đồ 30 ngày vừa chiều ngang ở mobile.

Không có danh sách phiên bản cấu hình, bản nháp, chờ duyệt, xuất bản hoặc thay đổi trạng thái phiên khảo sát. Không thêm thư viện hoặc AI.

## 2. Cách hiểu thống kê

- Khoảng lọc dựa trên **ngày tạo phiên khảo sát**, theo `Asia/Ho_Chi_Minh`. Mặc định 30 ngày, tối đa 366 ngày trong một lần xem. `from`/`to` bao gồm cả ngày bắt đầu và kết thúc.
- Tương tác được tính cho các phiên trong khoảng trên, kể cả tương tác xảy ra sau ngày kết thúc. UI giải thích rõ cách tính này.
- KPI xem kết quả/xem xe/liên hệ đếm **số phiên khác nhau** có sự kiện tương ứng. Hai lần bấm hai xe trong cùng một phiên vẫn là một phiên bấm xem xe.
- Các tỷ lệ KPI dùng tổng số phiên hoàn tất làm mẫu số; mẫu số bằng 0 trả 0%, hiển thị trạng thái chưa có dữ liệu.
- Tỷ lệ từng xe = số phiên bấm xem xe / số phiên có xe đó trong đề xuất. Mỗi bảng top giới hạn 20 xe, sắp xếp theo đúng chỉ số của bảng.
- Mục đích và ưu tiên cho phép nhiều lựa chọn: tổng số lựa chọn có thể lớn hơn tổng số phiên.
- Ngân sách được nhóm theo mức **tối đa khách chọn**: ≤300 triệu, >300–500 triệu, >500–800 triệu, >800 triệu–1 tỷ, >1 tỷ.
- “Nhu cầu chưa được đáp ứng” chỉ mô tả tiêu chí trong những phiên 0 kết quả; không tự kết luận vì sao không có xe. Các giá trị chưa chọn kỹ thuật được ghi “Không quan trọng”.
- Đây là lượt khảo sát và tương tác; không gọi là khách duy nhất, doanh số, đơn hàng hoặc tỷ lệ mua hàng.
- Tổng hợp, đếm, lọc và phân trang thực hiện tại PostgreSQL; browser không tải toàn bộ lịch sử để tính thống kê. Xu hướng có cả ngày 0 phiên.

## 3. Quyền và API

Tất cả endpoint bên dưới dùng tiền tố `/api/v1/admin/car-recommendations`, Bearer token và guards JWT/permissions hiện có; `Cache-Control: no-store`.

| Method / path | Quyền | Nội dung |
| --- | --- | --- |
| GET `/overview` | `car_recommendation.sessions.read` | Tổng hợp theo ngày; query `from`, `to` dạng `yyyy-mm-dd`. |
| GET `/sessions` | `car_recommendation.sessions.read` | Lịch sử, summary và nhãn snapshot; không trả capability/hash hoặc toàn bộ snapshot trong bảng danh sách. |
| GET `/sessions/:id` | `car_recommendation.sessions.read` | Snapshot đầy đủ, timeline và thông tin kho hiện tại. |
| GET `/settings` | `car_recommendation.sessions.read` | Singleton, mặc định an toàn, danh mục đánh giá, danh mục hãng/dòng. |
| PUT `/settings` | `car_recommendation.settings.update` | Body: `expectedUpdatedAt`, `enabled`, `retentionDays`, `config`. |
| POST `/preview` | `car_recommendation.sessions.read` | Body: `config`, `answers`; chấm thử trên kho thật, trả components; không lưu cấu hình hoặc phiên. |
| GET `/car-profiles` | `car_recommendation.sessions.read` | Xe thật + số tiêu chí có căn cứ, phân trang/lọc. |
| GET `/car-profiles/:id` | `car_recommendation.sessions.read` | Chi tiết xe/đánh giá hiện tại, `updatedAt`/`updatedBy`. |
| PUT `/car-profiles/:id` | `car_recommendation.profiles.update` | Body: `expectedUpdatedAt` (null lần đầu), `assessments`; thay bộ đánh giá của xe. |
| PUT `/car-profiles/batch` | `car_recommendation.profiles.update` | `items`, mỗi item có `carId`, `expectedUpdatedAt`, `assessments`, tùy chọn `merge`; tối đa 50 xe. |

Query lịch sử: `page` ≥1, `limit` 1–100, `from`, `to`, `minBudget`, `maxBudget`, `purpose`, `priority`, `passengers`, `resultCount` 0–5, `interaction` (`result_viewed`, `car_clicked`, `contact_clicked`, `none`), `search` (8–36 ký tự đầu UUID, hex/dấu gạch). Khoảng ngân sách khảo sát giao nhau với khoảng lọc. UI dùng 10 dòng/trang.

Query đặc tính xe: `page`, `limit`, `search` tên xe, `brandId`, `modelId`, `status`, `missing=true/false`. LIKE tìm tên được escape `%`, `_`, dấu gạch chéo; query còn lại tham số hóa. Xe đã soft delete không xuất hiện để chỉnh sửa.

Seed quyền giữ quy ước Phase 1: ADMIN/SUPER_ADMIN có cả ba quyền; SALES có quyền đọc. Quyền được kiểm tra tại backend, đồng thời ẩn nút sửa/menu khi thiếu quyền. Bộ test kiểm tra public 401, thiếu quyền 403 và tài khoản chỉ đọc không gọi được các lệnh PUT.

### Lưu trực tiếp và thay đổi đồng thời

- Singleton vẫn là duy nhất một hàng `recommendation_settings`, id=1.
- Lưu cấu hình khóa hàng, kiểm tra `expectedUpdatedAt`, validate trước khi ghi, cập nhật updater/timestamp và ghi `audit_logs` trong cùng transaction.
- Cập nhật đánh giá khóa các hàng xe theo thứ tự ID. Nếu một xe không tồn tại hoặc dữ liệu đã được người khác sửa, toàn bộ batch rollback. Không lưu một phần.
- HTTP 409: tải lại và đối chiếu thông tin mới nhất trước khi lưu lại. Timestamp là kiểm tra đồng thời, không phải workflow phiên bản.
- Câu hỏi scoring cốt lõi không được đổi key/type hoặc xóa lựa chọn scoring; bắt buộc giữ những câu cần để chấm. Kỹ thuật giữ tùy chọn “Không quan trọng”. Câu bị ẩn không được bắt buộc. Câu hỏi `custom_*` chỉ lưu tham khảo, không thêm công thức scoring mới.
- Tổng trọng số phải 100; ngân sách có trọng số >0; các nhóm khác 0–100. Giới hạn ngân sách, mốc gợi ý và số kết quả được kiểm tra nhất quán.
- Không có cache cho cấu hình/analytics này nên lưu xong lượt đọc tiếp theo nhận dữ liệu mới.

## 4. Hướng dẫn vận hành

### Chuẩn bị đánh giá xe

1. Mở **Đặc tính tư vấn xe**, lọc “Còn tiêu chí chưa rõ” và xe đang bán.
2. Mở xe, chọn điểm cho những tiêu chí đã có dữ liệu đúng xe.
3. Ghi nguồn/căn cứ (3–1000 ký tự), nên có ngày kiểm tra, tài liệu, số liệu đo hoặc điều kiện sử dụng. Thiếu căn cứ thì giữ “Chưa rõ”.
4. 1 = ít phù hợp, 2 = hạn chế, 3 = trung bình, 4 = phù hợp, 5 = rất phù hợp theo căn cứ. Scoring chuyển thành 0/25/50/75/100. Không suy an toàn/chi phí/giữ giá theo hãng.
5. Bấm **Lưu đánh giá**. Khảo sát mới dùng đánh giá vừa lưu; khảo sát cũ giữ điểm và căn cứ snapshot.
6. Để nhập hàng loạt, chọn ít nhất 2 xe, nhập các tiêu chí áp dụng, đối chiếu căn cứ với từng xe và lưu. Chỉ merge tiêu chí đã nhập; các tiêu chí khác của từng xe giữ nguyên. Để bỏ một đánh giá cũ, mở riêng xe và chọn “Chưa rõ”.

### Sửa khảo sát và trọng số

1. Mở **Cấu hình câu hỏi & thuật toán**, sửa wording/nhãn hoặc thứ tự câu hỏi.
2. Có thể ẩn kỹ thuật/phong cách, giảm số lựa chọn mục đích/ưu tiên; thêm câu hỏi lựa chọn tham khảo. Core scoring được bảo vệ.
3. Điều chỉnh trọng số tổng 100%; đọc phần cách chấm và bấm **Xem thử xếp hạng**. Bản xem thử dùng 5 người, đô thị, ưu tiên rộng rãi và ngân sách/mục đích nhập trên form. Câu tham khảo bắt buộc dùng lựa chọn đầu trong bản xem thử, không ảnh hưởng điểm; phong cách bắt buộc dùng “Mạnh mẽ / thực dụng”.
4. Bấm **Lưu thay đổi** để áp dụng cho khảo sát mới. Khôi phục mặc định chỉ thay form sau khi xác nhận; vẫn cần bấm Lưu thay đổi. Không xóa hồ sơ xe hoặc lịch sử.
5. Nếu cần tạm ngừng, bỏ tick bật tiện ích rồi lưu. Website hiển thị hướng dẫn xem kho/liên hệ.

### Xem báo cáo và lịch sử

1. Chọn ngày trong **Tổng quan**, bấm **Xem thống kê**. Đọc mẫu số bên dưới KPI trước khi so sánh tỷ lệ.
2. Xem ngân sách/ưu tiên chưa có xe đáp ứng và hai bảng top xe để hỗ trợ nhập kho/tư vấn.
3. Sang **Lịch sử khảo sát**, lọc và mở chi tiết. Giá/điểm lịch sử nằm tách với kho/giá hiện tại; không sửa trạng thái khảo sát.

### Retention

Mặc định 180 ngày, cho phép 1–730. Dùng lệnh prune từ Phase 1; cần lịch chạy trên server để thực thi:

```powershell
# Tại repo API; kiểm tra trước khi xóa.
npm.cmd run recommendations:prune
npm.cmd run recommendations:prune -- --apply
```

Rút ngắn retention áp dụng cho các phiên cũ ở lần prune tiếp theo; xóa phiên sẽ cascade event. Thống kê chỉ gồm dữ liệu còn giữ. Chưa cấu hình scheduler hoặc triển khai production trong lượt này.

## 5. Tương thích với web public

- Cấu hình admin đổi wording/thứ tự thì wizard sử dụng danh sách mới ở lần tải tiếp theo.
- Câu trả lời đang làm được đối chiếu với cấu hình mới: thu gọn tới giới hạn chọn, bỏ câu/option đã xóa và dữ liệu của mục đã ẩn. Không tự chọn câu bắt buộc mới hoặc nới ngân sách.
- Client gửi `configUpdatedAt` khi nộp. Nếu admin đã sửa giữa lúc khách tải và nộp khảo sát, API trả 409 trước khi lưu; khách dùng **Tải lại khảo sát**, kiểm tra câu trả lời rồi gửi. Retry một yêu cầu đã được lưu vẫn trả đúng phiên cũ trước khi kiểm tra cấu hình.
- Retry lỗi mạng giữ requestId/capability cũ, không dùng tải lại để tự tạo phiên mới.
- Snapshot mới lưu nhãn danh mục kỹ thuật khi khách đã chọn; admin đọc tên hãng/kiểu dáng/hộp số/nhiên liệu theo thời điểm khảo sát. Snapshot Phase 1 thiếu trường này vẫn đọc được; trường hợp đó hiển thị key gốc.
- Snapshot cũ không bị migrate/viết lại. Mở lại kết quả cũ vẫn kiểm tra tình trạng kho theo cơ chế Phase 1.

## 6. Migration và dữ liệu thật

- **`drizzle/0015_short_shotgun.sql`**: thêm GIN index `recommendation_sessions_criteria_idx` cho bộ lọc mục đích/ưu tiên JSONB. Không thêm bảng/cột dữ liệu hay thay đổi bản ghi lịch sử.
- Schema và `meta/0015_snapshot.json`/`meta/_journal.json` đồng bộ. Các index ngày tạo, hạn giữ, sự kiện/session và dedupe giữ từ migration 0014.
- Đã thử chuỗi migration trên PGlite và áp dụng 0015 lên database **phát triển/test được người dùng cho phép** bằng script có kiểm tra ledger. Không áp dụng production.
- Kiểm tra database thật: một cấu hình đang bật, 7 câu hỏi, 14 xe đủ điều kiện, 0 xe thiếu số ghế, **0 hồ sơ đánh giá có nguồn**. Không tạo xe/điểm/căn cứ giả. Khảo sát smoke trả 5 xe, top score/coverage 39%; record smoke và event đã được xóa sau kiểm tra.
- API thống kê/lịch sử/settings/profiles đọc database thật thành công. Database chưa có phiên khách trong 30 ngày tại thời điểm kiểm tra; biểu đồ/analytics chi tiết được đối chiếu trên fixtures riêng.
- RLS vẫn bật cho cả bốn bảng; vai trò `anon` và `authenticated` không có SELECT trực tiếp. Backend dùng pool hiện có, không tạo pool trong request.

Triển khai sau này: sao lưu DB theo quy trình môi trường, kiểm tra migration ledger, chạy migration/seed quyền hiện có, build/restart API/admin/web. Sau restart, token hiện tại lấy quyền qua `/admin/me`; đăng nhập lại/làm mới trang nếu menu chưa cập nhật. Migration này chỉ thêm index; khi cần gỡ index, dùng quy trình migration có kiểm soát, không sửa/xóa dữ liệu phiên hoặc singleton.

## 7. File thay đổi trong Phase 2

### API

- Mới: `src/modules/car-recommendations/admin.dto.ts`, `admin.service.ts`, `reporting.ts`, `assessment-catalog.ts`.
- Sửa: `controller.ts`, `module.ts`, `validation.ts`, `dto.ts`, `domain.ts`, `service.ts` trong cùng module.
- Sửa schema: `src/database/schema/car-recommendations.ts` (GIN index).
- Migration: `drizzle/0015_short_shotgun.sql`, `drizzle/meta/0015_snapshot.json`, `drizzle/meta/_journal.json`.
- Mới test: `test/car-recommendations-admin.test.ts`; sửa script kiểm tra thật `scripts/car-recommendations-live-check.ts`.
- Tài liệu: báo cáo này, `docs/mua-xe-theo-nhu-cau/implementation-plan.md` (kế hoạch Phase 2 viết trước code), README và thư mục screenshot.

### Admin

- Mới route: `src/app/tien-ich/mua-xe-theo-nhu-cau/page.tsx`.
- Mới: `src/components/car-recommendations/{Manager,Overview,History,Details,ConfigForm,Profiles,shared}.tsx`, `needs-admin.css`; `src/lib/car-recommendations.ts`.
- Sửa `src/components/Sidebar.tsx`: thêm menu tiện ích và lọc riêng entry có khai báo permission; không đổi mục menu hiện có.
- Mới: `scripts/car-recommendations-admin-check.mjs`.

### Web

- Sửa `lib/car-recommendations.ts`, `components/utilities/car-recommendations/NeedsSurvey.tsx`: tương thích cấu hình mới và nhận biết thay đổi giữa lúc làm khảo sát.
- Sửa `scripts/car-recommendations-web-check.mjs`: bổ sung kiểm tra thay đổi admin và HTTP fixture riêng phục vụ SSR khi API thật không chạy.

Các file Phase 1 còn nằm trong working tree được giữ nguyên theo tiến trình trước. Không commit/push/deploy, không thay CRUD xe, menu public, chatbot, định giá hoặc lịch xem ngày. Ngoài phạm vi admin mới, thay đổi web chỉ để bảo đảm cấu hình admin vận hành đúng với wizard này.

## 8. Kiểm thử và bằng chứng

| Kiểm tra | Kết quả |
| --- | --- |
| API `npm.cmd test` | **107/107 đạt**; gồm 8 kiểm thử nhóm admin mới và 13 kiểm thử public/scoring Phase 1. Regression có CRUD xe, danh mục, nội dung/SEO, phụ kiện, tìm kiếm, chatbot và định giá. |
| API lint / typecheck / build / db:check | Đạt. |
| Admin typecheck, lint các file sửa/mới và production build `--webpack` | Đạt. |
| Admin browser 1440/768/390/360 px | Đạt: 4 tab, layout tab cố định, phân trang/filter/detail, lưu cấu hình/đánh giá riêng và batch, read-only/thiếu quyền, lỗi/empty/retry, không tràn ngang toàn trang hoặc lỗi JS. |
| Web typecheck, lint phần tính năng và production build | Đạt; build vẫn có cảnh báo `<img>` ở các module hiện hữu. |
| Web browser 1440/768/390/360 px | Đạt: wizard/back/skip/validation/rank ưu tiên/budget/consent/retry/refresh/card/event/zero/offline. |
| Web đổi cấu hình admin | Đạt: đổi thứ tự, giảm giới hạn, ẩn kỹ thuật/phong cách, thêm câu bắt buộc, loại câu cũ, stale config 409 và tải lại gửi thành công. |
| Public route shells | `/`, `/san-pham`, `/ban-xe`, `/len-doi`, `/tien-ich/xem-ngay-mua-xe`, `/tien-ich/dinh-gia-xe`: HTTP 200 với fixture CMS/catalog riêng. Chỉ kiểm tra shell, không khẳng định đã thử mọi thao tác của các tiện ích này trên trình duyệt. |
| Database phát triển/test | Migration, seed idempotent, RLS/quyền, đọc API admin, retry/event dedupe và cleanup smoke: đạt. |

Fixture analytics kiểm tra trực tiếp SQL: ranh giới 00:00 Việt Nam, khoảng lọc gồm 3 phiên với 1 phiên 0 kết quả; 2 phiên xem kết quả =66,7%, 1 phiên xem xe =33,3%, 1 phiên liên hệ =33,3%; nhiều tương tác trong một phiên không tăng mẫu số; tổng xu hướng bằng tổng cohort, cả ngày 0. Kiểm tra malformed date/filter, pagination, escaping, protected scoring keys, tổng trọng số, optimistic concurrency, audit transaction, thiếu căn cứ, batch rollback, preview không lưu và snapshot không đổi.

Lệnh chính:

```powershell
# API
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run db:check
# Chỉ môi trường phát triển/test đã xác nhận; script không in secrets.
node node_modules/tsx/dist/cli.mjs scripts/car-recommendations-live-check.ts --development-test --apply-schema

# Admin (browser test cần Next admin đang chạy; mặc định :3001)
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src/components/car-recommendations src/lib/car-recommendations.ts src/app/tien-ich/mua-xe-theo-nhu-cau/page.tsx src/components/Sidebar.tsx
npm.cmd run build -- --webpack
node scripts/car-recommendations-admin-check.mjs

# Web
node node_modules/typescript/bin/tsc --noEmit
$env:ESLINT_USE_FLAT_CONFIG='false'
node node_modules/eslint/bin/eslint.js components/utilities/car-recommendations lib/car-recommendations.ts
npm.cmd run build
# Trong cửa sổ riêng: preview production và fixture SSR, tránh chia sẻ .next-dev với server khác.
$env:API_URL='http://127.0.0.1:4015'
node node_modules/next/dist/bin/next start -p 3003 -H 127.0.0.1
# Cửa sổ kiểm thử, từ repo web; cần biên dịch test API trước.
$env:NEEDS_FIXTURE_PORT='4015'
node scripts/car-recommendations-web-check.mjs
```

Browser tests dùng dữ liệu tổng hợp trên PGlite/Nest và giả lập session đăng nhập; mọi request auth/database thật được chặn. HTTP fixture chỉ mở loopback trong lúc chạy test và đóng khi kết thúc. Preview tạm do lượt này khởi chạy đã được dừng; không tắt server của người dùng.

Ảnh fixture (không có dữ liệu khách hoặc token):

| Tab | Desktop | Mobile |
| --- | --- | --- |
| Tổng quan | [1440 px](screenshots/overview-1440.png) | [390 px](screenshots/overview-390.png) |
| Lịch sử / chi tiết | [1440 px](screenshots/history-1440.png) | [390 px](screenshots/history-390.png) |
| Cấu hình | [1440 px](screenshots/settings-1440.png) | [390 px](screenshots/settings-390.png) |
| Đặc tính xe | [1440 px](screenshots/profile-1440.png) | [390 px](screenshots/profile-390.png) |

## 9. Giới hạn còn lại

- Cần admin nhập căn cứ đánh giá đúng từng xe để gợi ý mục đích/ưu tiên/môi trường có chất lượng. Khi chưa nhập, thuật toán chỉ dùng dữ liệu đã biết và hiển thị hạn chế; không giả lập độ an toàn hoặc khả năng giữ giá.
- Không thêm export CSV (tùy chọn trong prompt), dashboard giao dịch, khách duy nhất hoặc dữ liệu CRM.
- Chưa đo tải lớn trên production; kiểm thử query/server pagination và dữ liệu thật hiện có không thay thế load test.
- Chưa thử trên thiết bị Safari/iPhone vật lý; responsive được kiểm tra bằng trình duyệt Chromium ở các kích thước trên.
- Chưa chạy toàn bộ lint admin cũ; lint file thay đổi và production typecheck/build đạt. Lịch chạy retention và triển khai production thuộc vận hành môi trường.

**Phase 2 hoàn thành. Dừng tại phạm vi này.**
