# Bàn giao tính năng Xem ngày mua xe

## Trạng thái

Đã triển khai theo thứ tự: khảo sát → database và quyền → lịch Việt Nam → thuộc tính lịch → bộ quy tắc → API → admin/simulator → giao diện public → kiểm thử.

- Website: `/tien-ich/xem-ngay-mua-xe`; `/xem-ngay-mua-xe` chuyển hướng về đường dẫn này.
- Admin: **Tiện ích → Xem ngày mua xe**, đường dẫn `/tien-ich/xem-ngay-mua-xe` trên ứng dụng admin.
- Migration và seed đã áp dụng vào database trong `.env` API sau khi chủ website xác nhận đây là database phát triển/test và cho phép áp dụng.
- Bàn giao ban đầu để tiện ích tắt. Theo yêu cầu kích hoạt tiếp theo, đã bổ sung bộ tham khảo 1.1.0, nguồn và ca đối chiếu độc lập cho cả ba mục đích. Quy trình kích hoạt và phạm vi nguồn ở [09-activation.md](./09-activation.md).

## Database

Migration: `drizzle/0010_outgoing_polaris.sql`, snapshot và journal tương ứng.

| Bảng | Nội dung |
| --- | --- |
| `auspicious_date_settings` | Cấu hình tiện ích, hiển thị, SEO, disclaimer, CTA |
| `auspicious_rule_sets` | Phiên bản theo mục đích, revision và báo cáo kiểm tra |
| `auspicious_rules` | Handler, trọng số, mức ưu tiên, loại trừ, tham số |
| `auspicious_rule_contents` | Nội dung giải thích tiếng Việt |
| `auspicious_rule_sources` | Tài liệu, trạng thái xác minh và người xác minh |
| `auspicious_reference_cases` | Ca tham chiếu cùng kết quả kỳ vọng nhập độc lập |
| `auspicious_change_logs` | Nhật ký quản trị trước/sau và lý do thay đổi |

Seed riêng: `npm run db:seed-auspicious -- --apply`. Chạy không có `--apply` chỉ in kế hoạch. Seed không ghi đè bản ghi đã tồn tại, không xác minh nguồn và không xuất bản quy tắc.

Kiểm tra database sau seed: 1 cấu hình, 3 phiên bản, 21 quy tắc, 21 nội dung, 0 nguồn, 0 ca tham chiếu, 10 quyền. Khi kiểm tra cuối, 3 phiên bản đã ở trạng thái `REVIEW`; nhật ký ghi nhận 3 thao tác `version.review`. Không ghi đè các thao tác quản trị này.

Quyền có tiền tố `auspicious_date.`:

`read`, `settings.update`, `rules.read`, `rules.update`, `content.update`, `sources.manage`, `versions.manage`, `publish`, `simulate`, `audit.read`.

ADMIN và SUPER_ADMIN được cấp 10 quyền; CONTENT_EDITOR được cấp `read`, `rules.read`, `content.update`. Seed chỉ cấp các quyền của tính năng mới.

## API mới

Tiền tố public: `/api/v1/auspicious-dates`.

| Method | Endpoint | Công dụng |
| --- | --- | --- |
| GET | `/config` | Cấu hình, mục đích được xuất bản, giới hạn, ngày hiện tại UTC+7 |
| POST | `/search` | Tính toàn bộ khoảng ngày, lịch tháng và danh sách đề xuất |
| POST | `/detail` | Chi tiết ngày, giải thích và giờ phù hợp nếu được bật |

Tiền tố admin: `/api/v1/admin/auspicious-dates`. Tất cả yêu cầu JWT và quyền tương ứng.

| Method | Endpoint |
| --- | --- |
| GET | `/overview`, `/settings`, `/versions`, `/versions/:id`, `/versions/:id/cases`, `/audit` |
| PUT | `/settings`, `/rules/:id/content`, `/sources/:id`, `/cases/:id` |
| PATCH | `/rules/:id` |
| POST | `/versions`, `/versions/:id/clone`, `/versions/:id/review`, `/versions/:id/validate`, `/versions/:id/publish`, `/versions/:id/archive` |
| POST | `/rules/:id/sources`, `/versions/:id/cases`, `/simulate`, `/versions/:id/regression` |
| DELETE | `/sources/:id`, `/cases/:id` |

Public không nhận trọng số hoặc quy tắc, không trả trace quản trị, không lưu ngày sinh/lịch sử tra cứu vào database. Khoảng tìm kiếm tính cả hai đầu, tối đa 90 ngày; cấu hình có thể giảm giới hạn. Lịch hỗ trợ năm dương lịch 1900–2099.

## Admin và website

Admin có các tab: tổng quan, cấu hình, quy tắc, nội dung, nguồn, phiên bản, kiểm thử, ca tham chiếu và nhật ký. Simulator có trace từng quy tắc và so sánh hai phiên bản. Xuất bản cần xác nhận cùng lý do; backend kiểm tra lại trong transaction. Bản đã xuất bản không sửa trực tiếp; phải nhân bản sang phiên bản mới.

Public có form ngày sinh/mục đích/khoảng ngày, lịch tháng, ngày đề xuất, chi tiết hiển thị trong trang, giải thích, disclaimer và nút đến `/san-pham`. Giao diện dùng màu sắc, header/footer và icon tiện ích hiện có; có loading, retry, lỗi và trạng thái bảo trì.

## Files thay đổi theo repo

### API

- `src/modules/auspicious-date/`: domain/defaults, DTO/controller/module, repository, public/admin/version services.
- `src/modules/auspicious-date/calendar/`: timezone, Julian day, adapter Astronomy Engine, âm lịch Việt Nam, Can Chi, dữ liệu lịch.
- `src/modules/auspicious-date/almanac/`: quan hệ địa chi/ngũ hành, nạp âm, trực, giờ, ngày kiêng.
- `src/modules/auspicious-date/compatibility/`: hồ sơ ngày sinh theo năm âm lịch.
- `src/modules/auspicious-date/engine/`: registry, đánh giá, phân loại/xếp hạng, kiểm tra tham chiếu.
- `src/database/schema/auspicious-date.ts`, schema index; migration SQL/snapshot/journal.
- `src/database/seed/auspicious-date.ts`, `roles-permissions.ts`.
- `src/app.module.ts`, `package.json`, `package-lock.json`.
- `scripts/auspicious-regression.ts`, 3 file test mới, `docs/auspicious-date/`.

### Admin

- `src/app/tien-ich/xem-ngay-mua-xe/page.tsx`.
- `src/components/auspicious-date/Manager.tsx`, `Editor.tsx`, `SettingsForm.tsx`, `Simulator.tsx`.
- `src/lib/auspicious-date.ts`, `src/components/Sidebar.tsx`, `src/app/globals.css`.

### Web

- `app/tien-ich/xem-ngay-mua-xe/page.tsx`, `app/xem-ngay-mua-xe/page.tsx`.
- `components/utilities/AuspiciousDateViewer.tsx`.
- `components/utilities/auspicious-date/DateForm.tsx`, `ResultCalendar.tsx`, `DateDetail.tsx`.
- `lib/auspicious-date.ts`, `lib/public-api.ts`, `app/globals.css`.
- `components/layout/Header.tsx`: chuyển logo sang Next Link để đạt lint; giữ thao tác về đầu trang, bỏ hash gây cuộn sai.
- `scripts/validate-assets.mjs`: nhận diện các route App Router thật thay vì chỉ kiểm tra danh sách route của website cũ.
- `scripts/auspicious-web-check.mjs`, `scripts/auspicious-admin-check.mjs`: kiểm thử trình duyệt với dữ liệu tạm, không ghi database.

## Kiểm thử và giới hạn bằng chứng

- API: lint, typecheck, build, kiểm tra migration bằng `db:check`; bộ test hiện có và mới đều vượt qua, tổng 20 test.
- Admin: lint và TypeScript/build vượt qua. Các cảnh báo ảnh/font có sẵn vẫn được báo, không tắt kiểm tra.
- Web: lint, typecheck, build và validate vượt qua. Validate không có asset thiếu; vẫn báo các khoảng trống dữ liệu mirror cũ trong `sourceGaps`.
- `auspicious-calendar.test.ts`: mốc Tết, tháng nhuận, UTC+7 khác UTC+8, Can Chi, ngày không hợp lệ và chuyển đổi hai chiều trên dải năm hỗ trợ, gồm 2033.
- `auspicious-engine.test.ts`: quan hệ, nạp âm/giờ/ngày kiêng, match/non-match, quy tắc tắt, loại trừ quan trọng thắng điểm cao và thứ tự ổn định.
- `auspicious-api.test.ts`: chạy migration bằng database PGlite riêng; quy trình xuất bản, nguồn/ca tham chiếu, bất biến, regression, JWT/RBAC, DTO và public không lưu truy vấn. Ca kỳ vọng tạo từ engine chỉ dùng trong database kiểm thử quy trình; không seed thành dữ liệu nghiệp vụ.
- Playwright public: 1440/1024/768/390/360px; form, lịch, chi tiết, focus, retry, bảo trì, CTA, không tràn ngang/lỗi hydration.
- Playwright admin: 1440/390px; payload lưu, simulator, nguồn thêm/xóa, từ chối xuất bản, nhật ký và quyền. API trình duyệt được intercept bằng fixture; kiểm thử lưu thật vào database riêng nằm trong test API.
- Kiểm tra trực tiếp public với cấu hình database test: HTTP 200 và bảo trì. Kiểm tra logo desktop/mobile: từ tiện ích về đầu trang chủ và bấm logo khi đã ở trang chủ.
- Đo cục bộ engine trên 90 ngày: lần đầu 23ms; 10 lần tiếp theo median 6ms, tối đa 12ms. Engine không truy vấn database. Đây là đo trên máy phát triển, không phải kết quả tải HTTP production.

Chạy regression chỉ đọc:

```sh
npm run auspicious:regression -- --version <UUID>
```

Báo cáo Total/Pass/Fail/Changed; trả mã lỗi khi chưa đạt. Không tự ghi đè expected.

## Các quyết định tại thời điểm bàn giao ban đầu

1. Cung cấp/xác minh nguồn cho các quy tắc bật, đặc biệt danh sách trực phù hợp riêng cho BUY_CAR, RECEIVE_CAR và SIGN_CONTRACT. `PURPOSE_OFFICER` chưa được bật trong seed vì chưa có dữ liệu đã duyệt.
2. Nhập ca tham chiếu độc lập, có nguồn và kỳ vọng đúng, bao phủ match/non-match của các quy tắc bật. Không dùng kết quả engine làm bằng chứng tự xác nhận engine.
3. Duyệt trọng số/ngưỡng phân loại: đây là chính sách sản phẩm khởi tạo, không phải khẳng định từ một tài liệu lịch truyền thống.
4. 28 Tú, cát thần và hung thần mới có cấu trúc dữ liệu/TODO, trả unavailable; chưa triển khai cách tính vì thiếu nguồn/spec rõ ràng. Không đưa vào kết quả public.
5. Quy tắc ngũ hành và giờ phù hợp chưa bật; chỉ bật sau khi có nguồn xác minh và kiểm tra tương ứng.

Các mục nguồn/Trực/giờ đã được bổ sung cho bộ 1.1.0 trong đợt kích hoạt; ngũ hành, 28 Tú, cát thần/hung thần vẫn không tham gia kết quả. Xem 09-activation.md để biết chính xác bộ đang dùng.

## Trình tự kích hoạt phiên bản mới

1. Mở bộ quy tắc từng mục đích; sửa cấu hình/nội dung và bổ sung nguồn.
2. Xác minh nguồn cùng URL hoặc trang sách, ghi chú và lý do.
3. Nhập ca tham chiếu độc lập; chạy simulator và regression.
4. Chuyển chờ duyệt → kiểm tra đạt → xác nhận xuất bản.
5. Bật tiện ích trong Cấu hình; chọn các mục đích đã xuất bản. Nếu bật hiển thị giờ, các phiên bản đang dùng phải có quy tắc GOOD_HOURS đã được duyệt.

Không tự xuất bản để vượt qua các bước xác minh. Triển khai production cần kiểm tra môi trường, sao lưu theo quy trình hiện có và áp dụng migration/seed bằng quyền của người vận hành.
