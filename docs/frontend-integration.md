# Tích hợp frontend

## Admin

`admin-xeluottoantrung` dùng Supabase Auth để lấy access token, gửi Bearer token tới API. API quản lý RBAC. CRUD xe, ảnh R2, danh mục, nội dung, SEO, lead, khách hàng và dashboard lấy dữ liệu từ API. Chi tiết xem [phase8-admin.md](phase8-admin.md).

## Website

| Màn hình | Nguồn dữ liệu |
| --- | --- |
| Trang chủ | `GET /cars?sort=newest&limit=6` cho dải xe mới; `GET /slides`, `/brands`, `/lookups/body-styles` cho hero và chọn danh mục; giữ khuôn HTML cũ |
| Danh sách, tìm kiếm, lọc, phân trang | `GET /cars` với query tương ứng; thay toàn bộ card xe snapshot |
| Trang hãng, dòng, kiểu dáng | `GET /brands`, `/lookups/body-styles` để nhận diện route; `GET /cars` với bộ lọc |
| Chi tiết xe | `GET /cars/:slug` cho giá, mô tả, thông số, gallery; `GET /cars?brand=...` cho xe liên quan |
| Metadata | `GET /seo?route=...`, ưu tiên cấu hình admin; chi tiết xe dùng title, description, ảnh từ API khi chưa có SEO riêng |
| Tin tức, FAQ, cảm nhận | `GET /articles`, `/articles/:slug`, `/faqs`, `/testimonials` |
| Dịch vụ, tuyển dụng, trang thông tin | `GET /services`, `/recruitments`, `/pages/by-path`; chèn vào khuôn trang hiện có |
| Bán xe, lên đời | `GET /brands`, `/brands/:slug/models`, `/lookups/car-versions`; `POST /leads` |
| Gọi lại, đăng ký nhận tin | `POST /leads`, `POST /newsletter-subscriptions` |
| Showroom và thông tin liên hệ | `GET /branches`, `/lookups/branch-regions`, `/site-settings/thiet-lap-thong-tin` |
| Nội dung bán/lên đời | `GET /site-settings/thiet-lap-text-ban-xe`, `/site-settings/thiet-lap-text-len-doi` |

Server rendering giữ nội dung xe và metadata có thể lập chỉ mục. Request xe (`/cars` và `/cars/:slug`) đọc dữ liệu mới ở mỗi lần truy cập để thay đổi giá/xuất bản/ẩn xe không bị cache giữ kết quả cũ; danh mục và nội dung khác cache 30 giây. Danh sách chỉ tải ảnh đại diện; khi người dùng bấm mũi tên trên card, trình duyệt lấy gallery của riêng xe đó qua `/cars/:slug` và cho chuyển ảnh vòng từ cuối về đầu. Các route xe lịch sử không có bản ghi public trả 404, tránh hiển thị xe mẫu như hàng đang bán. Khi API không có xe, danh sách hiển thị trạng thái rỗng.

Website vẫn dùng snapshot cho menu, hình trang trí và một số trang thông tin chưa có bản ghi CMS. Hero giữ ảnh snapshot khi chưa có slide active trong database. Các trang tài khoản công khai từ website cũ chưa kích hoạt Supabase customer auth. Không có UI phụ kiện, định giá tự động hay tra cứu phạt nguội để kết nối.

Kiểm tra Phase 9: lint, typecheck và build web/admin đạt (lint còn cảnh báo ảnh legacy); lint, 7 test và build API đạt. HTTP website với API mô phỏng đã xác nhận trang chủ/danh sách/chi tiết/gallery và 404 cho xe không xuất bản. Với API thật, `/health` trả `database: ok`, danh mục hãng/kiểu dáng tải từ DB và trình duyệt nạp được dòng xe theo hãng; trang đăng nhập admin và website trả HTTP 200. DB kiểm tra hiện có 0 xe public; chuỗi thao tác admin tạo xe → R2 → publish → website chưa thể kiểm tra trực tiếp nếu không có xe đã xuất bản và phiên đăng nhập admin.
