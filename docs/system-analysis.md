# Phase 1 — Phân tích web và admin

Tài liệu này ghi nhận **code đang có**, làm đầu vào cho thiết kế database ở Phase 2. Chưa có schema hay API được triển khai. Phạm vi khảo sát: `web-xeluottoantrung/app`, `components`, `lib`, `types`, `data`; `admin-xeluottoantrung/src/app`, `src/components`, `src/lib`; các file cấu hình package. Các file `admin-page/*.html` là ảnh chụp giao diện cũ để tham khảo, không phải route Next.js đang chạy.

## 1. Công nghệ, route và nguồn dữ liệu hiện tại

| Ứng dụng | Stack | Routing | Nguồn dữ liệu |
| --- | --- | --- | --- |
| Web | Next.js 15.5.25, React 19.1.1, TypeScript; Cheerio, `html-react-parser`, `react-slick`; CSS/assets legacy | App Router: `/` và `app/[...slug]/page.tsx`. `data/routes.json` liệt kê 154 route tĩnh; `route-manifest.json` có 298 khóa gồm cả biến thể query. | `data/pages/*.json` là snapshot HTML/metadata; `data/cars.json` có 87 mục xe; `data/categories.json`, `data/shared.json` chứa mapping danh mục/menu/nội dung chung. `lib/pages.ts` đọc file JSON từ disk; `lib/search.ts` lọc snapshot ở server. Chưa có API client. |
| Admin | Next.js 16.3.5, React 19.2.8, TypeScript, Tailwind 4, Recharts, Sonner, Lucide | App Router có 59 `page.tsx` (trong đó `/san-pham/hang-xe` và `/san-pham/dong-xe` re-export màn danh mục cấp 1/2). | `src/lib/mock-data.ts` và `LegacyCollectionPage.tsx` tạo dữ liệu mẫu; `useLocalStore()` lưu trạng thái theo key trong `localStorage` của từng trình duyệt. Chưa có API client, server action hoặc auth guard. |

Web render nội dung legacy bằng `LegacyPage` → `LegacyContent` → `Markup`, đồng thời chèn card từ `cars.json`. `generateMetadata` lấy title/description/OG image từ snapshot JSON và canonical theo path. Trang chủ chọn 6 card đầu từ snapshot `/san-pham`. Search theo `keyword` và bộ lọc nâng cao sửa HTML snapshot bằng Cheerio, chưa truy vấn dữ liệu trung tâm. Admin `DataTable` lọc/tìm/sắp xếp và phân trang 10 dòng **trên client**; `CrudPage`, `SettingsPage`, `MailPage` cung cấp thao tác đang lưu localStorage. Ảnh upload chuyển thành Data URL bằng `FileReader` rồi lưu cùng record trong localStorage.

### Nhóm route web

| Nhóm | Route/nguồn | Tính năng hiện thấy |
| --- | --- | --- |
| Trang chủ | `/` | Hero/nội dung từ snapshot, 6 xe nổi bật lấy theo thứ tự listing, tìm từ khóa, form chọn hãng/dòng dẫn đến bán xe, dịch vụ, showroom. |
| Xe | `/san-pham`, `/tim-kiem-nang-cao`, khoảng 87 route chi tiết xe trong manifest | Listing, card, giá, thông số, bộ lọc hãng/kiểu dáng/hộp số/màu/giá/năm/km, sắp giá, gallery, so sánh 2 xe, form tư vấn/trả góp ở một số trang chi tiết. |
| Danh mục xe | Các route hãng như `/toyota`, `/ford`; dòng như `/camry`, `/cr-v`; kiểu dáng như `/suv`, `/sedan` | Listing theo danh mục trong snapshot và `categories.json`. |
| Nội dung | `/ve-chung-toi`, `/cam-ket`, `/cam-nhan`, `/cau-hoi`, `/tin-tuc`, các bài tin, `/ban-xe`, `/len-doi`, `/dich-vu-khac`, `/dich-vu-van-chuyen`, các trang chính sách | Giới thiệu, bài viết, FAQ, cảm nhận, quy trình, form gửi xe bán/lên đời. |
| Showroom | `/showroom-quan-12`, `/showroom-toan-trung-9`, `/showroom-toan-trung-gia-lai`, `/showroom-toan-trung-luxury-car` | Nội dung địa điểm và xe liên quan. Footer có danh sách showroom riêng hard-code. |
| Tài khoản public | `/account/dang-nhap`, `/account/dang-ky`, `/account/quen-mat-khau` | Snapshot form cũ; submit hiện bị `SiteInteractions` chặn. Chưa có session hay auth thật. |

Không thấy route hay code chức năng độc lập cho **phụ kiện**, **định giá xe tự động**, **tra cứu phạt nguội**. Form bán xe thu thập thông tin để nhân viên xử lý, chưa có thuật toán báo giá. Bảo hiểm trong footer là link ngoài; cứu hộ RSA chỉ là nhãn chưa có đích.

### Form và tương tác web

| Vị trí | Input / behavior | Hiện trạng |
| --- | --- | --- |
| Header/listing | `keyword`; bộ lọc `hang-xe`, `kieu-dang`, `hop-so`, `mau-sac`, `ngan-sach`, `nam-san-xuat`, `so-km`, `gia` | URL query và lọc JSON ở server; không có API, không phân trang dữ liệu thật. |
| `/ban-xe` | hãng, dòng, năm, phiên bản, km, điện thoại | HTML form `Formlaithu`; submit bị chặn và hiện số hotline. |
| `/len-doi` | Các field bán xe, thêm hãng/dòng xe muốn đổi | Cùng kiểu form, chưa gửi. |
| Chi tiết xe, tùy snapshot | Giá xe, khoản vay, thời hạn, lãi suất, họ tên, điện thoại, tên xe ẩn | Form tư vấn/trả góp chưa gửi; một số snapshot thiếu form, cần xác nhận theo từng URL khi tích hợp. |
| Footer | Email newsletter | React chỉ hiện thông báo “đang hoàn thiện”; không ghi đăng ký. |
| `/account/*` | Username/password, đăng ký tên/ngày sinh/giới tính/email/điện thoại/địa chỉ, quên mật khẩu | Form legacy chưa nối Supabase Auth. |
| Gallery/so sánh | Xem ảnh, chọn tối đa hai xe | Hoạt động phía client; so sánh không lưu bền vững. |

## 2. Kiểm kê từng màn hình admin

Ký hiệu: `C` = CRUD danh sách qua `CrudPage` (bảng, tìm, sắp xếp, phân trang, form thêm/sửa, xác nhận xóa); `L` = danh sách legacy qua `LegacyCollectionPage`, cùng thao tác C; `S` = form cấu hình qua `SettingsPage` và nút lưu; `M` = `MailPage` (xem, đọc/đã liên hệ, xóa; newsletter xuất CSV). **Nguồn hiện tại** của C là `mock-data.ts` hoặc literal trong page, của L là `definitions` trong `LegacyCollectionPage.tsx`, của S là `defaultValue`, của M là `mockMails`; tất cả thay đổi dùng `useLocalStore` trừ thống kê hard-code. Các API trong bảng là **đề xuất**, chưa tồn tại. Mỗi dòng nêu dữ liệu và entity cần thiết; thứ tự/hiển thị được lưu nếu màn hình cho phép.

| Screen / purpose | Dữ liệu và thao tác hiện có | Nguồn | API dự kiến / entity |
| --- | --- | --- | --- |
| `/` Tổng quan | Số xe, thư chưa đọc, khách hàng, lượt xem, thư gần đây, xe nổi bật; chỉ đọc | mock/localStorage | `GET /admin/dashboard`; tổng hợp `cars`, `leads`, `customers`; lượt xem cần nguồn đo thật |
| `/thong-ke` Thống kê truy cập | Card, biểu đồ tháng/tuần, thiết bị, trình duyệt, trang phổ biến; chỉ đọc | `mockDashboardStats` + mảng literal | `GET /admin/analytics`; event/nguồn analytics cần xác định |
| `/san-pham` Xe | C chuyên biệt: tìm/lọc hãng, dòng, phiên bản; xem, thêm/sửa/xóa, ảnh cover + gallery tối đa 10, bật nổi bật/trả góp, xuất CSV | `mockProducts` + localStorage | `GET/POST/PATCH/DELETE /admin/cars`, media API; `cars`, `car_media` |
| `/danh-muc/cap-1`, `/san-pham/hang-xe` Hãng | C: tên, ảnh, slug, trạng thái; liên hệ xe | `mockCategories` | `/admin/brands`; `brands` |
| `/danh-muc/cap-2`, `/san-pham/dong-xe` Dòng | C: tên, ảnh, hãng cha, kiểu dáng, slug, trạng thái | `mockSubCategories` | `/admin/car-models`; `car_models` |
| `/san-pham/phien-ban` Phiên bản | Bảng lọc hãng/dòng; thêm/sửa/xóa, ảnh/tên/slug và ràng buộc xe liên quan | `mockVersions` | `/admin/car-versions`; `car_versions` |
| `/quan-ly/kieu-dang` Kiểu dáng | C: tên, ảnh, slug, trạng thái | `mockBodyStyles` | `/admin/body-styles`; `body_styles` |
| `/quan-ly/nam-san-xuat` Năm | C: tên/năm, trạng thái | `mockYears` | `/admin/filter-options` nếu admin cần chỉnh; có thể suy từ năm xe nếu UI chấp nhận; chưa quyết định table |
| `/quan-ly/hop-so` Hộp số | C: tên, slug, trạng thái | `mockGearBoxes` | `/admin/transmissions`; `transmissions` hoặc lookup chung |
| `/quan-ly/ngan-sach` Ngân sách lọc | C: nhãn, slug, trạng thái; type có min/max nhưng form chưa sửa min/max | `mockBudgets` | `/admin/filter-options`; `filter_options` hoặc cấu hình bộ lọc |
| `/thiet-lap/so-km` Mức km | C: tên, slug, trạng thái; type có min/max nhưng form chưa sửa | `mockMileages` | `/admin/filter-options` |
| `/thiet-lap/bien-so` Nhóm biển số | C: tên, slug, trạng thái | `mockLicensePlates` | `/admin/filter-options`; chỉ lập quan hệ xe nếu UI xác nhận |
| `/thiet-lap/tinh-trang` Nhãn tình trạng | C: tên, slug, trạng thái; khác `Product.condition` (“Đã qua sử dụng/Xe mới”) và `Product.status` | `mockConditions` | `/admin/filter-options` hoặc mapping trạng thái xe, cần làm rõ |
| `/thiet-lap/mau-sac` Màu xe | L: tên, mã màu, trạng thái | `initialManagedCarColors` | `/admin/car-colors`; `car_colors` |
| `/quan-ly/chi-nhanh` Chi nhánh | C: tên, ảnh, điện thoại, địa chỉ, map URL, trạng thái | `mockBranches` | `/admin/branches`; `branches` |
| `/quan-ly/danh-muc-chi-nhanh` Vùng/nhóm chi nhánh | C: tên, trạng thái | literal “Miền Nam/Miền Trung” | `/admin/branch-regions`; `branch_regions` nếu dùng cho web |
| `/quan-ly/gioi-thieu` Giới thiệu | L: tiêu đề, ảnh, rich text, trạng thái | definition literal | `/admin/content-entries`; `content_entries` |
| `/quan-ly/thong-ke-noi-dung` Số liệu quảng bá | L: tiêu đề, trạng thái | definition literal | `/admin/content-entries`; không trộn với analytics thật |
| `/quan-ly/dich-vu` Dịch vụ | C: tiêu đề, ảnh, mô tả, trạng thái | `mockServices` | `/admin/services`; `services` hoặc `content_entries` |
| `/quan-ly/cam-nhan-khach-hang` Cảm nhận | C: tên, avatar, nội dung, rating, xe đã mua, nổi bật, trạng thái | `mockTestimonials` | `/admin/testimonials`; `testimonials` |
| `/quan-ly/cau-hoi-thuong-gap` FAQ | C: câu hỏi, trả lời rich text, nổi bật, trạng thái | `mockFAQs` | `/admin/faqs`; `faqs` |
| `/quan-ly/tin-tuc` Tin/bài viết | C: tiêu đề, ảnh, slug, danh mục, trích đoạn, nội dung, nổi bật, nháp/đăng | `mockNews` | `/admin/articles`; `articles`, có thể `article_categories` |
| `/quan-ly/tuyen-dung` Tuyển dụng | C: tiêu đề, ảnh, mô tả, yêu cầu, lương, địa điểm, hạn, trạng thái | `mockRecruitments` | `/admin/recruitments`; `recruitments` |
| `/thu/ban-xe` Thư bán xe | M: thông tin khách, xe muốn bán, trạng thái, ngày gửi | `mockMails` | `/admin/leads?type=sell`; `leads` |
| `/thu/len-doi-xe` Thư lên đời | M: xe hiện có, xe mong muốn, khách hàng | `mockMails` | `/admin/leads?type=trade_in`; `leads` |
| `/thu/yeu-cau-goi-lai` Gọi lại | M: khách, xe quan tâm | `mockMails` | `/admin/leads?type=callback`; `leads` |
| `/thu/dang-ky-nhan-tin` Newsletter | M: email, trạng thái, xuất CSV | `mockMails` | `/admin/newsletter-subscribers`; `newsletter_subscribers` hoặc lead loại subscribe |
| `/tai-khoan/khach-hang` Khách hàng | C: tên, email, điện thoại, địa chỉ, active/blocked, ngày đăng nhập | `mockCustomers` | `/admin/customers`; `customer_profiles` nếu public account được kích hoạt |
| `/tai-khoan/admin` Hồ sơ admin | Xem/sửa tên, email, điện thoại; vai trò “Super Admin” hard-code; đổi mật khẩu chỉ giải thích chưa hoạt động | localStorage | `/admin/me`, cập nhật profile; Supabase Auth cho email/password; `profiles`, RBAC |
| `/thiet-lap/slideshow` Banner trang chủ | C: tiêu đề, ảnh, link, trạng thái, thứ tự | `mockSlideshows` | `/admin/slides`; `slides` hoặc content collection |
| `/thiet-lap/banner-dong-xe` Banner theo dòng | L: tiêu đề, ảnh, link, trạng thái | definition rỗng | `/admin/content-entries` |
| `/thiet-lap/banner-len-doi` Banner lên đời | S: ảnh, tiêu đề, phụ đề | defaults/localStorage | `/admin/site-settings/:group` + media; `site_settings` |
| `/thiet-lap/anh-chi-nhanh` Ảnh chi nhánh | S: 3 ảnh và caption | defaults/localStorage | `/admin/site-settings/:group` + media; xem xét relation `branch_media` |
| `/thiet-lap/anh-vi-sao-chon` Ảnh lý do chọn | S: 4 ảnh | defaults/localStorage | `/admin/site-settings/:group` + media |
| `/thiet-lap/cac-buoc-mua-xe` Quy trình mua | L: tiêu đề, ảnh, rich text, trạng thái, thứ tự | definition literal | `/admin/content-entries` |
| `/thiet-lap/cac-buoc-ban-xe` Quy trình bán | L: cùng cấu trúc | definition literal | `/admin/content-entries` |
| `/thiet-lap/cac-buoc-len-doi` Quy trình lên đời | L: cùng cấu trúc, mặc định rỗng | definition literal | `/admin/content-entries` |
| `/thiet-lap/quy-trinh-ban-xe` Quy trình bán phiên bản khác | L: cùng cấu trúc; hiện có hai màn “quy trình bán xe” | definition literal | `/admin/content-entries`; cần xác nhận vị trí web sử dụng |
| `/thiet-lap/chinh-sach-dieu-kien` Chính sách | L: tiêu đề, ảnh, rich text, trạng thái | definition literal | `/admin/pages` hoặc `content_entries` |
| `/thiet-lap/kham-pha-xe` Khám phá xe | L: tiêu đề, ảnh, rich text, trạng thái | definition literal | `/admin/content-entries` |
| `/thiet-lap/tai-sao-chon` Lý do chọn | L: tiêu đề, ảnh, rich text, trạng thái | definition literal | `/admin/content-entries` |
| `/thiet-lap/goi-y-nam-san-xuat` Gợi ý năm | L: nhãn, trạng thái | definition literal | `/admin/filter-options` |
| `/thiet-lap/nut-goi` Nút gọi | L: tên, điện thoại, trạng thái | definition literal | `/admin/contact-buttons`; `contact_buttons` hoặc content collection |
| `/thiet-lap/mang-xa-hoi` Mạng xã hội | L: tên, ảnh/link, trạng thái | definition literal | `/admin/social-links`; `social_links` hoặc content collection |
| `/thiet-lap/ung-dung` Link ứng dụng | L: tên, ảnh/link, trạng thái; chưa có app | definition literal | `/admin/content-entries`; không bắt buộc public nếu chưa hiển thị |
| `/thiet-lap/text-ban-xe` Nội dung bán xe | S: hiển thị, tiêu đề, phụ đề, rich text, ảnh và SEO | defaults/localStorage | `/admin/site-settings/:group`, `/admin/seo` |
| `/thiet-lap/text-len-doi` Nội dung lên đời | S: hiển thị, tiêu đề, ảnh và SEO | defaults/localStorage | `/admin/site-settings/:group`, `/admin/seo` |
| `/thiet-lap/text-tra-gop` Nội dung trả góp | S: hiển thị, rich text | defaults/localStorage | `/admin/site-settings/:group` |
| `/thiet-lap/lien-he` Liên hệ | S: hiển thị, rich text, ảnh và SEO | defaults/localStorage | `/admin/site-settings/:group`, `/admin/seo` |
| `/thiet-lap/footer` Footer | S: hiển thị, nội dung, giới thiệu, copyright, địa chỉ, điện thoại, email | defaults/localStorage | `/admin/site-settings/:group` |
| `/thiet-lap/logo` Logo | S: logo chính/tối/mobile | defaults/localStorage | `/admin/site-settings/:group` + media |
| `/thiet-lap/favicon` Favicon | S: file | defaults/localStorage | `/admin/site-settings/:group` + media |
| `/thiet-lap/thong-tin` Cấu hình chung | S: vay %, lãi suất, kỳ hạn, tên/điện thoại/Zalo/website/fanpage/bảo hiểm/email/hotline/địa chỉ/giờ, số item/trang, map, MST, mô tả/keywords | defaults/localStorage | `/admin/site-settings/:group`; `site_settings`, SEO phần tương ứng |
| `/seo/cau-hoi-thuong-gap` SEO FAQ | S: title, description, keywords, OG image, canonical | defaults/localStorage | `/admin/seo/:route`; `seo_metadata` |
| `/seo/danh-gia-khach-hang` SEO đánh giá | S: cùng field | defaults/localStorage | `/admin/seo/:route` |
| `/seo/mua-xe` SEO mua xe | S: cùng field | defaults/localStorage | `/admin/seo/:route` |
| `/seo/tin-tuc` SEO tin tức | S: cùng field | defaults/localStorage | `/admin/seo/:route` |

Các màn C/L/S/M dùng modal hoặc view thay thế vùng nội dung, xác nhận xóa và toast. Có search/sort/page phía client. Các form cấu hình và rich text không tự động xuất hiện ở website vì hai app không chia sẻ storage hay API. Admin không có màn login; mọi route hiển thị nếu truy cập trực tiếp. `Header` và `Sidebar` đọc profile localStorage, notification đọc thư mock/localStorage; search toàn cục chỉ tìm tên màn hình trong sidebar.

## 3. Field xe và quan hệ thấy rõ từ UI

`Product` trong `src/lib/types.ts` và form `/san-pham` đòi hỏi: `id`, `name`, `slug`, `brand`, `model`, `version`, `branchId`, `year`, `price`, `originalPrice`, `mileage`, `transmission`, `fuel`, `color`, `licensePlate`, `condition`, `status`, `description`, `images`, `featured`, `installment`, `newArrival`, `createdAt`, `updatedAt`. Status thực tế: `active` (đang bán), `deposit` (đã nhận cọc), `sold`, `inactive` (ẩn). Dòng xe gắn hãng và kiểu dáng; phiên bản gắn dòng; xe gắn phiên bản và chi nhánh. Ảnh cover/gallery là quan hệ nhiều bản ghi, không phải `image1...` ở cars. Web còn hiển thị số chỗ và thông số từ `Car.specs`, trong khi admin `Product` chưa có field số chỗ/specifications — cần bổ sung field khi thiết kế schema, rồi quyết định cách biên tập trong UI mà không thay visual.

`Car` của web là cấu trúc trình bày (`priceHtml`, `specs[]`, `href`, `images[]`), chưa phải model nghiệp vụ chuẩn. `data/cars.json` có 87 card key; `car-source-status.json` phân biệt dữ liệu khôi phục từ website gốc và dữ liệu suy ra từ lịch sử. `data/pages/*.json` chứa nhiều nội dung và metadata có thể là dữ liệu thật cần giữ lại, nhưng chất lượng không đồng đều. Không coi `mockProducts` của admin là inventory thật.

## 4. Phân loại dữ liệu cứng/mock

| Loại | Vị trí | Hướng xử lý ở phase sau |
| --- | --- | --- |
| BUSINESS DATA | Web `cars.json`, `categories.json`, URL xe và assets; admin `mockProducts`, `mockCategories`, `mockSubCategories`, `mockVersions`, `mockBranches` | Đối chiếu/chuẩn hóa và nhập dữ liệu web có nguồn đáng tin; không seed 10 xe admin giả như xe thật. Mọi CRUD admin đi qua API. |
| CONTENT DATA | Web snapshot `pages/*.json`, `shared.json`, Footer showroom/địa chỉ/hotline/social; admin FAQ, testimonials, news, services, recruitment, slideshow và các màn `LegacyCollectionPage` | Chọn nội dung thực đã xác minh làm nguồn khởi tạo; admin quản lý phần nào thì API/CMS trả về đúng phần đó. Giữ bản snapshot/asset để đối chiếu khi chuyển. |
| UI STATIC DATA | Nhãn nút, icon, style, quy tắc hiển thị, breakpoint, dropdown bố cục | Giữ trong frontend; không tạo record DB cho từng label. |
| CONFIG DATA | Admin `SettingsPage`, 4 màn SEO; web metadata snapshot, URL liên hệ, số item/trang | `site_settings`/`seo_metadata` chỉ cho setting cần quản lý; mapping web bằng data layer. |
| MOCK DATA | Toàn bộ `src/lib/mock-data.ts`, chart literal `/thong-ke`, mock admin profile và content definitions | Không dùng làm số liệu sản xuất; chỉ giữ khi cần fixture kiểm thử. Dashboard/analytics không được hiển thị thống kê giả sau tích hợp. |

`localStorage` admin chứa dữ liệu nghiệp vụ theo prefix `xeluottoantrung-admin:v1:`. Dữ liệu có thể khác giữa máy/trình duyệt; trước khi thay bằng API, nếu đang có record thực trong browser của người vận hành cần cơ chế xuất/nhập hoặc đối chiếu. Theme/sidebar localStorage là **UI preference**, có thể giữ phía client.

## 5. Entity và quan hệ đề xuất cho Phase 2

| Mức ưu tiên | Entity | Vì sao UI cần / quan hệ |
| --- | --- | --- |
| Bắt buộc | `brands`, `car_models`, `car_versions`, `body_styles`, `cars`, `car_media`, `branches`, `branch_regions` | Chuỗi brand → model → version → car; model → body style; car → branch; car → nhiều media; branch → region. |
| Bắt buộc | `profiles`, `roles`, `permissions`, `user_roles`, `role_permissions` | Admin đang có hồ sơ/vai trò hiển thị nhưng chưa có auth; Supabase Auth nắm credential, DB app nắm quyền. |
| Bắt buộc theo màn admin | `leads`, `newsletter_subscribers`, `articles`, `faqs`, `testimonials`, `recruitments`, `slides`, `seo_metadata`, `site_settings`, `audit_logs` | Bốn hộp thư, CMS, SEO và lịch sử sửa/xóa/xuất bản. Gắn media bằng relation phù hợp; tránh lưu binary trong DB. |
| Tùy cấu trúc Phase 2 | `services`, `content_entries`, `filter_options`/lookup riêng, `social_links`, `contact_buttons`, `customer_profiles` | Các bộ dữ liệu đang có màn chỉnh; chọn bảng riêng khi có relation/query, content collection khi chỉ cần sắp thứ tự/hiển thị. Customer profile chỉ gắn Auth nếu public account được kích hoạt. |
| Chưa có bằng chứng UI | `accessories`, `accessory_categories`, `valuation_requests` cho báo giá tự động, `traffic_fine_queries` | Không tạo trong Phase 2 chỉ vì xuất hiện ở prompt tổng. Form bán xe/lên đời phù hợp `leads`; bổ sung khi có UI/business rule thật. |

Nên dùng UUID cho PK mới, lưu `legacy_id`/`source_url` khi nhập xe cũ để idempotent và giữ slug/URL đang index. Giá dùng số nguyên VND; trạng thái lưu có constraint rõ; `created_at`/`updated_at` cho record nghiệp vụ. Các danh mục range (ngân sách/km/năm) cần xác định ranh giới số; UI hiện chỉ sửa nhãn, chưa sửa min/max. Các bản ghi công khai chỉ trả status hiển thị. Không đưa giá nội bộ hay PII lead vào API public.

## 6. API cần thiết theo UI đang có

Đường dẫn minh họa dưới `/api/v1`; finalize ở Phase thiết kế API. `GET /cars` cần `search`, `brand`, `model`, `bodyStyle`, `transmission`, `color`, `priceMin/Max`, `yearMin/Max`, `mileageMin/Max`, `sort`, `page`, `limit`, `branch`; listing chỉ trả cover, detail trả gallery/specs. Web cần `GET /cars/:slug`, `GET /brands`, `GET /brands/:slug/models`, dữ liệu filter, `GET /branches`, `GET /articles`, `GET /faqs`, `GET /testimonials`, `GET /content`, `GET /seo/:route`. Form cần `POST /leads` theo sell/trade-in/callback/finance enquiry và `POST /newsletter-subscriptions`; auth public chỉ khi xác nhận 3 route account còn cần hoạt động.

Admin cần `GET /admin/me`, CRUD `/admin/cars`, `/admin/brands`, `/admin/car-models`, `/admin/car-versions`, `/admin/branches`, lookup/filter, `/admin/articles`, `/admin/faqs`, `/admin/testimonials`, `/admin/recruitments`, `/admin/leads` (read/status/delete theo quyền), `/admin/newsletter-subscribers`, `/admin/site-settings`, `/admin/content-entries`, `/admin/seo`, `/admin/slides`, `/admin/dashboard`. Thao tác ảnh cần presign R2 + xác nhận metadata + xóa/sắp xếp/cover. Admin action cần JWT Supabase + RBAC + audit cho xe, nội dung, SEO, media và quyền. Các màn data table cần API search/filter/sort/page thực thay cho lọc toàn bộ record tại browser.

## 7. Yêu cầu tích hợp và vấn đề cần xác minh

1. **Hai nguồn xe không trùng nhau.** Web chứa 87 card và route xe khôi phục; admin có 10 xe ví dụ. Chọn nguồn web đã xác minh để import, đối chiếu tài sản/giá/trạng thái với showroom trước khi public hóa. Giữ slug và mapping URL cũ. Một số snapshot title SEO còn chung/chưa đạt chất lượng.
2. **Không có đồng bộ nội dung.** Admin sửa localStorage chỉ thấy trên cùng browser; website đọc file JSON đóng gói. Cần API và lớp mapping `API DTO → UI model`, giữ Markup/CSS hiện tại. Tránh đổi layout trong khi thay nguồn dữ liệu.
3. **Lưu trữ media.** Web dùng file trong `public/thumbs`, `public/upload`; admin lưu Data URL. R2 cần key/URL/alt/order/cover, presigned upload, kiểm tra loại/kích thước và xử lý xóa. Asset cũ cần kiểm kê bản quyền/nguồn và kế hoạch import; không mất link cũ khi chuyển.
4. **Auth chưa có.** Admin không có màn login, route guard hay permission; chữ “Super Admin” chỉ là text. 3 trang tài khoản public là snapshot chưa hoạt động. Quyết định public account có được đưa vào vận hành hay giữ route thông báo; không dựng password system riêng.
5. **Form chưa gửi.** `SiteInteractions.tsx` chặn mọi form snapshot và hiện hotline; newsletter footer cũng chỉ hiện notice. Cần xác định thông tin bắt buộc, consent/chống spam, mapping `lead.type`, feedback thành công/lỗi và chính sách dữ liệu cá nhân.
6. **Cấu hình chưa khớp.** Footer/header hard-code số điện thoại, địa chỉ, showroom, social trong khi admin có màn chỉnh những dữ liệu này. Cần xác định nguồn chính xác để tránh ghi đè thông tin doanh nghiệp thật bằng mock (đặc biệt chi nhánh `mockBranches` có địa chỉ giả).
7. **Trạng thái xe lệch tên.** Admin `active/deposit/sold/inactive`; web `Car.status` thường rỗng. Mapping rõ các trạng thái public và hành động publish/unpublish; định nghĩa xe đã bán/đã cọc còn hiện listing hay không.
8. **Thông số web nhiều hơn form admin.** Web có số chỗ, chi nhánh, hộp số, nhiên liệu, km, năm được gắn nhãn “Biển số” trong card; admin thiếu số chỗ và các thông số mở rộng. Cần xem mẫu chi tiết thực trước khi khóa schema.
9. **Analytics chưa có nguồn.** Dashboard/chart hiện là số giả; không khởi tạo bảng analytics lớn nếu chưa chọn nguồn đo. Có thể trả thống kê nghiệp vụ từ DB, ẩn/đánh dấu phần lượt xem chưa triển khai ở data layer khi tới Phase 8.
10. **SEO và route cũ.** Metadata hiện theo snapshot tĩnh, `canonical` theo path; admin có 4 màn SEO riêng. Cần giữ canonical/redirect cho slug ổn định, metadata bài/xe động, tránh lấy SEO giả từ admin mock.
11. **Danh mục chồng lấn.** Hãng/dòng có hai route admin dẫn cùng component; “tình trạng” lookup khác `Product.condition` và lifecycle; hai nhóm “quy trình bán xe”. Không nhân đôi table/API nếu chúng thực chất cùng dữ liệu.
12. **Giới hạn khảo sát.** Phase 1 là phân tích code, chưa kiểm thử browser hay xác thực thông tin kinh doanh ngoài repo. Những nội dung snapshot suy ra từ dữ liệu khôi phục phải được chủ showroom kiểm chứng trước khi xem là sự thật sản xuất.

## 8. Kết quả Phase 1

Các module backend cần ưu tiên: auth/RBAC, hãng/dòng/phiên bản/xe, media, chi nhánh, lead/newsletter, CMS (bài viết/FAQ/cảm nhận/tuyển dụng/section), site settings, SEO, audit. Table dự kiến ở mục 5; API dự kiến ở mục 6; dữ liệu cần migrate ở mục 4. Phase 2 mới quyết định schema, migration và seed. Không tiếp tục Phase 2 trong lần thực hiện này.
