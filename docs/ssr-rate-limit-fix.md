# Khắc phục HTTP 429 khi Next.js render Server Components

**Cập nhật điều tra `/content`:** [Nguyên nhân policy CMS còn thiếu, regression và cách xác nhận VPS](content-429-investigation.md). Phần dưới ghi lại lần sửa lookup ban đầu; bản cập nhật bổ sung 5 nhóm CMS và diagnostics theo phút.

## Nguyên nhân đã kiểm chứng

- `ThrottlerGuard` mặc định tạo khóa từ **controller + handler + tên limiter + IP**. Bảy resource `/lookups/:resource` đều chạy `PublicLookupsController.list`, nên chi nhánh, kiểu dáng, màu sắc… từng tiêu chung một bộ đếm của IP SSR.
- Guard chạy trước `PublicCacheInterceptor`. Trước sửa, request thứ 501 có thể nhận 429 dù dữ liệu đã nằm trong cache, không cần query database.
- Web chủ động dùng `fetch(..., { cache: 'no-store' })` vì API sở hữu cache và invalidation sau thao tác Admin. React `cache()` chỉ chia sẻ kết quả giữa layout/page/metadata trong một lần render. Vì vậy, cache tại API không tự giảm bộ đếm HTTP của guard cũ.
- `fetchFilterLookups()` và `getHomeData()` từng đặt lookup trực tiếp trong `Promise.all`; một rejection từ lookup làm hỏng cả lần render. Layout có `allSettled`, nhưng không bảo vệ được các lượt đọc trong page.
- Đã tái hiện chính xác cơ chế này bằng Fastify + controller/guard/cache thật, dùng ngưỡng test **2/60 giây** để test nhanh. Không suy đoán đây là quota PostgreSQL hay lỗi kết nối database.

Trong cấu hình local được kiểm tra, limiter vẫn là **500/60 giây**, public cache bật theo chế độ một process, và `API_URL` của web trỏ localhost. Chưa truy cập log hoặc thay đổi cấu hình VPS production.

## Chính sách rate limiting sau sửa

Không tăng global limit, không thêm `@SkipThrottle()` và không thay đổi các decorator giới hạn riêng.

| Nhóm endpoint/controller đã rà soát | Xử lý |
| --- | --- |
| Lookups và các alias `/branches` | Giữ cache/TTL hiện có. Tách bảy bucket resource cố định cho `/lookups/:resource`, không tạo bucket theo query/ID tùy ý. |
| GET public thuộc allowlist cache: catalog models, một số content/site settings, collections, SEO, cars menu và nhóm xe đã có policy | Chỉ lượt đọc **ẩn danh từ loopback**, có **cache còn hạn**, không có limit khai báo riêng mới được phục vụ ngoài bộ đếm SSR. |
| GET public từ IP bên ngoài | Vẫn chịu limiter cũ, kể cả cache hit. Dùng `request.ip` do cấu hình Fastify hiện có xác định; không tự tin cậy X-Forwarded-For. |
| Cache miss, cache tắt, hết hạn, invalidation hoặc mutation đang chạy | Giữ giới hạn; tuyệt đối không miễn cho origin read chỉ vì URL thuộc nhóm public. |
| Cars mặc định/detail, brands có stock count, accessories, search, promotions | Giữ logic dữ liệu trực tiếp và limiter hiện có. Không mở rộng cache sang tồn kho, tìm kiếm hoặc trạng thái chương trình theo thời gian. |
| Leads/newsletter | Giữ nguyên 5 request/60 giây cho từng POST handler. |
| Valuation | Estimate 20, contact 5 request/60 giây; config/catalog và toàn bộ Admin giữ chính sách hiện có. |
| Car recommendations | Giữ POST sessions 20, resume/results 30, events 60 request/60 giây. Không cache session/capability. |
| Ownership | Config GET 40, calculate POST 15 request/60 giây; không cache câu trả lời hay capability. |
| Chatbot | Giữ SkipThrottle đã có và ChatRateGuard riêng; kiểm thử SSE, giới hạn độc lập và IP forwarding vẫn qua. |
| Auspicious dates | Giữ limiter hiện có cho config/search/detail và Admin. |
| Admin me, dashboard, customers, media; toàn bộ Admin của catalog/cars/content/collections/lookups/SEO/promotions/leads và các tiện ích | Giữ JWT, RBAC và limiter. Cookie hoặc Authorization không đủ điều kiện miễn theo cache. |
| Health | Giữ SkipThrottle đã có. |

Rà soát bao phủ 20 file controller trong `src/modules`. Không sửa các controller nghiệp vụ hoặc authentication.

## Cache và invalidation

- `PublicResponseCache` tiếp tục là cache dữ liệu public duy nhất giữa các request: TTL, LRU, giới hạn bytes/pending và coalescing hiện có được giữ nguyên.
- Thêm `hasFresh()` để guard biết một lượt đọc có thực sự còn cache hợp lệ hay không. Trong mutation, cache tắt hoặc entry hết hạn, hàm trả false.
- Admin HTTP mutations vẫn invalidate trước/sau, kể cả khi media workflow thất bại sau commit. Pending read thuộc epoch cũ không được ghi ngược lại cache.
- Web giữ React memoization với query đã canonicalize; không thêm TTL thứ hai trong Next để che khuất thay đổi Admin. Không lưu lỗi, fallback, session, PII hoặc kết quả xe giữa các render.
- Không thêm Redis, bảng database, migration, polling, hoặc request kiểm tra cache mới.

## Retry và fallback trên web

- Chỉ áp dụng ở helper **GET server** `publicApi`; không sửa retry của các POST lead, newsletter, khảo sát, chatbot, định giá hoặc tính chi phí.
- 429/503 được retry **tối đa một lần** với backoff và jitter; model catalog giữ khả năng retry lỗi server như trước.
- Đọc `Retry-After` dạng số giây và HTTP-date. Nếu phải chờ hơn 750 ms thì không retry sớm và cũng không giữ SSR chờ một phút: chuyển sang fallback/lỗi có kiểm soát.
- Giới hạn thời gian đọc khoảng 5 giây, cars menu 7 giây; giữ tối đa tám lượt đọc đồng thời. Hủy body lỗi trước retry để giải phóng kết nối.
- Không nuốt lỗi điều khiển render của Next (dynamic rendering, redirect…). Không phân loại mọi exception thành 503.
- `optionalLookupPage` / `optionalPublicLookups` chỉ cho bảy resource lookup public. `null` biểu thị không tải được; khác với catalog rỗng thành công. Không trả một catalog phân trang thiếu trang như thể đã đầy đủ.
- Khi lookup tùy chọn lỗi, chỉ thiếu lựa chọn chưa tải được. Trang chủ và danh sách xe vẫn lấy và hiển thị kết quả xe thật. Các bộ lọc chi nhánh/kiểu dáng/phiên bản đã chọn vẫn được giữ trong query.
- Nếu lookup cần thiết để phân biệt route là kiểu dáng, chi nhánh hay model, không đoán route và không kết luận 404 sai. Hiện trạng thái chưa tải được và cho thử lại.
- Nếu **truy vấn xe thật** thất bại, không chuyển thành `{data: [], total: 0}`. Error boundary giữ header/footer và cho thử lại bằng refresh Server Components; giao diện bình thường không đổi.

## Logging

- API ghi `requestId`, method, path không có query, status 429 và `rate_limit_exceeded`; lỗi server tiếp tục dùng logger đã có.
- Web ghi JSON `public_api_read_failure`: endpoint không có query, status, reason, attempt và outcome (`retry`, `failed`, `lookup_unavailable`).
- Log web được giới hạn theo endpoint/status/outcome trong cửa sổ 10 giây, tối đa 64 key trong RAM. Không log body, token, cookie, nội dung tìm kiếm hoặc thông tin liên hệ.

## File đã sửa

### API

- `src/app.module.ts`: đăng ký guard kế thừa limiter hiện có.
- `src/common/cache/public-read-throttler.guard.ts`: policy cho SSR cache hit và bucket lookup.
- `src/common/cache/public-cache.ts`: kiểm tra freshness không đọc origin.
- `src/common/cache/public-cache.policy.ts`: nhận diện resource cố định để tạo bucket.
- `src/common/filters/api-exception.filter.ts`: log nguyên nhân 429.
- `src/main.ts`: bỏ một import không sử dụng để lint qua; không thay trustProxy/bootstrap/authentication.
- `test/public-read-throttler.test.ts`: regression cho guard/cache/quyền truy cập và giữ giới hạn POST.
- `docs/ssr-rate-limit-fix.md`: báo cáo này.

### Web

- `lib/public-api.ts`: retry, timeout, Retry-After, logging và helper lookup tùy chọn.
- `lib/public-pages.ts`: áp dụng fallback lookup đúng chỗ; giữ query xe và không đoán sai route.
- `app/error.tsx`: cô lập lỗi dữ liệu bắt buộc, nút thử lại refresh SSR.
- `scripts/public-api-resilience-check.mjs`: retry/cache ownership/memoization/privacy/control-flow/partial pagination.
- `scripts/lookup-ssr-resilience-check.mjs`: production Next + HTTP API giả lập 429/503, dữ liệu xe và retry thật trên Chrome.
- `scripts/home-cache-policy-check.mjs`, `scripts/vehicle-model-api-check.mjs`: cập nhật fixture cho retry có giới hạn; tiếp tục kiểm tra không có TTL che invalidation và giới hạn tám lượt đọc.

## Kiểm thử

Trong thư mục API:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npx.cmd tsc -p tsconfig.test.json
node --test --test-concurrency=1 .test-dist/test/public-read-throttler.test.js .test-dist/test/public-cache.test.js .test-dist/test/lookups.test.js .test-dist/test/auth.test.js .test-dist/test/chatbot.test.js .test-dist/test/valuation-api.test.js .test-dist/test/car-recommendations-api.test.js .test-dist/test/ownership-api.test.js
```

Bộ liên quan qua **38 tests**, không thất bại. Sau khi siết ngoại lệ chỉ cho loopback, chạy lại 13 tests guard/cache và xác nhận IP bên ngoài vẫn bị giới hạn, XFF từ nguồn không tin cậy không tạo bucket mới.

Trong thư mục web:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
node scripts/public-api-resilience-check.mjs
node scripts/home-cache-policy-check.mjs
node scripts/vehicle-model-api-check.mjs
node scripts/lookup-ssr-resilience-check.mjs
```

Production SSR được kiểm tra với API HTTP cô lập, không ghi database thật:

- Lookup branches/body-styles/car-versions trả 429 hoặc 503: home/listing vẫn trả nội dung xe thật; không có Application error, không mất query chi nhánh/kiểu dáng/phiên bản.
- Một trang lookup bị lỗi không được đưa vào catalog phân trang thiếu dữ liệu.
- `/sedan` khi chưa xác định được route: trạng thái thử lại, không đoán sai model hoặc trả 404 sai.
- Cars trả 503: trạng thái lỗi thay cho số lượng 0 giả; khi API phục hồi, bấm Thử lại lấy được danh sách xe.
- Retry-After dài không bị retry trước hạn; lỗi/fallback không bị cache; thay đổi dữ liệu từ API được thấy ở render tiếp theo.

Web có các warning lint đã tồn tại về `<img>` và hook ở VehicleLightbox, VehicleModelOptions, ResponsiveImage; không có lỗi lint mới trong phần sửa.

## Áp dụng trên VPS

Triển khai lại **cả API và web** từ mã đã build. Không cần migration hoặc thay authentication. Đường đọc SSR nên đi qua `API_URL` nội bộ loopback như cấu hình local đã kiểm tra; ngoại lệ không áp dụng cho IP ngoài hoặc API gọi qua một domain bên ngoài VPS. Public cache chỉ bật khi topology một process đã được xác nhận theo cấu hình hiện có; khi cache tắt, limiter vẫn hoạt động và web vẫn xử lý lookup lỗi an toàn.

Chưa triển khai hoặc restart dịch vụ production trong lần sửa này. Không cam kết mọi 429 biến mất: 429 vẫn đúng và cần thiết khi vượt các giới hạn chống spam, Admin hoặc origin reads.

Tham khảo: [NestJS rate limiting](https://docs.nestjs.com/security/rate-limiting), [Next.js caching](https://nextjs.org/docs/app/guides/caching-without-cache-components), [Next.js 15 internal control-flow errors](https://nextjs.org/docs/15/app/api-reference/functions/unstable_rethrow).
