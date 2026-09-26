# Triển khai và vận hành

Chạy Node.js tương thích với ba `package.json`. PostgreSQL là Supabase PostgreSQL; ảnh dùng Cloudflare R2. Mỗi project cài dependency bằng `npm ci` trong thư mục riêng.

## Biến môi trường

| Project | Biến |
| --- | --- |
| API | `DATABASE_URL`, `NODE_ENV`, `PORT`, `CORS_ORIGINS`, `SUPABASE_URL`; tùy cấu hình JWT: `SUPABASE_ANON_KEY`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWKS_URL`; R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`; giới hạn request: `RATE_LIMIT_TTL_MS`, `RATE_LIMIT_MAX` |
| Admin | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Web | `API_URL` (server Next.js gọi API), `NEXT_PUBLIC_API_URL` (trình duyệt gọi API công khai) |

Không đặt service role key, mật khẩu DB hay khóa R2 trong biến `NEXT_PUBLIC_*`. API `CORS_ORIGINS` phải liệt kê chính xác origin của admin và website, ví dụ `https://admin.example.com,https://example.com`. Bucket R2 cần CORS PUT cho origin admin. Public base URL của R2 phải truy cập được từ trình duyệt.

## Khởi tạo và chạy

Trong `api-xeluottoantrung`:

```bash
npm ci
npm run db:ping
npm run db:migrate
npm run db:seed
npm run build
npm start
```

Trong `admin-xeluottoantrung` và `web-xeluottoantrung`, lần lượt chạy `npm ci`, `npm run build`, `npm start`. Local mặc định: API cổng 4000, admin cổng 3000, web cổng 3001. Với web local: `npm run dev -- -p 3001`; với admin: `npm run dev -- -p 3000`.

Tạo admin đầu tiên trong Supabase Auth, rồi dùng `npm run admin:bootstrap -- <auth-user-uuid> "Tên hiển thị"` trong API. Không chạy bootstrap với UID không được phép quản trị. Seed quyền có thể chạy lại; migration phải được áp dụng trước khi chạy API.

## Kiểm tra sau triển khai

1. `GET /health` trả `database: ok`; `/api/docs` mở được.
2. Admin đăng nhập, tạo xe, tải ảnh lên R2, publish.
3. `GET /api/v1/cars` có xe; website liệt kê xe và route `/:slug` có gallery.
4. Sửa giá admin; kiểm tra API rồi website sau tối đa khoảng 30 giây cache.
5. Unpublish; API và website không còn trả xe public, trang chi tiết trả 404.
6. Kiểm tra preflight CORS từ cả origin admin và web; thử lead/newsletter hợp lệ theo nhu cầu vận hành.

Trước khi áp dụng migration lên môi trường có dữ liệu, sao lưu PostgreSQL và kiểm tra thay đổi schema. Sau khi đổi `NEXT_PUBLIC_*`, build lại frontend vì các giá trị đó được đóng vào bundle trình duyệt. Website cần Next.js server để render route động; không dùng static export.
