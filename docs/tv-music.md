# Nhạc nền TV — vận hành và kiểm thử

## Phạm vi

Web `/TV` phát nhạc từ URL R2/CDN; Admin `/tv-display` quản lý playlist. Không thêm dependency, biến môi trường, bảng hoặc migration. Cấu hình cũ mặc định tắt nhạc, âm lượng 30%, playlist rỗng. Nhạc độc lập với theme thường/kỷ niệm và các bộ đếm trang xe.

## Giới hạn cứng

- Tối đa **10 file**, tổng **1.000.000.000 byte = 1 GB**, không dùng đơn vị GiB.
- Bao gồm file đã lưu, file đang upload/chờ lưu và file chờ xóa chưa được R2 xác nhận xóa thành công.
- Hai điều kiện được kiểm tra độc lập ở API; không chỉ khóa nút trên UI. Không cấp chỗ mới nếu vượt số file hoặc byte, kể cả khi có nhiều phiên Admin.
- Chỉ MP3; tên tối đa 120 ký tự. Một file cũng không được lớn hơn 1 GB.
- Không upload file thật cỡ 1 GB trong test: kiểm ranh giới bằng metadata giả, kiểm byte stream thực bằng fixture vài byte.
- Đây là quota cho file do tính năng nhạc TV quản lý, không phải giới hạn cả bucket chứa ảnh xe. File được upload thủ công ngoài tính năng không tự động được tiếp nhận/xóa.

## Cách dùng

1. Trong Admin → TV Display → Nhạc nền trình chiếu, thêm MP3, đặt tên, sắp xếp, bật nhạc và chỉnh âm lượng.
2. Nhấn **Lưu thay đổi** để công khai bài vừa tải và các thiết lập. File chưa lưu sẽ tự dọn sau khoảng 20 phút, cộng chu kỳ cleanup và thời gian retry nếu storage lỗi.
3. **Xóa bài đã lưu có hiệu lực ngay**, không đợi nút Lưu. Có xác nhận trước thao tác. File được đưa vào cleanup sau transaction cập nhật cấu hình.
4. **Thay bài xóa/dọn bài cũ trước rồi mới upload bài mới**, giữ vị trí bài trong playlist. Điều này tránh tạm vượt 10 file/1 GB. Nếu upload mới thất bại, bài cũ không tự khôi phục; chọn lại file mới. UI giải thích trước khi xác nhận.
5. Dung lượng “Kho R2 đang giữ” có thể lớn hơn playlist đang soạn do file tạm/chờ xóa. Không nới quota khi R2 lỗi; có thể làm mới số liệu và chờ retry.
6. TV nhận cấu hình theo chu kỳ snapshot hiện tại, khoảng 5 phút và lần chuyển trang kế tiếp. Không phải điều khiển âm thanh tức thời từ Admin.
7. Nếu trình duyệt chặn autoplay, TV hiện một nút nổi “Chạm để bật nhạc”; thao tác một lần sẽ thử phát. Không có controls/tên bài/thanh tiến trình thường trực. Sau reload có thể phải chạm lại.

Thay đổi chưa lưu trong các phần logo/hotline/sự kiện vẫn được giữ trong form khi xóa một bài; riêng việc xóa bài đã được ghi ngay ở server. Revision playlist chặn lưu đè từ form cũ hoặc phiên Admin khác.

## Luồng lưu trữ và tải hệ thống

### Upload

Giới hạn byte thực nhận đòi hỏi thêm một luồng **stream qua API chỉ dành cho upload nhạc**. Không cấp URL PUT R2 cho browser vì giới hạn dung lượng khai báo không đủ làm bằng chứng ràng buộc actual bytes tại provider. Không dùng bộ đệm chứa cả file hoặc multipart SDK upload để tránh phần upload dở chiếm R2 không được quản lý.

1. `POST /api/v1/admin/tv-music/uploads` với tên và sizeBytes: đặt chỗ quota bằng row lock chuyên biệt, ghi reservation/audit và intent dọn orphan bền vững.
2. `PUT /api/v1/admin/tv-music/uploads/:id`, `Content-Type: audio/mpeg`: đọc stream với số byte thực chính xác bằng dung lượng đã đặt chỗ, kiểm prefix MP3, gửi một PUT có ContentLength tới R2. Có deadline 10 phút. Content-Length của request nếu có phải khớp; thiếu header vẫn bị bộ đếm stream ràng buộc.
3. HEAD object xác nhận MIME/size, trả track id/name/url/sizeBytes. Ticket chỉ dùng một lần, không upload đè/replay được. Transport từ chối MIME khác trước khi JSON parser có thể dùng trần body lớn; chỉ đúng PUT nhạc có giới hạn stream 1 GB, DELETE và các route khác giữ giới hạn cũ.
4. PUT cấu hình TV qua endpoint hiện tại: kiểm URL thuộc đúng R2 hệ thống, trạng thái upload, dung lượng và revision, xác minh HEAD khi nhạc thay đổi rồi lưu JSON atomically.

API dùng lại `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`. R2 key là `tv/music/<UUID>.mp3`, tên object bất biến và không chứa tên bài do người dùng nhập. Audio stream dùng S3 client riêng, tạo lười; cấu hình signer ảnh/video cũ được giữ nguyên.

Upload hiếm khi Admin thêm/thay bài có sử dụng băng thông/CPU VPS. **Phát nhạc không đi qua API/VPS**. Không cam kết không tăng tải trong lúc upload. Long staging PUT không mở mutation window của public response cache; lưu/xóa playlist vẫn invalidation như bình thường.

### Phát

Playlist được thêm vào snapshot hiện có; không thêm polling/SQL theo bài và không HEAD R2 khi TV đọc dữ liệu. Một audio element tồn tại xuyên suốt. Nhạc chỉ bắt đầu khi xe sẵn sàng và có xe; đổi dữ liệu xe, đổi tên bài, volume, chuyển hãng và slide tri ân không gán lại source của bài còn tồn tại. Hết bài chuyển bài tiếp, cuối danh sách lặp lại. Trang ẩn thì pause, hiện lại thử resume; bị chặn thì chờ thao tác, không polling autoplay.

Lỗi một bài thì bỏ qua; lỗi toàn playlist chờ 30 giây trước lượt thử mới. Không reload hay dừng trình chiếu xe. Không tải sẵn cả playlist, không Web Audio visualizer hoặc timer cập nhật React mỗi giây. Không bảo đảm offline khi hết buffer/cache.

## Xóa R2 và phục hồi lỗi

- Dùng audit journal và deletion outbox hiện có; không migration. Reservation/audit là metadata nghiệp vụ, không phải bản sao MP3 và không bị xóa để giả vờ giải phóng quota.
- Bỏ/thay URL đã lưu tạo intent trong cùng transaction với cập nhật cấu hình. Cancel upload cũng tạo intent; đóng tab/mất kết nối/failed save có intent orphan đã được tạo từ lúc đặt chỗ.
- Cleanup chạy sau mutation và mỗi 60 giây. Chỉ giải phóng quota **sau khi delete R2 thành công**; lỗi được giữ để retry, không lặng lẽ quên file.
- Không xóa audio đang được PUT; chờ uploaded/failed hoặc hết hạn reservation nếu process chết. Không xóa file còn tham chiếu ở dữ liệu đang sử dụng. Trình phát có thể đang giữ buffer của bài cũ trong thời gian chờ snapshot mới.
- Publication, quota và xóa audio dùng cùng một row lock, tránh publish lại đúng lúc cleanup xóa. Quota không phụ thuộc RAM của một Node process. Những admin writer của nhạc TV đều đi qua khóa này.
- Intent nhạc đến hạn được ưu tiên để không mắc kẹt sau các lỗi ảnh cũ; không dùng một vòng lặp xóa vô hạn trong request.
- Xóa object R2 không đồng nghĩa purge bản sao đã cache tại CDN/browser; không thêm Cloudflare purge API. Dung lượng origin đã được giải phóng, URL cũ có thể còn được cache phục vụ trong TTL.

## Hạ tầng trước khi đưa vào sử dụng

Chưa kết nối/sửa R2, Nginx, Cloudflare hoặc production trong nhiệm vụ này.

- Cần custom domain/public URL đúng cho audio; URL không qua pipeline Cloudflare Image Resizing.
- Kiểm tra `audio/mpeg`, Content-Length, hỗ trợ Range, cache headers, cache rule hiệu lực và document policy/media-src nếu có. Player cơ bản không dùng Web Audio/fetch blob hoặc thuộc tính crossorigin; không tự thêm yêu cầu CORS GET không cần thiết.
- Upload nhạc mới đi qua API, nên **Nginx/Cloudflare/request timeout có thể chặn file nhỏ hơn quota 1 GB**. Quota là trần, không bảo đảm hạ tầng hiện tại nhận được một request 1 GB. Owner cần đối chiếu giới hạn request/body/time của gói Cloudflare, Nginx và đường truy cập API. Không tự thay cấu hình này.
- Nếu cần file lớn hơn giới hạn ingress thực tế, cần phương án upload chia phần có quota/cleanup tương ứng ở nhiệm vụ tiếp theo; không tự nới quyền upload ảnh/video để né kiểm tra.
- Không dùng khóa R2 ở browser; API yêu cầu JWT/profile active và `content.update` cho mọi mutation; usage yêu cầu `content.read`.

## Kiểm thử tái chạy với dữ liệu giả

API, không đọc .env hay kết nối DB thật; PGlite in-memory và StorageService giả:

```text
node node_modules/typescript/bin/tsc -p tsconfig.test.json
node --test --test-concurrency=1 .test-dist/test/tv-music.test.js .test-dist/test/tv-display.test.js .test-dist/test/media.test.js .test-dist/test/storage-cleanup.test.js .test-dist/test/public-cache.test.js
```

Web engine, không network/browser:

```text
node --test scripts/tv-music.test.cjs
```

Build Admin để chạy fixture: đặt trong **tiến trình build** `NEXT_PUBLIC_API_URL=http://127.0.0.1:4019`, `NEXT_PUBLIC_SUPABASE_URL=https://tv-fixture.supabase.co`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy-test-key`, `NEXT_TELEMETRY_DISABLED=1`; không sửa .env. Sau khi compile test API ở trên, chạy trong Admin:

```text
node scripts/tv-music-admin-check.mjs
```

Browser test dùng production Admin, controller/guard/service thật, PGlite/R2 giả, JWT/session giả và Chrome cài sẵn. API request được bridge bằng Playwright tới inject, không gửi token giả lên Supabase. Chặn các domain ngoài. Kiểm upload/save/replace/delete/reorder, quota 10 bài, xóa object thật trong storage substitute và layout 1440/768/390/320px. Ảnh ở `.test-dist/tv-music-admin-ui` của API, không đưa vào source commit.

Build Web với `API_URL` và `NEXT_PUBLIC_API_URL` trỏ `http://127.0.0.1:4019`, cùng public Supabase dummy như trên. Chạy trong Web:

```text
node scripts/tv-music-browser-check.mjs
```

Fixture mở mock API loopback 4019 và Web 3006. Kiểm 6 xe/trang, lời nhắc autoplay không resize vùng xe, cùng một nguồn nhạc xuyên slide tri ân/chuyển xe, không thêm backend request. **Media methods được mô phỏng**, không phải phép kiểm giải mã MP3/loa/thiết bị TV thật. Ảnh ở `web-xeluottoantrung/artifacts/tv-music` (đã gitignore).

**Các artifact build dùng cấu hình dummy chỉ phục vụ kiểm thử. Phải build lại bằng cấu hình triển khai đúng trước khi start/deploy thật.** Các script chỉ nên chạy khi các cổng fixture chưa có dịch vụ; không trỏ sang hệ thống dùng chung.

## Gate bàn giao

Kết quả local ngày 28/10/2026:

| Gate đã chạy | Kết quả |
|---|---|
| Production build API (`tsc -p tsconfig.build.json`) | PASS trên mã cuối cùng. |
| Production build Admin | PASS, 72/72 trang. |
| Production build Web | PASS, 15/15 trang; các warning ảnh/useEffect có sẵn ngoài TV vẫn còn. |
| Typecheck ba repository | PASS; build/test compilation tiếp tục kiểm kiểu các thay đổi sau đó. |
| ESLint các file API/Admin/Web liên quan | PASS. |
| API: TV music + TV settings/anniversary + media + cleanup ảnh + public cache | 18/18 test PASS; sau khi siết MIME transport, chạy lại riêng 4/4 test TV music và build API, đều PASS. |
| Engine nhạc Web/contract ba repo | 5/5 test PASS. |
| Browser production Admin với controller/guard/service thật và storage/DB giả | PASS: upload/lưu/thay/xóa/sắp xếp, chặn thêm khi đủ 10 bài, xóa object cũ; không tràn vùng nhạc ở 1440/768/390/320px. |
| Browser production TV với mock API và media methods mô phỏng | PASS: 6 xe/trang, một audio không controls, prompt không resize stage, qua slide tri ân và chuyển xe không reset nguồn/play hoặc thêm backend request. |
| `git diff --check` ba repo | PASS; chỉ có thông báo chuẩn hóa LF/CRLF. |

Các nhánh đã kiểm: đúng 10 và vượt 10; đúng 1 GB và vượt byte dù dưới 10 bài; cạnh tranh 11 lượt đặt chỗ; stream thực dư/thiếu byte và sai prefix; metadata sai; replay, ticket khác owner, revision cũ; 401/403/415; R2 delete lỗi giữ quota rồi retry; orphan chưa lưu bị dọn; orphan intent không xóa bài đã publish; hủy khi PUT đang chạy chưa giải phóng quota cho đến khi stream kết thúc; loopback HTTP thật với payload dummy; nhạc không bị reset sau 500 cập nhật cấu hình tương đương.

Chưa soak test nhiều giờ, chưa upload MP3 vào R2 thật, chưa kiểm chứng giới hạn ingress production hoặc nghe thử trên thiết bị TV thật. Kiểm thử cạnh tranh dùng PGlite với transaction tuần tự; khóa hàng trên PostgreSQL nhiều process được đối chiếu ở mã nguồn, chưa stress môi trường dùng chung. Không commit/push/deploy hoặc chạy migration.
