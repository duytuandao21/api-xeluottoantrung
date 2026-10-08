# Mua xe theo nhu cầu — kế hoạch Phase 1

Đọc `prompt.md` tại workspace ngày 07/10/2026. Người giao việc yêu cầu triển khai **Phase 1**; dừng sau nghiệm thu, không làm UI/cấu hình/analytics Phase 2.

## Audit thực tế

- Web: Next 15 App Router, React 19; layout `.wapper`, `SiteBreadcrumb`, nút `tt-date-button`, `CarCard`, `SaleAccessProvider`, API cùng origin qua rewrite trong `next.config.ts`. Header và `lib/home-bottom.ts` đã có link `/tien-ich/mua-xe-theo-nhu-cau` cùng PNG của người dùng; route hiện chưa có implementation riêng. SEO dùng `routeMetadata`.
- Admin: Next 16, Tailwind, `components/ui.tsx` (DataTable, Select, Button), `Sidebar.tsx` có nhóm Tiện ích; `useAuth` lấy permissions, `sonner` toast, pagination server. Phase 1 không sửa UI admin. Phase 2 thêm mục và manager theo các pattern này.
- API: NestJS/Fastify, global JwtAuthGuard/PermissionsGuard, `@Public`, `@Permissions`, ValidationPipe whitelist + forbidNonWhitelisted, Throttler, sanitized exception filter, DatabaseService singleton Pool(max 10) + Drizzle node-postgres. Migration Drizzle hiện đến 0013. Không tạo pool trong request.
- Xe: `cars.status` = active/deposit/sold/inactive; chỉ **active**, `published_at IS NOT NULL`, `deleted_at IS NULL`, hãng/dòng active, giá >0 được đề xuất. Public CarsService hiện hiển thị cả deposit/sold; không sửa behavior đó. Cột thật: price, seat_count, mileage, year, fuel, transmission_id, body_style_id, brand_id, model_id, version_id. Join car_media cover chưa pending delete; slug detail thực tế `/<slug>`.
- Không có analytics khảo sát phù hợp. Audit logs là thay đổi quản trị; leads có PII; không dùng chúng thay cho khảo sát ẩn danh. Không suy an toàn/giữ giá/chi phí/sang trọng từ hãng/kiểu dáng. Hồ sơ đánh giá ban đầu trống.

## File và schema

API: module mới `src/modules/car-recommendations/{domain,defaults,validation,dto,engine,repository,service,controller,module}.ts`; schema mới `src/database/schema/car-recommendations.ts`; seed idempotent và CLI retention; migration additive 0014. Register module/schema, thêm permissions seed và bảo vệ log capability. Tests engine/API dùng PGlite riêng.

Web: route `app/tien-ich/mua-xe-theo-nhu-cau/page.tsx`, `lib/car-recommendations.ts`, components và CSS scoped `components/utilities/car-recommendations/`. Không sửa header, global style, card xe hoặc tiện ích khác. Không thêm dependency.

4 bảng: singleton `recommendation_settings` (id=1, enabled, questions/weights JSONB, retention_days, updated_by/at); `car_recommendation_profiles` (unique car_id, JSON assessments score 1–5 + source, updated_by/at); `recommendation_sessions` (UUID, unique request_id, capability hash, answers hash, raw/normalized answers, immutable questions/config/ranking/inventory snapshot, completion ms, expires_at); `recommendation_events` (session FK cascade, whitelist type, nullable car_id as snapshot UUID, dedupe key unique, created_at). Không versions/drafts/approvals. Bảng backend only, bật RLS không policy anon, revoke public/anon/authenticated khi role tồn tại. Retention CLI dry run mặc định, apply chủ động theo cấu hình; FK xóa events cùng session.

## Contract

- GET `/api/v1/car-recommendations/config`: enabled, 7 câu hỏi, presets/limits, technical options từ catalog/inventory; không assessments/private config.
- POST `/sessions`: `{requestId: UUID, capability: base64url(32 random bytes), noticeAccepted:true, answers:{purposes,budget:{min,max},passengers,requireSeats,environment,priorities,technical,style}, completionMs}`. Không field họ tên/điện thoại. Validation cả DTO và stable option keys. Trả sessionId, top 5 snapshot cars + score/coverage/reasons/caveats, unavailable IDs, expiresAt. Capability ở body, không URL; không trả/lưu plaintext trên DB/log. Retry cùng request/capability/answers trả lại session; khác answers/key capability =409.
- POST `/sessions/:id/resume`: `{capability}`; mở lại cùng session, đối chiếu live stock trong một query, không sửa snapshot/không tạo session. Xe không còn bán không hiển thị thành đề xuất đang bán.
- POST `/sessions/:id/events`: `{capability,type,carId?}`. Token hash constant-time, carId phải trong kết quả snapshot. Dedupe theo session/type/car hoặc contact chung; không nhận score/price/PII client.
- Admin read API Phase 1: GET `/admin/car-recommendations/sessions?page=&limit=` và `/:id`; permission `car_recommendation.sessions.read`, không public history read. CRUD singleton/profiles và aggregate/UI thuộc Phase 2.
- Public config no-store; submit 20/min, resume 30/min, event 60/min theo Throttler hiện có. Config đọc singleton một lần/request: nhỏ và luôn fresh, Phase 2 save không phải invalidate cache phức tạp.

## Scoring

Pure engine, algorithm ID nội bộ để tái dựng. Hard: stock/public/positive price + max budget + minimum seats khi checkbox bắt buộc + thông số được đánh dấu bắt buộc. Min budget là soft. Không tự nới hard filters; 0 kết quả trả empty và CTA chỉnh câu trả lời.

Weights khởi tạo budget25/purpose20/priorities25/environment10/seats10/technical10. Không có technical preference thì bỏ nhóm đó khỏi mẫu số. Budget trong min–max=100, dưới min=80. Seat >= nhóm khách chọn=100, thiếu ghế khi soft giảm theo tỷ lệ; null unknown. Assessment 1–5 chuyển 0–100, chỉ chấm khi có source. Multi purpose trung bình, priorities hạng 1/2/3 dùng hệ số 3/2/1. Technical so khớp catalog thật; null không được coi là match.

Điểm = tổng(weight × điểm × phần dữ liệu có nguồn) / tổng weight đang áp dụng; unknown đóng góp 0. Coverage = tổng(weight × phần dữ liệu đã rõ) / tổng weight. Không làm unknown đạt điểm cao bằng cách bỏ hết denominator. Sort score desc → coverage desc → price asc → year desc → UUID lexical. Lý do chỉ từ match đã biết; 2–4 khi đủ dữ liệu, ít hơn nếu dữ liệu thiếu, có caveats minh bạch. Style chỉ lưu tham khảo.

Snapshot lưu questions/options thực sự hiển thị, weights, algorithm ID, criteria, kết quả từng thành phần/profiles có nguồn, giá/thông tin xe tại lúc gửi. Không serialize license plate/source URL/description/private profile notes ra public.

## Wireflow

Landing → bắt đầu → 7 bước từ question schema; card chọn, max2 purposes, budget preset/input, seats + checkbox bắt buộc, môi trường, ranked priorities max3, technical optional + required toggles, style optional → notice lưu khảo sát + privacy link → submit → 0–5 card xe hiện có + badge/lý do/coverage, xem chi tiết, gọi/Zalo theo contact web → chỉnh câu trả lời/làm lại.

sessionStorage trong một tab lưu answers/request key/capability để retry/refresh không duplicate; không gắn session vào URL. Resume đối chiếu xe vừa bán. Events không gửi lead/PII, click không chặn navigation. Keyboard, focus heading, loading/error/retry, reduced motion, responsive 360px+.

## Thứ tự và kiểm chứng

1. Audit + plan (file này). 2. Domain/defaults/validation/engine + unit tests. 3. Schema/migration/repository/service/public + protected history APIs + PGlite integration (idempotency, race, events, tokens, permissions, retention, sold car, immutable history). 4. Web wizard/result và browser smoke 1440/768/390/360, keyboard/refresh/retry/0 results. 5. Typecheck/lint/build, regression suites hiện hữu, kiểm tra migration trên DB riêng trước khi áp dụng DB phát triển/test đã được xác nhận trong cuộc trao đổi. Không migrate production/commit/deploy. 6. Report và dừng Phase 1.

Rủi ro: thiếu seat_count/profiles làm coverage thấp; nói rõ trên UI. Throttler in-memory theo tiến trình/IP proxy hiện có, nhiều instance cần ingress rate limit riêng khi vận hành lớn. Retry/cache result không được quảng bá xe đã bán. Retention cần lịch chạy CLI khi deploy. Quota query bounded (5000 inventory), không N+1. Rollback chỉ các bảng mới, phải export lịch sử trước khi xóa; không tác động bảng xe.

## Phase 2 — được giao triển khai sau nghiệm thu Phase 1

- Audit lại admin Next 16.3.5/React 19, hướng dẫn Next cài trong repo, `ui.tsx`, `auth-context`, `api/client`, Sidebar và Manager định giá. Tái sử dụng PageHeader/StatsCard/DataTable/Input/Select/Button, token theme và toast sonner. Thêm route/sidebar đúng Tiện ích, 4 tab có kích thước cố định, responsive. Web chỉ sửa tương thích câu hỏi được ẩn/sửa sau save; không sửa global UI.
- API thêm `admin.dto.ts`, `admin.service.ts`, `reporting.ts`, assessment catalog và controller methods vào module hiện có. Giữ singleton, snapshots và RLS Phase 1; thêm GIN index criteria bằng migration additive 0015 cho filter JSON. Audit dùng `audit_logs` có sẵn, không tạo versions/drafts/approval.
- GET overview aggregate tại PostgreSQL theo cohort phiên tạo trong khoảng ngày, mặc định 30 ngày, timezone Asia/Ho_Chi_Minh, tối đa 366 ngày. Tổng phiên/zero result, phiên có viewed/car/contact với mẫu số tổng phiên, phân bố ngân sách/mục đích/ghế/môi trường/kỹ thuật/ưu tiên, nhu cầu chưa đáp ứng, trend đầy đủ ngày 0, top xe đề xuất/click và trạng thái kho hiện tại. Không kéo toàn bộ phiên lên browser hoặc đếm là khách duy nhất/doanh số.
- Mở rộng GET sessions filter ngày/budget/purpose/priority/seats/result count/interaction/id prefix, pagination server; detail dùng nhãn snapshot + current stock + event timeline. Không cho public đọc. CSV là tùy chọn, không thêm vì bảng/detail đã đáp ứng phạm vi.
- GET settings trả config hiện hành, defaults và updatedAt; PUT settings validation strict + lock + expectedUpdatedAt, audit trong cùng transaction. Thay đổi áp dụng request mới ngay (không cache config). Core question keys/options giữ nguyên; cho sửa wording/order/limit hợp lệ, ẩn optional, thêm/xóa custom questions tham khảo. UI khôi phục defaults sau xác nhận, chỉ áp dụng khi bấm Lưu thay đổi.
- GET car-profiles phân trang và tìm theo xe/hãng/dòng/status/missing; dùng kho thật, không catalog riêng. GET detail / PUT theo carId; batch PUT tối đa 50 có transaction all-or-nothing, timestamps chống ghi đè. Assessment unknown bỏ field; chỉ score1–5 cùng nguồn/căn cứ hợp lệ, whitelist 21 tiêu chí engine hỗ trợ, có hướng dẫn đánh giá. Không seed đánh giá giả. Có thể sao chép form cho nhiều xe do admin chủ động chọn, mỗi xe giữ updater/audit.
- Các GET bảo vệ quyền read đã cấp; PUT settings cần settings.update, PUT profile/batch cần profiles.update, guard backend. Tests fixture có viewer/editor/admin/no permission; bảo vệ hashes/PII, SQL parameters, immutable snapshots và stale save.
- Thứ tự: plan này → API/filter/analytics/settings/profiles + tests PGlite → admin 4 tab và web tương thích cấu hình → browser fixtures desktop/mobile + permission/error/empty/concurrency → lint/typecheck/build/regression + migration DB phát triển/test → report/hướng dẫn vận hành. Không deploy/commit hoặc migrate production. Scheduler retention tiếp tục CLI Phase 1.
