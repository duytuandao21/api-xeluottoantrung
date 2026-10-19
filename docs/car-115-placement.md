# Đặt xe 115 giữa xe 063 và 065

Phạm vi: thứ tự mặc định của danh sách xe trên Admin và website. Ngày tạo, giá, trạng thái, ảnh, metadata, nhãn Xe mới về, authentication và chính sách cache không đổi. Bộ lọc và các lựa chọn sắp xếp rõ ràng theo giá/km/năm/ngày tạo vẫn hoạt động như trước.

## Cơ chế

- Migration `0021_car_listing_order.sql` thêm cột nullable `cars.listing_order_at` và index. Xe chưa có giá trị riêng tiếp tục sắp theo `created_at`.
- API dùng `coalesce(listing_order_at, created_at)` cho thứ tự mặc định; Admin và Web cùng dùng API này. Không cần đổi source/build Admin hoặc Web cho thay đổi này.
- Script đặt **duy nhất xe 115** giữa hai xe neo theo ID/slug đã kiểm tra. Trước khi cập nhật, script khóa ba dòng, kiểm tra đủ xe, kiểm tra hai xe neo liền nhau và không ghi đè vị trí riêng đã có.
- Có audit log của thao tác database operator và rollback. Script chạy lại không tạo xe/ảnh hoặc log trùng. Không mở thêm HTTP endpoint hoặc cho client ghi cột nội bộ.

Ba xe:

| Thư mục | Xe | ID |
| --- | --- | --- |
| 063 | Mitsubishi Xpander Cross 2023 | `cf0b8914-8d73-4926-a175-cbd00909acdf` |
| 065 | Ford Ranger XLS AT 4x4 2022 | `c8e62fba-60ad-4b95-b9e9-f790c16a3152` |
| 115 | Mitsubishi Xforce Exceed 2024 | `1763061e-1a16-49c7-8864-0b95f24dcc3b` |

Vì mặc định là mới trước, kết quả theo chiều từ trên xuống là **065 → 115 → 063**. Đây là thay vị trí thư mục 064, không phải hàng STT 64 tuyệt đối. Vị trí tuyệt đối thay đổi khi thêm xe hoặc lọc danh sách.

## Triển khai thủ công trên VPS

**Chưa thực hiện trên production.** Working tree local có nhiều thay đổi khác từ trước: chỉ đưa diff của cơ chế vị trí này lên đúng source API đang chạy; kiểm tra migration pending trước khi chạy. Không dùng toàn bộ working tree local làm gói triển khai mặc định.

Trong thư mục API trên VPS, dùng `.env` production hiện có, không đưa secrets vào command/chat:

1. Backup database theo quy trình hiện tại; ghi phiên bản API đang chạy.
2. Chuẩn bị code và build API mới trước khi dừng dịch vụ: `npm ci`, `npm run build`.
3. Dừng riêng process API theo tên PM2/service thực tế. Không đoán tên process và không dừng PostgreSQL hoặc Web.
4. Chạy `npm run db:migrate` sau khi đã xác nhận các migration pending; patch này chỉ thêm migration 0021.
5. Xem trước, chưa cập nhật:

   ```bash
   node scripts/place-imported-car-115.mjs
   ```

6. Sau khi kiểm tra đúng ba xe, áp dụng:

   ```bash
   node scripts/place-imported-car-115.mjs --apply --api-offline
   ```

7. Khởi động API với build mới. Việc khởi động tạo cache API trống, tránh giữ kết quả lọc/menu trước thay đổi. Không thay TTL, rate limit hoặc cache policy.
8. Đối chiếu Admin ở thứ tự mặc định và Web `/san-pham`/trang chủ: giữa xe 065 và 063 phải là 115. Khi lọc, hai xe neo có thể không cùng xuất hiện. Kiểm tra các giá trị giá/ảnh/ngày tạo và Xe mới về vẫn giữ nguyên.

Không chạy script cập nhật khi API vẫn hoạt động: thao tác database trực tiếp không đi qua interceptor invalidation của các HTTP mutations. Cờ `--api-offline` là xác nhận của operator, không tự dừng dịch vụ.

## Rollback

Dừng riêng API, dùng cùng database:

```bash
node scripts/place-imported-car-115.mjs --rollback
node scripts/place-imported-car-115.mjs --rollback --apply --api-offline
```

Khởi động API lại. Có thể dùng build API trước thay đổi nếu cần. Giữ cột/index bổ sung để tránh lỗi tương thích trong lúc rollback; giá trị của xe 115 được trả về đúng trạng thái trước thao tác từ audit log. Rollback từ chối ghi đè nếu vị trí đã được thay đổi bởi thao tác khác sau đó.
