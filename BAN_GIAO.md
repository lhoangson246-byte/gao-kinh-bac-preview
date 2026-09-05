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

`admin@gaokinhbac.vn` / `admin123` — chỉ dùng để phát triển, không dùng ở production.
