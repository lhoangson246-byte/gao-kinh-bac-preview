# Cập nhật Vercel — 14/09/2026

## Trạng thái

Bản đo trước: commit `beca4ca`, URL `https://gao-kinh-bac-preview.vercel.app` (đây là domain Production dù tên chứa preview). Báo cáo đang được bổ sung kết quả sau triển khai; số liệu local không được coi là số liệu Production.

## Số đo đã ghi nhận

| Hạng mục | Trước | Sau local |
| --- | ---: | ---: |
| JS trang khách, raw / gzip | 314,16 / 89,95 KB | 237,12 / 73,65 KB |
| JS Admin riêng, raw / gzip | Gộp vào main | 47,47 / 12,18 KB |
| JS POS riêng, raw / gzip | Gộp vào main | 36,81 / 8,88 KB |
| CSS, raw / gzip | 61,98 / 12,44 KB | 62,18 / 12,47 KB |
| Boot libSQL đã migrate: execute / prepare | 32 / 25 | 2 / 3 |
| Boot file libSQL, không admin, cùng máy | 701 ms | 380 ms |
| Băm dummy khi import | 1 lần, đo riêng 329 ms | 0 lần |

Các chunk bản build cuối trước push: `index-BAEMNCV2.js`, `Admin-DBtop8Cc.js`, `Retail-DyoYhJLs.js`, `index-CNz0TE09.css`. Bcrypt so sánh mật khẩu admin mặc định vẫn được giữ; fixture production có admin đo 686 ms, 1 compare và 0 lần tạo hash riêng. Không so trực tiếp thời gian fixture khác nhau để kết luận cải thiện.

24 JPEG: 3.781.943 byte; 24 WebP 480: 863.874 byte; 24 WebP lớn: 2.463.668 byte. Biến thể lớn giữ 900 px gốc, manifest khai báo đúng 900w dù tên đích là 960. Trình duyệt chọn một biến thể, không tải tất cả cả hai cỡ.

| Lighthouse mobile trước cập nhật | Performance | LCP ms | CLS | TBT ms | Transfer byte |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/` | 89 | 2336,243 | 0,182260 | 87 | 224419 |
| `/gio-hang` | 95 | 2404,342 | 0 | 18 | 271725 |

Lighthouse CLI cấu hình mobile mặc định, chỉ category performance, Chrome headless; một lượt mỗi trang, có biến thiên mạng. Chưa dùng điểm local để thay cho điểm live sau deploy.

Trước deploy, ngày 14/09 20:05 giờ Việt Nam: health lần đầu HTTP 200/21.920 ms, lần kế 469 ms; products 200/954 ms rồi 787 ms. Đều CDN MISS/no-store, function iad1. Log Vercel của health đầu: execution 10,86 giây, response finished 21,6 giây, sau khoảng 10 phút không có log trong timeline. Đây là phép đo first-after-idle, không có nhãn cold-start để khẳng định mọi độ trễ đều do boot.

## Kiểm thử

| Bộ | Pass | Fail |
| --- | ---: | ---: |
| smoke | 82 | 0 |
| retail | 107 | 0 |
| manage (Excel, xoá, phân trang) | 141 | 0 |
| security | 64 | 0 |
| isolated (smoke + retail + manage, DB mới từng bộ) | 330 | 0 |
| database-config | 7 | 0 |
| performance | 5 | 0 |

Ba bộ API cũng chạy riêng với server khởi động lại từng bộ. Các fixture không dùng DB thật, xoá thư mục tạm có kiểm tra phạm vi. Kiểm tra libSQL file cho ba bộ API cũng đạt 82/107/141. Performance kiểm 105 đơn thử với cỡ trang 1/30/100 luôn đúng 3 SELECT, chưa tính BEGIN/COMMIT của transaction. Audit npm backend/frontend: 0 lỗ hổng được báo. Build production thành công.

## Thay đổi theo tệp

- `backend/src/security.js`: mặc định tin 1 proxy trên Vercel, Origin so host và giữ allow-list/CSRF.
- `backend/src/database-config.js`, `.env.example`: remote DB bắt buộc trên Vercel, Preview riêng/fail-closed; giữ alias LIBSQL.
- `backend/src/database.js`: dynamic import driver, bật FK; SQLite local dùng WAL.
- `backend/src/db.js`, `schema-version.js`: đọc schema và admin hashes một SELECT, từ chối schema cũ.
- `backend/src/migrate.js`, `migrate-cli.js`: giữ thứ tự/schema/backfill cũ, chạy có phiên bản trong bước Production deploy.
- `backend/src/admin-security.js`: dùng hashes đọc sẵn, giữ chặn admin mật khẩu mặc định.
- `backend/src/routes/auth.js`: hằng dummy bcrypt cost 12, giữ compare khi không có tài khoản.
- `backend/src/order-lists.js`: gom items một query, phân trang và counts, snapshot transaction.
- `backend/src/routes/admin.js`: phân trang 30 mặc định, xoá hẳn sản phẩm trong transaction, route Excel và resolvePeriod dùng chung.
- `backend/src/routes/customers.js`: xoá khách/địa chỉ cùng transaction chỉ khi không có đơn; không xoá admin, không xoá điểm quầy.
- `backend/src/routes/orders.js`: batch items, danh sách cột public không lộ giá nhập.
- `backend/src/routes/retail.js`: batch items trên tra cứu khách và trang hoá đơn, snapshot trang hoá đơn.
- `backend/src/routes/products.js`, `images.js`: cache cạnh CDN chỉ dữ liệu công khai/ảnh bất biến.
- `backend/src/orders-export.js`: ExcelJS tải khi cần, ba sheet, ngày Việt Nam, numeric money, row/day/byte guards và đọc cùng snapshot.
- `backend/src/schemas.js`: đăng ký đường dẫn xoá, tham số phân trang/Excel.
- `backend/src/seed.js`: ghi weight_kg ngay khi seed; trước đây phụ thuộc backfill ở boot kế tiếp.
- `backend/package.json`, lock: ExcelJS và migrate script, override uuid trong ExcelJS để audit sạch.
- `backend/test/security.mjs`, `manage.mjs`, `database-config.mjs`, `fixture.mjs`: hồi quy ghi Vercel, bảo mật, Excel đọc ngược, xoá, phân trang, tách DB thử.
- `backend/test/boot-probe.mjs`, `performance.mjs`, `local-preview.mjs`: đếm boot/bcrypt/query, fixture giao diện riêng.
- `frontend/src/App.jsx`: lazy Admin/POS, luồng khách vẫn eager.
- `frontend/src/api.js`: tham số phân trang, API xoá và tải blob Excel qua cookie/CSRF, revoke URL.
- `frontend/src/components/OrdersExportButton.jsx`: busy/error tiếng Việt; `RevenueReport.jsx`: nút theo bộ lọc.
- `frontend/src/components/CustomerManager.jsx`: nút xoá đỏ, vô hiệu khi có đơn.
- `frontend/src/pages/Admin.jsx`: xoá sản phẩm có xác nhận, xuất hôm nay, trang 30 đơn/counters và chống phản hồi trang cũ.
- `frontend/src/components/ProductImage.jsx`, `product-images.json`: picture srcset theo chiều rộng thật, dimensions/eager/priority.
- `frontend/src/pages/Home.jsx`, `Retail.jsx`, `components/ImagePicker.jsx`: dùng ảnh responsive/khai kích thước.
- `frontend/scripts/optimize-images.mjs`, package/lock, 48 WebP trong public/products: tạo ảnh một lần bằng sharp, không thêm vào deploy.
- `frontend/public/sw.js`: v5, assets hash cache-first, static SWR thật; API chỉ ngoại lệ ảnh immutable.
- `frontend/src/styles.css`: nút xoá; sửa lỗi quản trị mobile đo được 658 px tràn trên viewport 390 px, sau sửa 390/390.
- `vercel.json`: Production-gated migration trước build, không bỏ security headers.
- `README.md`, `BAN_GIAO.md`: hướng dẫn migration, Preview, cache, Excel và xoá.

## Phát hiện khác và giới hạn

- Thực tế Vite 8.2.2/React Router 7.18.3, không phải Vite 5/Router 6 trong brief.
- Các index được gợi ý đã có. EXPLAIN dùng idx_orders_user/status, idx_items_order, idx_retail_items_inv, idx_retail_inv_created. Không thêm index trùng. Các lọc ngày dùng localDate giữ đúng nghiệp vụ; không đổi thành raw UTC để lấy tốc độ.
- Live có 69 sản phẩm ở baseline; không ép thành 29 bằng seed/xoá vì đó là dữ liệu thật hiện tại.
- Cấu hình Vercel xác nhận Fluid Compute Enabled, Hobby 1vCPU/2GB, function iad1. Giữ nguyên gói và Fluid. Production branch trước là master dù bản promoted đang chạy từ vercel-persistent; đã sửa branch tracking sang vercel-persistent để đúng yêu cầu triển khai.
- Biến hiện có: LIBSQL_URL, LIBSQL_AUTH_TOKEN, JWT_SECRET, NODE_ENV, TRUST_PROXY; không có VITE_API_URL. Không in token/secret. Preview hiện chưa có DB riêng: không triển khai Preview có quyền ghi Production.
- Chưa di chuyển database/vùng: cần chủ cửa hàng duyệt xuất DB hiện tại, tạo/nhập DB Singapore, đối chiếu số lượng/tổng/FK, chuyển biến Production trong cửa sổ dừng ghi, deploy sin1, kiểm tra và giữ DB cũ để rollback. Không thực hiện khi chưa duyệt.
- Vercel Blob và Speed Insights chỉ đề xuất; chưa cài thêm dịch vụ/script, chưa thay đổi phí.
- Không tự tạo số điện thoại/địa chỉ cửa hàng/tài khoản ngân hàng. Các chỗ chưa được chủ cửa hàng xác nhận vẫn giữ nguyên.
