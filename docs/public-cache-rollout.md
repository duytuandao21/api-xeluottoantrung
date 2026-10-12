# Public cache — bật và vận hành

Ngày 12/10/2026. Người dùng xác nhận VPS chạy **PM2 fork, 1 instance API** và yêu cầu bật cache, hoàn thiện tối ưu query. Cấu hình `.env` API tại workspace đã bật. Tài liệu này áp dụng cho source đã có `PublicCacheModule`, không phải binary cũ.

## 1. Điều kiện và cấu hình

Chỉ một API process trên toàn bộ hệ thống, kể cả replica/VPS thứ hai. PM2 fork một instance được hỗ trợ; Node cluster/PM2 cluster, số process khác 1 hoặc topology chưa khai báo sẽ bypass. Chỉ số `NODE_APP_INSTANCE` không dùng để suy ra số replica.

Các biến không chứa secret cần có trong môi trường API:

```dotenv
PUBLIC_CACHE_ENABLED=true
PUBLIC_CACHE_MODE=single-process
PUBLIC_CACHE_PROCESS_COUNT=1
```

Giới hạn mặc định: 256 entries, budget key/JSON 8 MiB, 512 KiB mỗi entry, 32 pending keys. `.env.example` vẫn tắt để tránh tự bật trên deployment chưa kiểm chứng. Không đổi connection URL, Supabase/R2/JWT keys hoặc pool.

PM2 có thể giữ env cũ từ shell/ecosystem và ghi đè `.env`. Nếu các biến cache đã được khai báo trong ecosystem, cập nhật chúng tại cùng nguồn; kiểm tra bằng startup log sau restart. Không công khai output `pm2 env`, `.env`, process command lines hoặc credentials.

## 2. Build và áp dụng trên VPS

Workspace không có kết nối quản trị VPS; chưa thực hiện deploy/restart từ đây. Người vận hành áp dụng source API và Web đã kiểm thử vào app hiện có theo quy trình deploy đang dùng. Không chạy migration/seed cho thay đổi cache/query này.

Trước production, kiểm tra staging cùng một API process: metadata, logo, hãng/dòng xe, create/edit/delete, publish/unpublish, giá/status/media và admin RBAC. Database test local là PGlite, không thay thế Supabase network/pooler hoặc iPhone thật.

Trong API:

```bash
npm run lint
npm run typecheck
npm run build
```

Trong Web:

```bash
npm run typecheck
npm run build
```

Chọn đúng tên app API hiện có bằng `pm2 list`; xác minh fork/1 instance bằng thông tin deployment hiện có. **Không `pm2 start` thêm app thứ hai** để bật cache. Trong shell VPS, thay `API_NAME` bằng tên đó rồi:

```bash
PUBLIC_CACHE_ENABLED=true PUBLIC_CACHE_MODE=single-process PUBLIC_CACHE_PROCESS_COUNT=1 pm2 restart API_NAME --update-env
pm2 logs API_NAME --lines 20 --nostream
```

Đưa cùng cấu hình vào nguồn env/ecosystem bền vững của app để lần restart/reboot sau vẫn đúng. Khởi động lại Web đã build bằng quy trình hiện có. Dùng **restart**, không reload kiểu giữ hai generation API chồng nhau khi cache process-local bật. Có thể có khoảng gián đoạn ngắn theo quy trình PM2 hiện tại; không đổi cấu hình load balancer tự động.

Cách cập nhật env khi restart được đối chiếu [tài liệu PM2 chính thức](https://pm2.keymetrics.io/docs/usage/process-management/); thứ tự shell/ecosystem và ý nghĩa `NODE_APP_INSTANCE` ở [PM2 environment](https://pm2.keymetrics.io/docs/usage/environment/). Khuyến nghị restart ở trên là quyết định cho cache process-local của project.

Log `public cache configuration` phải có `enabled: true`, `reason: single-process`, `declaredProcessCount: 1`. Nếu false, reason chỉ ra flag/mode/process-count/cluster/exec-mode; sửa topology/cấu hình, không bỏ kiểm tra để ép bật.

## 3. Freshness và những dữ liệu được tối ưu

- API là lớp persistent cache chính: SEO tồn tại, models/lookups và presentation/content/collections đã allowlist. Next chỉ memoize trong một SSR render.
- Admin HTTP mutation invalidate trước/sau handler; request mới sau response ghi nhận dữ liệu mới. Trang đang mở không tự refresh khi admin sửa.
- Cars list/count/detail, giá, trạng thái bán, stockCount của `/brands`, search và private/admin/sale vẫn đọc trực tiếp. Không thêm TTL inventory để đổi độ chính xác lấy tốc độ.
- Dòng xe cold đọc brand + active models bằng **1 SELECT** thay vì 2, vẫn phân biệt brand không có model `[]` và brand không tồn tại/inactive `404`.
- Public listing/detail chỉ select các cột dùng cho JSON hoặc nối media/specification. Các trường sku/biển số/source/legacy/audit không cần cho public được loại khỏi projection; admin/sale response và filter/sort/page giữ nguyên.

CLI import, SQL Dashboard, seed/cron ghi trực tiếp không đi qua invalidation HTTP. Khi cần chạy các writer đó, tắt cache/restart API trước, thực hiện import theo quy trình đã được cho phép, sau đó bật lại/restart. Không để một process cũ còn cache trong lúc process khác ghi DB.

## 4. Quan sát 24–48 giờ

API ghi `public cache metrics` mỗi 5 phút khi cache bật, chỉ có aggregate counters/entries/bytes/pending; không key, search, token hoặc nội dung user. Counters tích lũy từ restart; lấy delta hai log cùng process để tính hit/miss/coalesced/bypass. Live/private bị loại trước `cache.read` nên không nằm trong bypass counter. `bytes` là budget cache, không phải network/Egress; expiry dọn khi có đọc/ghi.

Theo dõi cùng time window:

- Startup flag, PM2 process count, restart count, CPU/RSS và cache entries/bytes/pending.
- Request/status/latency theo endpoint từ logs hiện có; tăng 5xx/timeouts phải được điều tra, không cache lỗi hoặc retry mọi endpoint.
- Hai snapshot `pg_stat_statements` cách nhau 5–10 phút, giữ reset timestamp; không reset counters production. Đối chiếu SEO/models/settings và các hotspots cars/brands vẫn live.
- Supabase Usage theo Database/Shared Pooler/Data API/Storage/Log Drains và billing/timezone, Egress ngày trước/sau trên traffic tương đương. Nếu SQL calls giảm mà Egress không giảm, kiểm tra các dịch vụ/writer khác và độ trễ dashboard.
- Lần fetch mới sau admin sửa SEO/logo/model phải đúng; public giá/trạng thái/media đúng ngay sau commit; thử mobile đổi hãng nhanh và chọn lại hãng đang active.

Cache entry TTL hard expiry, không stale-if-error. Không hứa tỷ lệ tiết kiệm Egress từ benchmark local; HTTP body bytes bằng nhau là điều mong đợi vì contract giữ nguyên.

## 5. Proxy và rollback

Origin public endpoints thuộc cache policy trả HTTP `Cache-Control: no-store` để API memory là TTL duy nhất. Kiểm tra rules hiện có của Nginx/Cloudflare: HTML/RSC/API private và các public API này không được cache-everything hoặc bỏ qua origin header. Không đổi cache ảnh/font CDN. Chưa có quyền xem/sửa proxy VPS trong workspace.

Rollback nhanh: đặt `PUBLIC_CACHE_ENABLED=false` tại nguồn env đang dùng và restart **cùng app** bằng `--update-env`. Dữ liệu trở về origin, cache cũ mất khi process dừng; không rollback DB/schema. Web đã bỏ TTL nên requests lookup có thể tăng khi API cache tắt. Nếu rollback source, rollback API/Web phối hợp cùng revision đã biết và build lại; không khôi phục riêng browser snapshot trong khi kỳ vọng admin invalidation tức thì.

Tests local và số liệu before/after: [báo cáo tổng hợp](../../docs/verification-query-cache.md). Không có deploy production hoặc số liệu Egress thật từ lần hoàn thiện này.
