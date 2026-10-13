# Sự kiện / Khuyến mãi

## Sử dụng

- Admin: `/quan-ly/khuyen-mai`, trong nhóm Bài viết & nội dung.
- Website: `/khuyen-mai`, 6 chương trình mỗi trang, 3 cột trên desktop.
- Nhập tiêu đề, loại chương trình, một ảnh, nội dung và ngày bắt đầu/kết thúc theo `dd/mm/yyyy`. Database lưu hai cột `DATE`; API trả về `yyyy-mm-dd`, không nhận/lưu giờ cho ngày áp dụng.
- Bỏ chọn **Đăng chương trình** để lưu bản nháp. Bản nháp không xuất hiện trên website.
- **Bật popup** trong danh sách hoặc **Dùng ảnh làm popup quảng cáo** trong biểu mẫu sẽ thay chương trình đã chọn trước đó. **Tắt popup** không ảnh hưởng bài đăng.
- Không cần chọn trạng thái thủ công: đang diễn ra từ ngày bắt đầu đến hết ngày kết thúc (bao gồm cả hai ngày); sắp diễn ra trước ngày bắt đầu; kết thúc sau ngày kết thúc. Dùng ngày hiện tại theo lịch Việt Nam. Cho phép chương trình chỉ áp dụng một ngày. Thứ tự danh sách: đang diễn ra, sắp diễn ra, kết thúc.

## Popup quảng cáo

- Chương trình đang hoặc sắp diễn ra đều có thể được chọn. Chương trình hết hạn hoặc bản nháp không thể bật popup.
- Một bản ghi cấu hình duy nhất trỏ tới một chương trình. Các thao tác thay ảnh được khóa trong transaction để không thể bật đồng thời nhiều ảnh.
- Sau khi cửa sổ tải xong, chờ 3 giây rồi lấy ảnh được chọn. Không có ảnh, API lỗi hoặc ảnh không tải được: không hiện popup.
- Chỉ hiện ảnh bo góc và nút đóng. Bấm ảnh sẽ mở trang Khuyến mãi và chi tiết tương ứng.
- Không chồng lên hộp thoại đang mở. Nếu chương trình hết hạn khi đang chờ hoặc đang hiện, popup tự dừng.
- Đóng quảng cáo sẽ giữ trạng thái trong lần truy cập của tab, kể cả liên kết cũ tải lại tài liệu khi chuyển trang. Nhấn tải lại trang (F5/Reload) bắt đầu lần truy cập mới. Không lưu trạng thái đóng vĩnh viễn.
- Trạng thái/thời gian và popup đọc trực tiếp từ API, `Cache-Control: no-store`, không cần cron. Khi hết hạn, API tự trả về không có ảnh popup.
- Khung chi tiết giữ ảnh cố định và cuộn riêng nội dung; mobile xếp ảnh phía trên nội dung.

## Database và triển khai

- Migration: `0019_conscious_apocalypse.sql`, tạo `promotions` và `promotion_popup`; không thay bảng xe hay nội dung cũ. Bật RLS, chặn quyền truy cập trực tiếp của `PUBLIC`, `anon`, `authenticated`.
- Migration `0020_wet_bishop.sql`: chuyển ngày áp dụng từ timestamp sang DATE, lấy ngày theo lịch Việt Nam trước khi bỏ giờ. Giữ ảnh, mô tả và lựa chọn popup cũ. Các mốc tạo/cập nhật phục vụ nhật ký hệ thống vẫn độc lập với ngày áp dụng.
- Quyền Admin dùng nhóm quyền nội dung hiện có: `content.read/create/update/delete`; upload dùng `media.create`. Không cần thêm mã quyền mới.
- Trước khi chạy code mới trên một database khác: `npm.cmd run db:migrate` trong API. Trên Linux dùng `npm run db:migrate`.
- Build và khởi động lại API, Admin và Web theo quy trình triển khai hiện có. Với API trên PM2 fork một instance: chạy build rồi restart đúng tên ứng dụng đã cấu hình; không đổi topology cache.
- Bài kiểm thử chỉ được tạo trong database tạm. Không tạo dữ liệu khuyến mãi mẫu trong database hiện tại.

## Kiểm tra

Trong API:

```sh
npm run test
npm run build
```

Build Web và Admin trước, rồi trong Web:

```sh
node scripts/promotions-check.mjs
```

Script dùng Chrome đã cài, API Nest thật và PGlite tạm với toàn bộ migration. Kiểm tra các màn hình desktop/mobile, phân trang, lọc nội dung HTML, ảnh cố định khi cuộn, focus/đóng, thời gian popup, chuyển trang/tải lại, một ảnh quảng cáo, upload, nhập/hiển thị ngày, mô tả khi tạo/sửa, bản nháp và phân quyền. Ảnh chụp lưu ở `web-xeluottoantrung/artifacts/promotions`.
