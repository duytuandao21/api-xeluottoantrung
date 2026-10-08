# Mua xe theo nhu cầu — báo cáo Phase 1

> Cập nhật sau Phase 2: [giao diện, 6 xe mỗi lần tải và migration 0016](ui-pagination-update.md). Các giới hạn/giao diện dưới đây mô tả thời điểm nghiệm thu Phase 1.

Ngày thực hiện: **07/10/2026**. Phạm vi: public quiz, recommendation engine, lịch sử khảo sát và nền tảng API đọc lịch sử có phân quyền. **Chưa triển khai Phase 2** (trang admin, chỉnh cấu hình/đặc tính và analytics).

## Chức năng đã hoàn thành

- Route `/tien-ich/mua-xe-theo-nhu-cau`, vào từ menu Khám phá → Tiện ích hoặc thẻ tiện ích hiện có. SEO dùng `routeMetadata`, canonical cố định; không tạo URL chứa mã khảo sát/câu trả lời.
- Landing và wizard 7 câu lấy từ cấu hình: mục đích tối đa 2, ngân sách min/max và presets, nhóm người + số ghế bắt buộc, môi trường, tối đa 3 ưu tiên có sắp xếp, thông số optional + đánh dấu bắt buộc, phong cách optional.
- Giữ câu trả lời khi quay lại; bỏ qua xóa lựa chọn optional. Validation, focus heading, bàn phím, reduced motion, trạng thái gửi/lỗi/retry. Input ngân sách định dạng dấu chấm, font 16px để tránh iPhone tự zoom.
- Thông báo và checkbox đồng ý lưu khảo sát trước khi gửi, link chính sách quyền riêng tư hiện có. Không yêu cầu tài khoản/thông tin liên hệ; không tạo lead.
- Tối đa 5 xe với `CarCard` hiện có, giá thật, điểm xếp hạng, lý do và giới hạn dữ liệu. CTA xem chi tiết và liên hệ từng xe; CTA chỉnh câu trả lời/làm lại/xem kho/gọi/Zalo.
- Chỉ chọn xe `active`, đã công khai, chưa xóa, hãng/dòng active, model đúng hãng và giá dương. Loại xe cọc/đã bán. Max ngân sách, số ghế và kỹ thuật được đánh dấu bắt buộc là hard filters. Không tự nới điều kiện khi không có xe.
- PostgreSQL lưu nguyên câu trả lời hợp lệ, criteria, câu hỏi/nhãn, trọng số, thuật toán, dữ liệu xe/giá/điểm từng thành phần/lý do/assessment tại thời điểm gửi. Sửa cấu hình không viết lại lịch sử.
- Retry đồng thời cùng request/capability/câu trả lời trả cùng session, có unique constraint + transaction advisory lock. Refresh dùng resume, không gửi khảo sát mới. Capability 256 bit lưu trong sessionStorage của tab, chỉ lưu hash ở DB và không đưa lên URL/log.
- Resume đối chiếu xe đang bán và thông tin dùng trong đánh giá; xe đã bán hoặc thay đổi bị loại khỏi kết quả đang hiển thị, lịch sử gốc vẫn giữ. Ảnh và thông tin phụ lấy từ kho hiện tại cho xe còn hợp lệ.
- Events whitelist, kiểm tra capability và xe thuộc snapshot; mỗi session/type/car chỉ ghi một lần. Không nhận điểm, giá hay dữ liệu liên hệ từ client.

## Database phát triển/test

Đã áp dụng **`drizzle/0014_fast_prima.sql`** vào database trong `.env`, theo xác nhận trước đó của người giao việc rằng đây là **phát triển/test**. Không migrate production.

Migration chỉ thêm:

| Bảng | Vai trò |
| --- | --- |
| `recommendation_settings` | Một dòng `id=1`, config hiện hành, enabled, retention, updater |
| `car_recommendation_profiles` | Assessment theo đúng xe, score 1–5 + nguồn; mặc định chưa đánh giá |
| `recommendation_sessions` | Answers/criteria/snapshot bất biến, request/hash, thời gian, hạn lưu |
| `recommendation_events` | Tương tác hợp lệ, dedupe, FK session cascade |

4 bảng bật RLS, revoke PUBLIC/anon/authenticated. Kiểm tra DB thật xác nhận anon/authenticated không có quyền SELECT. API sử dụng kết nối server hiện có; không tạo pool mỗi request. Migration journal/meta đã cập nhật; không thay schema xe hoặc dữ liệu tính năng cũ.

Seed chạy hai lần vẫn có **1 config**, 3 permission; không chèn xe hay assessment giả. Cấu hình mặc định enabled, retention **180 ngày**. ADMIN/SUPER_ADMIN được cấp quyền mới; SALES chỉ đọc lịch sử.

Kiểm tra kho thật: **14 xe đủ điều kiện**, 0 xe thiếu số ghế, **0 hồ sơ assessment có nguồn**. Khảo sát smoke trả **5 xe**, top score/coverage **39/100 và 39%** khi chưa chọn kỹ thuật. Retry/events đã dedupe. Chỉ bản ghi khảo sát smoke do script tự tạo được xóa sau kiểm tra, events cascade; không lưu dữ liệu kiểm thử trong kho/lịch sử.

## API contract

Các đường dẫn dưới `/api/v1`:

| Method/path | Quyền / tác dụng |
| --- | --- |
| GET `/car-recommendations/config` | Public, câu hỏi/presets/limits/catalog; không weights/assessment/private notes |
| POST `/car-recommendations/sessions` | Public, validate + rank + lưu atomically; 20/phút/IP |
| POST `/car-recommendations/sessions/:id/resume` | Capability, mở lại kết quả, kiểm tra kho; 30/phút/IP |
| POST `/car-recommendations/sessions/:id/events` | Capability, whitelist/dedupe; 60/phút/IP |
| GET `/admin/car-recommendations/sessions?page=1&limit=20` | JWT + `car_recommendation.sessions.read`, pagination server, limit ≤100 |
| GET `/admin/car-recommendations/sessions/:id` | Cùng quyền, answers/snapshot/events; không hash/capability |

Tất cả response feature no-store. Global DTO whitelist/forbidNonWhitelisted, UUID validation, DB constraints, log lỗi không chứa SQL parameters. JWT/PermissionsGuard hiện có bảo vệ API admin ở backend.

Payload gửi mẫu (UUID và capability do client tạo ngẫu nhiên, **không tái sử dụng mẫu này khi vận hành**):

```json
{
  "requestId": "<UUID>",
  "capability": "<43 ký tự base64url từ 32 random bytes>",
  "noticeAccepted": true,
  "completionMs": 90000,
  "answers": {
    "purposes": ["family"],
    "budget": { "min": 200000000, "max": 500000000 },
    "passengers": "3_5", "requireSeats": true,
    "environment": "city", "priorities": ["safety", "space"],
    "technical": { "required": [] }, "style": "", "extras": {}
  }
}
```

Resume `{capability}`. Event `{capability,type,carId?}`; `car_clicked` bắt buộc carId; contact có thể gắn xe hoặc chung; viewed/restarted không có carId. Public không có endpoint GET lịch sử.

Trả `{sessionId,createdAt,expiresAt,criteria,results,unavailableCarIds,eligibleCount}`. Mỗi result có car (ID/slug/name/price/year/mileage/seats/public catalog/cover/branch), score, coverage, reasons, caveats, matchedFactors. `eligibleCount` thuộc snapshot lúc gửi. Admin detail giữ điểm thành phần và config/questions snapshot đầy đủ.

## Thuật toán và dữ liệu thiếu

Chi tiết ở [implementation-plan.md](implementation-plan.md). Weights mặc định 25/20/25/10/10/10 cho budget/purpose/priorities/environment/seats/technical. Technical không được chọn thì bỏ nhóm đó khỏi mẫu số. Priority hạng 1/2/3 dùng hệ số 3/2/1. Assessment chỉ hợp lệ khi score 1–5 và có nguồn; style chỉ lưu tham khảo.

`score = round(sum(weight × component_score × coverage) / sum(active_weight))`.

`coverage = round(100 × sum(weight × coverage) / sum(active_weight))`.

Unknown đóng góp 0, không tự gán điểm an toàn/giữ giá/tiết kiệm từ hãng. Tie-break: score giảm → coverage giảm → giá tăng → năm giảm → ID lexical. Không vượt hard filters. Min budget soft, xe rẻ hơn vẫn có thể được đề xuất và giải thích.

**Giới hạn dữ liệu hiện tại:** purpose/priorities/environment chưa có hồ sơ được xác minh, nên phần này không đóng góp điểm. UI ghi rõ dữ liệu hạn chế. Quản lý nhập assessment có nguồn thuộc Phase 2; không cần dựng workflow version/draft/approval.

## Kiểm chứng

| Kiểm tra | Kết quả |
| --- | --- |
| Toàn bộ API `npm.cmd test` | **99/99 pass**, gồm regressions xe/catalog/search/chatbot/phụ kiện/ngày mua xe/định giá |
| Engine + API feature | **13/13 pass**, gồm concurrency, hard filters, unknown, ranking, auth, event, retention dry-run/apply/cascade |
| API lint/typecheck/build | Pass |
| Drizzle `db:check` | Pass |
| Web typecheck + ESLint các file mới (legacy config) | Pass |
| Web production build | Pass; route public được Next nhận diện, còn warnings `<img>` từ các component hiện hữu |
| Browser actual UI + API in-memory PostgreSQL | Pass ở **1440, 768, 390, 360px** |
| Luồng browser | 7 bước, back/skip/max selections, đổi thứ tự, ngân sách, consent, 503 retry cùng key, UUID fallback cho HTTP IP, refresh không gửi lại, 5 thẻ, event, 0 xe, lỗi mạng config + retry |
| Smoke trang cũ | `/`, `/san-pham`, `/ban-xe`, `/len-doi`, tiện ích ngày mua xe và định giá trả 200 |
| DB phát triển/test thực tế | Migration/seed/protections/history/retry/events/resume pass; chỉ dùng kho thật |

Ảnh local (ignored artifacts, không commit): `web-xeluottoantrung/artifacts/car-recommendations-check/technical-{1440,768,390,360}.png` và `results-{1440,768,390,360}.png`. Browser kiểm tra không tràn ngang ở 4 kích thước. Đây là Chromium với kích thước mobile, chưa kiểm tra trên iPhone/Safari vật lý cho tính năng mới.

Lệnh tái kiểm chứng:

```powershell
# API
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run db:check

# Web: chạy server tạm ở port riêng, dừng sau khi kiểm tra
npm.cmd run dev -- -p 3003 -H 127.0.0.1
node scripts/car-recommendations-web-check.mjs
npm.cmd run typecheck
$env:ESLINT_USE_FLAT_CONFIG='false'
node node_modules/eslint/bin/eslint.js components/utilities/car-recommendations lib/car-recommendations.ts app/tien-ich/mua-xe-theo-nhu-cau/page.tsx
npm.cmd run build
```

Browser script chỉ dùng PGlite riêng qua Fastify injection; **không bật API server**, không ghi database mạng. Thư mục `.test-dist` API phải được compile bởi `npm.cmd test` trước. Log build đặt ở `artifacts`, không đặt trong `.next` vì Next dọn output trước khi build.

## Vận hành và retention

### Kiểm tra thủ công

1. Mở `/tien-ich/mua-xe-theo-nhu-cau`, bấm **Bắt đầu tìm xe**.
2. Chọn nhu cầu, ngân sách niêm yết và số người. Nếu cần đủ ghế, tick yêu cầu bắt buộc; kỹ thuật cũng có checkbox riêng cho từng thông số.
3. Chọn tối đa 3 ưu tiên, dùng mũi tên để đổi thứ tự; có thể bỏ qua thông số/phong cách optional.
4. Đồng ý thông báo lưu khảo sát rồi bấm **Xem xe phù hợp**. Kiểm tra giá không vượt max và xe còn đang bán. Nếu không có xe, chủ động **Điều chỉnh câu trả lời**.
5. Refresh để mở lại cùng kết quả; bấm xem chi tiết/liên hệ. **Làm lại khảo sát** bắt đầu lượt mới; chỉnh câu trả lời mà không thay đổi dữ liệu rồi gửi lại vẫn trả lượt cũ.
6. Với tài khoản có `car_recommendation.sessions.read`, gọi hai API admin ở trên để xem answers/snapshot/events. Giao diện quản trị tương ứng sẽ được làm ở Phase 2.

Không thêm biến môi trường/dependency. Web dùng rewrite `/api/v1` và cấu hình API hiện có. Sau khi nạp code mới, khởi động lại API/web theo quy trình hiện có nếu đang chạy bản build cũ. Không tự deploy hoặc để lại API server chạy từ kiểm thử.

Trên database phát triển/test đã được xác nhận:

```powershell
npm.cmd run db:seed-car-recommendations -- --apply --development-test
node node_modules/tsx/dist/cli.mjs scripts/car-recommendations-live-check.ts --development-test
```

Script live-check kiểm tra kho thật, tạo đúng một khảo sát smoke rồi xóa chính bản ghi đó. `--apply-schema` chỉ dành DB phát triển/test, chỉ chấp nhận ledger đang ở 0013 hoặc 0014 để tránh chạy các migration trước một cách âm thầm. Production cần quy trình approval/backup riêng.

Retention: chạy dry-run để xem số lượng, sau đó đặt lịch chạy **mỗi ngày** bằng scheduler hiện có khi deploy:

```powershell
npm.cmd run recommendations:prune
npm.cmd run recommendations:prune -- --apply
```

Xóa khi đã quá `expires_at` **hoặc** quá thời hạn cấu hình hiện tại tính từ created_at. Rút ngắn retention áp dụng cho phiên cũ ở lần prune tiếp theo; kéo dài không hồi sinh các phiên đã hết hạn. Batch 500, row lock/skip locked, statement timeout, event FK cascade. Không giữ PII/fingerprint hoặc aggregate riêng sau prune ở Phase 1. Chưa cấu hình scheduler trên máy production vì không có yêu cầu deploy.

## Khôi phục / rollback

- Ưu tiên tạm ngừng feature bằng singleton `enabled=false` khi cần, giữ dữ liệu và không tác động các tính năng khác. Có thể rollback code ứng dụng và giữ bảng mới.
- Nếu phải rollback schema: backup/export 4 bảng mới bằng tài khoản backend; kiểm tra không còn request dùng module; trong transaction drop `recommendation_events`, `recommendation_sessions`, `car_recommendation_profiles`, `recommendation_settings` (không dùng CASCADE rộng); kiểm tra bảng xe vẫn còn nguyên. Sau đó đồng bộ migration ledger đúng hash của **0014** và artifact migration/schema của release rollback theo quy trình triển khai. Không xóa ledger hoặc tables cũ hàng loạt. Chưa chạy rollback DB thật.

## File thay đổi

API:

- `src/modules/car-recommendations/{domain,defaults,validation,dto,engine,repository,service,controller,module,retention}.ts`: domain, validation, pure ranking, persistence/API và retention.
- `src/database/schema/car-recommendations.ts`, `schema/index.ts`: 4 bảng và export; `drizzle/0014_fast_prima.sql`, `drizzle/meta/{0014_snapshot.json,_journal.json}`.
- `src/database/seed/car-recommendations.ts`, `seed/roles-permissions.ts`: singleton và RBAC idempotent.
- `src/app.module.ts`: đăng ký module mới.
- `src/common/filters/api-exception.filter.ts`, `common/logging/pino-logger.service.ts`: redaction cho riêng feature mới; behavior route khác giữ nguyên.
- `scripts/{car-recommendations-live-check,prune-car-recommendations}.ts`, `package.json`: script vận hành.
- `test/car-recommendations-{engine,api}.test.ts`, `docs/mua-xe-theo-nhu-cau/{implementation-plan,phase-1-report}.md`, `README.md`.

Web:

- `app/tien-ich/mua-xe-theo-nhu-cau/page.tsx`.
- `components/utilities/car-recommendations/{NeedsSurvey,SurveyResults}.tsx`, `needs-survey.css` (scoped).
- `lib/car-recommendations.ts`, `scripts/car-recommendations-web-check.mjs`, `README.md`.

Admin: **không sửa file** trong Phase 1. Không sửa header/footer, global style, CarCard gốc, chi tiết xe hoặc logic tiện ích cũ. Không thêm library/AI, không commit/push/deploy.

## Những phần để lại cho Phase 2

Trang admin và sidebar, filters/analytics, chỉnh singleton và hồ sơ assessment có nguồn, optimistic concurrency/audit cấu hình. Contract read-history/schema/quyền đã sẵn sàng. Throttler hiện theo process/IP và inventory chặn >5000 xe thay vì trả thiếu; khi scale nhiều instance cần ingress rate limit phù hợp. Điểm là xếp hạng có giới hạn dữ liệu, không bảo đảm mua xe/chất lượng.

**Dừng ở Phase 1 và chờ xác nhận trước Phase 2.**
