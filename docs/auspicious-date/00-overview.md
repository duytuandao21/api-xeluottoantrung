# Xem ngày mua xe

Public: /tien-ich/xem-ngay-mua-xe (route hiện có). Alias /xem-ngay-mua-xe chuyển về route này.
Admin: /tien-ich/xem-ngay-mua-xe trong nhóm Tiện ích.

## Discovery
- API: Nest/Fastify, global ValidationPipe whitelist + forbidden extras, JWT + database RBAC, Pino request ID/duration, Drizzle/pg transactions, node:test + PGlite.
- Admin: Next 16, AuthProvider, api/json bearer client, sonner, ui.tsx Button/Input/Select/DataTable, CSS variables, lucide-react. Đã đọc AGENTS và installed Next page/client docs.
- Web: Next 15, publicApi server/client proxy, SiteBreadcrumb, shared utility menu/icon hiện có, routeMetadata + SEO database.
- Không lưu lịch sử tra cứu public/ngày sinh. Không AI, không runtime API lịch ngoài.

## Business boundary
Seed nền tảng chỉ tạo cấu hình tắt và bản nháp. Theo yêu cầu chủ website bật tính năng, bộ tham khảo 1.1.0 bổ sung nguồn đối chiếu kỹ thuật và ca tham chiếu độc lập; xem 09-activation.md. Trạng thái VERIFIED thể hiện đối chiếu nội dung nguồn, không xác nhận khả năng dự báo. Chỉ bộ kiểm tra đạt và đã xuất bản mới dùng ở public. Simulator hoạt động trước khi publish.
