# Chống spam bốn form công khai

Phạm vi: bán xe (`sell`), lên đời (`trade_in`), gọi lại (`callback`, gồm popup sản phẩm/phụ kiện) và nhận tin. `finance` và các endpoint Admin/chatbot không đổi. API trả `{ accepted: true }` cho form đã bật bảo vệ, kể cả yêu cầu trùng; không tiết lộ số điện thoại/email có trong hệ thống.

## Cấu hình

API:

| Biến | Ý nghĩa |
|---|---|
| `FORM_DEDUPE_HMAC_KEY` | Bí mật ngẫu nhiên tối thiểu 32 ký tự; giữ ổn định qua các lần deploy. Bắt buộc khi bật ít nhất một form. |
| `FORM_PROTECTION_SELL_ENABLED` | Bật riêng form bán xe. Mặc định `false`. |
| `FORM_PROTECTION_TRADE_IN_ENABLED` | Bật riêng form lên đời. Mặc định `false`. |
| `FORM_PROTECTION_CALLBACK_ENABLED` | Bật riêng các form gọi lại. Mặc định `false`. |
| `FORM_PROTECTION_NEWSLETTER_ENABLED` | Bật riêng nhận tin. Mặc định `false`. |
| `TURNSTILE_ENABLED` | Bật xác minh Turnstile cho các form có cờ bảo vệ. Mặc định `false`. |
| `TURNSTILE_SECRET_KEY` | Secret của widget Managed. Chỉ đặt ở API. |
| `TURNSTILE_EXPECTED_HOSTNAMES` | Danh sách hostname WEB chính xác, phân tách bằng dấu phẩy, không gồm protocol; thêm hostname staging nếu cần. |

WEB: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` là site key công khai, cấu hình lúc **build WEB**. Khi có site key, script Turnstile chỉ tải khi gửi; widget có thể hiện lúc cần tương tác. Form popup chỉ tải sau khi mở và gửi. Action: `sell_car`, `trade_in`, `callback`, `newsletter`.

API cần ra ngoài tới `https://challenges.cloudflare.com/turnstile/v0/siteverify` qua HTTPS. Khi API không kết nối được, form fail closed; không ghi lead/subscriber. Chỉ có thể bật `TURNSTILE_ENABLED=true` sau khi key, hostname, khả năng kết nối và WEB đã được kiểm chứng.

## IP và proxy trước khi bật cờ

Rate limit dùng `request.ip` do Fastify tính với `trustProxy` chỉ tin loopback. Cần xác minh trên production: Cloudflare ghi IP thật; origin chỉ nhận Cloudflare/proxy được phép; Nginx **ghi đè** `X-Forwarded-For` từ client ngoài thay vì chấp nhận giá trị tự đặt; Next rewrite `/api/v1/*` chuyển đúng chuỗi proxy; Fastify chọn IP khách chứ không phải Cloudflare/Next/Nginx. Dùng hai IP giả trong staging và request hợp lệ, không cần scan production. Nếu API thấy loopback ở production, form đã bật bảo vệ trả 503 để tránh gộp mọi khách vào cùng quota. Không bật cờ khi chưa xác nhận topology này.

## Thứ tự triển khai

1. **Migration:** sao lưu/kiểm tra migration mới `0024_form_protection.sql`; chạy bằng quy trình migration đã duyệt. Không dùng `drizzle-kit push` và không tự động migrate production. Migration chỉ thêm ba bảng/index, không ghi đè dữ liệu cũ.
2. **API:** deploy với toàn bộ `FORM_PROTECTION_*_ENABLED=false` và `TURNSTILE_ENABLED=false`; xác nhận endpoint cũ vẫn hoạt động. Đặt HMAC key/Turnstile secret/expected hostnames trong môi trường API trước khi bật cờ.
3. **WEB:** build/deploy với `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; kiểm tra bốn form bằng dữ liệu giả ở staging. Sau khi xác minh ingress IP và Siteverify, bật lần lượt từng `FORM_PROTECTION_*_ENABLED`, rồi bật `TURNSTILE_ENABLED=true` khi WEB tương ứng đã chạy. Không bật Turnstile trên API trước WEB.

Tắt cờ từng form để quay về đường API cũ nếu cần; không xóa bảng hay đổi HMAC key để rollback. Cờ tắt không xóa receipt còn hiệu lực. Cookie/phiên Admin không tham gia cơ chế này.

## Hành vi và lưu trữ

- Số `+84…` và `0…` về cùng dạng `0…`; email trim/lowercase. Tên khách không nằm trong fingerprint. Xe ưu tiên `carId`; nếu không có, chuẩn hóa nhãn xe và thông số bằng Unicode NFC, trim, gộp khoảng trắng và lowercase tiếng Việt.
- Cửa sổ chống trùng tính từ lần tạo bản ghi gần nhất: bán/lên đời 10 phút, gọi lại 15 phút. Nhận tin dựa trên unique email; email đã có không tạo thêm bản ghi hoặc kích hoạt lại bản ghi inactive. Một nội dung trùng không tạo thông báo mới.
- `submissionId` UUID được WEB giữ khi retry cùng nội dung. Receipt giữ 24 giờ, trả xác nhận cũ trước khi tính quota hoặc xác minh lại. Cùng mã nhưng payload khác trả 409. Khóa transaction PostgreSQL xử lý request đồng thời.
- Bộ đếm IP lưu trong PostgreSQL: ba form liên hệ dùng chung 5/60 giây và 20/15 phút; nhận tin riêng 5/60 giây. 429 có `Retry-After`. IP lưu dưới HMAC, không lưu địa chỉ thô. Các lượt xác minh thất bại vẫn tính quota. Job cleanup mỗi giờ xóa receipt/dedupe hết hạn và sự kiện rate quá 15 phút; cửa sổ được kiểm tra theo thời điểm nên không phụ thuộc job chạy đúng giờ.
- WEB giữ dữ liệu khi mạng lỗi, khóa nút lúc đang gửi và 30 giây sau thành công; token Turnstile được tạo mới ở lần gửi kế tiếp. Lỗi 429 hiển thị thời gian chờ. Không log token, số điện thoại, email hoặc HMAC key.
