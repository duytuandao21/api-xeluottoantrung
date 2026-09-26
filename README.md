# API Xe Lướt Toàn Trung

Backend NestJS chạy trên Fastify, dùng Drizzle ORM, Supabase PostgreSQL và Cloudflare R2. Admin và website đã tích hợp các API xác thực/RBAC, xe/media, danh mục, nội dung, SEO, lead và newsletter. Chi tiết tích hợp xem [docs/frontend-integration.md](docs/frontend-integration.md).

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
