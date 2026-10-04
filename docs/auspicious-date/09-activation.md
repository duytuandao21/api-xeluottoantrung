# Kích hoạt bộ tham khảo 1.1.0

Theo yêu cầu bật tính năng ngày 03/10/2026, bổ sung bộ quy tắc riêng và nguồn được đối chiếu kỹ thuật. Database đã được chủ website xác nhận là phát triển/test. Không ghi đè bộ 1.0.0 hoặc ca tham chiếu admin đã nhập.

## Phạm vi của bộ quy tắc

Đây là bộ tiêu chí tham khảo của tiện ích, không phải hệ thống luận giải toàn bộ một cuốn thông thư. `VERIFIED` ở nguồn ghi nhận việc đối chiếu nội dung và bảng dữ liệu; không phải xác nhận khoa học về may mắn, tài lộc hay an toàn. Nhật ký ghi rõ công cụ thực hiện theo yêu cầu chủ website dưới tài khoản quản trị được phép.

| Mục đích | Trực được chọn | Cách áp dụng |
| --- | --- | --- |
| Mua xe | Mãn (2) | Tiêu chí giao dịch mua xe |
| Nhận xe | Kiến (0), Thành (8) | Tiêu chí chuyến đi nhận xe |
| Ký hợp đồng | Mãn (2), Định (4) | Tiêu chí lập khoán/ký kết |

Nguồn cho Mãn là mục lập khoán/giao dịch trong [Hiệp kỷ biện phương thư, bản số hóa](https://www.shidianguji.com/book/SK1619/chapter/1l9llrr8p9fkz). Nguồn không nói về ô tô; việc áp dụng cho giao dịch mua xe là cách diễn giải có giới hạn của tiện ích.

Trực Định được đối chiếu với [lịch ngày 06/10/2026](https://lichngaytot.com/xem-ngay-tot-xau-06-10-2026). Kiến/Thành cho xuất hành được đối chiếu với [02/10/2026](https://lichngaytot.com/xem-ngay-tot-xau-02-10-2026) và [11/10/2026](https://lichngaytot.com/xem-ngay-tot-xau-11-10-2026). Các nguồn hiện đại có thể khác nhau về toàn bộ hệ thống chọn ngày; bản này chỉ dùng những tiêu chí đã ghi rõ.

Các tiêu chí đang bật còn gồm: cặp chi đối xung với năm sinh âm lịch; cặp lục hợp hoặc hai chi trong cùng nhóm tam hợp; Tam nương/Nguyệt kỵ; ngày hoàng đạo; bảng giờ hoàng đạo. Danh sách ngày kiêng đối chiếu [bài của đơn vị công bố Lịch ngày Tốt](https://lichngaytot.com/tu-vi/ngay-tam-nuong-la-ngay-gi-304-188097.html). Chỉ dùng danh sách ngày, không dùng các giải thích nhân quả trong bài.

Ngũ hành nạp âm chưa tham gia phân loại. 28 Tú, cát thần và hung thần vẫn unavailable vì chưa có đặc tả đã đối chiếu. Không hiện kết quả cho các mục này.

## Ca tham chiếu độc lập

`activation-pack.ts` chứa các giá trị lịch/Trực/hoàng đạo/giờ nhập từ các trang lịch đã đọc, cùng phân loại kiểm tra bằng phép cộng tay. Không gọi `evaluate` hoặc simulator để tạo expected. Bộ test và script hồi quy mới dùng engine để so sánh với expected này.

- 01–12/10/2026: mỗi ngày có nguồn `https://lichngaytot.com/xem-ngay-tot-xau-DD-10-2026` với DD là ngày hai chữ số. Bao phủ sáu bảng giờ, hai tháng âm, ngày đổi tiết khí, các trường hợp quy tắc match/non-match.
- 16 và 28/10/2026: kiểm tra tuổi Dần, tương hợp và ngày kiêng. Nguồn lịch [16/10](https://lichngaytot.com/xem-ngay-tot-xau-16-10-2026), [28/10](https://lichngaytot.com/xem-ngay-tot-xau-28-10-2026).
- Ngày sinh minh họa 02/02/1984 thuộc năm Giáp Tý theo mốc Tết trong tài liệu lịch Hồ Ngọc Đức đã dùng ở test calendar. Ngày 15/08/1998 thuộc Mậu Dần được đối chiếu [trang lịch ngày sinh](https://lichngaytot.com/xem-ngay-tot-xau-15-08-1998). Đây không phải dữ liệu khách hàng.

Chính sách điểm: 50 ban đầu; hợp chi +10; hoàng đạo +15; Trực được chọn +15; xung chi -40; ngày kiêng -40. Xung hoặc ngày kiêng loại trừ trước khi xét điểm. GOOD từ 65 và có tiêu chí dương; VERY_GOOD từ 80 và ít nhất hai tiêu chí dương. Ngưỡng và việc ưu tiên loại trừ là chính sách của tiện ích, không gán cho tác giả tài liệu.

### Bảng kiểm tra tay

Ngày sinh mặc định cho 01–12/10 là Giáp Tý. Ký hiệu N: NORMAL, G: GOOD, A: AVOID.

| Ngày 10/2026 | Điểm mua / nhận / ký | Phân loại mua / nhận / ký |
| --- | --- | --- |
| 01 | 60 / 60 / 60 | N / N / N |
| 02 | 25 / 40 / 25 | A / A / A |
| 03 | 10 / 10 / 10 | A / A / A |
| 04 | 65 / 50 / 65 | G / N / G |
| 05 | 65 / 65 / 65 | G / G / G |
| 06 | 60 / 60 / 75 | N / N / G |
| 07 | 25 / 25 / 25 | A / A / A |
| 08 | 65 / 65 / 65 | G / G / G |
| 09 | 60 / 60 / 60 | N / N / N |
| 10 | 65 / 65 / 65 | G / G / G |
| 11 | 10 / 25 / 10 | A / A / A |
| 12 | 10 / 10 / 10 | A / A / A |
| 16, tuổi Dần | 35 / 35 / 35 | A / A / A |
| 28, tuổi Dần | 75 / 75 / 75 | G / G / G |

## Sửa lỗi ngày đổi tiết khí

[07/10](https://lichngaytot.com/xem-ngay-tot-xau-07-10-2026) và [08/10](https://lichngaytot.com/xem-ngay-tot-xau-08-10-2026) đều là Trực Chấp; 09/10 là Phá. Code cũ lấy tháng tiết khí tại 00:00 nên đổi muộn trên ngày Hàn lộ xuất hiện buổi chiều. Code mới xác định tháng Trực cho toàn bộ ngày dân sự có tiết khí mới. Tiết khí trong chi tiết vẫn ghi rõ là tiết khí tại đầu ngày.

`ReferenceExpectation` bổ sung `almanac` để kiểm tra được Trực, ngày kiêng và danh sách giờ. Mảng vẫn phải đủ số phần tử và đúng thứ tự; có thể nhập các trường cần đối chiếu của mỗi phần tử.

## Công cụ và kiểm tra

Chỉ in kế hoạch, không ghi dữ liệu:

```sh
npm run auspicious:activate
```

Áp dụng trên database phát triển/test được cho phép:

```sh
npm run auspicious:activate -- --apply --development-test --actor <UUID profile admin>
```

Công cụ kiểm tra quyền của tài khoản, tạo 1.1.0, nhập nguồn và 14 ca cho mỗi mục đích, chạy validate trước khi publish qua các service hiện có; cuối cùng bật cấu hình và giờ tham khảo. Nếu có bộ cùng số phiên bản chưa xuất bản, công cụ dừng để tránh ghi đè. Nếu xảy ra lỗi trước xuất bản, bản nháp đã chuẩn bị vẫn nằm trong admin để kiểm tra; không tự xóa nhật ký hoặc sửa expected.

Chạy kiểm tra website với API và dữ liệu thật, không dùng fixture:

```sh
# Trong repo web, API và web đang chạy ở port cấu hình hiện có
node scripts/auspicious-live-check.mjs
```

Có thể đặt `AUSPICIOUS_WEB_URL` để đổi địa chỉ kiểm tra. Script chỉ gửi tra cứu public và chi tiết, không sửa admin/database.

## Kết quả kích hoạt thực tế

- Database phát triển/test: `is_enabled=true`, `show_good_hours=true`, giới hạn 90 ngày.
- BUY_CAR, RECEIVE_CAR, SIGN_CONTRACT đều có 1.1.0 PUBLISHED; mỗi bộ có 14 ca, Pass 14 / Fail 0 / Changed 0. Đã chạy lại CLI hồi quy trên cả ba bộ sau xuất bản.
- Tổng 19 bản ghi nguồn VERIFIED và 42 ca tham chiếu mới. Các bộ 1.0.0 và dữ liệu admin cũ được giữ lại.
- API: bộ test đầy đủ 22/22 đạt; lint, typecheck và build đạt. Công cụ kích hoạt cũng qua kiểm tra TypeScript riêng.
- Website dùng API/database thật: kiểm tra 1440px và 390px đạt cho cả ba mục đích, chọn ngày, xem chi tiết, sáu khung giờ, CTA; không tràn ngang/lỗi hydration. Ảnh kiểm tra nằm trong `.next/auspicious-live-1440.png` và `.next/auspicious-live-390.png` của repo web.
- Kiểm tra public trực tiếp: cấu hình đang bật, tra cứu 90 ngày thành công, 91 ngày bị từ chối đúng giới hạn.
- Không thêm migration trong đợt kích hoạt. Không triển khai hoặc thay đổi database production.
