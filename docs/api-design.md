# Thiết kế API

Base path: `/api/v1`. Các danh sách phân trang trả `{ data, meta: { page, limit, total, totalPages } }`. Validation từ chối trường không hỗ trợ; lỗi có `statusCode`, `error`, `message`. Endpoint admin cần Supabase access token và permission tương ứng. Swagger chi tiết: `/api/docs` hoặc `/api/docs-json`.

| Nhóm | Công khai | Admin |
| --- | --- | --- |
| Xe | `GET /cars`, `GET /cars/:slug` | `GET/POST /admin/cars`, `GET/PATCH/DELETE /admin/cars/:id`, `POST /admin/cars/:id/publish`, `POST /admin/cars/:id/unpublish` |
| Danh mục | `GET /brands`, `GET /brands/:slug/models`, `GET /lookups/:resource`, `GET /branches`, `GET /branches/:slug` | CRUD `/admin/brands`, `/admin/car-models`, `/admin/lookups/:resource` |
| Media | Public URL trong dữ liệu xe | `POST /admin/media/presign`, `POST /admin/media/assets/presign`, `GET/POST /admin/cars/:id/media`, `PATCH /admin/cars/:id/media/order`, `PATCH/DELETE /admin/cars/:id/media/:mediaId` |
| Nội dung | `GET /articles`, `/articles/:slug`, `/article-categories`, `/faqs`, `/testimonials`, `/services`, `/recruitments`, `/slides`, `/pages/by-path`, `/content`, `/content/:group/:key`, `/site-settings/:group` | CRUD `/admin/collections/:collection`, `/admin/content`, `PUT /admin/site-settings/:group/:key` |
| SEO | `GET /seo?route=...` | `GET /admin/seo`, `GET /admin/seo/by-route`, `PUT/DELETE /admin/seo` |
| Yêu cầu khách | `POST /leads`, `POST /newsletter-subscriptions` | CRUD `/admin/leads`, `/admin/newsletter-subscribers`, xuất CSV `/admin/newsletter-subscribers/export` |
| Tài khoản và tổng quan | `GET /health` ở root | `GET/PATCH /admin/me`, CRUD `/admin/customers`, `GET /admin/dashboard` |

`GET /cars` chỉ trả dữ liệu card và một ảnh đại diện. Các bộ lọc gồm `search`, `brand`, `model`, `version`, `year_from/to`, `price_min/max`, `body_type`, `fuel_type`, `transmission`, `color`, `branch`, `mileage_min/max`, `status`, `featured`, `page`, `limit`, `sort`. `brand`, `body_type`, `transmission`, `color` chấp nhận tối đa 20 slug phân tách bằng dấu phẩy để hỗ trợ chọn nhiều mục trong bộ lọc website. Giá dùng VND; quãng đường dùng km. Danh sách công khai chỉ trả xe đã publish, chưa xóa và có hãng/dòng đang hoạt động.

`POST /leads` nhận loại `sell`, `trade_in`, `callback`, hoặc `finance`; phản hồi không lặp lại thông tin liên hệ. `POST /newsletter-subscriptions` nhận email. Mỗi endpoint bị giới hạn 5 request/phút/IP. Các endpoint này ghi dữ liệu thật, không tạo kết quả định giá hoặc phê duyệt vay tự động.

Chi tiết theo module: [cars-api.md](cars-api.md), [media-api.md](media-api.md), [phase7-api.md](phase7-api.md).
