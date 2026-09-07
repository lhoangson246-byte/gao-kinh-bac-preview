# Bàn giao — Gạo Kinh Bắc

## Hướng sản phẩm

Đây là **ứng dụng web cài được (PWA)** cho khách mua gạo bán lẻ, không phải website giới thiệu. Phạm vi giao hàng được cố định là tỉnh Bắc Ninh. Ứng dụng khách và trang quản trị dùng chung API nhưng có giao diện và quyền truy cập riêng.

## Đã hoàn thiện

### Giao diện và trải nghiệm

- Giao diện khách hàng theo kiểu ứng dụng, màn hình đầu tiên là danh sách gạo
- Thanh điều hướng ứng dụng riêng ở đáy màn hình điện thoại
- PWA: manifest hợp lệ, service worker, biểu tượng PNG 192/512 + maskable, nút cài ứng dụng
- Giao diện responsive trên điện thoại và máy tính, đầy đủ trạng thái loading / rỗng / lỗi / thành công
- Đổi tiêu đề tab theo từng trang, có liên kết "bỏ qua phần điều hướng" cho bàn phím
- Giữ nguyên bảng màu xanh lá đậm, vàng lúa và nền kem

### Luồng mua hàng

- Tìm kiếm, lọc nhanh theo nhóm gạo và lọc "chỉ hàng còn"
- Hết hàng thì không thêm được vào giỏ; giỏ hàng tự đồng bộ giá và tồn kho mới nhất
- Địa chỉ được tách khỏi đăng ký thành **sổ địa chỉ**: mỗi tài khoản lưu tối đa 10 địa chỉ,
  chọn địa chỉ ở checkout, đặt mặc định, sửa và xoá; dữ liệu địa chỉ cũ tự chuyển sang mục mặc định
- Phí giao hàng: miễn phí, giao hoả tốc trong ngày; khách chọn khung giờ sáng hoặc chiều
- Checkout cố định khu vực Bắc Ninh, kiểm tra ở cả trình duyệt và máy chủ
- Chuyển khoản chỉ báo "cửa hàng gửi thông tin sau khi xác nhận đơn", không tạo số tài khoản giả
- Khách huỷ được đơn `pending`; số lượng được trả lại kho

### Quản trị

- Trang `/quan-tri` tách riêng, có bộ lọc đơn và nút thao tác theo từng bước
- Số điện thoại khách bấm gọi được trên điện thoại
- Xác nhận trước khi huỷ đơn hoặc ẩn sản phẩm
- Doanh thu chỉ tính đơn `completed`; thống kê cảnh báo loại gạo sắp hết

### Bảo mật và tính đúng đắn (đợt sửa gần nhất)

| Vấn đề đã xử lý | Cách xử lý |
|---|---|
| Bán vượt tồn kho khi hai người đặt cùng lúc | Đưa toàn bộ việc đọc giá, kiểm tra kho, tạo đơn và trừ kho vào **một transaction**; câu lệnh trừ kho có điều kiện `stock >= ?`, không đủ hàng thì huỷ cả transaction |
| Hoàn kho hai lần cho cùng một đơn | Đổi trạng thái bằng `UPDATE … WHERE id = ? AND status = ?` bên trong transaction — chỉ request đầu tiên đổi được trạng thái mới hoàn kho |
| Giỏ hàng gửi trùng `product_id` để vượt kho | Gộp các dòng trùng trước khi kiểm tra tồn kho |
| Địa chỉ ngoài Bắc Ninh vẫn qua được | Máy chủ kiểm tra cả `delivery_area` lẫn nội dung địa chỉ (danh sách tỉnh khác trong `constants.js`) |
| Giá / tổng tiền gửi từ trình duyệt | Máy chủ luôn tự đọc giá hiện tại và tự tính tổng tiền |
| Giá và tồn kho không hợp lệ (`NaN`, số âm) | Thêm `validate.js`, kiểm tra ở cả frontend và backend; URL ảnh chỉ nhận `http(s)` hoặc đường dẫn nội bộ bắt đầu bằng `/`, chặn `javascript:` và `//tên-miền-khác` |
| `JWT_SECRET` có giá trị mặc định | Khi `NODE_ENV=production` mà thiếu `JWT_SECRET`, API từ chối khởi động |
| Giới hạn tần suất khoá nhầm người dùng | Tách limiter: chặt cho đăng nhập/đăng ký, rộng cho phần còn lại, riêng cho việc tạo đơn |
| Sửa sản phẩm làm mất mô tả cũ | `PUT /admin/products/:id` chỉ cập nhật đúng những trường được gửi lên |
| Không xoá được SĐT / địa chỉ mặc định | `PUT /auth/me` phân biệt "không gửi" và "gửi chuỗi rỗng" |
| Ký tự `%` trong ô tìm kiếm bị hiểu là ký tự đại diện | Escape `%` và `_` trong câu `LIKE` |
| SĐT và địa chỉ admin bịa trong seed | Bỏ hẳn, để trống cho chủ cửa hàng tự điền |
| Service worker có thể trả về rỗng khi offline | Có trang dự phòng khi mất mạng; vẫn tuyệt đối không lưu đệm request `/api` |

## Đợt cập nhật: thương hiệu, ảnh thật và đăng nhập bằng số điện thoại

### Thương hiệu và hình ảnh

- Đổi tên ứng dụng thành **Gạo Kinh Bắc** theo logo cửa hàng cung cấp (`App_logo.jpg`).
- Biểu tượng ứng dụng (192/512/maskable), logo trên thanh điều hướng và trang quản trị đều
  dựng từ logo thật; đã bỏ biểu tượng vẽ tay `icon.svg` cũ.
- **22 ảnh sản phẩm thật** chụp tại cửa hàng, đặt trong `frontend/public/products/`.
  Ảnh gốc 4000×3000 (~127 MB) được thu nhỏ còn 900×900 trên nền kem, tổng **3,3 MB**.
- Danh mục trong `seed.js` viết lại theo đúng tên trên bao bì: Cỏ May, LVS, G9 (Điện Biên,
  Khang Dân, Bắc Hương, Hải Hậu), Khánh Vy TG, ST25, gạo nếp, gạo lứt…
- Mô tả sản phẩm chỉ ghi lại nội dung in trên bao bì, không thêm lời quảng cáo tự nghĩ.

### Đăng nhập không cần email

- Đăng ký chỉ cần **số điện thoại + mật khẩu**; email là tuỳ chọn.
- Đăng nhập bằng SĐT hoặc email qua cùng một ô nhập (trường `identifier`).
- SĐT được chuẩn hoá về dạng `0xxxxxxxxx`, nên `0912 345 678`, `+84912345678` và
  `0912345678` là cùng một tài khoản.
- Thêm ràng buộc **mỗi số điện thoại chỉ thuộc một tài khoản**. Nếu cơ sở dữ liệu cũ đang có
  số trùng, API sẽ in cảnh báo kèm danh sách tài khoản và bỏ qua ràng buộc thay vì xoá dữ liệu.
- Cột `email` chuyển sang cho phép để trống; `db.js` tự chuyển đổi bảng `users` cũ.
- Không cho xoá SĐT nếu tài khoản không có email (sẽ mất đường đăng nhập).

### Bảng giá (cửa hàng gửi 04/09/2026)

Danh mục có **29 loại**: **22 loại đã có giá**, **7 loại chưa có giá**.

Bảy loại chưa có giá — cần bạn bổ sung:

| Loại | Quy cách | Ghi chú |
|---|---|---|
| Gạo Quê | bao 25kg | bảng giá ghi tên nhưng bỏ trống giá |
| Gạo Cỏ May | bao 25kg | bảng giá ghi tên nhưng bỏ trống giá |
| Gạo Lài Miên | bao 25kg | bảng giá ghi tên nhưng bỏ trống giá |
| Gạo sạch G9 – ST25 (túi xanh) | túi 5kg | có ảnh nhưng không khớp dòng nào trong bảng giá |
| Gạo sạch G9 – ST25 (túi hồng) | túi 5kg | có ảnh nhưng không khớp dòng nào trong bảng giá |
| Gạo ST25 (LVS túi vàng) | túi 5kg | có ảnh nhưng không khớp dòng nào trong bảng giá |
| Gạo thơm cơm dẻo | bao 10kg | có ảnh nhưng không khớp dòng nào trong bảng giá |

Năm loại có giá nhưng **chưa có ảnh bao bì**: Kê vàng, Gạo Thái, Gạo Sén Cù, Gạo BC, Gạo Thái Hồng
— đang dùng logo cửa hàng làm ảnh tạm.

**Cơ chế “chưa có giá”** (`price = 0`):

- Khách thấy ảnh và tên, nhãn ghi **“Chưa có giá”**, nút chuyển thành **“Chưa bán”** và không thêm được vào giỏ.
- Máy chủ cũng từ chối đơn có sản phẩm giá 0, không chỉ dựa vào giao diện.
- Trang quản trị hiện cảnh báo *“N loại gạo chưa có giá bán”* kèm nút chuyển thẳng sang tab Sản phẩm.
- Khi chủ cửa hàng nhập giá và tồn kho, sản phẩm bán được ngay, không cần sửa mã nguồn.

### Giao hàng: khung giờ và phí

- Cửa hàng giao **hoả tốc trong ngày, miễn phí** → giỏ hàng và trang đặt hàng ghi rõ
  “Phí giao hàng: Miễn phí”, không còn dòng “xác nhận sau”.
- Khách chọn **khung giờ mong muốn**: Buổi sáng 07h00–11h30 hoặc Buổi chiều 14h00–18h00.
- Khung giờ lưu ở cột `orders.delivery_slot` (`db.js` tự thêm cột cho cơ sở dữ liệu cũ),
  hiển thị lại cho khách ở trang Đơn hàng và cho cửa hàng ở trang quản trị.
- Máy chủ chỉ nhận `sang` hoặc `chieu`; không chọn cũng đặt hàng được.

## Hệ thống bán lẻ tại quầy

Màn hình riêng ở `/quan-tri/ban-hang`, chỉ tài khoản `admin` vào được (kiểm tra ở máy chủ,
không chỉ ẩn nút).

### Ba chức năng cửa hàng yêu cầu

| Yêu cầu | Cách hoạt động |
|---|---|
| Tích điểm | 1.000₫ khách **thực trả** = 1 điểm. Điểm cộng vào hồ sơ gắn với số điện thoại, xem được tổng điểm, số lần mua và tổng chi tiêu. |
| Giảm 10k–20k cho hoá đơn từ 300k | Giảm **tự động theo bậc**, khách không cần tích luỹ trước: từ 300.000₫ giảm 10.000₫, từ 500.000₫ giảm 20.000₫. Máy chủ tự tính, không tin số tiền do máy bán hàng gửi lên. |
| Tra cứu hoá đơn cũ | Tra theo mã hoá đơn (`HD000012`), số điện thoại, tên khách, hoặc lọc theo khoảng ngày. Có phân trang. |

### Bảng dữ liệu mới

- `retail_customers` — khách quen, khoá theo `phone` (duy nhất, chuẩn hoá `0xxxxxxxxx`),
  giữ `points`, `total_spent`, `visit_count`.
- `retail_invoices` — hoá đơn, có `code` dạng `HD000012` để khách đọc lại.
- `retail_invoice_items` — chi tiết từng dòng, **chép lại tên và giá lúc bán** nên sửa giá
  sau này không làm sai hoá đơn cũ.

Các bảng này được tạo tự động khi khởi động API, không cần chạy lệnh riêng.

### Điểm cần biết

- **Không trừ tồn kho của web.** Theo yêu cầu của cửa hàng, bán tại quầy và bán online theo dõi
  tồn kho riêng. Nếu sau này muốn dùng chung một kho thì sửa `routes/retail.js` để trừ `products.stock`
  trong cùng transaction, giống `routes/orders.js`.
- Toàn bộ tiền (tiền hàng, giảm giá, điểm) đều do **máy chủ tính lại**; dữ liệu gửi từ trình duyệt bị bỏ qua.
- Loại gạo **chưa có giá** thì không bán được tại quầy.
- Khách không cho số điện thoại vẫn bán được, chỉ là không tích điểm.
- Đổi chính sách: sửa `RETAIL_DISCOUNT_TIERS` và `RETAIL_VND_PER_POINT` trong `backend/src/constants.js`,
  giao diện tự đọc theo qua `GET /api/retail/policy` nên không phải sửa hai nơi.
- Nút **In hoá đơn** dùng chức năng in của trình duyệt; CSS `@media print` đã ẩn phần giao diện thừa.

### Kiểm thử

`npm run test:retail` — 51 phép kiểm tra: phân quyền, các mốc giảm giá (kể cả đúng 300.000₫
và 500.000₫), tích điểm cộng dồn, khách vãng lai, bỏ qua giá do trình duyệt gửi, gộp dòng trùng,
không trừ tồn kho, tra cứu theo mã/SĐT/tên/ngày, phân trang.

## Báo cáo doanh thu theo ngày / tháng

Tab **Doanh thu** trong `/quan-tri`.

- Chọn nhanh: **Hôm nay · Hôm qua · 7 ngày · Tháng này · Tháng trước**, hoặc tự chọn
  một ngày, một tháng, hoặc khoảng ngày bất kỳ.
- Bốn ô tổng hợp: tổng doanh thu (kèm số giao dịch), bán online, bán tại quầy, và
  số tiền đã giảm cho khách.
- Bảng chi tiết từng ngày có cột so sánh dạng thanh ngang, kèm dòng **Cộng** ở cuối.
- Nguồn số liệu: đơn online **đã hoàn thành** (giữ nguyên quy tắc doanh thu cũ) cộng với
  toàn bộ hoá đơn bán tại quầy.

API: `GET /api/admin/revenue?period=day|month|range&date=&month=&from=&to=` (chỉ admin).

### Đã sửa kèm: lỗi lệch ngày do múi giờ

SQLite lưu `created_at` theo **giờ UTC**, trong khi cửa hàng ở **UTC+7**. Thống kê cũ của
trang bán hàng so `date(created_at)` (giờ UTC) với `date('now','localtime')` — hoá đơn bán
trước 07h00 sáng bị tính sang **ngày hôm trước**.

Nay mọi chỗ lọc theo ngày đều quy về giờ Việt Nam qua `localDate()` trong `constants.js`.
Đổi múi giờ bằng biến môi trường `REPORT_TIME_SHIFT` (mặc định `+7 hours`); giá trị sai
định dạng sẽ bị bỏ qua và quay về mặc định, vì chuỗi này được ghép vào câu SQL.

Chỗ đã sửa: `GET /api/retail/stats` (doanh thu hôm nay) và bộ lọc ngày của
`GET /api/retail/invoices`.

## Quản lý tài khoản khách hàng

Tab **Khách hàng** trong `/quan-tri`.

- Danh sách khách kèm số điện thoại, email, ngày đăng ký, **số đơn đã đặt** và **tổng đã mua**.
  Tìm theo tên, số điện thoại hoặc email; lọc riêng những tài khoản đang bị khoá.
- Nút **Chi tiết** mở ra sổ địa chỉ và 10 đơn gần nhất của khách.
- **Đặt lại mật khẩu**: mật khẩu được băm bằng bcrypt nên *không ai đọc lại được*, kể cả cửa hàng.
  Khi khách quên, cửa hàng đặt một mật khẩu mới (có nút gợi ý chuỗi dễ đọc qua điện thoại)
  rồi đọc cho khách. Giao diện nói rõ điều này để không ai hiểu nhầm là xem được mật khẩu cũ.
- **Khoá / mở khoá tài khoản**: khoá xong thì khách không đăng nhập được nữa, và
  **token đang dùng cũng hết hiệu lực ngay** (`requireAuth` kiểm tra `is_locked` mỗi lần gọi API),
  nên không phải chờ token hết hạn.

Ràng buộc an toàn:

- API chỉ thao tác trên tài khoản có `role = 'customer'`; đụng vào tài khoản quản trị trả 403.
- Không tự khoá được tài khoản của chính mình (tránh tự khoá mình ra ngoài).
- Không API nào trả về `password_hash`.

API: `GET/PUT /api/admin/customers`, `POST /api/admin/customers/:id/reset-password`,
`PATCH /api/admin/customers/:id/lock`.

## Nhập kho và giá nhập

### Nhập kho cộng dồn

Nút **Nhập kho** ở mỗi dòng sản phẩm. Gõ số lượng nhập thêm — hệ thống **cộng vào** tồn kho
hiện có chứ không ghi đè, đúng cách nghĩ "hôm nay nhập thêm 20 bao". Hộp nhập hiện luôn
"tồn kho hiện tại → sau khi nhập" để nhìn thấy kết quả trước khi bấm.

Mỗi lần nhập ghi một dòng vào bảng `stock_entries`: số lượng, giá nhập của lần đó,
tồn kho sau khi nhập, ghi chú, ai nhập, lúc nào. Lịch sử hiện ngay dưới hộp nhập.

Việc cộng tồn kho và ghi lịch sử nằm trong **cùng một transaction**.

### Giá nhập và lãi

- Mỗi loại gạo có thêm cột `cost_price` — **chỉ cửa hàng thấy**, khách không thấy.
- Nhập kho có khai giá nhập thì giá nhập của sản phẩm được cập nhật luôn.
- Danh sách sản phẩm hiện **lãi mỗi đơn vị** = giá bán − giá nhập.
- Thống kê có thêm **giá trị tồn kho** (giá nhập × số lượng) và số loại chưa khai giá nhập.
- Báo cáo doanh thu có thêm phần **lãi gộp** = doanh thu − giá vốn.

**Quan trọng:** giá nhập được **chép vào từng dòng hàng lúc bán**
(`order_items.cost_price`, `retail_invoice_items.cost_price`). Nhờ vậy đổi giá nhập về sau
không làm sai lãi của các đơn cũ — có phép kiểm tra riêng cho việc này.

API: `POST /api/admin/products/:id/stock`, `GET /api/admin/products/:id/stock`,
`GET /api/admin/stock-entries`.

### Kiểm thử

`npm run test:manage` — 59 phép kiểm tra: phân quyền, tìm kiếm, phân trang, đặt lại mật khẩu
(mật khẩu cũ hết tác dụng, mật khẩu mới dùng được), khoá tài khoản (chặn đăng nhập, vô hiệu token
cũ, chặn đặt hàng), không tự khoá mình, nhập kho cộng dồn, lịch sử, chặn số lượng âm/0,
giá trị tồn kho, lãi gộp, và đổi giá nhập không làm sai đơn cũ.

## Thể lệ tích điểm đầy đủ (cửa hàng chốt 06/09/2026)

| Nội dung | Quy tắc |
|---|---|
| Giảm giá theo hoá đơn | Từ **300.000₫** giảm **10.000₫** · từ **500.000₫** giảm **20.000₫**. Tự động, không cần tích luỹ trước. |
| Tích điểm | **1.000₫ thực trả = 1 điểm**, tính trên số tiền sau giảm giá, gắn với số điện thoại. |
| Đổi quà | Đủ **1.000 điểm** đổi **1 túi 1kg**: gạo nếp cái hoa vàng, gạo lứt, hoặc kê vàng. |

### Cách đổi quà hoạt động

- Nhân viên tra số điện thoại; nếu khách đủ điểm, khối **"Đổi được N phần quà"** hiện ra
  với ba loại quà để chọn. Không đủ điểm thì hiện dòng nhắc còn thiếu bao nhiêu.
- Quà vào hoá đơn thành **dòng giá 0₫** có nhãn *"Quà đổi điểm"*.
- Quà **không cộng vào tiền hàng**, nên không giúp khách đạt mốc giảm giá và không sinh thêm điểm.
- Khách có thể **chỉ đến lấy quà** mà không mua gì — hoá đơn 0₫ vẫn hợp lệ.
- Khách vãng lai không cho số điện thoại thì không đổi quà được.

### Bảo đảm đúng đắn

- Số điểm được kiểm tra và trừ **trong cùng transaction với việc tạo hoá đơn**, bằng câu lệnh
  có điều kiện `WHERE points >= ?`. Hai máy bán hàng cùng đổi quà cho một khách thì chỉ
  một máy thành công, không bao giờ trừ âm điểm.
- Máy chủ tự kiểm tra sản phẩm có đúng là quà (`is_reward = 1`) hay không —
  không tin danh sách gửi từ trình duyệt.
- Dòng quà vẫn lưu **giá vốn**, nên báo cáo lãi không bị thổi phồng vì hàng tặng.
- Hoá đơn lưu `points_used`; mở lại hoá đơn cũ vẫn thấy rõ phần quà và số điểm đã trừ.

### Đổi loại quà hoặc mức điểm

- Mức điểm: sửa `RETAIL_POINTS_PER_REWARD` trong `backend/src/constants.js`.
- Loại nào được làm quà: bật/tắt cột `products.is_reward`. Mặc định đã bật cho
  ba loại 1kg (nếp, lứt, kê) qua migration `2026-09-mark-default-rewards`.
- Giao diện đọc thể lệ qua `GET /api/retail/policy` nên không phải sửa hai nơi.

## Một hồ sơ điểm cho cả quầy và online (cửa hàng chốt 06/09/2026)

Yêu cầu: *"lưu data ttin sdt khách để tích điểm = sdt đăng ký = sdt tài khoản đăng nhập order online"*.

### Nguyên tắc

**Số điện thoại là chìa khoá duy nhất.** Khách mua tại quầy hay đặt "đơn hàng online – giao
hàng tận nhà" đều cộng vào cùng một hồ sơ tích điểm, tra theo số điện thoại đã chuẩn hoá
về dạng `0xxxxxxxxx`. Một khách không còn có hai sổ điểm.

Logic dùng chung nằm ở `backend/src/loyalty.js`, cả hai luồng đều gọi vào đây:

| Hàm | Việc |
| --- | --- |
| `loyaltyPhoneForOrder(order)` | Lấy SĐT **của tài khoản đặt đơn**, không lấy SĐT người nhận trên đơn |
| `creditPoints(phone, {...})` | Tạo hoặc cập nhật hồ sơ `retail_customers`, trả về số điểm vừa cộng |
| `loyaltyProfile(phone)` | Đọc hồ sơ điểm |
| `onlineAccount(phone)` | Đọc tài khoản đăng nhập gắn với số đó |

> Cố ý lấy SĐT của **tài khoản**, không lấy SĐT trên địa chỉ nhận hàng: khách hay đặt hộ
> người khác, điểm phải về đúng người mua.

### Đơn online giờ cũng được giảm giá

Đơn online dùng **chung mốc giảm giá** với hoá đơn quầy (từ 300.000₫ giảm 10.000₫, từ
500.000₫ giảm 20.000₫). Giỏ hàng và trang đặt hàng hiện trước số tiền được giảm, giỏ hàng
còn nhắc *"mua thêm X nữa để được giảm Y"*. Bảng `orders` thêm ba cột `subtotal`,
`discount`, `points_earned`.

**Máy chủ vẫn tự tính lại toàn bộ.** Con số trên trình duyệt chỉ để khách xem trước;
`POST /api/orders` lấy giá hiện tại trong kho, tự cộng tiền hàng rồi tự áp mốc giảm —
không đọc bất kỳ số tiền nào do trình duyệt gửi lên.

### Điểm cộng đúng một lần

Điểm chỉ được cộng khi cửa hàng bấm **Hoàn thành**, và ghi ngay số điểm đã cộng vào
`orders.points_earned`:

- đơn đang *chờ xác nhận / đã xác nhận / đang giao* → **chưa** cộng điểm;
- đơn *đã huỷ* → **không** cộng điểm, hàng được hoàn về kho;
- `ALLOWED_TRANSITIONS` không cho quay lại trạng thái cũ, nên không có đường nào bấm
  *Hoàn thành* hai lần cho cùng một đơn.

### Đăng ký tài khoản cho khách ngay tại quầy

Nhân viên tra số điện thoại xong:

- **Số chưa có tài khoản** → hiện ô mời *"Chưa có tài khoản đặt hàng online"*. Bấm
  **Tạo tài khoản**, nhập tên khách, bấm **Gợi ý** để hệ thống sinh mật khẩu dễ đọc qua
  điện thoại (dạng `gao123456`), rồi bấm **Tạo tài khoản**. Màn hình hiện đúng câu để
  nhân viên đọc cho khách: *"số 09xxxxxxxx, mật khẩu gaoxxxxxx"*.
- **Số đã có tài khoản** → hiện dải xanh *"Đã có tài khoản đặt hàng online"* kèm số đơn
  giao tận nhà khách đã đặt, và báo rõ nếu tài khoản đang bị khoá.

API: `POST /api/retail/customers/account` (chỉ admin). Máy chủ từ chối nếu số đó đã có
tài khoản, mật khẩu vẫn được **hash bằng bcrypt** như mọi tài khoản khác, và mật khẩu
không bao giờ được đọc ngược ra — nếu khách quên thì dùng chức năng *đặt lại mật khẩu*
trong phần Quản lý tài khoản khách.

Nhắc nhân viên: đây là mật khẩu tạm, nên dặn khách tự đổi sau lần đăng nhập đầu tiên.

### Đã sửa kèm: form đăng ký bị đóng giữa chừng

Ô số điện thoại ở quầy tra cứu lại mỗi khi mất focus. Khi nhân viên bấm vào form đăng ký,
lần tra cứu thừa đó đưa màn hình về trạng thái *đang tải* và **làm mất form đang nhập dở,
đồng thời xoá luôn phần quà đã chọn**. Nay chỉ tra lại khi nhân viên thực sự sửa số hoặc
tự bấm nút *Tra cứu*.

### Đã sửa kèm: khách nhìn thấy giá nhập của cửa hàng

`GET /api/orders` và `GET /api/orders/:id` trả dòng hàng bằng `SELECT *`, nên từ khi thêm
cột `order_items.cost_price` (giá nhập) thì **khách xem đơn của mình là đọc được giá nhập
của cửa hàng**. Nay hai API chỉ trả đúng các cột được phép; giá nhập chỉ còn xuất hiện
trong khu vực quản trị. `npm run test:smoke` có hai phép thử canh việc này.

### Kiểm thử

`npm run test:manage` — **84 PASS · 0 FAIL** (toàn bộ ba bộ: **261 PASS · 0 FAIL**), trong đó:

- Đơn online từ 300k được giảm 10.000₫
- Điểm đơn online cộng vào ĐÚNG hồ sơ SĐT
- Đơn đang giao vẫn chưa cộng điểm
- Đơn bị huỷ không cộng điểm
- Mua tại quầy cộng tiếp vào cùng hồ sơ
- Đơn hoàn thành ghi lại số điểm đã cộng

## Việc bạn cần tự làm trước khi chạy thật

1. **Đổi `JWT_SECRET`** thành chuỗi dài ngẫu nhiên và **đổi mật khẩu quản trị mẫu**.
2. Đặt `NODE_ENV=production` và `CLIENT_ORIGIN` đúng địa chỉ Vercel ở backend.
3. Đặt `TRUST_PROXY=1` nếu backend chạy sau proxy (Railway, Render, Nginx).
4. Đặt `VITE_API_URL` và `VITE_SITE_URL` trong phần Environment Variables của Vercel.
5. Chuẩn bị host có ổ đĩa bền vững cho SQLite và **lên lịch sao lưu `backend/data/app.db`**.
6. Điền các thông tin kinh doanh còn để trống (xem mục dưới).
7. Ảnh sản phẩm hiện nhận qua URL; có thể bổ sung Cloudinary hoặc dịch vụ lưu ảnh ở giai đoạn sau.

## Thông tin kinh doanh chưa có — đang để trống có chủ đích

Những mục sau **cố tình không có dữ liệu giả**. Khi bạn cung cấp, chúng sẽ được đưa vào giao diện:

- **Số lượng tồn kho thật**: hiện đặt tạm 100 cho mỗi loại đã có giá. Phải sửa lại trong
  trang quản trị, nếu không cửa hàng sẽ nhận đơn nhiều hơn số hàng đang có.
- **Giá của 7 loại còn lại** (xem mục "Bảng giá" bên dưới).
- **Số điện thoại cửa hàng**: chưa hiển thị ở đâu. Cần có để khách gọi khi muốn đổi đơn đã xác nhận.
- **Địa chỉ cửa hàng**: chưa hiển thị ở footer hay trang liên hệ.
- **Tài khoản ngân hàng**: khách chọn chuyển khoản chỉ được báo "cửa hàng sẽ gửi thông tin". Chưa có số tài khoản nào trong mã nguồn.
- **Chính sách đổi trả / thời gian giao**: chưa có trang nào.

## Nếu muốn chuyển backend lên serverless

Hiện tại **chưa chuyển** và cũng không nên chuyển khi chưa cần. Nếu sau này thật sự cần, thứ tự đúng là:

1. Đổi SQLite sang PostgreSQL (Neon, Supabase hoặc Vercel Postgres) **trước**.
2. Chuyển `better-sqlite3` sang một driver hỗ trợ kết nối gộp (`postgres.js` hoặc `pg`) — lưu ý mọi truy vấn sẽ thành bất đồng bộ.
3. Giữ nguyên các transaction đang có: tạo đơn/trừ kho và huỷ đơn/hoàn kho phải nằm trong `BEGIN … COMMIT`, kèm điều kiện `WHERE stock >= ?` và `WHERE status = ?` như hiện nay.
4. Chuyển giới hạn tần suất sang bộ nhớ dùng chung (Upstash Redis) vì mỗi function là một tiến trình riêng.
5. Viết script chuyển dữ liệu từ `app.db` sang PostgreSQL và chạy thử trên bản sao trước.

Trước khi làm bước nào, chạy `npm run test:smoke` để chắc chắn hành vi không đổi.

## Tài khoản mẫu

Không còn tài khoản mặc định. Đặt `ADMIN_EMAIL` và `ADMIN_PASSWORD` riêng trước lần seed đầu. Xem `SECURITY_AUDIT.md` để biết các thay đổi bảo mật và việc cần làm khi triển khai.
