# Phase 5 — Cars, brands and models API

Base URL: `/api/v1`. Swagger UI: `/api/docs`. Public endpoints không cần token; admin endpoints dùng Supabase access token trong `Authorization: Bearer <token>` và kiểm tra quyền từ bảng RBAC.

`seatCount` là số chỗ ngồi (`cars.seat_count`, số nguyên 1–100) trong payload tạo/sửa xe, danh sách công khai/admin và chi tiết xe. `transmissionId` là UUID của bản ghi trong danh mục `transmissions`; form admin lấy danh mục này từ API thay vì dùng lựa chọn cố định. Xe đã tạo trước khi có ô số chỗ có thể đang để `null` và cần được cập nhật trong admin.

Danh sách xe công khai trả thêm `branch` là tên showroom đang giữ xe, hoặc `null` nếu xe chưa gắn showroom. Card web hiển thị tên này cùng các thông số xe; chi tiết xe tiếp tục trả object showroom với tên, slug, địa chỉ và điện thoại.

## Endpoint

| Public | Mục đích |
| --- | --- |
| `GET /brands` | Hãng đang active |
| `GET /brands/:slug/models` | Dòng đang active của hãng đang active |
| `GET /cars` | Card xe đã đăng, có lọc và phân trang |
| `GET /cars/:slug` | Chi tiết xe đã đăng, gồm gallery và specifications |

| Admin | Quyền |
| --- | --- |
| `GET /admin/brands`, `GET /admin/brands/:id` | `brand.read` |
| `POST /admin/brands`, `PATCH /admin/brands/:id`, `DELETE /admin/brands/:id` | `brand.create`, `brand.update`, `brand.delete` |
| `GET /admin/car-models`, `GET /admin/car-models/:id` | `model.read` |
| `POST /admin/car-models`, `PATCH /admin/car-models/:id`, `DELETE /admin/car-models/:id` | `model.create`, `model.update`, `model.delete` |
| `GET /admin/cars`, `GET /admin/cars/:id` | `car.read` |
| `POST /admin/cars`, `PATCH /admin/cars/:id`, `DELETE /admin/cars/:id` | `car.create`, `car.update`, `car.delete` |
| `POST /admin/cars/:id/publish`, `POST /admin/cars/:id/unpublish` | `car.publish` |

Các `:id` admin là UUID. `DELETE /admin/cars/:id` là soft delete; trả 204. Xóa hãng/dòng là hard delete khi chưa bị tham chiếu; nếu còn dữ liệu liên quan trả 409. `GET /admin/car-models?brandId=<uuid>` lọc theo hãng.

## Lọc và phân trang xe

`GET /cars` và `GET /admin/cars` nhận: `search`, `brand`, `model`, `year_from`, `year_to`, `price_min`, `price_max`, `body_type`, `fuel_type`, `transmission`, `color`, `branch`, `mileage_min`, `mileage_max`, `status`, `page`, `limit`, `sort`. `brand`, `model`, `body_type`, `transmission`, `color`, `branch` dùng slug danh mục. `price_*` là số nguyên VND. `search` tìm tên xe; admin còn tìm SKU. Filter `status=inactive` trên public không làm lộ xe ẩn.

`page` mặc định 1, `limit` mặc định 20 và tối đa 100. `sort`: `newest` (mặc định, theo `updatedAt` giảm dần; nếu trùng thì theo `createdAt` giảm dần và ID), `oldest`, `price_asc`, `price_desc`, `year_desc`, `mileage_asc`. Các khoảng min/max không hợp lệ trả 400. Response:

```json
{
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

Public list trả dữ liệu cho card và URL ảnh cover, cùng `color` (tên màu) và `colorSlug` để web tạo gợi ý lọc từ xe đang đăng. Xe chưa gắn màu trả `null` cho hai trường này. Danh sách không tải full gallery/specifications và không trả SKU, biển số, nguồn import hay trường xóa nội bộ. Public detail trả gallery/specifications và các trường trình bày. Admin detail trả đầy đủ trường xe để chỉnh sửa.

## Vòng đời và toàn vẹn dữ liệu

Xe tạo mới chưa đăng (`publishedAt = null`) dù `status` được nhập là gì. Publish gán `publishedAt` và chuyển `inactive` thành `active`; unpublish xóa `publishedAt` nhưng giữ `status`. Public chỉ trả xe có `publishedAt`, chưa soft delete, hãng và dòng đang active, và `status` thuộc `active`, `deposit`, `sold`. Trạng thái `inactive` luôn ẩn. Chính sách này giữ nhãn “đã nhận cọc/đã bán” trên website; có thể đổi nếu nghiệp vụ yêu cầu chỉ hiện xe đang bán.

Slug được tạo từ tên khi thiếu và không tự thay đổi khi sửa tên. Đổi slug phải gửi `slug` rõ ràng. Service kiểm tra model thuộc brand, version thuộc model và body style phù hợp trước khi ghi xe. Không cho chuyển brand/body style của model đã có xe. Unique slug/SKU và FK được database bảo vệ; xung đột trả 409.

Tạo, sửa, xóa, publish, unpublish, đổi giá và đổi trạng thái xe đều ghi `audit_logs` trong cùng transaction. Audit chỉ chứa các trường cần theo dõi, không sao chép mô tả hay biển số. Media CRUD/upload thuộc Phase 6; Phase 5 chỉ đọc media hiện có. Chưa nhập dữ liệu xe từ web legacy hoặc mock admin vào database thật.
