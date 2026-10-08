# Cập nhật khảo sát và kết quả — 07/10/2026

Áp dụng sau Phase 2, theo yêu cầu chỉnh giao diện và tải thêm xe.

## Giao diện

- Câu hỏi chuyển bằng hiệu ứng trượt nhẹ và mờ trong 280 ms; chiều chuyển khác nhau khi tiến/lùi. Giữ câu trả lời khi quay lại và tắt hiệu ứng theo `prefers-reduced-motion`.
- Các mục ưu tiên trượt lên/xuống trong 280 ms khi đổi thứ tự. Đo vị trí thực tế để hỗ trợ hàng cao khác nhau và bấm liên tục giữa hiệu ứng; giữ focus bàn phím, thông báo thứ tự cho trình đọc màn hình và dừng hiệu ứng khi bật giảm chuyển động.
- Bỏ dòng mô tả dưới tiêu đề. Hiển thị đầy đủ PNG tiện ích hiện có: quy tắc scoped ghi đè `img { max-width:100% !important }` trong stylesheet chung; không thay ảnh.
- Kết quả chỉ giữ điểm phù hợp, thẻ xe và các lý do khớp. Bỏ đoạn giải thích điểm, caveats, tỷ lệ đầy đủ dữ liệu và nút chi tiết/liên hệ trong thẻ. Bấm ảnh/tên hoặc phần còn lại của thẻ để xem xe; thao tác so sánh và đổi ảnh vẫn dùng hành vi riêng.
- **Xem toàn bộ kho xe**, **Làm lại khảo sát** đặt bên phải tiêu đề kết quả trên desktop; mobile xếp ngay dưới tiêu đề và căn phải. Cuối danh sách có nút **Xem thêm** dùng style chung với `/san-pham`, có trạng thái tải, lỗi và thử lại; mỗi lần bổ sung tối đa 6 xe.
- Tiến độ chỉ tồn tại trong bộ nhớ khi đang ở trang khảo sát. Không lưu câu trả lời, bước, capability hoặc kết quả vào browser storage; xóa khóa tiến độ của bản cũ. Sang trang khác, tải lại hoặc quay lại bằng lịch sử trình duyệt đều bắt đầu ở phần giới thiệu. Xử lý `pagehide`/`pageshow` cho browser back/forward cache và hủy request đang gửi để kết quả cũ không xuất hiện trở lại. Nút Quay lại giữa các câu hỏi vẫn giữ lựa chọn trong lần khảo sát đang mở.

## API và dữ liệu

- Gửi khảo sát và mở lại phiên trả tối đa 6 xe đầu tiên. Endpoint mới: `POST /api/v1/car-recommendations/sessions/:id/results`, body `{ capability, offset }`. Không đưa capability vào URL.
- Response bổ sung `pageSize`, `nextOffset`, `hasMore`, `totalAvailable`. Client dùng `nextOffset` cho lần tải tiếp theo; không tự tính offset từ số thẻ đã hiển thị.
- Cursor dựa trên vị trí snapshot, giữ thứ tự chấm điểm ban đầu. Mỗi lần tải kiểm tra kho hiện tại; xe đã bán hoặc thay đổi giá/thông tin được loại. Client loại thẻ không còn hợp lệ, gộp kết quả không lặp và hủy request khi rời kết quả.
- Snapshot lưu toàn bộ kết quả trong giới hạn tổng do admin đặt, mặc định 5000 (trùng giới hạn kho của thuật toán). Public chỉ nhận tối đa 6 xe mỗi request. `resultCount` trong lịch sử là tổng xe được xếp hạng, không phải số thẻ đã tải hay lượt hiển thị.
- Admin sửa giới hạn tổng 1–5000; lọc lịch sử theo số xe 0–5000. Xem thử admin chỉ trả tối đa 6 xe.
- Migration **0016_peaceful_iron_lad** mở check constraint số kết quả, nâng cấu hình cũ có giới hạn 1–5 lên 5000 và cập nhật timestamp. Các câu hỏi/trọng số/đặc tính khác giữ dữ liệu hiện có. Migration đã được áp dụng trên database phát triển/test được cho phép.
- Snapshot khảo sát đã hoàn tất vẫn là dữ liệu lịch sử quản trị; web không khôi phục phiên từ browser storage nữa. Retry trong cùng lần mở trang vẫn dùng requestId/capability trong bộ nhớ để tránh gửi trùng. Production cần áp dụng migration qua quy trình triển khai của dự án trước khi chạy API mới.

## Kiểm tra

- 22 kiểm thử engine/API/admin đạt trên PostgreSQL riêng: migration nâng cấu hình cũ, 6/6/2 xe, cursor sau khi xe trước đó bị bán hoặc xe sau đổi giá, không lặp, retry, quyền/capability, hết hạn, snapshot và lọc lịch sử >5 xe.
- Typecheck, lint phần thay đổi, build API/web/admin và Drizzle check đạt. Build web có các cảnh báo `<img>` đã có ở phần khác.
- Browser web tại 1440/768/390/360 px: chuyển câu hỏi, quay lại giữ câu trả lời, reduced motion, icon nằm trọn khung, 6 → 12 → 14 xe, hết kết quả ẩn Xem thêm, lỗi tải thêm/thử lại, click thẻ, refresh không gửi khảo sát mới và không tràn ngang. Kiểm tra cấu hình admin thay đổi và các route web hiện có cũng đạt.
- Kiểm tra lại chính sách bỏ tiến độ tại 1440/390 px: reload từ kết quả, điều hướng nội bộ từ câu hỏi đang trả lời, Back từ chi tiết xe và `pageshow` với `persisted=true` đều về phần giới thiệu; lựa chọn/ngân sách cũ không còn. Khóa storage bản cũ được xóa và không khôi phục. Retry trong cùng lần mở trang vẫn giữ requestId/capability, phân trang và nút Quay lại trong khảo sát vẫn hoạt động.
- Browser admin tại cùng bốn chiều rộng: tổng quan, lịch sử/lọc mới, cấu hình, đặc tính, phân trang và quyền đạt.
- Database phát triển/test: 14 xe đủ điều kiện, phân trang qua toàn bộ kết quả không lặp; phiên smoke và events của nó đã được xóa. Không thêm xe hoặc hồ sơ đánh giá giả. Kiểm tra responsive bằng browser tự động, chưa kiểm tra trên điện thoại vật lý.
