# Chi phí sử dụng xe — bàn giao và triển khai

Ngày: 12/10/2026. Phạm vi: API, Web và Admin nằm cạnh nhau trong workspace.

## Chức năng đã triển khai

- Nút **Tính toán chi phí sử dụng** thay đúng nút **Xem mô tả chi tiết** trên trang chi tiết. Mô tả vẫn nằm ở `#mo-ta-chi-tiet`.
- Khảo sát ba bước và dashboard trong cùng popup; không đổi URL. Native dialog đặt popup trên các widget nổi, khóa nền; có ESC, backdrop, chặn Tab/Shift+Tab, hoàn trả focus và reduced motion.
- Trigger không gọi API. Module/CSS của popup tải khi bấm. Không thêm thư viện, provider toàn cục, ảnh mới hoặc chart library.
- API đọc giá/ODO/nhiên liệu/năm xe từ DB mỗi lần; chỉ cấu hình/profile dùng cache 60 giây, tối đa 1.000 entries và xóa ngay sau thay đổi Admin. Pending reads cũ không được chèn lại vào cache mới. Thiết kế phù hợp PM2 fork **1 instance**; khi tăng số process phải bổ sung invalidation liên process.
- Khảo sát hoàn thành mới lưu, tính lại cập nhật cùng interaction. Capability 192 bit ngẫu nhiên ở trình duyệt, DB chỉ lưu SHA-256, quyền sửa hết hạn sau 2 giờ. Request ID + khóa transaction + revision kiểm soát retry/concurrent update. Revision này chỉ là số lần sửa khảo sát, không phải hệ thống version cấu hình.
- Admin có **Tiện ích → Chi phí sử dụng xe**, quyền đọc/sửa cấu hình/sửa định mức riêng; khảo sát phân trang, lọc, chi tiết và thống kê giới hạn khoảng ngày.

## Quy ước tính toán

- Tiền làm tròn đến VNĐ; DB dùng `bigint` cho tiền, `numeric` cho tỷ lệ vay. JSON cấu hình chứa tiền nguyên có giới hạn; không lưu tiền floating point trong DB.
- Xăng/dầu: `km/100 × tiêu hao × hệ số đường đi × giá/lít`. Điện cộng `1 + hao_hụt_sạc` vào điện của xe trước khi nhân giá/kWh.
- Định mức ưu tiên **xe → phiên bản → dòng → kiểu dáng → nhiên liệu → mặc định**. Mỗi override là bộ quy tắc đầy đủ. Dữ liệu vẫn được mô tả là dự toán, không phải tiêu hao đo chính thức.
- Thiếu ODO: dùng ODO dự phòng admin cấu hình, hiển thị rõ. Thiếu/không nhận diện nhiên liệu: dùng nhiên liệu dự phòng có nhãn. Giá chưa có hoặc ngoài giới hạn thì chặn khảo sát và giải thích. Hybrid được dự toán ngân sách xăng có lưu ý; chưa mô hình hóa sạc ngoài và thuê pin riêng.
- Bảo dưỡng: chỉ **định mức tổng** hoặc **lịch hạng mục**. Chế độ lịch bắt buộc định mức tổng bằng 0; chế độ tổng không kèm lịch. Mã hạng mục duy nhất. Admin cần tránh nhập cùng dịch vụ dưới hai tên khác nhau.
- Lịch km bắt đầu ở mốc kế tiếp sau ODO hiện tại. Chu kỳ tháng tính từ lúc mua, vì project chưa có lịch sử lần bảo dưỡng gần nhất. Nếu cả km và tháng cùng có, dùng mốc đến trước, rồi đặt lại cả hai chu kỳ; không đếm hai lần. Dự báo liệt kê tối đa 120 mốc nhưng tổng tính tất cả mốc.
- Sửa chữa dự phòng tăng theo tuổi/ODO qua từng năm. Khấu hao tính qua từng năm, có sàn giá bán lại và không âm. Các hệ số đều sửa được.
- Trả góp đều theo lãi danh nghĩa năm chia 12, lãi tính trên dư nợ giảm dần; trường hợp lãi 0 xử lý riêng. Schedule làm tròn VNĐ từng tháng, điều chỉnh kỳ cuối để dư nợ về 0. Không phải báo giá ngân hàng; phí tất toán chưa có quy tắc riêng.
- **TCO = giá mua + phí ban đầu + vận hành trong kỳ + lãi vay/phí tài chính − bán lại.** Gốc vay không cộng lần thứ hai. Giá bán ròng trừ dư nợ, có thể âm.
- KPI vận hành là ngân sách **bình quân trong thời gian sở hữu**, gồm dự phòng; dòng tiền tháng cộng khoản trả góp trong thời gian còn vay. Không cộng khấu hao vào tiền chi hàng tháng. Bảng tháng/năm làm tròn riêng; tổng toàn kỳ dùng ledger từng tháng. Biểu đồ sử dụng cùng ledger và công thức TCO.
- Phí phù hợp theo nhiên liệu, nhóm kiểu dáng, khu vực và trường hợp giao dịch được cộng. Phí vật chất chỉ cộng nếu chọn; phí tài chính chỉ cộng nếu vay. Chưa cấu hình phí giao dịch thì ghi rõ **chưa cộng phí**, không khẳng định mọi giao dịch miễn phí.

## File triển khai

### API

- `src/modules/ownership/domain.ts`, `defaults.ts`, `validation.ts`, `calculator.ts`: contract, minh họa mặc định, validation và calculator thuần.
- `src/modules/ownership/dto.ts`, `service.ts`, `controller.ts`, `module.ts`, `transport.ts`: routes, cache, persistence, reporting, auth và giới hạn body.
- `src/database/schema/ownership.ts`, `src/database/schema/index.ts`: ba bảng mới, index/constraint.
- `src/database/seed/ownership.ts`, `src/database/seed/roles-permissions.ts`: seed idempotent, quyền riêng.
- `src/modules/cars/cars.service.ts`: bổ sung ID vào public detail; không thay logic xuất bản/lọc xe.
- `src/app.module.ts`, `src/main.ts`: đăng ký module và body limits.
- `src/common/filters/api-exception.filter.ts`: che nội dung lỗi SQL cho ownership; giữ diagnostic trên routes khác.
- `drizzle/0017_foamy_cobalt_man.sql`, `0018_closed_valkyrie.sql`, hai snapshot tương ứng và `meta/_journal.json`.
- `test/ownership-calculator.test.ts`, `test/ownership-api.test.ts`, `test/fixtures/ownership.ts`.
- `package.json`: `db:seed-ownership`, `test:ownership`. Không thêm dependency.

### Web

- `components/ownership/OwnershipTrigger.tsx`: trigger nhẹ.
- `components/ownership/OwnershipModal.tsx`, `OwnershipResults.tsx`, `ownership.css`: popup và dashboard; CSS có prefix riêng.
- `lib/ownership-types.ts`: contract type, không kèm calculator client.
- `lib/public-pages.ts`, `components/common/Markup.tsx`: thay đúng điểm tích hợp; dùng `data-skip-legacy-submit` trên form riêng để tránh handler cũ.
- `lib/public-api.ts`: thêm kiểu ID cho car detail.
- `scripts/ownership-web-check.mjs`, `package.json`: browser regression trên production build, fixture cô lập.

### Admin

- `src/app/tien-ich/chi-phi-su-dung-xe/page.tsx`, `src/components/Sidebar.tsx`.
- `src/components/ownership/Manager.tsx`, `SettingsForm.tsx`, `PolicyForm.tsx`, `Profiles.tsx`, `Surveys.tsx`, `shared.tsx`, `ownership-admin.css`.
- `src/lib/ownership.ts`: contract type.
- `scripts/ownership-admin-check.mjs`, `package.json`: kiểm thử UI, typecheck script.

Không sửa `.env`, cấu hình CDN, chatbot, homepage, cache của module khác hay SEO. Các sửa đổi chatbot/home services đã có trước nhiệm vụ này được giữ nguyên. `next-env.d.ts` có thể được Next sinh lại khi build.

## Database và seed

**Chưa chạy migration/seed vào database thật trong lượt triển khai này.** Các migration đã được chạy bằng PGlite (PostgreSQL cô lập), cùng toàn bộ migration cũ.

- `0017`: chỉ tạo ba bảng ownership, index/constraint, bật RLS, thu hồi quyền đọc trực tiếp của PUBLIC/anon/authenticated nếu role tồn tại; thêm cấu hình minh họa và ba permissions. Cấp quyền mới cho ADMIN/SUPER_ADMIN đang tồn tại.
- `0018`: chỉ điều chỉnh timestamp của các bảng mới xuống độ chính xác millisecond, để optimistic update khớp với JavaScript Date. Không sửa bảng cũ.
- Singleton config đã được seed trong `0017`, không ghi đè cấu hình hiện hữu. Không seed profile giả cho từng xe.

Tại repo API, sau khi chọn đúng database đích và sao lưu:

```sh
npm ci
npm run db:check
npm run db:migrate
# Optional: bổ sung quyền khi roles được tạo sau migration; không ghi đè config:
npm run db:seed-ownership -- --apply
npm run build
```

`npm run db:seed-ownership` không kèm `--apply` chỉ in hướng dẫn, không kết nối DB. API cần kết nối với role server có quyền truy cập/bypass RLS phù hợp như các module hiện có; không dùng token anon.

Không có biến môi trường mới. Dùng `DATABASE_URL`, `API_URL`/`NEXT_PUBLIC_API_URL`, Supabase auth và cấu hình rate limit hiện có. Public GET trả `Cache-Control: no-store`; không thêm ownership vào response cache chung để tránh giữ giá xe cũ.

## Endpoints

Prefix chung: `/api/v1`.

| Method | Path | Quyền / mục đích |
| --- | --- | --- |
| GET | `/cars/:id/ownership-config` | Public, UUID; thông số và lựa chọn UI; không ghi khảo sát |
| POST | `/cars/:id/ownership-calculate` | Public, tính + tạo/cập nhật cùng interaction; 15 request/phút/IP theo guard hiện hữu |
| GET | `/admin/ownership/settings` | `ownership.read` |
| PATCH | `/admin/ownership/settings` | `ownership.settings.update`, current `updatedAt` |
| GET | `/admin/ownership/targets` | `ownership.read`, scope và search; tối đa 30 đối tượng |
| GET | `/admin/ownership/profiles` | `ownership.read`, server pagination/search |
| PUT | `/admin/ownership/profiles/:id` | `ownership.profiles.update`, UUID do client tạo; `updatedAt` khi sửa |
| DELETE | `/admin/ownership/profiles/:id` | `ownership.profiles.update` |
| GET | `/admin/ownership/surveys` | `ownership.read`, lọc vehicleId/from/to/finance; sort newest/oldest/cost; page/limit |
| GET | `/admin/ownership/surveys/:id` | `ownership.read`, compact detail, không trả capability/hash |
| GET | `/admin/ownership/summary` | `ownership.read`, tổng/xe phổ biến/km phổ biến/trả góp/chi phí TB |

POST body: `interactionId`, `requestId`, `capability`, `expectedRevision`, `answers`. Gửi lại request thất bại dùng cùng requestId; sửa đáp án dùng requestId mới + revision gần nhất. Lỗi 409 có `details.revision` để client phục hồi. Không nhận price/fuel/ODO từ client. Body public 8 KB, admin 64 KB.

Giới hạn chính: 0–20.000 km/tháng; năng lượng 1–100.000 VNĐ/đơn vị; ngân sách mỗi khoản tối đa 20 triệu/tháng; 1–20 năm; vay 1–240 tháng, 0–40%/năm, trả trước 0–100%; giá xe tối đa 100 tỷ VNĐ. Không chấp nhận NaN/Infinity/field lạ. Tiền mặt bắt buộc các thông số vay null.

Reporting mặc định 30 ngày, tối đa 366 ngày mỗi query, ngày lọc theo UTC+7. Aggregation chỉ trên cohort ngày đã lọc, top 10 xe/top 5 km và statement timeout 4 giây. Không N+1; row index theo ngày, xe/ngày, vay/ngày. Bản ghi không lưu tên, điện thoại, email, raw IP, user-agent hay cookie ID. Guard dùng IP trong bộ nhớ để rate limit như hệ thống sẵn có, không ghi vào survey.

## Các trường Admin quản lý

- Bật/tắt; giá xăng/dầu/điện, km/điều kiện đi, ODO/nhiên liệu dự phòng.
- Ngân sách gửi xe/rửa xe/cầu đường, lựa chọn nhanh, bảo hiểm mặc định, năm sở hữu, khu vực/trường hợp giao dịch và mặc định tương ứng.
- Chọn vay mặc định, trả trước/kỳ hạn/lãi suất giả định.
- Tiêu hao từng nhiên liệu, hệ số đi city/mixed/highway, hao hụt EV.
- Bảo dưỡng tổng theo km/năm hoặc lịch với mã/tên/giá/chu kỳ km/tháng.
- Sửa chữa theo tuổi/ODO; khấu hao và sàn giá trị còn lại.
- Phí/bảo hiểm cố định + % giá và các điều kiện áp dụng.
- Override theo xe/phiên bản/dòng/nhóm/nhiên liệu, tìm đối tượng từ danh mục có sẵn, sửa/xóa.
- Lưu cấu hình chung/override áp dụng rộng có confirm; reset chỉ đổi biểu mẫu, cần Lưu mới áp dụng. Optimistic `updatedAt` chống ghi đè thay đổi mới.

## Kiểm tra và tái chạy

Giữ ba repo ở các thư mục cạnh nhau. Windows dùng `npm.cmd` nếu execution policy chặn npm.ps1.

```sh
# API
npm run lint
npm run typecheck
npm test
npm run build
npm run db:check
# Hoặc chỉ ownership: npm run test:ownership

# Web, sau khi API tests đã compile .test-dist
npm run lint
npm run typecheck
npm run build
npm run test:ownership

# Admin, sau khi API tests đã compile .test-dist
npm run lint
npm run typecheck
npm run build
npm run test:ownership
```

Browser scripts dùng Chrome headless từ Playwright hiện có, fixture DB chỉ trong bộ nhớ. Web test tự mở Next production port 3003 và fixture 4012. Admin test tự mở production port 3005, giả lập auth tại trình duyệt và kiểm tra JWT/RBAC thật trong fixture. Không dùng live auth hay ghi vào DB thật; chặn CDN/auth bên ngoài trong test. Các port này cần trống.

Kết quả đã chạy: calculator/API (xăng/dầu/EV, 0 km, biên, ODO/time, vay 0%/lãi dương/short ownership, TCO, retry/edit, permission, config invalidation, pagination/reporting/RLS/body limit/rate limit), Web 320/390/768/1440 px, Admin 390/1440 px. Báo cáo trạng thái cuối cùng và ảnh: xem `docs/ownership-cost-implementation.md` tại workspace.

Không tuyên bố số đo LCP/CLS production: kiểm thử xác nhận không có ownership request/JS chunk trước click, không đổi URL, không lỗi hydration, modal không tràn ngang và cuộn riêng. Chưa thử Safari/iPhone thật hay dữ liệu production. Ảnh thiếu logo/xe ngoài popup trong fixture do CDN bị chặn, không phải thay asset.

## Checklist triển khai production

1. Sao lưu DB, ghi nhận release code đang chạy; review chỉ các file thuộc ownership. Không đưa `.env`, log, test artifacts hay sửa UI có từ trước vào commit này ngoài ý muốn.
2. Chạy gates trên staging; chạy migration **trước** API/Web mới. Xác nhận ba bảng mới, config singleton, quyền và DB role server phù hợp RLS.
3. Deploy API và restart PM2 fork một instance để đăng ký routes mới. Không tăng instance mà giữ invalidation cache chỉ trong process.
4. Admin đăng nhập lại/làm mới quyền, kiểm tra menu và chỉnh các mức minh họa theo thực tế, đặc biệt phí giao dịch, bảo hiểm, tiêu hao và bảo dưỡng.
5. Deploy Admin và Web đã build. Mở xe public, tính tiền mặt/vay, sửa đáp án, xác nhận một survey được cập nhật. Kiểm tra xe chưa công khai không dùng được API.
6. Kiểm tra mobile keyboard/scroll/close, mô tả xe, gọi lại, gallery, các tiện ích và chatbot. Theo dõi lỗi 4xx/5xx/latency, không ghi capability hoặc dữ liệu trả lời vào log.

### Rollback

- Nếu cần ngừng tính nhanh, tắt enabled ở Admin; API không nhận lượt mới.
- Khi hoàn nguyên giao diện/code, rollback Web và Admin trước, API sau. Phục hồi nút mô tả bằng release cũ.
- **Giữ các bảng/migration additive** và dữ liệu khảo sát; code cũ không đọc các bảng này. Không chạy down migration/drop bảng trên production. Sau rollback vẫn giữ journal migration để tránh chạy lại seed.
- Không revert các thay đổi homepage/chatbot của người dùng nằm ngoài tính năng này.
