# Cloudflare Analytics cho Admin `/thong-ke`

Tích hợp local ngày 20/10/2026. Chưa deploy hoặc sửa Cloudflare/VPS/database production.

## Kiến trúc và phạm vi

```text
Admin /thong-ke → NestJS GET /api/v1/admin/dashboard/analytics
                → JWT + quyền analytics.read
                → cache bộ nhớ 10 phút / process / khoảng thời gian
                → Cloudflare GraphQL Analytics API
```

- Không thêm dependency; không đưa Cloudflare token vào Admin, bundle Next.js hay response API.
- Không đổi dashboard nghiệp vụ `/admin/dashboard`, API public, cache catalog, Web hoặc beacon của website.
- UI ưu tiên admin: ba thẻ tổng quan, grid xu hướng/thiết bị/xe/quốc gia và bảng trang được xem. HTTP requests, bandwidth, cache và WAF nằm trong “Thông tin kỹ thuật” thu gọn. Giữ kiểu thẻ, màu sắc và responsive của Admin; không thay đổi website public.
- `Cache-Control: private, no-store` tại endpoint. Không dùng Cloudflare CDN cache cho dữ liệu quản trị.
- Truy vấn chỉ chạy khi người có quyền mở thống kê; không có cron, polling hoặc request từ khách truy cập website. Có tối đa một truy vấn database đối chiếu tên xe cho mỗi snapshot chưa cache, chỉ đọc hai cột theo slug đã quan sát.

## Cấu hình backend

Thêm vào **`.env` của NestJS trên VPS**, không phải `.env` Admin/Web:

```dotenv
CLOUDFLARE_API_TOKEN=<token chỉ đọc>
CLOUDFLARE_ZONE_ID=<zone ID 32 ký tự hex>
CLOUDFLARE_ANALYTICS_HOSTNAME=toantrungxeluot.io.vn
# Khuyến nghị cung cấp để không cần Zone Read lookup:
CLOUDFLARE_ACCOUNT_ID=<account ID chứa Web Analytics site>
```

Không đặt tên `NEXT_PUBLIC_CLOUDFLARE_*`. Không commit `.env`, không gửi token trong chat, query string hoặc lệnh curl frontend. Nếu thiếu token/zone, module khác vẫn chạy, thống kê hiện N/A.

Token phải được scope tới zone/account cần xem, chỉ cấp quyền đọc Analytics cần thiết. Tài liệu Cloudflare hướng dẫn `Account → Account Analytics → Read`; zone analytics có quyền Analytics Read theo scope tương ứng. Kiểm tra `settings.enabled` và `availableFields` của chính token thay vì suy ra mọi dataset sẽ được mở. Nếu không cấu hình account ID, backend thử **GET zone details** để lấy account; thao tác này cần `Zone → Zone → Read`. Không có quyền đó thì HTTP vẫn hoạt động, Web Analytics N/A. Không cần cấp quyền chỉnh DNS, cache, WAF, R2 hoặc quyền ghi nào. [Tài liệu token chính thức](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/).

Hostname là giá trị backend cố định, so sánh bằng **exact match**; không nhận hostname từ client. `admin.`, `api.`, `cdn.` không được dùng làm hostname thống kê. Không gộp `www`, API, Admin hoặc CDN ảnh vào lưu lượng website. HTTP/WAF dùng `clientRequestHTTPHost`; RUM dùng `requestHost`. HTTP thêm `requestSource=eyeball` nếu schema và quyền hỗ trợ. Request DNS-only/bypass Cloudflare không có trong nguồn này.

## Cấp quyền quản trị thống kê

Quyền mới: **`analytics.read`**. `dashboard.read` riêng lẻ không cho xem thống kê. Seed source đã bổ sung quyền cho `ADMIN`, `SUPER_ADMIN`; không cấp cho SALES/CONTENT_EDITOR/INVENTORY_MANAGER/SEO_MANAGER.

Khi triển khai, có thể chạy seed roles/permissions theo quy trình hiện tại (`npm run db:seed`). Nếu chỉ muốn thêm đúng quyền mới, dùng SQL cộng thêm dưới đây bằng kết nối quản trị PostgreSQL đã có; **không cần migration schema**:

```sql
BEGIN;
INSERT INTO permissions (code)
VALUES ('analytics.read') ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('ADMIN', 'SUPER_ADMIN') AND p.code = 'analytics.read'
ON CONFLICT (role_id, permission_id) DO NOTHING;
COMMIT;
```

Kiểm tra tài khoản có profile active và được gán đúng role. Reload Admin/đăng nhập lại để nạp permissions vào UI; API kiểm tra quyền lại mỗi request, kể cả dữ liệu đang cache. Không cấp quyền này cho sale chỉ để hiện menu.

## Dataset, định nghĩa và giới hạn

Backend introspect type/field/filter/orderBy, kiểm tra `settings` rồi mới xây truy vấn. Chỉ dùng giao của schema với `availableFields`; `enabled=false` hoặc không lọc được hostname thì không query dataset. Không fallback sang tổng cả zone/account. [Cloudflare discovery/settings](https://developers.cloudflare.com/analytics/graphql-api/features/discovery/settings/).

| Nhóm UI | Nguồn | Định nghĩa / giới hạn |
| --- | --- | --- |
| HTTP requests | `httpRequestsAdaptiveGroups.count` | Requests gồm HTML, JS/CSS/ảnh trên hostname website và bot; không phải lượt xem/người dùng |
| Dữ liệu truyền từ edge | `sum.edgeResponseBytes` | Tổng bytes response edge, không phải Mbps, origin bandwidth hoặc bytes đã tiết kiệm |
| Xu hướng truy cập | RUM `count`, `sum.visits`, `datetimeMinute` / `datetimeHour` | Hai chuỗi lượt xem/visits; không phải người dùng duy nhất. Kỳ dài gộp giờ thành ngày Việt Nam (UTC+7), không cộng uniques |
| Thiết bị / quốc gia | RUM `deviceType`, `countryName` | Phân bổ theo lượt xem trang, không phải tỷ lệ số người riêng biệt; top 10 quốc gia |
| Trang được xem nhiều | RUM `requestPath` + `count` | Top 10 đường dẫn theo page views; không dùng bảng HTTP requests hoặc tự coi asset request là lượt xem |
| Xe được xem nhiều | RUM paths đối chiếu `cars.slug`, `cars.name` | Một SELECT có điều kiện slug, không tải toàn bộ kho xe/ảnh/thông số. Không đoán loại trang theo tên slug; xe không còn trong DB hoặc đã soft-delete không được gán tên giả |
| Cache | HTTP `cacheStatus` | HIT, MISS, DYNAMIC, BYPASS, REVALIDATED… giữ riêng. HIT rate = HIT / tổng count của tất cả trạng thái; không gọi REVALIDATED là HIT |
| Page views | `rumPageloadEventsAdaptiveGroups.count` | Page-load events Web Analytics cho đúng hostname; phụ thuộc beacon, có thể bị chặn, không phải tổng HTTP requests |
| Visits RUM | RUM `sum.visits` | Theo định nghĩa Cloudflare: lượt vào từ referrer khác hostname hoặc liên kết trực tiếp; một visit có thể có nhiều page views; không phải unique visitors |
| Visits HTTP | HTTP `sum.visits` | Còn trong response tương thích; không dùng làm chỉ số truy cập chính hoặc cộng vào visits RUM |
| Unique visitors | Không có metric phù hợp trong dataset đang dùng | N/A; không dùng unique IP hoặc tổng visits thay thế |
| Security / WAF | `firewallEventsAdaptiveGroups.count` + action | Sự kiện bảo mật, không phải số người tấn công, không đồng nhất mọi event với WAF block. Nếu dataset không được cấp quyền thì N/A |

Adaptive datasets có thể lấy mẫu/ước tính; backend không tự nhân count với sample interval. Hiển thị interval trung bình HTTP khi có. Không suy ra người thật, conversion, phiên hay thời gian xem trung bình. Xem [HTTP hostname analytics](https://developers.cloudflare.com/analytics/graphql-api/tutorials/end-customer-analytics/), [Web Analytics metrics](https://developers.cloudflare.com/web-analytics/data-metrics/high-level-metrics/).

Các lựa chọn 1h/6h/24h/7d/30d chỉ hiện nếu nằm trong **cả** `maxDuration` và `notOlderThan` thực tế của RUM; nếu RUM chưa khả dụng thì dùng giới hạn HTTP. Mặc định 24h khi được hỗ trợ. Bỏ 5 phút gần nhất để giảm dữ liệu chưa hoàn tất (không cam kết Cloudflare ingest xong sau đúng 5 phút). Từng dataset kỹ thuật vẫn được kiểm tra riêng. Không âm thầm cắt thời gian WAF ngắn hơn rồi gán nhãn toàn kỳ. Không query 12 tháng, không chia hàng trăm cửa sổ để vượt giới hạn gói.

Snapshot kiểm tra chỉ đọc ngày 20/10/2026 với cấu hình local:

- Zone details: **Free Website**.
- HTTP enabled, `maxDuration=2592000` giây (30 ngày), `notOlderThan=2678400` (31 ngày), max page size 10000, max fields 40.
- RUM enabled, max duration 93 ngày, retention 184 ngày; đây là settings tài khoản/token quan sát được, **không hard-code thành quyền của mọi Free account**. UI ưu tiên giới hạn RUM nhưng chỉ cung cấp tối đa các lựa chọn 30 ngày đã định nghĩa.
- `firewallEventsAdaptiveGroups` disabled cho token hiện tại: N/A. Không khẳng định mọi Free plan đều không có WAF analytics; có thể khác quyền/token/dataset.
- Đã đọc được các aggregate HTTP và RUM cho đúng hostname. Không sửa token, plan, beacon hoặc security rules để ép có dữ liệu.

## Cache và giới hạn truy vấn

- Cache snapshot và discovery trong RAM **600.000 ms**, gộp các request đồng thời; tối đa sáu khóa snapshot (năm range + mặc định). Tải lại UI không bypass cache.
- Cold discovery: bốn truy vấn introspection batch, tối đa hai settings query (zone/account), thêm một Zone Read khi thiếu account ID. Khi đã cache discovery, mỗi range mới thường chỉ một HTTP query + một RUM query + tối đa một security query nếu được mở.
- HTTP query dùng aliases cho total/trend/country/path/cache; tách batch chỉ khi field budget thực tế yêu cầu. Không dùng raw event pagination. Query/row limits đều kiểm tra trước.
- RUM query gộp total/trend/devices/countries/pages vào các aliases, vẫn thường một request. Lấy tối đa `min(1000,maxPageSize)` đường dẫn có lượt xem cao nhất, trả top 10 trang và đối chiếu tên xe theo tập này. Nếu chạm giới hạn, UI ghi rõ top xe có thể chưa bao gồm mọi xe; không âm thầm khẳng định đã xét toàn bộ dữ liệu. Tên xe và kết quả đối chiếu cũng cache 10 phút.
- Biểu đồ 1h theo phút, đến 24h theo giờ, kỳ dài gộp giờ thành ngày UTC+7. Khoảng thời gian không có nhóm được để trống trên trục đúng vị trí; không tự chèn giá trị đo. Nếu chuỗi thời gian có thể bị cắt bởi page limit thì không hiển thị như chuỗi đầy đủ.
- Timeout hữu hạn 10–15s/request, không tự retry dồn dập. GraphQL partial failure chỉ làm nhóm thiếu hiện N/A; lỗi mạng/quyền không biến thành số 0. Cache cả snapshot không khả dụng để tránh gọi lỗi liên tục; thử lại sau tối đa 10 phút hoặc khi process được khởi động lại theo quy trình vận hành.
- Cache process-local: nhiều PM2 worker có cache riêng, không dùng Redis/DB mới. Ước lượng quota theo số worker và range được mở. Không chia sẻ cache catalog/invalidation hiện tại.
- Empty response HTTP hợp lệ có thể là 0 requests; RUM rỗng hiện N/A vì không đủ phân biệt không có lượt xem với chưa có beacon/dữ liệu. Các trường thiếu/denied luôn null/N/A.

## Triển khai production (hướng dẫn, chưa thực hiện)

1. Review diff, sao lưu phiên bản API/Admin đang chạy và cấu hình env hiện tại.
2. Thêm biến backend và quyền PostgreSQL như trên. Không cấu hình token trong Admin.
3. Build/test hai repository bằng phiên bản Node theo dự án:

```bash
# api-xeluottoantrung
npm ci
npm run build
npm run lint
npm run typecheck
npm test

# admin-xeluottoantrung
npm ci
npm run build
npm run lint
npm run typecheck
```

4. Deploy API rồi Admin bằng quy trình hiện có, chỉ restart/reload service khi người vận hành chủ động triển khai. Không đổi Cloudflare/Nginx cache policy. Đảm bảo rule cache không override `private,no-store` cho `/api/v1/admin/*`; nếu đã có Cache Everything sai phạm vi, phải bypass riêng trước khi dùng endpoint quản trị.
5. Mở `/thong-ke` bằng ADMIN/SUPER_ADMIN. Xác nhận hostname, thời gian, nguồn HTTP/RUM, N/A WAF nếu chưa được cấp quyền. Network trình duyệt chỉ gọi NestJS, không gọi `api.cloudflare.com`, không chứa Cloudflare token.
6. Xác nhận 401 khi chưa đăng nhập, 403 khi chỉ có `dashboard.read`; quyền analytics mới xem được. Thử range, tải lại: `generatedAt` giữ nguyên trong TTL; kiểm tra `Cache-Control: private, no-store`, không có `CF-Cache-Status:HIT` trên endpoint thống kê.
7. Nếu Web Analytics N/A: kiểm tra account ID, Account Analytics Read, settings, site/beacon hiện tại và thời gian đã chọn. Không tự chèn beacon thứ hai. Nếu WAF disabled: giữ N/A; không mở rộng token sang quyền ghi hay mua gói như bước mặc định.

## Rollback

- Rollback đúng commit/patch API và Admin của tích hợp này, build và deploy lại theo quy trình dự án; không reset toàn repository.
- Có thể xóa các biến `CLOUDFLARE_*` mới khỏi backend nếu không còn nơi nào sử dụng; không xóa token chung đang được công cụ khác dùng. Thiếu cấu hình chỉ làm analytics N/A, không làm hỏng module khác.
- Quyền `analytics.read` chưa được gọi bởi code cũ nên có thể để nguyên. Nếu cần thu hồi, chỉ xóa mappings của quyền đó sau khi kiểm tra các cấp quyền tùy chỉnh; không xóa role/user hoặc permissions khác.
- Không có schema migration, dependency mới, thay đổi dữ liệu xe hoặc Cloudflare rule cần rollback.

## Kiểm chứng local

| Kiểm tra | Kết quả |
| --- | --- |
| API build / typecheck / lint | PASS |
| Admin production build / typecheck / lint | PASS; lint có 12 warning có sẵn, không thuộc tích hợp này |
| 12 test analytics | PASS: hostname exact, schema/availableFields, plan limits, WAF disabled/enabled, N/A/zero, partial/error, không cấu hình, cache 10 phút + coalescing, không lộ lỗi upstream, JWT/RBAC/query validation; thêm nguồn RUM, ngày Việt Nam, một lookup tên xe và lỗi lookup độc lập |
| Regression `phase7.test.js`, `auth.test.js`, `foundation.test.js` | PASS: 4 test hiện có; dashboard nghiệp vụ vẫn giữ `websiteViews=null` |
| Production-browser ở 1440 / 768 / 390 px | PASS: dữ liệu RUM, tên xe, thiết bị, kỹ thuật thu gọn/mở rộng, đổi range, biểu đồ dày 61 nhóm phút, zero/N/A, lỗi API, thiếu quyền; không tràn ngang, không page/hydration error, không gọi Cloudflare trực tiếp |
| Đọc Cloudflare qua service thật | PASS: 1h hostname công khai có 398 HTTP requests, 35 page views RUM, 6 visits RUM trong snapshot `02:25:08–03:25:08 UTC` ngày 20/10/2026; các nhóm trend/country/path/cache có dữ liệu; WAF N/A như settings |
| Gọi lặp service thật | PASS: dùng lại cùng snapshot cache, không query lại |
| Quét bundle/output Admin | PASS: kiểm tra 88 file static và output route `/thong-ke`, không tìm thấy giá trị Cloudflare API token |

Kiểm tra lại sau khi chuyển sang dashboard cho admin: **16/16 test liên quan đạt** (12 analytics và 4 regression auth/config/dashboard). Query RUM mới đã đọc được trend, thiết bị, quốc gia và đường dẫn thật với token hiện có; smoke live dùng lookup tên xe fixture, không đọc database production. Đối chiếu tên xe đã được kiểm tra SQL thực trên PGlite tạm, có ca xe xóa, URL không phải xe, URL trùng và lỗi lookup. Giữ N/A khi không có nguồn; không bổ sung tracking người dùng, suy diễn unique visitors hoặc khôi phục khối giải thích dài đã được yêu cầu bỏ.

Số live là một snapshot để kiểm chứng tích hợp, không phải benchmark, baseline cố định hoặc số khách duy nhất. Không chạy full API suite; đã chạy các test liên quan đến module/cache/auth/config và dashboard. Không thực hiện đăng nhập production, seed DB thật, upload/xóa ảnh hoặc thay rule Cloudflare.

Chạy lại tests liên quan từ thư mục API:

```bash
npx tsc -p tsconfig.test.json
node --test .test-dist/test/analytics.test.js .test-dist/test/phase7.test.js .test-dist/test/auth.test.js .test-dist/test/foundation.test.js
```

Chạy UI local từ thư mục Admin sau production build: `node scripts/analytics-admin-check.mjs`. Runner dùng Playwright/Chrome đã có trong repository Web, cổng loopback 3006, session/API fixture trong browser; không cần gửi mật khẩu hoặc gọi production. Nếu cổng này đang dùng, chọn cổng kiểm thử khác trước khi chạy để tránh sử dụng nhầm server. Chụp màn hình và JSON kết quả ở `.tmp/cloudflare-analytics/ui/` tại workspace root. Đây là kiểm tra fixture, không giả làm số liệu live. Runner đóng riêng process/browser nó tạo.

Tooling kiểm tra chỉ đọc Cloudflare nằm ngoài source tại `.tmp/cloudflare-analytics/`; không chứa token trong artifact aggregate. Fixture trong test tự động chỉ dùng để kiểm thử, không dùng làm dữ liệu hiển thị khi triển khai. Tài liệu và source mới là phần cần deploy; không đưa fixture, trace hay runner tạm vào production.
