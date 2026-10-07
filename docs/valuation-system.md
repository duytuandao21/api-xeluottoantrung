# Hệ thống định giá xe cũ

Cập nhật: 06/10/2026. Public: `/tien-ich/dinh-gia-xe`. Admin: **Tiện ích → Định giá xe cũ** (`/tien-ich/dinh-gia-xe`). API prefix: `/api/v1`.

Admin sử dụng **một bộ cấu hình chung**. Sửa giá tham chiếu, quy tắc hoặc cấu hình rồi **Lưu và áp dụng** để dùng ngay cho lần định giá tiếp theo. Giao diện đã bỏ tab/chọn phiên bản và quy trình tạo, nhân bản, kiểm tra, xuất bản, lưu trữ phiên bản cấu hình.

## 1. Kiến trúc

Web dùng form nhiều bước, API client và CSS của website hiện có. Admin dùng layout, tab, form, DataTable, modal, toast và RBAC hiện có. Backend Nest/Fastify gồm:

| Thành phần | Trách nhiệm |
| --- | --- |
| `valuation-public.controller.ts` | Cấu hình public, danh mục, định giá, gửi liên hệ |
| `valuation.controller.ts` | Quản trị cấu hình hiện hành, mô phỏng, audit và lịch sử |
| `valuation.service.ts` | CRUD master data, kiểm tra và áp dụng trong một transaction, bật/tắt |
| `valuation-engine.service.ts` | Hàm tính deterministic trên input, snapshot và clock; không truy vấn hay ghi DB |
| `valuation-rule-resolver.ts` | Chọn rule theo phạm vi, selector, khoảng và hiệu lực |
| `estimate.service.ts` | Kiểm tra quan hệ xe, dùng policy hiện hành, lưu và trả kết quả public |
| `valuation.repository.ts` | Truy vấn cấu hình chung, transaction, cache snapshot hợp lệ, audit |
| `history.service.ts` | Snapshot bất biến, capability liên hệ, lead và trạng thái xử lý |
| `valuation.transport.ts` | Giới hạn body public 16 KiB, Admin 64 KiB |

DatabaseService quản lý pool chung của ứng dụng. Feature không tạo pool trong request/service method. Script kích hoạt có một pool riêng `max=1`, luôn đóng khi kết thúc. Không dùng AI, nguồn giá bên ngoài hoặc dịch vụ trả phí để tính giá.

## 2. Dữ liệu và migration

Tái sử dụng `brands`, `car_models`, `car_versions`, `car_colors`, `profiles`, `leads`, `audit_logs`, cùng quyền/role hiện có.

| Bảng | Nội dung |
| --- | --- |
| `valuation_settings` | Singleton: trạng thái, policy active, disclaimer, CTA |
| `valuation_policies` | Lưu cấu hình chung, revision nội bộ chống ghi đè, config JSONB và báo cáo kiểm tra |
| `valuation_reference_prices` | Phiên bản/năm, ba loại giá, loại nền được chọn, nguồn, tuổi/ODO nền, hiệu lực |
| `valuation_condition_options` | Code/label tình trạng, chưa rõ, yêu cầu kiểm định |
| `valuation_rules` | Nhóm, scope, selector, khoảng, %, hiệu lực, yêu cầu kiểm định |
| `valuation_records` | Snapshot input/xe/giá/rule/result, cột lọc, liên kết lead, hash capability, hạn token |

Migration `0011` tạo master data định giá; `0012` thêm lịch sử và trạng thái lead; `0013_valuation_release_checks.sql` siết CHECK khoảng giá: cả hai cận phải cùng NULL hoặc cùng có số dương và `max >= min`. Migration 0013 không xóa bảng hoặc bản ghi. Đã áp dụng đến 0013 trên database phát triển/test được cho phép; việc triển khai production là thao tác riêng.

Chuyển sang cấu hình chung không cần migration mới. Cấu hình đang active cùng giá/rule/option hiện có được dùng trực tiếp. Các trường version/status và dữ liệu cấu hình cũ còn trong DB để tương thích lịch sử, script khởi tạo và API cũ; Admin không chọn hay tạo phiên bản cấu hình. `revision` chỉ là bộ đếm kỹ thuật để chống hai người ghi đè nhau và làm mới cache. Danh mục **phiên bản xe** vẫn là dữ liệu sản phẩm, độc lập với cấu hình định giá.

Index giá theo policy/variant/year/active; rule theo policy/category/scope/active; lịch sử theo ngày, hãng/dòng/ngày, trạng thái và giá. List có phân trang server, không tải toàn bộ snapshot. FK lịch sử cho phép giữ snapshot khi danh mục/policy/lead liên quan bị xóa.

## 3. Luồng tính giá

1. Đọc settings và cấu hình chung hợp lệ; trạng thái nội bộ `PUBLISHED` và revision đã kiểm tra được cập nhật tự động khi lưu hợp lệ.
2. Kiểm tra hãng/dòng/phiên bản/màu đang hoạt động và đúng quan hệ.
3. Chọn giá đúng phiên bản/năm, active và có hiệu lực. Không suy giá từ năm gần nhất.
4. Tính tuổi, ODO kỳ vọng và độ lệch; resolve các rule tương ứng.
5. Nhân hệ số theo thứ tự AGE → ODO → EXTERIOR → INTERIOR → ACCIDENT → FLOOD → ENGINE → TRANSMISSION → SERVICE → OWNERS → USAGE → COLOR → MARKET.
6. Áp dụng cap, làm tròn, tính khoảng thị trường/thu mua và điểm đầy đủ dữ liệu.
7. Lưu snapshot trong cùng transaction với việc đọc cấu hình; chỉ trả thành công khi lịch sử được lưu.
8. Khách xem giá trước, có thể gửi thông tin liên hệ sau; tạo lead bán xe hiện có khi đồng ý.

Trang kết quả chỉ trình bày hai khoảng giá: **Giá thu mua tại Toàn Trung** và **Giá thị trường tham khảo**. Bên dưới có nút **Gửi thông tin xe** mở popup và nút gọi **0777393913**. Form dùng các thông tin giống trang bán xe: hãng, dòng, phiên bản, năm sản xuất, số km và số điện thoại. Thông tin xe được điền sẵn; người dùng nhập số điện thoại và đồng ý liên hệ. Họ tên không bắt buộc trong API liên hệ. Server lấy thông tin xe từ snapshot, tạo lead loại `sell` và gắn với lịch sử định giá; gửi lại cùng capability không tạo lead trùng. Các dữ liệu phân tích vẫn được tính và lưu trong lịch sử, không hiển thị trên trang kết quả.

Simulation API chỉ đọc: không tạo lịch sử hoặc lead. Mỗi snapshot lưu tên xe, input, bản sao cấu hình/giá/rule/option thực sự áp dụng, breakdown, cap, giá ứng viên, disclaimer và CTA. Sửa cấu hình sau đó không thay đổi kết quả cũ.

## 4. Rule precedence và thời gian

Ưu tiên **VARIANT → MODEL → BRAND → GLOBAL** trong các rule khớp lựa chọn/khoảng và đang có hiệu lực. Không có match ở scope cụ thể thì tiếp tục scope thấp hơn. Khoảng số và thời gian là `[từ, đến)`; cận cuối để trống nghĩa là không giới hạn. Hai match cùng mức ưu tiên gây lỗi cấu hình, không chọn ngẫu nhiên.

Bộ GLOBAL AGE/ODO/OWNERS phải liên tục, không hở/trùng. Các option hoạt động phải có rule phù hợp; option nghiêm trọng yêu cầu kiểm định không được chuyển thành kết quả chắc chắn. COLOR và MARKET thiếu rule được hiểu là trung tính; nhóm bắt buộc thiếu rule trả lỗi cấu hình.

Thời điểm public do server xác định. Năm hiện tại và ngày lọc lịch sử theo `Asia/Ho_Chi_Minh`. Ngày sản xuất ưu tiên trước ngày đăng ký; không có ngày thì dùng năm hiện tại trừ năm sản xuất. Public form hiện nhập năm, chưa nhập hai ngày bổ sung này. Tuổi theo năm chưa biết tháng/ngày là một giới hạn dữ liệu.

## 5. Công thức

Với MSRP:

```text
factor = 1 + adjustmentPercent / 100
value = referencePrice × ageFactor × odoFactor × các conditionFactor × marketFactor
expectedODO = max(ageYears, youngVehicleAgeFloor) × expectedKmPerYear
deviationPercent = (ODO − expectedODO) / expectedODO × 100
```

Với `MARKET_REFERENCE`, giá đã phản ánh tuổi/ODO của xe nền:

```text
ageFactor = ageFactor(xe nhập) / ageFactor(xe nền)
odoFactor = odoFactor(xe nhập) / odoFactor(xe nền)
```

Hệ số ODO sau chuẩn hóa vẫn bị giới hạn theo bonus/penalty cấu hình. Xe có cùng tuổi và ODO với nền không bị khấu hao lần thứ hai. `basisNote` ghi giả định nền; engine không đọc văn bản để suy tình trạng. Neo cần có tuổi, ODO và ghi chú hợp lệ.

```text
value = clamp(value, referencePrice × minValueFactor, referencePrice × maxValueFactor)
estimatedValue = làm tròn theo roundingVnd, giữ trong cap
marketLow/High = estimatedValue × (1 − minus% / 100) / (1 + plus% / 100)
buyingLow/High = estimatedValue × (1 − marginMax% / 100) / (1 − marginMin% / 100)
```

Cận thấp làm tròn xuống, cận cao làm tròn lên. Kiểm tra số nguyên VND an toàn, không âm/NaN/Infinity; cap được ưu tiên khi không nằm trên lưới làm tròn. Các tỷ lệ là dữ liệu DB do Admin quản lý, không phải hằng số được engine áp dụng cho mọi policy.

`confidenceScore = round(100 × trọng số trường đã rõ / tổng trọng số)`. Đây là **độ đầy đủ input**, không phải xác suất giá đúng hoặc bằng chứng nguồn giá đã được xác minh. Thiếu/chọn “Chưa rõ” không nhận trọng số. Trọng số và ngưỡng HIGH/MEDIUM do Admin cấu hình.

Chassis, tai nạn kết cấu, ngập nặng/thủy kích, lỗi máy/hộp số nặng và một số input chưa rõ chuyển sang kiểm định. Policy khởi tạo có `showSeverePriceRange=false`: public không nhận giá ứng viên nội bộ; Admin vẫn thấy breakdown để kiểm tra. Thiếu giá nền cũng không được hiển thị 0 đồng như một giá hợp lệ.

## 6. Cấu hình đang hoạt động

Ngày 06/10/2026, theo yêu cầu chủ website giao chuẩn bị dữ liệu và bật tính năng:

- Cấu hình chung “Tham chiếu niêm yết Toàn Trung — khởi tạo”, public đã bật. `1.0.0` là nhãn kỹ thuật của gói khởi tạo cũ, không còn hiển thị hay yêu cầu chọn trong Admin.
- 12 giá tham chiếu từ **giá chào bán của xe đang active và đã xuất bản trong database nội bộ**, 6 hãng, 73 rule, 50 option. Không coi đây là giá giao dịch thực tế hoặc MSRP mới.
- Mỗi giá có ID xe nguồn, đường dẫn bài xe, ngày chụp, tuổi/ODO nền và ghi chú giả định tính toán. Xe niêm yết chưa có điều kiện kiểm định có cấu trúc; giả định trung tính không chứng nhận tình trạng thực tế của xe nguồn.
- Hiệu lực từ **00:00 06/10/2026 đến trước 00:00 05/11/2026**, giờ Việt Nam. Giá hết hạn tự rời danh mục tra cứu; cần cập nhật và lưu giá trước mốc này để tiếp tục tra cứu.
- Khoảng thị trường **±7%**, biên thu mua **7–12%**, làm tròn **1 triệu VND**. Đây là lựa chọn khởi tạo, không phải khoảng sai số thống kê đã đo.
- ODO kỳ vọng 15.000 km/năm, tuổi tối thiểu dùng tính ODO 0,5 năm; thưởng ODO tối đa 2%, trừ tối đa 10%; cap 0,15–1,25 lần nền; năm tối thiểu 1980, tuổi tối đa 50 năm, ODO tối đa 2 triệu km.
- Kế thừa các tỷ lệ ví dụ từ prompt làm rule khởi tạo; ghi chú mẫu/chưa xác minh thị trường được giữ để Admin biết mức độ dữ liệu. Admin có thể sửa trực tiếp từng tỷ lệ trong bộ quy tắc chung.

### Tỷ lệ ban đầu

| Nhóm | Tỷ lệ % |
| --- | --- |
| Tuổi 0 / 1 / 2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / ≥10 năm | −8 / −12 / −18 / −24 / −30 / −35 / −40 / −44 / −48 / −52 / −55 |
| Lệch ODO [−100,−30) / [−30,−10) / [−10,10) / [10,30) / [30,50) / [50,100) / ≥100 | +2 / +1 / 0 / −2 / −4 / −7 / −10 |
| Ngoại thất nguyên bản / xước / sơn 1–2 / sơn 3–5 / sơn >5 / sơn toàn bộ / hư hỏng | 0 / −1 / −2 / −4 / −6 / −8 / −10 |
| Nội thất rất tốt / tốt / hao mòn thường / nhiều / hư hỏng | +1 / 0 / −1 / −4 / −8 |
| Tai nạn không / nhẹ / thay chi tiết / kết cấu / trụ / chassis | 0 / −3 / −5 / −15 / −20 / −30 |
| Ngập không / sàn / nặng / thủy kích | 0 / −10 / −25 / −35 |
| Máy hoặc hộp số rất tốt / thường / bảo dưỡng nhẹ / cảnh báo / sửa lớn | +1 / 0 / −2 / −8 / −15 |
| Bảo dưỡng đầy đủ / một phần / không có / bất nhất | +2 / 0 / −2 / −5 |
| Số chủ 1 / 2 / 3 / ≥4 | +1 / 0 / −1 / −2 |
| Sử dụng cá nhân / công ty / dịch vụ / công nghệ / taxi / cho thuê | 0 / −1 / −4 / −5 / −8 / −5 |
| Thị trường | 0; chưa có dữ liệu giao dịch để thêm điều chỉnh |

Option chưa rõ dùng mức trung tính kèm giảm điểm và yêu cầu kiểm định ở các nhóm quan trọng; không tự suy thành tình trạng tốt. Màu chưa có tỷ lệ riêng.

Hai niêm yết **không nhập** do năm trong tên khác năm DB:

- Hyundai Accent 1.5AT Standard **2024**, DB lưu **2023**.
- Mitsubishi Outlander CVT **2019**, DB lưu **2018**.

Không sửa dữ liệu xe/catalog để đoán năm. Sau khi kiểm tra giấy tờ, sửa nguồn xe và thêm giá đúng variant/năm vào cấu hình chung. Bản nháp mẫu cũ được giữ nội bộ, không xuất hiện trong giao diện quản trị cấu hình chung.

### Ví dụ hoạt động

Kia Morning 1.2 MT 2018, ODO 64.000 km, các điều kiện trung tính, 2 chủ, cá nhân: nền 178 triệu → midpoint 178 triệu, thị trường **165–191 triệu**, thu mua **156–166 triệu**. Thay tình trạng/ODO sẽ thay hệ số; chưa rõ tai nạn/ngập sẽ yêu cầu kiểm định.

## 7. Quản trị và cách thêm dữ liệu

1. Vào **Tiện ích → Định giá xe cũ**. Admin/Super Admin quản lý; Sales chỉ đọc cấu hình, xem lịch sử và xử lý lead.
2. Các tab hiển thị trực tiếp dữ liệu của bộ cấu hình chung đang sử dụng. Chọn sửa/thêm/xóa tại tab cần quản lý.
3. Tab giá: chọn đúng hãng/dòng/phiên bản/năm; nhập loại nền và giá có nguồn. Với MARKET_REFERENCE phải ghi tuổi/ODO nền và giả định tình trạng. Đặt thời gian hiệu lực phù hợp, không chồng khoảng.
4. Tab rule: chọn category, scope và selector tương ứng. Scope GLOBAL áp dụng cho mọi xe; BRAND/MODEL/VARIANT ghi đè theo hãng/dòng/phiên bản xe. Thêm option mới ở trạng thái tắt, thêm rule GLOBAL cho option rồi bật hoạt động. Code option và nhóm ổn định sau khi tạo.
5. Sửa range, margin, cap, limits và trọng số tại **Cấu hình định giá**, **ODO** hoặc **Cấu hình giá thu mua**.
6. Nhập lý do rồi **Lưu và áp dụng**. Hệ thống khóa cấu hình, kiểm tra toàn bộ giá/rule/option/catalog và ghi trong một transaction. Khi đang bật, thay đổi gây thiếu/trùng rule hoặc làm mất giá hợp lệ bị từ chối; dữ liệu cũ vẫn được sử dụng. Thay đổi hợp lệ có hiệu lực ngay, không tạo bản cấu hình mới.
7. **Cấu hình chung** quản lý bật/tắt, disclaimer và CTA. Bật cần quyền `valuation.settings.update`, xác nhận rà soát và toàn bộ dữ liệu hợp lệ, gồm ít nhất một giá còn hiệu lực. Không cần quyền xuất bản trong luồng mới.

Mọi thay đổi quản trị có audit người thực hiện/lý do. Optimistic concurrency trả 409 khi dữ liệu đã bị người khác sửa; tải lại trước khi lưu tiếp. Giá/rule dùng đúng phạm vi đã chọn, không nhân bản sang cấu hình khác.

Khi cần sửa nhiều khoảng phụ thuộc nhau (ví dụ đổi ranh giới hai rule khấu hao), tắt tra cứu → sửa và lưu các hàng liên quan → bật lại sau khi hệ thống kiểm tra đầy đủ. Trong lúc tắt có thể lưu bộ dữ liệu chưa hoàn chỉnh để chuẩn bị; không thể bật lại khi còn lỗi. Kết quả đã lưu không bị tính lại.

### Khôi phục và tạm ngừng

- Cần ngừng ngay: đổi trạng thái chung sang tắt. Request mới đọc settings mới, không phải đợi hết cache; các capability liên hệ còn hạn vẫn gửi được.
- Khôi phục tỷ lệ cũ: xem dữ liệu trước/sau trong Nhật ký → sửa lại giá/rule/cấu hình chung → lưu và áp dụng. Khi cần nhiều thay đổi phụ thuộc nhau, tắt tra cứu trong lúc chỉnh sửa rồi bật lại.
- Giữ nguyên snapshot lịch sử; không xóa lịch sử để khôi phục cấu hình.

## 8. API và quyền

Public không yêu cầu đăng nhập:

| Method | `/api/v1/valuation/…` | Nội dung |
| --- | --- | --- |
| GET | `config` | Bật/tắt, khóa cache cấu hình, lựa chọn và giới hạn input |
| GET | `brands` | Hãng có giá còn hiệu lực |
| GET | `models?brandId=UUID` | Dòng hỗ trợ |
| GET | `variants?modelId=UUID` | Phiên bản hỗ trợ |
| GET | `years?variantId=UUID` | Năm giảm dần |
| POST | `estimate` | Lưu lịch sử và trả ranges, độ đầy đủ, lý do, capability liên hệ |
| POST | `records/:id/lead` | Gửi contact, cần đúng token và `consent:true` |

Admin yêu cầu JWT/profile active và đúng quyền; prefix `/api/v1/admin/valuation`:

| Endpoint | Quyền |
| --- | --- |
| GET current, catalog, current/reference-prices, current/rules, current/options | `valuation.read` |
| PATCH current/config; PUT current/settings | `valuation.settings.update` |
| POST current/reference-prices, PATCH/DELETE current/reference-prices/:id | `valuation.reference_prices.manage` |
| POST current/rules hoặc current/options, PATCH/DELETE current/rules/:id hoặc current/options/:id | `valuation.rules.manage` |
| GET audit | `valuation.audit.read` |
| POST simulate | `valuation.simulate` |
| GET records, records/:id | `valuation.history.read` |
| PATCH records/:id/status | `valuation.history.read` và `valuation.history.update` |

Swagger cập nhật trên `/api/docs` của API. Input examples, query/payload và response chi tiết nằm ở DTO trong module. Không đưa token đăng nhập hoặc DATABASE_URL vào tài liệu/log.

API `current` tự xác định cấu hình chung trên server, không nhận `policyId` từ UI. `current/config` nhận `config`, `expectedRevision`, `reason`; các CRUD current cũng kiểm tra `expectedRevision`. API phiên bản/CRUD cũ được giữ tương thích script khởi tạo và khách API cũ nhưng ẩn khỏi Swagger và không được giao diện Admin mới sử dụng. Endpoint `simulate` cũ chỉ phục vụ kiểm tra qua API, không nằm trong quy trình lưu/áp dụng mới.

| HTTP | Cách xử lý |
| --- | --- |
| 400 | Input/quan hệ/ngày/range/consent sai; sửa trường được chỉ ra |
| 401/403 | Đăng nhập lại hoặc kiểm tra quyền |
| 404 khi gửi lead | Record/token sai hoặc hết 24 giờ; định giá lại, không tiết lộ record có tồn tại |
| 409 | Dữ liệu đã thay đổi hoặc xung đột; tải lại dữ liệu rồi chỉnh sửa và lưu |
| 413 | Body vượt giới hạn; bỏ dữ liệu không cần thiết |
| 429 | Chờ hết cửa sổ rate limit; không gửi request lặp liên tục |
| 503 | Đang tắt hoặc policy/giá/rule không dùng được; kiểm tra Admin |
| 500 | Lỗi server chung; dùng requestId để đối chiếu, public không nhận stack/SQL |

## 9. Security, privacy và vận hành

- DTO whitelist + forbidNonWhitelisted, UUID/numeric/date validation, tham số SQL Drizzle, escape ký tự LIKE. Không chấp nhận payload sửa snapshot, giá engine trả về hoặc lead status từ public.
- Public dùng allowlist; không trả rule ID/tỷ lệ, margin, cap, source notes, tuổi/ODO nền hoặc giá ứng viên bị ẩn.
- Lead capability ngẫu nhiên 256 bit, hạn 24 giờ, DB lưu SHA-256 hash; so sánh timing-safe. Không có public API đọc lịch sử theo UUID. Token không ghi URL/localStorage/log.
- Contact tùy chọn sau giá, cần đồng ý. Row lock và unique liên kết bảo đảm gửi lại/đồng thời không tạo hai lead. PII nằm trong hệ thống leads; snapshot không chứa contact, IP, user-agent hoặc tracking xuyên phiên.
- Rate limit theo tracker Throttler hiện có: estimate 20/phút, lead 5/phút. Storage hiện trong một tiến trình; nhiều API instance không tự chia sẻ quota. Qua Next/reverse proxy, nhiều khách có thể chung IP tracker. Cần kiểm tra topology/trusted proxy và rate limit tại ingress trước vận hành quy mô lớn; không tin tùy tiện X-Forwarded-For từ client.
- Khi có lỗi valuation, logger không ghi Error.message có thể chứa SQL params/PII; giữ loại lỗi, requestId, method/path/status. Route khác giữ chẩn đoán cũ. Pino redact token/hash.
- Chưa có tác vụ tự xóa snapshot/PII theo lịch. Áp dụng chính sách lưu trữ của cửa hàng, quyền truy cập DB/backup, và quy trình xóa lead hiện có; không tự xóa dữ liệu lịch sử khi nâng cấp.
- Catalog/settings đọc mới; snapshot hợp lệ cache tối đa 30 giây, tối đa 8 khóa `id:revision:updatedAt`. Mỗi lần lưu tăng revision, nên estimate mới dùng cấu hình mới ngay. Public config/catalog trả `configurationKey` theo ID/revision để Web bỏ cache cũ khi cấu hình thay đổi. Giá hết hiệu lực được kiểm tra tại thời điểm tính, không bị cache kéo dài.
- Resolver gom rule một lần; không query từng rule. Trong fixture warm, estimate có 6 truy vấn mức service, không tăng theo số rule. Không thêm dependency runtime/animation hay thay đổi homepage.
- Giá nhập là snapshot, không tự đồng bộ khi nhân viên sửa/xóa tin xe. Admin phải cập nhật nguồn, giá, ngày hiệu lực rồi lưu và áp dụng. Không chạy lại script để ghi đè dữ liệu đã được nhân viên sửa.

### Công cụ kích hoạt lần đầu

Chỉ dành cho database phát triển/test đã được chủ website cho phép. Build API trước vì script sử dụng module đã compile:

```powershell
npm.cmd run build
node scripts/activate-valuation.mjs                          # chỉ đọc và in kế hoạch
node scripts/activate-valuation.mjs --apply --development-test
```

Script kiểm tra profile admin có đủ quyền; toàn bộ tạo policy/giá/rule, mô phỏng 12 neo, validate/publish/enable trong **một transaction** với advisory lock. Lỗi trước commit rollback cả pack. Policy có sẵn không bị ghi đè; nếu pack đã active thì bảo toàn. Seed `db:seed-valuation -- --apply` vẫn chỉ tạo bản mẫu nháp/tắt khi chưa có dữ liệu, không tự bật production.

## 10. Kiểm thử và giới hạn kiểm tra

- API: `npm.cmd test` **86/86 đạt** toàn repo, gồm engine, RBAC, input, token, concurrency, matrix A–H, activation, rollback, 413 và che lỗi SQL.
- `valuation-current.test.ts`: **7/7 đạt**, gồm sửa trực tiếp AGE/MARKET/giá/config áp dụng ngay, không tạo thêm cấu hình, snapshot cũ bất biến, từ chối dữ liệu không hợp lệ và stale/concurrent edits, chuẩn bị option/rule khi tắt rồi bật lại. Đã chạy lại sau các chỉnh sửa cuối.
- API lint/build, Drizzle `db:check`: đạt.
- Web/Admin browser scripts kiểm tra **360, 390, 430, 768, 1024, 1440px**: form, tên dài, lỗi, kết quả, tab/bảng, CRUD áp dụng trực tiếp, contact và quyền. Admin kiểm tra không còn tab/nút chọn, tạo, nhân bản, xuất bản phiên bản cấu hình.
- Kiểm tra focus/tab, heading focus khi đổi bước, label, aria-live/error, meter và reduced-motion. Không tự bật bàn phím khi mở form.
- Live smoke trên database test: desktop 1440 và mobile 390, dùng Kia Morning đã nhập, ranges đúng, tạo 2 record ẩn danh, **không gửi lead test vào DB thật**. Mobile giảm viewport cao xuống 430px, ô điện thoại vẫn nhìn thấy, font input 16px và Tab đi đúng ô.
- Headless Chromium/reduced viewport không mô phỏng bàn phím native iPhone/Safari. Chưa thể xác nhận trên thiết bị Safari thật. Các số latency fixture không đại diện Supabase/production hoặc load test.

```powershell
# API
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run db:check
# Admin, sau khi compile API tests và có server Admin
node scripts/valuation-admin-check.mjs
# Web, khi có server Web (mặc định 3003)
node scripts/valuation-web-check.mjs
# Live smoke chỉ chạy chủ động trên môi trường test: lưu 2 record ẩn danh
node scripts/valuation-live-check.mjs
```

## 11. Mở rộng dữ liệu giao dịch

Không triển khai ML/AI. UUID record, snapshot JSONB có schemaVersion và liên kết lead cho phép nối một bảng giao dịch sau này để lưu `actual_purchase_price`, `repair_cost`, `listing_price`, `actual_selling_price`, `days_to_sell`. Giữ snapshot dự đoán để so sánh với giao dịch; không sửa snapshot bằng giá thực tế. Chưa có các cột giao dịch này trong phiên bản hiện tại và không coi trạng thái PURCHASED là dữ liệu giá mua đã thu thập.

Ưu tiên tiếp theo về dữ liệu: giá giao dịch có chứng từ, điều kiện xe nguồn được kiểm định, cập nhật thêm variant/năm và hiệu chuẩn tỷ lệ theo lịch sử. Hiện hệ thống hoạt động với nguồn niêm yết nội bộ và chỉ hỗ trợ các variant/năm đã có giá hợp lệ.
