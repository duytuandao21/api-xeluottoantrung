# Phase 2 — Database schema

> Schema và migration đang được API sử dụng. Quy trình áp dụng migration và seed cho môi trường mới xem [deployment.md](deployment.md).

Thiết kế dựa trên [system-analysis.md](./system-analysis.md), phiên bản thực thi là `src/database/schema/*.ts` và migration `drizzle/0000_wild_carmella_unuscione.sql`. Có 32 table. Migration đã chạy trên Supabase PostgreSQL; seed đã tạo 6 role và 44 permission. `drizzle-kit check` chạy thành công.

## Quy ước và quyết định

- PostgreSQL/Supabase, Drizzle ORM. Mọi bảng có `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`; các bảng nối role cũng có UUID riêng. `created_at timestamptz DEFAULT now()`; bảng nghiệp vụ thay đổi có `updated_at timestamptz DEFAULT now()` (service phải cập nhật khi sửa, DB không tự cập nhật).
- Ký hiệu catalog: `!` = NOT NULL, `?` = nullable, `D=` = default, `PK`/`FK`/`UQ` = khóa. Cột không đánh `!` là nullable. `ts` = `timestamp with time zone`, `int` = integer, `bigint` = PostgreSQL bigint, `bool` = boolean. Toàn bộ `id`, `created_at` theo quy ước trên được ghi gọn ở từng bảng; SQL migration là định nghĩa chính xác từng cột.
- `auth_user_id` nối logic với Supabase `auth.users.id` nhưng không khai báo foreign key chéo schema để migration ứng dụng độc lập và không quản lý vòng đời người dùng của Supabase. `profiles` dùng cho nhân viên/admin; `customers` giữ màn khách hàng, có thể gắn `auth_user_id` nếu public account được kích hoạt. Không lưu password.
- `cars.status` là enum `active/deposit/sold/inactive`, đúng UI admin. Public listing nên chỉ cho trạng thái được chính sách xuất bản cho phép; `published_at` và `deleted_at` được xét cùng status. `lead_type` và `lead_status` cũng là enum. Các trường `status` dạng text ở CMS/lookup giữ giá trị UI hiện có (`active/inactive`, bài viết `draft/published`); service Phase sau phải validate.
- `cars.brand_id`, `model_id`, `version_id`, `body_style_id` phục vụ query nhưng trùng thông tin phân cấp; khi ghi xe service phải kiểm tra model thuộc brand, version thuộc model, body style hợp với model. Chưa dùng trigger để tránh logic bị tách khỏi API. Phần này là invariant bắt buộc, không được cho frontend tự quyết định.
- `filter_options` chỉ chứa nhóm được admin sửa: năm, ngân sách, km, biển số, nhãn tình trạng, gợi ý năm. `min_value`/`max_value` nullable vì UI hiện chỉ sửa nhãn; Phase tích hợp phải xác định ranh giới lọc thực. Tên group cần hằng số ở service.
- `seo_metadata.route_path` là khóa route ổn định cho trang, xe, bài viết; slug giữ nguyên khi đổi tiêu đề. `structured_data` dùng JSONB đúng loại metadata linh hoạt. `audit_logs.old_data/new_data` dùng JSONB cho bản thay đổi; tránh đưa secret, token hoặc PII không cần thiết vào audit.
- `car_media.storage_key` nullable để giữ ảnh local legacy khi import; media upload R2 mới phải có key. `public_url` được lưu cho ảnh cũ và URL phát hành; binary không nằm trong DB. Một xe có tối đa một cover nhờ unique index có điều kiện; giới hạn 10 ảnh của UI do service kiểm tra.
- Không tạo accessories, traffic fine, valuation algorithm, analytics event: Phase 1 không thấy UI tương ứng hoặc nguồn dữ liệu thật. Form bán/lên đời/finance là `leads`. Không seed xe, chi nhánh, nội dung hoặc thống kê giả.

## Catalog cột

| Bảng — mục đích | Cột đặc thù (kiểu, null/default; PK/FK) | Unique/index chính |
| --- | --- | --- |
| `profiles` — hồ sơ admin | `auth_user_id uuid! UQ`, `full_name text!`, `email text?`, `phone text?`, `status text! D=active`, `deleted_at ts?` | `auth_user_id` unique |
| `roles` — vai trò | `code text!`, `name text!`, `description text?` | `code` unique |
| `permissions` — quyền resource.action | `code text!`, `description text?` | `code` unique |
| `user_roles` — gán vai trò | `profile_id uuid! FK→profiles`, `role_id uuid! FK→roles` | `(profile_id,role_id)` unique; `role_id` index; cascade delete link |
| `role_permissions` — quyền của role | `role_id uuid! FK→roles`, `permission_id uuid! FK→permissions` | `(role_id,permission_id)` unique; `permission_id` index; cascade delete link |
| `customers` — màn tài khoản khách | `auth_user_id uuid? UQ`, `name text!`, `email text!`, `phone text!`, `address text?`, `status text! D=active`, `last_login_at ts?`, `deleted_at ts?` | `auth_user_id` unique (nullable); `email` index |
| `brands` — hãng xe | `name text!`, `slug text!`, `image_url text?`, `sort_order int! D=0`, `status text! D=active` | `slug` unique |
| `body_styles` — kiểu dáng | giống `brands` | `slug` unique |
| `car_models` — dòng xe | `brand_id uuid! FK→brands`, `body_style_id uuid? FK→body_styles`, `name text!`, `slug text!`, `image_url text?`, `sort_order int! D=0`, `status text! D=active` | `(brand_id,slug)` unique; `body_style_id` index |
| `car_versions` — phiên bản | `model_id uuid! FK→car_models`, `name text!`, `slug text!`, `image_url text?`, `sort_order int! D=0`, `status text! D=active` | `(model_id,slug)` unique |
| `branch_regions` — vùng showroom | `name text!`, `slug text!`, `sort_order int! D=0`, `status text! D=active` | `slug` unique |
| `branches` — showroom/chi nhánh | `region_id uuid? FK→branch_regions`, `name text!`, `slug text!`, `address text!`, `phone text!`, `map_url text?`, `image_url text?`, `sort_order int! D=0`, `status text! D=active` | `slug` unique; `region_id` index |
| `car_colors` — màu xe | `name text!`, `slug text!`, `color_code text?`, `sort_order int! D=0`, `status text! D=active` | `slug` unique |
| `transmissions` — hộp số | `name text!`, `slug text!`, `sort_order int! D=0`, `status text! D=active` | `slug` unique |
| `filter_options` — các chip/range admin | `group text!`, `name text!`, `slug text!`, `min_value int?`, `max_value int?`, `sort_order int! D=0`, `status text! D=active` | `(group,slug)` unique |
| `cars` — xe | `legacy_id text?`, `sku text?`, `slug text!`, `name text!`, `brand_id uuid! FK→brands`, `model_id uuid! FK→car_models`, `version_id uuid? FK→car_versions`, `body_style_id uuid? FK→body_styles`, `branch_id uuid? FK→branches`, `year int!`, `price bigint!`, `original_price bigint?`, `mileage int?`, `transmission_id uuid? FK→transmissions`, `fuel text?`, `color_id uuid? FK→car_colors`, `license_plate text?`, `condition text?`, `seat_count int?`, `description text?`, `status car_status! D=inactive`, `featured bool! D=false`, `installment bool! D=false`, `new_arrival bool! D=false`, `published_at ts?`, `source_url text?`, `source_kind text?`, `deleted_at ts?` | `slug`, `legacy_id`, `sku`, `source_url` unique; `(status,created_at)`, `(brand_id,status)`, `model_id`, `version_id`, `body_style_id`, `branch_id`, `price`, `year` indexes; checks year 1886–2100, price/km ≥0, seats >0 |
| `car_media` — ảnh/video xe | `car_id uuid! FK→cars` cascade, `type car_media_type! D=image`, `storage_key text?`, `public_url text!`, `alt_text text?`, `sort_order int! D=0`, `is_cover bool! D=false`, `width int?`, `height int?`, `size_bytes bigint?`, `mime_type text?`, `deletion_pending_at timestamptz?` | `(car_id,sort_order)` index; `storage_key` unique; partial unique `car_id WHERE is_cover=true`; size ≥0; pending rows hidden until R2/DB deletion can finish |
| `car_specifications` — thông số thêm từ web cũ | `car_id uuid! FK→cars` cascade, `key text!`, `label text!`, `value text!`, `sort_order int! D=0` | `(car_id,key)` unique |
| `article_categories` — nhóm tin | `name text!`, `slug text!` | `slug` unique |
| `articles` — tin/bài viết | `legacy_id text?`, `title text!`, `slug text!`, `category_id uuid? FK→article_categories`, `excerpt text?`, `content text!`, `image_url text?`, `author_id uuid? FK→profiles`, `author_name text?`, `featured bool! D=false`, `status text! D=draft`, `published_at ts?`, `deleted_at ts?` | `slug`, `legacy_id` unique; `(status,published_at)` index |
| `pages` — trang nội dung URL ổn định | `path text!`, `title text!`, `body text?`, `status text! D=draft`, `published_at ts?`, `deleted_at ts?` | `path` unique |
| `faqs` — hỏi đáp | `question text!`, `answer text!`, `featured bool! D=false`, `sort_order int! D=0`, `status text! D=active` | `(status,sort_order)` index |
| `testimonials` — cảm nhận | `name text!`, `content text!`, `rating int!` (1–5), `avatar_url text?`, `car_bought text?`, `featured bool! D=false`, `sort_order int! D=0`, `status text! D=active` | `(status,sort_order)` index |
| `services` — dịch vụ | `title text!`, `description text!`, `image_url text?`, `icon text?`, `sort_order int! D=0`, `status text! D=active` | PK only; volume nhỏ |
| `recruitments` — tuyển dụng | `title text!`, `image_url text?`, `description text!`, `requirements text!`, `salary text?`, `location text!`, `deadline ts?`, `status text! D=active` | PK only; volume nhỏ |
| `slides` — slideshow | `title text!`, `image_url text!`, `link text?`, `sort_order int! D=0`, `status text! D=active` | `(status,sort_order)` index |
| `content_entries` — section lặp/có thứ tự | `group text!`, `key text!`, `title text!`, `body text?`, `image_url text?`, `link text?`, `phone text?`, `sort_order int! D=0`, `status text! D=active`, `updated_by uuid? FK→profiles` | `(group,key)` unique; `(group,sort_order)` index |
| `site_settings` — key/value cấu hình | `group text!`, `key text!`, `value text?`, `value_type text! D=text`, `description text?`, `updated_by uuid? FK→profiles` | `(group,key)` unique |
| `seo_metadata` — SEO theo route | `route_path text!`, `meta_title text?`, `meta_description text?`, `keywords text?`, `og_title text?`, `og_description text?`, `og_image_url text?`, `canonical_url text?`, `robots_index bool! D=true`, `robots_follow bool! D=true`, `structured_data jsonb?`, `updated_by uuid? FK→profiles` | `route_path` unique |
| `leads` — bán/lên đời/gọi lại/trả góp | `type lead_type!`, `status lead_status! D=unread`, `name text?`, `phone text!`, `email text?`, `content text?`, `car_id uuid? FK→cars` set null, `car_name text?`, `current_car text?`, `desired_car text?`, `offered_brand text?`, `offered_model text?`, `offered_version text?`, `offered_year text?`, `offered_mileage text?`, `finance_amount text?`, `finance_term text?`, `handled_by uuid? FK→profiles` | `(type,status,created_at)`, `car_id` indexes |
| `newsletter_subscribers` — đăng ký email | `email text!`, `status text! D=active`, `source text?` | `email` unique |
| `audit_logs` — truy vết admin | `actor_profile_id uuid? FK→profiles` set null, `action text!`, `entity_type text!`, `entity_id uuid?`, `old_data jsonb?`, `new_data jsonb?`, `ip_address text?`, `user_agent text?`, `request_id text?` | `(entity_type,entity_id,created_at)` và `(actor_profile_id,created_at)` indexes |

`id` là PK của **mọi** bảng, không liệt kê lặp trong catalog. Tất cả bảng có `created_at`; chỉ `permissions`, `user_roles`, `role_permissions`, `car_media`, `car_specifications`, `audit_logs` không có `updated_at`. `deleted_at` chỉ ở `profiles`, `customers`, `cars`, `articles`, `pages`. Các URL ảnh ngoài `car_media` hiện là cột URL vì UI chỉ có một ảnh cho bản ghi đó; binary vẫn ở object storage.

## ERD triển khai

```mermaid
erDiagram
  PROFILES ||--o{ USER_ROLES : assigned
  ROLES ||--o{ USER_ROLES : includes
  ROLES ||--o{ ROLE_PERMISSIONS : grants
  PERMISSIONS ||--o{ ROLE_PERMISSIONS : included
  BRANDS ||--o{ CAR_MODELS : owns
  BODY_STYLES |o--o{ CAR_MODELS : describes
  CAR_MODELS ||--o{ CAR_VERSIONS : offers
  BRANCH_REGIONS |o--o{ BRANCHES : groups
  BRANDS ||--o{ CARS : brand
  CAR_MODELS ||--o{ CARS : model
  CAR_VERSIONS |o--o{ CARS : version
  BODY_STYLES |o--o{ CARS : style
  BRANCHES |o--o{ CARS : located_at
  CAR_COLORS |o--o{ CARS : color
  TRANSMISSIONS |o--o{ CARS : transmission
  CARS ||--o{ CAR_MEDIA : has
  CARS ||--o{ CAR_SPECIFICATIONS : has
  CARS |o--o{ LEADS : interested_in
  ARTICLE_CATEGORIES |o--o{ ARTICLES : contains
  PROFILES |o--o{ ARTICLES : writes
  PROFILES |o--o{ CONTENT_ENTRIES : updates
  PROFILES |o--o{ SITE_SETTINGS : updates
  PROFILES |o--o{ SEO_METADATA : updates
  PROFILES |o--o{ LEADS : handles
  PROFILES |o--o{ AUDIT_LOGS : acts
```

`customers`, `filter_options`, `pages`, `faqs`, `testimonials`, `services`, `recruitments`, `slides`, `newsletter_subscribers` hiện độc lập theo nhu cầu UI; SEO nối với chúng qua `route_path` logic để URL và slug ổn định. `audit_logs.entity_id` là tham chiếu đa loại, không thể có FK đơn. Các bảng độc lập vẫn có PK, timestamp và quy tắc duy nhất/hiển thị tương ứng.

## Seed và triển khai

`src/database/seed/roles-permissions.ts` tạo 6 vai trò (`SUPER_ADMIN`, `ADMIN`, `CONTENT_EDITOR`, `INVENTORY_MANAGER`, `SALES`, `SEO_MANAGER`) và permission `resource.action`. Seed dùng `onConflictDoNothing` trên khóa code/cặp nên chạy lại an toàn, không tự cấp role cho bất kỳ user nào. Việc gán Super Admin đầu tiên cần một thao tác bootstrap có kiểm soát ở Phase 4.

Chạy trong `api-xeluottoantrung`: `npm ci`, đặt `DATABASE_URL` ở `.env`, `npm run db:generate` khi đổi schema, `npm run db:check`, `npm run db:migrate`, `npm run db:seed`. Migration ban đầu và seed đã được chạy trên Supabase PostgreSQL trong Phase 3. Với database mới, chạy lại migrate và seed theo thứ tự trên; không tạo bảng thủ công trong Supabase Dashboard. Tham khảo [Drizzle Kit generate](https://orm.drizzle.team/docs/drizzle-kit-generate) và [PostgreSQL setup](https://orm.drizzle.team/docs/get-started/appwrite-postgres-existing) cho quy trình schema → migration → migrate.
