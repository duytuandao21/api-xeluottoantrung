# Báo cáo nhập dòng xe và phiên bản từ cars.json

Ngày thực hiện: 09/10/2026.

## Kết quả

Đã nhập vào database cấu hình trong API, được đối chiếu với API mà web đang dùng tại `http://localhost:4000`.

| Danh mục | Trước khi nhập | Thêm mới | Sau khi nhập |
|---|---:|---:|---:|
| Hãng xe | 17 | 0 | 17 |
| Dòng xe | 13 | 155 | 168 |
| Phiên bản | 15 | 632 | 647 |

File nguồn là `cars.json` ở thư mục gốc workspace. Có 31 hãng trong file, trong đó 16 hãng khớp với hãng đang hoạt động trên website.

## Chi tiết theo hãng

| Hãng trên website | Dòng xe thêm mới | Phiên bản thêm mới |
|---|---:|---:|
| Toyota | 18 | 73 |
| Huynhdai | 9 | 55 |
| Kia | 13 | 81 |
| Mazda | 7 | 40 |
| Ford | 8 | 34 |
| Mitsubishi | 8 | 33 |
| Honda | 8 | 35 |
| Vinfast | 15 | 25 |
| Suzuki | 7 | 18 |
| Nissan | 7 | 25 |
| Isuzu | 1 | 11 |
| Peugeot | 6 | 20 |
| Subaru | 7 | 17 |
| Mercedes | 15 | 63 |
| BMW | 16 | 70 |
| Lexus | 10 | 32 |
| **Tổng** | **155** | **632** |

15 hãng được bỏ qua theo yêu cầu: MG, Volkswagen, Audi, Volvo, Porsche, Land Rover, Mini, BYD, Wuling, Omoda, Jaecoo, Geely, GAC, Lynk & Co, Haval.

Chevrolet đang có trên website nhưng không có dữ liệu trong file nguồn.

## Đối chiếu và bảo toàn dữ liệu

- Ghép Hyundai vào hãng Huynhdai; Mercedes-Benz vào Mercedes; VinFast vào Vinfast.
- Ghép Grand i10 vào I10, Santa Fe vào Santafe, Mazda3 vào Mazda 3, CX-8 vào CX8, D-Max vào Dmax.
- Đối chiếu tên phiên bản theo chữ hoa/thường, dấu tiếng Việt và khoảng trắng; giữ các ký hiệu kỹ thuật như dấu thập phân khi so khớp.
- Dùng lại 13 dòng xe và 6 phiên bản đã có trong dữ liệu nguồn. Các phiên bản cũ khác vẫn được giữ nguyên.
- Toàn bộ bản ghi hãng/dòng/phiên bản có trước khi nhập được so sánh đầy đủ sau khi nhập; tất cả giữ nguyên ID và các trường dữ liệu.
- Giao dịch database đã commit thành công. Kiểm tra lập kế hoạch lại ngay trong giao dịch cho kết quả 0 dòng xe và 0 phiên bản cần thêm, xác nhận chạy lại không tạo trùng.

## Phạm vi dữ liệu

Nhập tên dòng xe và phiên bản vào danh mục chung `car_models`, `car_versions`, dùng cho quản trị và các lựa chọn dòng xe/phiên bản trên website. Những bản ghi mới có trạng thái `active`.

File không cung cấp kiểu dáng hoặc ảnh cho từng dòng xe/phiên bản; các trường này để trống cho admin bổ sung.

Theo ghi chú của file nguồn, khoảng năm và phiên bản chưa được đối chiếu chính thức theo từng năm. Hệ thống lưu danh mục phiên bản theo dòng xe; lần nhập này không tạo liên kết phiên bản với từng năm sản xuất hoặc dữ liệu giá tham chiếu. Tiện ích định giá sử dụng riêng dữ liệu giá tham chiếu đã cấu hình.

## Kiểm tra

- TypeScript API: đạt.
- API `/brands`: vẫn có đúng 17 hãng với cùng các ID trước khi nhập.
- API `/brands/:slug/models`: trả đủ 155 dòng xe mới, liên kết đúng các hãng hiện có.
- API `/lookups/car-versions`: kiểm tra toàn bộ các trang; có 647 phiên bản, gồm đủ 632 bản mới liên kết đúng dòng xe.
- Số dòng xe/phiên bản mới thiếu trên API: 0.

Web lấy danh mục qua API. Tải lại trang để lấy danh mục mới; những dữ liệu danh mục đã được web cache có thể cần khoảng 60 giây để cập nhật.

## Tệp đối chiếu và cách chạy

- `cars-import-before.json`: danh mục trước khi nhập, đọc cùng lúc đối chiếu API của web.
- `cars-import-backup-*.json`: bản chụp đầy đủ các bảng danh mục ngay trước giao dịch ghi.
- `cars-import-plan.json`: kế hoạch nhập thử.
- `cars-import-result.json`: kết quả đã commit, gồm danh sách ID các mục thêm mới và SHA-256 file nguồn.
- `cars-import-verification.json`: kết quả đọc lại API sau khi nhập.
- Script: `src/database/seed/car-catalog.ts`.

Chạy từ thư mục API, mặc định chỉ lập kế hoạch:

```powershell
node node_modules/tsx/dist/cli.mjs src/database/seed/car-catalog.ts
```

Nhập bổ sung sau khi đối chiếu kế hoạch:

```powershell
node node_modules/tsx/dist/cli.mjs src/database/seed/car-catalog.ts --apply
```

Có thể chỉ định file khác bằng `--file <đường-dẫn-file>`. Script chỉ dùng các hãng đã có trạng thái active, thêm mục còn thiếu và giữ nguyên dữ liệu hiện có.
