# Nhập danh mục Chevrolet

Ngày thực hiện: 09/10/2026.

## Kết quả

Đã nhập dữ liệu người dùng cung cấp vào hãng **Chevrolet** hiện có (`2f8a52fd-e1aa-4586-8a00-90d2b7440475`): **8 dòng xe, 17 phiên bản**.

| Dòng xe | Phiên bản |
| --- | --- |
| Spark | LS, LT |
| Aveo | LT, LTZ |
| Cruze | LT, LTZ |
| Captiva | LT, LTZ, MAXX |
| Colorado | LT, LTZ, High Country |
| Trailblazer | LT, LTZ |
| Orlando | LT, LTZ |
| Trax | LTZ |

Tất cả bản ghi mới đang hoạt động. Không tạo hãng mới. Dữ liệu danh mục cũ được giữ nguyên, gồm ID, thông tin và thời điểm cập nhật. Tổng danh mục sau nhập: 17 hãng, 176 dòng xe, 664 phiên bản.

Khoảng năm trong nguồn chỉ được giữ trong file nguồn; không tự gán phiên bản cho từng năm, không bổ sung giá tham chiếu hoặc xe trong kho.

## Kiểm tra

- Đối chiếu ID hãng trên API mà website đang cấu hình với database trước khi nhập: trùng khớp; Chevrolet trước đó chưa có dòng xe.
- Nhập trong transaction, có bản sao lưu danh mục trước thay đổi.
- Kiểm tra toàn bộ bản ghi cũ sau nhập: giữ nguyên.
- Lập lại kế hoạch trong transaction sau nhập: không còn dòng xe hoặc phiên bản cần thêm, tránh tạo trùng khi chạy lại.
- API `/api/v1/brands/chevrolet/models`: trả đủ 8 dòng xe và đúng ID vừa nhập.
- API `/api/v1/lookups/car-versions?modelId=...&limit=100`: trả đủ 17 phiên bản, đúng tên, đúng dòng xe và trạng thái hoạt động.
- `npm.cmd run typecheck`: thành công.

Website có cache danh mục; tải lại trang, có thể chờ khoảng 60 giây để cache cập nhật.

## Tệp đối chiếu

- [Nguồn người dùng cung cấp](chevrolet-vietnam-2026.json)
- [Kế hoạch trước nhập](cars-import-plan.json)
- [Kết quả đã commit](cars-import-result.json)
- [Kiểm tra API sau nhập](cars-import-verification.json)
- Bản sao lưu trước nhập: `cars-import-backup-*.json` trong thư mục này.

Script nhập bổ sung tùy chọn `--report-dir` để lưu riêng báo cáo Chevrolet. Báo cáo lần nhập `cars.json` trước đó vẫn được giữ nguyên ở thư mục cha.
