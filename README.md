# API Xe Lướt Toàn Trung

Backend NestJS chạy trên Fastify, dùng Drizzle ORM, Supabase PostgreSQL và Cloudflare R2. Admin và website đã tích hợp các API xác thực/RBAC, xe/media, danh mục, nội dung, SEO, lead và newsletter. Chi tiết tích hợp xem [docs/frontend-integration.md](docs/frontend-integration.md).

## Trợ lý AI ô tô

Module độc lập `src/modules/chatbot/` cung cấp `POST /api/v1/chat` public, streaming SSE từ OpenRouter hoặc Groq qua provider abstraction. Chỉ cho phép model trong `src/config/ai-models.ts`; không fallback model/provider. Không truy vấn tồn kho và không lưu hội thoại vào database.

Thêm vào **backend** `.env`:

```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your-backend-only-key
OPENROUTER_MODEL=qwen/qwen3.8-27b:free
GROQ_API_KEY=
GROQ_MODEL=
GROQ_FREE_TIER_CONFIRMED=false
CHAT_RATE_LIMIT=10
CHAT_RATE_WINDOW_MS=600000
CHAT_TIMEOUT_MS=30000
CHAT_TRUSTED_PROXY_IPS=
```

Không thêm key vào frontend hoặc biến `NEXT_PUBLIC_*`. Model/provider chọn bằng env backend; không lấy từ request. OpenRouter chỉ dùng ID `:free` trong allowlist, `max_price=0` và `allow_fallbacks=false`. Để dùng Groq, đặt `AI_PROVIDER=groq`, `GROQ_MODEL` trong allowlist và **xác minh tài khoản đang dùng Free Plan** trước khi đặt `GROQ_FREE_TIER_CONFIRMED=true`. Cùng ID model có thể tính phí trên Developer Plan; backend không có API để tự xác minh gói tài khoản và không gọi billing endpoint. Gemini không còn được chatbot sử dụng.

Chạy `npm run dev`, sau đó frontend gọi endpoint qua proxy Next.js `/api/v1/chat`. Request: `{ "message": "ABS là gì?", "history": [] }`. SSE giữ nguyên `content`, `sources`, `done`, `error`; nguồn hiện là `[]`, không có Google Search/tool. Chưa có key/model thì chỉ chatbot trả lỗi cấu hình 503; API khác vẫn chạy. Model/provider không hợp lệ sẽ bị từ chối bởi config validator.

Chatbot có rate limit riêng **10 request / 10 phút / IP**, trả 429 và `Retry-After`. Memory store có thể thay bằng Redis qua provider `ChatRateStore` khi chạy nhiều instance. Khi chạy sau Next.js/reverse proxy, cấu hình `CHAT_TRUSTED_PROXY_IPS` bằng **đúng IP** các proxy tin cậy và bảo đảm proxy ghi chuỗi `X-Forwarded-For` đúng; không tin header này từ peer ngoài danh sách. Không thay rate limit của endpoint khác.

Kiểm thử: `npm test`, `npm run lint`, `npm run build`. Smoke test thật, một request tới đúng provider/model trong env: `npx tsx scripts/chatbot-provider-smoke.ts`. Đổi env cần restart API. Xem [AI_PROVIDER_MIGRATION.md](../technical%20documentation/AI_PROVIDER_MIGRATION.md).

## Cài đặt

Yêu cầu Node.js tương thích với NestJS 12 và một database PostgreSQL/Supabase. Trong thư mục này:

```bash
npm ci
```

## Môi trường

Sao chép `.env.example` thành `.env` rồi điền `DATABASE_URL` và `SUPABASE_URL` (Project URL trong Supabase Dashboard). Không commit `.env`. Với Supabase, dùng chuỗi kết nối Session pooler (cổng 5432) khi môi trường chạy không hỗ trợ IPv6 của Direct connection. Mật khẩu có ký tự đặc biệt phải được URL encode.

Các biến đang dùng:

| Biến | Ý nghĩa |
| --- | --- |
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL, bắt buộc |
| `NODE_ENV` | `development`, `test` hoặc `production`; mặc định `development` |
| `PORT` | Cổng API, mặc định `4000` |
| `CORS_ORIGINS` | Danh sách origin cách nhau bằng dấu phẩy; bắt buộc trong production, không dùng `*` |
| `RATE_LIMIT_TTL_MS` | Cửa sổ giới hạn request, mặc định 60000 ms |
| `RATE_LIMIT_MAX` | Số request tối đa trong mỗi cửa sổ, mặc định 100 |
| `SUPABASE_URL` | Project URL dạng `https://<project-ref>.supabase.co`, bắt buộc |
| `SUPABASE_JWT_ISSUER` | Tùy chọn; mặc định `<SUPABASE_URL>/auth/v1` |
| `SUPABASE_JWKS_URL` | Tùy chọn; mặc định `<issuer>/.well-known/jwks.json` |
| `SUPABASE_ANON_KEY` | Cần nếu project còn ký access token bằng HS256; dùng để xác minh token qua Supabase Auth `/user` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Thông tin bucket và access key R2 cho media xe |
| `R2_PUBLIC_BASE_URL` | URL HTTPS công khai cho object R2 |

`SUPABASE_SERVICE_ROLE_KEY` có trong file mẫu nhưng backend hiện không dùng. Không đặt service role key hay khóa R2 trong frontend. R2 có thể bỏ trống khi chỉ chạy các module không dùng media; các endpoint media sẽ trả 503 cho đến khi cấu hình đầy đủ.

## Database

Schema và ERD: [docs/database-schema.md](docs/database-schema.md). Migration ban đầu gồm 32 bảng. Trước khi chạy ứng dụng trên database mới:

```bash
npm run db:ping
npm run db:migrate
npm run db:seed
```

Seed tạo các role và permission nền tảng, có thể chạy lại. Khi thay đổi schema, dùng `npm run db:generate` để tạo migration rồi kiểm tra bằng `npm run db:check` trước khi migrate. Không dùng `db:generate` để áp dụng migration.

## Supabase Auth và quyền admin

Các route API yêu cầu header `Authorization: Bearer <access_token>` theo mặc định. `GET /health` được đánh dấu public. Token ký bằng khóa bất đối xứng được xác minh bằng JWKS của project, với chữ ký, issuer, audience `authenticated`, thời hạn và role. Khóa JWKS được cache trong tiến trình; việc xác minh JWT không cần truy vấn database. Với token HS256 cũ, backend gọi Supabase Auth `/user` để xác minh; cần `SUPABASE_ANON_KEY`. Không dùng JWT secret hoặc service role key để tự xác minh token cũ.

`GET /api/v1/admin/me` yêu cầu một profile admin đang active, chưa bị xóa. Kết quả gồm `profile`, `roles` và `permissions` lấy từ các bảng RBAC. Tài khoản Auth mới không tự có quyền admin. Các route cần quyền sử dụng `@Permissions('resource.action')`; guard đọc quyền mới nhất từ database để việc thu hồi quyền có hiệu lực ở request kế tiếp.

Để cấp quyền quản trị đầu tiên, tạo user trong Supabase Auth trước, lấy UUID của user trong Dashboard rồi chạy lệnh sau trên máy có quyền truy cập database:

```bash
npm run admin:bootstrap -- <auth-user-uuid> "Tên quản trị"
```

Lệnh xác nhận user tồn tại trong `auth.users`, tạo profile nếu chưa có và gán `SUPER_ADMIN` theo kiểu chạy lại an toàn. Chỉ chạy với UUID của người được phép quản trị. Các role mặc định khác là `ADMIN`, `CONTENT_EDITOR`, `INVENTORY_MANAGER`, `SALES`, `SEO_MANAGER`; bảng `user_roles` là nguồn phân quyền của ứng dụng.

Kiểm tra lại tài khoản, profile và số quyền bằng lệnh chỉ đọc:

```bash
npm run admin:check-user -- <auth-user-uuid>
```

## Chạy ứng dụng

```bash
npm run dev
```

Mặc định API nghe ở `http://localhost:4000`:

- `GET /health`: kiểm tra ứng dụng và kết nối database; trả HTTP 503 khi database không khả dụng.
- `/api/docs`: Swagger UI; `/api/docs-json`: OpenAPI JSON.
- `GET /api/v1/admin/me`: thông tin và quyền của admin hiện tại; cần Bearer token.
- `GET /api/v1/brands`, `GET /api/v1/brands/:slug/models`: danh mục công khai.
- `GET /api/v1/cars`, `GET /api/v1/cars/:slug`: danh sách và chi tiết xe công khai.
- `/api/v1/admin/brands`, `/api/v1/admin/car-models`, `/api/v1/admin/cars`: CRUD có RBAC; thao tác publish/unpublish cho xe.
- Các API danh mục, nội dung, SEO, lead và newsletter cũng nằm dưới `/api/v1`; danh sách và hợp đồng xem [docs/api-design.md](docs/api-design.md).

Hợp đồng endpoint, bộ lọc, response và quy tắc xuất bản: [docs/cars-api.md](docs/cars-api.md).

Build và chạy bản đã biên dịch:

```bash
npm run build
npm run start
```

Kiểm tra mã nguồn:

```bash
npm run lint
npm run typecheck
npm run test
```

## Cấu trúc

`src/config` xác thực biến môi trường; `src/database` quản lý một pool kết nối và Drizzle schema; `src/modules/auth` chứa xác thực JWT, `@CurrentUser()`, profile admin và RBAC guard; `src/modules/catalog` và `src/modules/cars` chứa API Phase 5; `src/common` chứa logger Pino và exception filter; `src/modules/health` chứa health endpoint. Ứng dụng dùng global validation pipe, Helmet, CORS theo môi trường và rate limit. Request log ghi ID, phương thức, đường dẫn, mã phản hồi và thời gian; không ghi token hoặc mật khẩu.
# Media / R2 (Phase 6)

See [docs/media-api.md](docs/media-api.md) for R2 configuration, bucket CORS, direct upload, media CRUD, and retryable deletion. Check credentials with `npm run r2:ping`.

# Content, SEO, enquiries (Phase 7)

See [docs/phase7-api.md](docs/phase7-api.md) for public and admin endpoints, permissions, validation, and scope decisions.

## Định giá xe cũ

Xem [docs/valuation-system.md](docs/valuation-system.md) để biết công thức, API/quyền, nguồn giá khởi tạo, quản trị bộ cấu hình chung, bật/tắt, cập nhật giá và khôi phục tỷ lệ. Admin sửa giá/rule/cấu hình rồi lưu để áp dụng ngay. Tiện ích đã bật trên database phát triển/test; dữ liệu niêm yết và tỷ lệ khởi tạo chỉ dùng tham khảo, cần kiểm định để xác nhận giá thu mua.

## Mua xe theo nhu cầu

Public quiz, ranking theo dữ liệu kho thật và lịch sử PostgreSQL. [Phase 1](docs/mua-xe-theo-nhu-cau/phase-1-report.md) ghi API public, migration 0014, seed và retention. [Phase 2](docs/mua-xe-theo-nhu-cau/phase-2-report.md) ghi API admin, migration 0015 và cách sử dụng 4 tab tại Admin → Tiện ích → Mua xe theo nhu cầu. Admin sửa trực tiếp một cấu hình; lịch sử giữ snapshot. Cấu hình đã bật trên database phát triển/test; không seed hồ sơ đặc tính giả.

[Cập nhật giao diện và phân trang](docs/mua-xe-theo-nhu-cau/ui-pagination-update.md): hiệu ứng chuyển câu hỏi, thẻ kết quả gọn hơn, 6 xe mỗi lần tải và Xem thêm; migration 0016 mở giới hạn tổng kết quả.
