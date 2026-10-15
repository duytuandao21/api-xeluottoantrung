# Điều tra 429 tại GET /api/v1/content

## Phạm vi và kết luận

Đã tái hiện lỗi trong source bằng Fastify, controller, guard và interceptor thật. Chưa có kết nối quản trị VPS hoặc bản log production để xác nhận cấu hình/cache counters đang chạy trên VPS. Các con số bên dưới là kiểm thử local; phần cuối hướng dẫn xác nhận production.

### Nguyên nhân còn sót sau lần sửa lookup

1. `ThrottlerGuard` mặc định hash `controller + handler + limiter name + normalized request.ip`. Tất cả nhóm `/content?group=...` cùng vào `PublicContentController.list`; query group không tham gia key cũ. Với SSR gọi trực tiếp `127.0.0.1:4000`, mọi khách truy cập web tiêu chung quota của handler/IP này.
2. Policy cũ chỉ cho cache **7** nhóm CMS. **5** nhóm public đang được SSR sử dụng bị thiếu: `thiet-lap-chinh-sach-dieu-kien`, `thiet-lap-nut-goi`, `thiet-lap-goi-y-nam-san-xuat`, `thiet-lap-tai-sao-chon`, `quan-ly-gioi-thieu`.
3. `shouldSkip()` đòi hỏi policy tồn tại và cache còn hạn. Hai nhóm đầu được gọi trong root layout trên mọi lần SSR, nhưng không bao giờ có cache entry. Vì vậy, dùng loopback đúng vẫn chưa đủ để được miễn quota.
4. Ví dụ sau khi các nhóm khác đã warm: khoảng **250 SSR trang chủ/phút** tạo 500 origin reads cho hai nhóm bị thiếu, chưa tính cold reads, invalidation hay các trang khác. Listing, bán xe, lên đời và giới thiệu còn có nhóm chưa cache riêng. Đây là phép tính từ số lượt gọi, không phải số đo traffic production.

Không có bằng chứng từ source về vòng lặp `/content`, polling hoặc retry vô hạn. Giới hạn 500/60 giây không phải quota PostgreSQL và không phải một bucket duy nhất cho toàn bộ API: limiter áp dụng toàn cục nhưng key mặc định còn chứa controller/handler.

## Audit Next.js

| Nơi gọi | Nhóm content |
| --- | --- |
| `app/layout.tsx` | nút gọi, chính sách, mạng xã hội, ứng dụng |
| `lib/website-content.ts` / `getPolicies()` | chính sách; dùng chung bởi layout và resolver page |
| `lib/public-pages.ts` / `getHomeData()` | quy trình bán xe, các bước mua/bán/lên đời, banner dòng xe |
| `app/page.tsx` | gọi lại 3 nhóm các bước để dựng panel; được React memoization gộp với `getHomeData()` |
| `lib/public-pages.ts` / filter lookups | gợi ý năm sản xuất |
| `lib/public-pages.ts` / service landing | các bước bán/lên đời, tại sao chọn |
| `app/ve-chung-toi/page.tsx` | quản lý giới thiệu; metadata và page chia sẻ lượt đọc |

`publicApi()` canonicalize query và dùng React `cache()`: một GET cho mỗi group trong một render thành công. `getRequestPublicPage()` cũng gộp metadata/page. Không có client component hoặc Next route handler gọi `/content`; các route handler menu xe dùng `/cars/menu`.

Web giữ `cache: no-store` để render kế tiếp thấy invalidation Admin tại API. Không thêm TTL độc lập trong Next hoặc giữ promise/kết quả giữa các render; cách đó có thể giữ chính sách đã bị tắt. Không gộp thành GET `/content` không có group vì sẽ đọc dữ liệu dư thừa.

Retry hiện có: GET chỉ thử lại tối đa một lần với backoff/jitter, ngoài slot concurrency 8, ngân sách đọc 5 giây. Khi Nest gửi `Retry-After: 60`, web không thử lại sớm và không giữ SSR chờ một phút. 503 không có thời gian chờ dài có tối đa hai attempts. Test mới kiểm tra riêng `/content` và log theo group an toàn.

**Nhánh render lỗi có một lượt đọc bổ sung:** khi cố tình làm toàn bộ `/content` trả 429/503, kiểm thử production Next 15 ghi nhận 2 lượt đọc chính sách trong một HTTP SSR, trong khi nhánh thành công chỉ có 1. Source Next cài trong dự án (`server/app-render/app-render.js`, `getErrorRSCPayload`) tạo metadata tree trong error RSC stream riêng; phù hợp với lượt đọc metadata bổ sung được quan sát. React memoization không chia sẻ giữa hai render đó. Đây là khuếch đại có giới hạn ở nhánh lỗi, không phải vòng lặp hoặc helper retry bỏ qua Retry-After. Không sửa internals Next hay cache lỗi giữa các render để che đi vấn đề; sửa cache/quota CMS tại nguồn. Regression kiểm tra cả GET HTML không trình duyệt và điều hướng Chrome, giới hạn tối đa 2 lượt chính sách khi lỗi có Retry-After dài và phục hồi khi API hoạt động lại.

## Sửa chính sách

- Bổ sung **đúng 5 nhóm public CMS** vào allowlist; giữ 7 nhóm cũ. Chỉ chấp nhận query có duy nhất một `group` thuộc tập cố định. Unknown/duplicate/extra query không tạo cache hoặc bucket mới.
- TTL cùng các nhóm CMS hiện có: tối đa 300 giây; jitter chỉ giảm còn 270–300 giây. LRU, byte budget và coalescing giữ nguyên.
- Bất kỳ Admin mutation HTTP vẫn invalidate trước và sau; bao gồm deactivate/delete chính sách/nút gọi, lỗi sau partial commit và epoch của pending read. Không phục vụ stale-if-error. Cookie/Authorization bypass cache như trước.
- Cold reads **ẩn danh loopback** tách bucket theo 12 nhóm cố định. Mỗi bucket vẫn có ngưỡng cấu hình 500/60 giây. Cache hit còn hạn mới được miễn; pending/miss/expired/mutating/cache-off vẫn bị tính quota.
- GET `/content` từ IP ngoài và request có credentials vẫn giữ bucket handler/IP cũ, kể cả cache hit; không thêm miễn giới hạn cho bên ngoài. Không dựa vào header tùy ý để nhận diện SSR. Giữ nguyên cấu hình trustProxy hiện có.
- Không thêm `SkipThrottle`, không tăng global limit, không sửa POST leads/newsletter/định giá/khảo sát/chatbot, JWT, RBAC, UI, schema hay response contract.

## Log chẩn đoán

API phát **tối đa một log `event=public_content_reads` mỗi 60 giây**, chỉ khi có hoạt động, kể cả cache tắt. Tắt timer khi đóng server. Không tạo request thăm dò hoặc query database mới.

Mỗi row có:

- `group`: một trong 12 tên đã allowlist, còn lại là `other`.
- `trackerScope`: `loopback` hoặc `external`; **không chứa địa chỉ IP hoặc hash tracker**.
- `bucket`: `content-group` hoặc `shared-handler-ip`; không log key thật.
- `received`, `charged`, `exempt`, `blocked`: số requests trong `windowMs`. `charged` gồm cả requests đã bị chặn, không phải số query DB.
- `cache.hit/miss/coalesced/bypass`: kết quả thật ở `cache.read`, không suy luận từ HTTP 200. Request bị guard chặn hoặc bypass vì credentials không đi vào cache.read.
- `reasons`: `fresh`, `disabled`, `mutating`, `pending`, `expired`, `absent`, `no-policy`, `credentials`, `external`, `explicit-limit`, `not-public`.
- `ttlMs`: TTL policy; `maxRemainingMs`: thời gian còn lại lớn nhất quan sát tại guard trong window, không phải TTL hiện tại của toàn bộ cache.
- Khi có 429: `limit`, `limiterTtlMs`, `maxBlockedHits`, `retryAfterSeconds` từ storage thật của throttler; không giữ `key`/`tracker`.
- Top level: `cacheEnabled`, `rateLimitMax`, `rateLimitTtlMs`, `windowMs`.

Cardinality giới hạn bởi 12 nhóm + other và các enum cố định; không tăng theo URL, IP hoặc traffic. Không log raw query, token, cookie, nội dung CMS hay thông tin liên hệ. Log HTTP request hiện có vẫn được giữ nguyên.

Web bổ sung `group` đã allowlist vào `public_api_read_failure` của `/content`. Group lạ/extra query thành `other`. Log lỗi tiếp tục bị giới hạn 10 giây/key và 64 keys trong RAM.

## Files thay đổi

API:

- `src/common/cache/public-cache.policy.ts`: allowlist CMS và parser nhóm cố định.
- `src/common/cache/public-read-throttler.guard.ts`: bucket CMS cho SSR, lý do exemption và counters 429.
- `src/common/cache/public-cache.ts`: inspect freshness và báo outcome cache.read.
- `src/common/cache/content-read-diagnostics.ts`: aggregate có giới hạn, không giữ dữ liệu request.
- `src/common/cache/public-cache.interceptor.ts`: ghi nhận outcome cache thực tế.
- `src/common/cache/public-cache.module.ts`: cung cấp diagnostics dùng chung guard/interceptor.
- `src/main.ts`: log tổng hợp mỗi phút, dọn timer khi đóng.
- `test/public-read-throttler.test.ts`, `test/public-cache.test.ts`, `test/content-read-diagnostics.test.ts`: regression/quyền truy cập/privacy.
- Báo cáo này và liên kết từ `docs/ssr-rate-limit-fix.md`.

Web:

- `lib/public-api.ts`: group allowlist trong log lỗi, không đổi request/cache/retry policy.
- `scripts/public-api-resilience-check.mjs`: retry/memoization/logging `/content`.
- `scripts/lookup-ssr-resilience-check.mjs`: đếm lượt `/content` qua production Next SSR thật, tiếp tục kiểm tra lookup 429/503 và recovery.

## Kiểm thử

API:

```bash
npm run lint
npm run typecheck
npm run build
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 .test-dist/test/public-read-throttler.test.js .test-dist/test/public-cache.test.js .test-dist/test/content-read-diagnostics.test.js
```

Regression dùng ngưỡng **2/60 giây** để tái hiện nhanh. Trước sửa, nhóm content thứ ba đã 429 trong lượt render đầu. Sau sửa kiểm tra 60 lượt x 12 nhóm (720 requests) chỉ cần một origin load/nhóm khi warm, cùng với invalidation/TTL/cookie/external/XFF/Admin/POST và cache-off.

Web:

```bash
npm run lint
npm run typecheck
npm run build
node scripts/public-api-resilience-check.mjs
node scripts/home-cache-policy-check.mjs
node scripts/vehicle-model-api-check.mjs
node scripts/lookup-ssr-resilience-check.mjs
```

Script SSR dùng API giả lập cô lập và Chrome; không ghi database thật. Script đếm từng group ở hai render liên tiếp, kiểm tra metadata/layout/page không nhân request; các test cũ tiếp tục xác nhận lookup 429/503 không mất inventory/filter, lỗi xe không biến thành 0 xe và refresh phục hồi được.

Kết quả đếm HTTP qua production Next thật: trang chủ **9**, listing **5**, bán xe/lên đời **6**, giới thiệu **5** lượt `/content` cho mỗi SSR. Mỗi group chỉ gọi một lần trong mỗi render, không có duplicates từ metadata/layout/page. Đây là số lượt HTTP đến API, không phải số query DB khi API cache bật.

Kết quả hoàn tất local:

- API: lint, typecheck, build và compile test đều thành công; **17/17 tests** trong 3 file trên qua.
- Web: lint, typecheck, build và cả 4 scripts trên đều qua. Lint còn các warning đã có về img/hook tại VehicleLightbox, VehicleModelOptions, ResponsiveImage; không có lỗi lint mới.
- Khi toàn bộ `/content` trả 429 hoặc 503 kèm Retry-After dài: cả HTML SSR và điều hướng Chrome ghi nhận 2 lượt chính sách trong nhánh lỗi Next; không retry loop, không hiển thị Application error hoặc 0 xe giả. Header còn hiển thị, nút Thử lại phục hồi inventory khi API trở lại bình thường. Không giữ cache lỗi/fallback giữa render.
- Không chạy mutation vào database production hoặc thay đổi môi trường VPS. Các sửa UI thẻ xe có sẵn trước task này được giữ nguyên.

## Xác nhận trên VPS

1. Build và triển khai **API + web** vào các dịch vụ hiện có. Không migration/seed, không tăng RATE_LIMIT_MAX. Kiểm tra app API hiện có thực sự là PM2 fork một instance trước khi dùng cache một process.
2. Startup log `public cache configuration` cần `enabled=true`, `reason=single-process`, `declaredProcessCount=1`. Nếu khác, giải quyết đúng nguồn cấu hình env/PM2 theo [hướng dẫn cache](public-cache-rollout.md), không ép bật khi nhiều replica. Không gửi `pm2 env` hay toàn bộ `.env` vì chứa secret.
3. Trên VPS, thực hiện một số GET không credentials qua loopback, chỉ in status, không in nội dung trả về:

```bash
for group in thiet-lap-chinh-sach-dieu-kien thiet-lap-nut-goi; do
  for run in 1 2 3 4 5; do
    curl --max-time 5 -sS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:4000/api/v1/content?group=$group"
  done
done
```

4. Sau một cửa sổ 60 giây, xem log API hiện có, lọc `public_content_reads` và startup configuration. Với cache đã warm và không có mutation: `trackerScope=loopback`, `bucket=content-group`, `reasons.fresh`/`exempt`/`cache.hit` tăng; `charged`/`cache.miss` thấp, `blocked=0`. Cộng rows để có số requests/window; dùng `received * 60000 / windowMs` khi window không đúng 60 giây. Không coi log từ trước restart là dữ liệu sau sửa.
5. Truy cập trang chủ, danh sách, bán xe, lên đời và giới thiệu bằng lượt truy cập bình thường. Theo dõi vài window, đặc biệt lúc TTL refresh/Admin mutation. Cache miss sau invalidation là đúng; không kỳ vọng `charged=0` vĩnh viễn.
6. Nếu 429 còn: `disabled` → kiểm tra startup reason/env/topology; `no-policy`/`other` → caller khác hoặc query ngoài hợp đồng; `credentials` → có Cookie/Authorization được forward; `external` → request.ip thực tế không phải loopback; nhiều `absent`/miss → kiểm tra eviction, size budget, restart, invalidation hoặc responses không shareable. Nhiều `pending` → cold burst; xem coalescing và rate của caller. Đối chiếu `limit`, `maxBlockedHits`, retry window thay vì suy đoán từ tổng HTTP request.
7. Kiểm tra deactivate một policy/nút gọi bằng quy trình Admin bình thường và xác nhận render mới nhận dữ liệu mới ngay sau response mutation. Không cần tạo dữ liệu khách hàng để test chống spam production; các giới hạn đó đã có regression local.

Không cam kết bỏ mọi HTTP 429: truy cập vượt giới hạn origin, endpoint chống spam, Admin và bên ngoài vẫn phải bị chặn. Chưa deploy/restart hoặc xác nhận số liệu production từ workspace này.
