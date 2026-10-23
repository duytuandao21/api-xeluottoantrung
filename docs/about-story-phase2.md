# About Story API — Phase 2

Chỉ backend/schema/API. Web `/ve-chung-toi` và Admin `/quan-ly/gioi-thieu` vẫn dùng luồng cũ cho đến các phase sau. Không có migration hoặc seed nào đã chạy trên production.

## Dữ liệu và trạng thái

Migration `drizzle/0022_about_story.sql` thêm `about_story_pages`, `about_story_sections`, `about_milestones`, `about_customer_stories`, `about_story_assets`; không sửa/drop bảng hiện hữu. `about_story_pages` giữ revision bản nháp và JSON snapshot đã xuất bản. Admin sửa bản nháp không tác động snapshot. Khi rút xác minh mốc, thu hồi consent story hoặc quyền ảnh đang public, API tự gỡ snapshot ngay trong transaction; public trả 404. `audit_logs` giữ các thao tác.

Seed `db:seed-about-story` thêm 5 chapter cố định và 12 mốc từ tài liệu nội bộ, idempotent theo slug. Tất cả mốc `draft/needs_review`, chưa có ảnh và **không có bản public**. Cần đối chiếu chứng cứ trước khi chuyển `verified/published`. Trang public Web cũ vẫn đọc `content_entries` nên không bị thay đổi do seed này.

## Hợp đồng API (prefix `/api/v1`)

| Method/path | Quyền | Nội dung |
| --- | --- | --- |
| `GET /about-story` | Public | Snapshot đã xuất bản; 404 nếu chưa có. Header `no-store`. Không chứa source note, consent reference, storage key, nháp. |
| `GET /admin/about-story` | `content.read` | Draft: revision, 5 chapter, milestones, stories, assets và publishedRevision. Private no-store. |
| `PATCH /admin/about-story/sections/:key` | `content.update` | Sửa chapter; key chỉ nhận 5 chương. |
| `POST /admin/about-story/milestones`, `PATCH/DELETE /admin/about-story/milestones/:id` | `content.create/update/delete` | CRUD mốc, ngày ISO chỉ khi biết ngày chính xác; published cần verified + sourceNote. |
| `POST /admin/about-story/stories`, `PATCH/DELETE /admin/about-story/stories/:id` | `content.create/update/delete` | CRUD story; published cần consent granted + consentReference. |
| `POST /admin/about-story/assets`, `PATCH/DELETE /admin/about-story/assets/:id` | `content.create/update/delete` | Đăng ký ảnh R2 đã upload qua presign asset hiện có, xác minh HeadObject/MIME/size; alt, dimensions, rights, placement. Ảnh đang dùng ở snapshot không được xóa. |
| `PATCH /admin/about-story/order` | `content.update` | Danh sách đủ mọi UUID của nhóm `milestone`, `story` hoặc `asset`; không đổi thứ tự 5 chapter. |
| `POST /admin/about-story/publish`, `POST /admin/about-story/unpublish` | `content.publish` | Publish transaction; kiểm tra 5 chapter, ảnh hero đã duyệt, ít nhất một mốc verified, consent và ảnh story. |

Mọi body ghi có `expectedRevision` từ GET admin; sai revision trả 409 và không ghi đè đồng nghiệp. Ví dụ rút xác minh một mốc (cần đầy đủ field theo DTO):

```json
{"slug":"1997-khoi-nguon","periodLabel":"1997","stage":"1997-2017","title":"Khởi nguồn hành trình","summary":"Bắt đầu kinh doanh xe máy tại Gia Lai.","featured":true,"sortOrder":0,"verificationStatus":"needs_review","publishStatus":"draft","expectedRevision":2}
```

Ví dụ public sau khi được duyệt/publish:

```json
{"chapters":[{"key":"opening","title":"Hành trình tạo dựng niềm tin","images":[{"url":"https://cdn.example/...jpg","width":1200,"height":800,"alt":"Showroom","placement":"desktop"}]}],"milestones":[{"slug":"1997-khoi-nguon","periodLabel":"1997","stage":"1997-2017","title":"Khởi nguồn hành trình","images":[]}],"stories":[],"publishedAt":"...","revision":2}
```

Ví dụ rút gọn minh họa shape; response thật có đúng 5 chapter và thêm các trường subtitle/body/CTA. `sourceNote`/`consentReference` chỉ ở admin. Body/quote/title chỉ nhận plain text, không HTML; Web Phase 4 render qua React text nodes. CTA chỉ URL nội bộ.

## Upload và cleanup

1. Admin gọi `POST /api/v1/admin/media/assets/presign` với MIME và bytes, PUT trực tiếp ảnh JPEG/PNG/WebP/AVIF lên URL có chữ ký như luồng hiện tại.
2. Admin tính width/height theo orientation của ảnh trước khi đăng ký; gọi `POST /admin/about-story/assets` với `storageKey`, owner, placement, alt, dimensions và `rightsStatus`. API xác nhận object tồn tại, MIME, size và suy public URL từ storage key; không tin URL tự gửi.
3. Asset mặc định `needs_review`. Chỉ `verified` mới vào snapshot. Thay/xóa asset đang public phải publish nội dung thay thế hoặc unpublish trước. Xóa bản draft đưa URL vào cleanup outbox; cleanup kiểm tra cả bảng asset và published snapshot trước khi xóa object R2.

API hiện không tự đọc orientation/bitmap từ bytes R2, chỉ xác nhận HeadObject/MIME/size; Phase 3 Admin phải dùng hàm đọc dimensions như upload ảnh xe và test EXIF. Object PUT xong nhưng chưa đăng ký có thể thành orphan; cần quy trình dọn orphan riêng nếu thực tế phát sinh, không quét/xóa bucket trong Phase 2.

## Migration local/staging và production sau này

Review `drizzle/0022_about_story.sql` và snapshot; giữ backup DB trước khi triển khai bất kỳ môi trường có dữ liệu. Trên local/staging với `DATABASE_URL` đúng môi trường:

```powershell
npm.cmd run db:check
npm.cmd run db:migrate
npm.cmd run db:seed-about-story
```

Không chạy các lệnh này với production `.env` trong nhiệm vụ hiện tại. Khi triển khai sau này: backup/restore test, migration staging, triển khai API, chạy seed draft, xác nhận public 404 và Web cũ còn chạy, rồi mới Admin/Web phase sau. Rollback an toàn là lùi API/Web code và giữ bảng mới; chỉ drop bảng qua migration đảo sau backup và khi không còn dữ liệu cần giữ. Không reset database. Không thêm biến môi trường mới; dùng `DATABASE_URL` và cấu hình R2 hiện có.

## Kiểm thử và giới hạn

Kiểm thử liên quan kiểm tra migration PGlite, public 404 trước publish, chặn xuất bản thiếu ảnh/xác minh, không lộ source note/consent record, optimistic revision, rút xác minh/consent/quyền ảnh làm public 404, thứ tự mốc, MIME upload và HTTP RBAC 401/403. Chưa thử UI Admin/Web vì hai phase đó chưa triển khai. Chưa chạy migration, seed hoặc upload production. Preview bản nháp qua Web chưa có; Phase 3–4 phải thiết kế vé/cookie riêng như tài liệu kiến trúc, không thêm `preview=true` vào GET public.

Đã chạy trên local: `npm.cmd run build` PASS, `npm.cmd run lint` PASS, `npm.cmd run db:check` PASS, `npx.cmd tsc -p tsconfig.test.json` PASS, `npx.cmd tsx --test test/about-story.test.ts` PASS (3 ca). Chưa chạy toàn bộ suite vì các module khác không thay đổi; chưa chạy migration/seed với database thật.
