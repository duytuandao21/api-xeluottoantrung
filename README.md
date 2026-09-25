# API Xe Lướt Toàn Trung

Backend NestJS chạy trên Fastify, dùng Drizzle ORM và Supabase PostgreSQL. Phase 3 cung cấp cấu hình, kết nối database, bảo vệ HTTP cơ bản, Swagger và health check. Các API nghiệp vụ và xác thực được triển khai ở những phase tiếp theo.

## Cài đặt

Yêu cầu Node.js tương thích với NestJS 12 và một database PostgreSQL/Supabase. Trong thư mục này:

```bash
npm ci
```

## Môi trường

Sao chép `.env.example` thành `.env` rồi điền `DATABASE_URL`. Không commit `.env`. Với Supabase, dùng chuỗi kết nối Session pooler (cổng 5432) khi môi trường chạy không hỗ trợ IPv6 của Direct connection. Mật khẩu có ký tự đặc biệt phải được URL encode.

Các biến cần cho Phase 3:

| Biến | Ý nghĩa |
| --- | --- |
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL, bắt buộc |
| `NODE_ENV` | `development`, `test` hoặc `production`; mặc định `development` |
| `PORT` | Cổng API, mặc định `4000` |
| `CORS_ORIGINS` | Danh sách origin cách nhau bằng dấu phẩy; bắt buộc trong production, không dùng `*` |
| `RATE_LIMIT_TTL_MS` | Cửa sổ giới hạn request, mặc định 60000 ms |
| `RATE_LIMIT_MAX` | Số request tối đa trong mỗi cửa sổ, mặc định 100 |

Các biến `SUPABASE_*` và `R2_*` có trong file mẫu để chuẩn bị cho auth và media ở các phase sau; Phase 3 chưa sử dụng chúng.

## Database

Schema và ERD: [docs/database-schema.md](docs/database-schema.md). Migration ban đầu gồm 32 bảng. Trước khi chạy ứng dụng trên database mới:

```bash
npm run db:ping
npm run db:migrate
npm run db:seed
```

Seed tạo các role và permission nền tảng, có thể chạy lại. Khi thay đổi schema, dùng `npm run db:generate` để tạo migration rồi kiểm tra bằng `npm run db:check` trước khi migrate. Không dùng `db:generate` để áp dụng migration.

## Chạy ứng dụng

```bash
npm run dev
```

Mặc định API nghe ở `http://localhost:4000`:

- `GET /health`: kiểm tra ứng dụng và kết nối database; trả HTTP 503 khi database không khả dụng.
- `/api/docs`: Swagger UI; `/api/docs-json`: OpenAPI JSON.
- Các API nghiệp vụ sau này nằm dưới `/api/v1`.

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

`src/config` xác thực biến môi trường; `src/database` quản lý một pool kết nối và Drizzle schema; `src/common` chứa logger Pino và exception filter; `src/modules/health` chứa health endpoint. Ứng dụng dùng global validation pipe, Helmet, CORS theo môi trường và rate limit. Request log ghi ID, phương thức, đường dẫn, mã phản hồi và thời gian; không ghi token hoặc mật khẩu.
