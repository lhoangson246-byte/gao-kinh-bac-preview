# Gạo Kinh Bắc — ứng dụng bán gạo gia đình

Ứng dụng web cài được (PWA) dành cho khách mua gạo bán lẻ tại Bắc Ninh. Chạy tốt trên điện thoại và máy tính, có khu vực quản trị riêng cho người vận hành cửa hàng.

## Chức năng chính

### Khách hàng

- Xem, tìm kiếm và lọc loại gạo; lọc nhanh "chỉ hàng còn"
- Giỏ hàng lưu trên thiết bị, tự cập nhật giá và tồn kho mới nhất từ cửa hàng
- Đăng ký chỉ bằng **số điện thoại** (email không bắt buộc), đăng nhập bằng SĐT hoặc email
- Sổ địa chỉ giao hàng riêng (tối đa 10 địa chỉ): thêm/sửa/xoá, chọn địa chỉ khi thanh toán và đặt mặc định cho lần mua sau
- Đặt hàng tới địa chỉ trong tỉnh Bắc Ninh (kiểm tra ở cả trình duyệt và máy chủ)
- Chọn khung giờ giao trong ngày (sáng 07h00–11h30 hoặc chiều 14h00–18h00), giao hàng miễn phí
- Chọn thanh toán khi nhận hàng hoặc chuyển khoản
- **Ưu đãi 20.000₫ cho đơn đầu tiên** của mỗi tài khoản; giỏ hàng và trang đặt hàng hiện sẵn số tiền được giảm
- **Tích điểm cho mọi đơn**: đơn giao xong sẽ cộng điểm vào chính số điện thoại của tài khoản (1.000₫ = 1 điểm)
- Theo dõi trạng thái và tự huỷ đơn còn chờ xác nhận
- Cài ứng dụng lên màn hình chính từ trình duyệt hỗ trợ PWA

### Quản trị

- Khu vực `/quan-tri` tách biệt với ứng dụng khách hàng, chỉ tài khoản `admin` vào được
- Mở trang là thấy ngay số đơn đang chờ xác nhận
- Nút thao tác theo từng bước: xác nhận → giao hàng → hoàn thành
- Thêm, sửa, ẩn và mở bán lại sản phẩm (ẩn là soft delete, đơn cũ giữ nguyên)
- **Đưa ảnh sản phẩm vào theo cách nào cũng được**: chọn tệp, kéo thả vào ô ảnh, dán bằng Ctrl+V, hoặc bấm *Chọn từ ảnh đã có* để lấy lại ảnh trong thư viện của cửa hàng. Ảnh tự thu nhỏ và hiện ngay ô xem trước.
- Theo dõi tồn kho, cảnh báo loại gạo sắp hết và doanh thu của đơn đã hoàn thành
- Cảnh báo ngay số loại gạo **chưa nhập giá bán**
- **Quản lý tài khoản khách**: xem, tìm theo tên/SĐT/email, đặt lại mật khẩu khi khách quên, khoá và mở khoá tài khoản
- **Nhập kho cộng dồn có lịch sử**: gõ số lượng nhập thêm, hệ thống tự cộng vào tồn kho và lưu lại từng lần nhập
- **Giá nhập cho từng loại gạo** (chỉ cửa hàng thấy) để biết lãi mỗi đơn vị và giá trị hàng đang trong kho
- **Báo cáo doanh thu lọc theo ngày, tháng hoặc khoảng ngày** — gộp đơn online đã hoàn thành và hoá đơn bán tại quầy, kèm bảng chi tiết từng ngày

### Bán lẻ tại quầy

Khu vực `/quan-tri/ban-hang` dành cho nhân viên đứng quầy:

- Nhập số điện thoại để **tra cứu khách quen**: hiện tên, điểm tích luỹ, số lần mua và các hoá đơn gần đây. Số chưa từng mua sẽ được báo là khách mới và tạo hồ sơ khi lưu hoá đơn.
- Bấm vào loại gạo để thêm vào hoá đơn, chỉnh số lượng, chọn tiền mặt hoặc chuyển khoản.
- **Giảm giá theo khối lượng, mức phần trăm do cửa hàng tự nhập**: chỉ hoá đơn từ **50kg** trở lên mới mở ô nhập %, tối đa 50%. Dưới 50kg thì ô này bị khoá và máy chủ cũng từ chối. Màn hình hiện sẵn tổng khối lượng của hoá đơn.
- **Không có giảm giá tự động theo giá trị hoá đơn** — mốc 300k/500k trước đây đã bỏ.
- **Tích điểm**: 1.000₫ thực trả = 1 điểm, cộng vào hồ sơ theo số điện thoại. Khách vãng lai không cho số thì không tích điểm.
- **Đổi quà**: đủ **1.000 điểm** đổi được **1 túi 1kg** — gạo nếp, gạo lứt hoặc kê vàng. Quà tính 0₫, điểm bị trừ ngay khi lưu hoá đơn.
- **Đăng ký tài khoản đặt hàng online ngay tại quầy**: tra số điện thoại xong, nếu số đó chưa có tài khoản thì nhân viên bấm *Tạo tài khoản*, nhập tên khách và bấm *Gợi ý* để hệ thống sinh mật khẩu dễ đọc, rồi đọc số điện thoại và mật khẩu cho khách. Nếu số đã có tài khoản, màn hình báo sẵn kèm số đơn giao tận nhà khách đã đặt.
- Tab **Hoá đơn cũ** tra theo mã hoá đơn (`HD000012`), số điện thoại, tên khách hoặc khoảng ngày; mở ra xem lại đúng tên và giá lúc bán.

Mốc 50kg tính theo cột `products.weight_kg`. Cột này tự suy từ tên đơn vị khi tạo sản phẩm ("bao 10kg" → 10) và sửa được trong form sản phẩm ở trang quản trị. Quà đổi điểm không tính vào khối lượng.

**Số điện thoại tích điểm chính là số đăng nhập đặt hàng online.** Khách mua tại quầy hay đặt "đơn hàng online – giao hàng tận nhà" đều cộng vào cùng một hồ sơ điểm, nên không còn cảnh một khách có hai sổ điểm. Đơn online chỉ được cộng điểm **một lần duy nhất**, vào lúc cửa hàng bấm *Hoàn thành*; đơn bị huỷ hoặc còn đang giao thì chưa cộng.

Hai kênh bán có **hai chính sách giảm giá khác nhau**: đặt online được giảm 20.000₫ cho đơn đầu tiên của mỗi tài khoản; mua tại quầy chỉ giảm khi hoá đơn từ 50kg, theo phần trăm nhân viên nhập tay. **Tích điểm thì giống nhau ở cả hai kênh.**

Muốn đổi chính sách thì sửa `FIRST_ORDER_DISCOUNT`, `RETAIL_DISCOUNT_MIN_KG`, `RETAIL_DISCOUNT_MAX_PERCENT` và `RETAIL_VND_PER_POINT` trong `backend/src/constants.js`.

**Bán tại quầy không trừ tồn kho của cửa hàng online** — hai bên theo dõi riêng, đúng như cửa hàng yêu cầu.

## Chạy thử trên máy

Yêu cầu Node.js 22.12+ hoặc Node.js 24. Kiểm thử bảo mật chạy trên Node.js 24.15.0.

```bash
# Cửa sổ 1 — API
cd backend
npm install
cp .env.example .env
# Set ADMIN_EMAIL, ADMIN_PASSWORD and JWT_SECRET in .env before seeding.
npm run seed
npm run dev

# Cửa sổ 2 — ứng dụng
cd frontend
npm install
npm run dev
```

Mở `http://localhost:5173`.

Trước lần seed đầu tiên, đặt `ADMIN_EMAIL` và `ADMIN_PASSWORD` riêng trong `backend/.env`.
Mật khẩu phải có ít nhất 12 ký tự, tối đa 72 byte UTF-8. Không còn tài khoản mặc định.
Tạo `JWT_SECRET` bằng lệnh `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

**Quan trọng:** danh mục có 29 loại — 22 loại đã có giá theo bảng giá cửa hàng, 7 loại còn lại để `price = 0` nên khách chưa đặt mua được.

**Tồn kho đang là số tạm (100 mỗi loại)** vì cửa hàng chưa gửi số lượng thật. Phải sửa trong `/quan-tri` → **Sản phẩm** trước khi bán thật, nếu không sẽ nhận đơn nhiều hơn số hàng đang có. Có thể đổi số tạm này khi seed:

```bash
SEED_STOCK=0 npm run seed
```

Lệnh seed yêu cầu thông tin quản trị riêng khi tạo cơ sở dữ liệu mới:

```bash
# Set ADMIN_EMAIL and ADMIN_PASSWORD in your private .env, then:
npm run seed
```

### Kiểm thử API

Khi API đang chạy, mở một cửa sổ khác:

```bash
cd backend
# Ba bộ này gọi vào API đang chạy nên cần đúng tài khoản quản trị của bạn.
export ADMIN_EMAIL=... ADMIN_PASSWORD=...     # Windows PowerShell: $env:ADMIN_EMAIL="..."
npm run test:smoke     # cửa hàng online
npm run test:retail    # bán lẻ tại quầy + doanh thu
npm run test:manage    # tài khoản khách, nhập kho, giá nhập, ảnh sản phẩm
```

Thiếu hai biến trên thì bước đăng nhập quản trị hỏng và bộ kiểm thử dừng giữa chừng.

Hai bộ còn lại tự dựng API riêng nên chạy được bất cứ lúc nào, không cần biến môi trường
và cũng không đụng vào cơ sở dữ liệu đang dùng:

```bash
npm run test:security  # JWT, seed, đổi tài khoản quản trị, giới hạn tần suất
npm run test:isolated  # chạy lại bộ quản lý trên một cơ sở dữ liệu sạch
```

Ba bộ đầu đều tạo tài khoản mới nên chạy liên tiếp sẽ **chạm giới hạn 20 lần đăng ký / 15 phút**
và báo lỗi giả. Khởi động lại API trước mỗi bộ, hoặc chờ vài phút giữa các lần chạy.

Bộ kiểm thử đi qua các luồng chính: đăng ký, đăng nhập, sổ địa chỉ, phân quyền, tạo đơn, giới hạn Bắc Ninh, tồn kho, huỷ đơn và hoàn kho, quy trình trạng thái đơn, quản lý sản phẩm.

### Lưu ý khi dùng Node.js 24 trên Windows

`better-sqlite3` chưa có bản biên dịch sẵn cho Node 24 nên npm sẽ cố build từ mã nguồn và báo lỗi nếu máy chưa cài Visual Studio C++. Thư viện đã kèm sẵn tệp nhị phân dùng được, chỉ cần bỏ qua bước build:

```bash
cd backend
npm install --ignore-scripts
```

Cách bền hơn là dùng Node.js 20 hoặc 22 như khuyến nghị.

## Đưa ứng dụng lên Vercel

Tệp `vercel.json` ở thư mục gốc đã cấu hình sẵn quá trình build PWA, phần rewrite cho React Router và các header cache cho service worker.

1. Đưa mã nguồn lên GitHub và Import project vào Vercel.
2. Giữ Root Directory là thư mục gốc của dự án.
3. Trong Vercel Marketplace, tạo hoặc kết nối **Turso Cloud** với project. Integration sẽ
   tự thêm `TURSO_DATABASE_URL` và `TURSO_AUTH_TOKEN` cho project.
4. Thêm `JWT_SECRET` (chuỗi bí mật ngẫu nhiên dài ít nhất 32 byte) và
   `VITE_SITE_URL`, ví dụ `https://gao-kinh-bac.vercel.app`.
5. Để trống `VITE_API_URL` khi frontend và API cùng nằm trong project này. Nếu biến này
   từng trỏ tới backend cũ, hãy xoá nó.
6. Redeploy production sau khi thêm hoặc sửa biến môi trường. Vercel không áp dụng biến
   mới cho deployment đã có.

API chạy cùng project Vercel tại `/api`. Dữ liệu được lưu bền vững trong Turso; ứng dụng
cũng tiếp tục hỗ trợ tên biến cũ `LIBSQL_URL` và `LIBSQL_AUTH_TOKEN` nếu cấu hình thủ công.
Ứng dụng sẽ chủ động từ chối khởi động trên Vercel nếu không có database bền vững, thay vì
âm thầm ghi vào file SQLite tạm rồi làm mất thông tin khách hàng.

Nếu dùng backend riêng trên Railway, Render hoặc VPS, có thể tiếp tục dùng SQLite với
`DATA_DIR` trỏ tới ổ đĩa bền vững và đặt `VITE_API_URL` thành tên miền backend đó.

### Biến môi trường

Backend (`backend/.env`):

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `JWT_SECRET` | Có khi chạy thật | Chuỗi bí mật ký JWT. Thiếu biến này khi `NODE_ENV=production` thì API sẽ không khởi động. |
| `NODE_ENV` | Nên đặt | Đặt `production` khi chạy thật. |
| `CLIENT_ORIGIN` | Nên đặt | Địa chỉ frontend được phép gọi API, nhiều địa chỉ ngăn cách bằng dấu phẩy. |
| `PORT` | Không | Mặc định `4000`. |
| Thời hạn phiên | Cố định | 1 giờ; đổi mật khẩu, khoá/mở khoá và đăng xuất thu hồi các phiên cũ. |
| `TRUST_PROXY` | Khi chạy sau proxy | Đặt `1` trên Railway/Render/Nginx để giới hạn tần suất đọc đúng IP. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Lần seed đầu | Không có giá trị mặc định; mật khẩu 12+ ký tự, tối đa 72 byte UTF-8. |
| `COOKIE_SAME_SITE` | Khi frontend/API khác site | Mặc định `lax`; dùng `none` với HTTPS và `CLIENT_ORIGIN` chính xác. Trình duyệt chặn cookie bên thứ ba có thể yêu cầu đưa API về cùng site. |
| `DATA_DIR` | Không | Thư mục SQLite riêng; mặc định `backend/data`. Dùng ổ đĩa bền vững khi triển khai thật. |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Có trên Vercel | Database bền vững. Vercel Turso integration tự tạo hai biến này. Tên cũ `LIBSQL_URL`, `LIBSQL_AUTH_TOKEN` vẫn dùng được. |
| `REPORT_TIME_SHIFT` | Không | Múi giờ tính báo cáo doanh thu, mặc định `+7 hours` (giờ Việt Nam). |

Frontend (biến của Vercel):

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `VITE_API_URL` | Tuỳ cách deploy | Để trống khi frontend/API cùng project Vercel; chỉ điền khi backend ở tên miền khác. |
| `VITE_SITE_URL` | Nên đặt | Địa chỉ ứng dụng, dùng để tạo thẻ ảnh xem trước khi chia sẻ. |

## Cấu trúc

```text
gao-shop/
├── frontend/                 # React + Vite + PWA
│   ├── public/               # manifest, service worker, logo, ảnh chia sẻ
│   │   └── products/         # ảnh chụp thật của từng loại gạo
│   └── src/
│       ├── components/       # Navbar, ProtectedRoute, nút cài ứng dụng
│       ├── context/          # AuthContext, CartContext
│       ├── pages/            # Home, Cart, Checkout, Orders, Profile, Admin, Retail…
│       └── api.js            # gọi API, định dạng tiền/ngày, kiểm tra khu vực
├── backend/                  # Express + SQLite
│   ├── src/
│   │   ├── constants.js      # khu vực giao hàng, trạng thái đơn, giới hạn dữ liệu
│   │   ├── validate.js       # kiểm tra và chuẩn hoá dữ liệu đầu vào
│   │   ├── middleware/       # xác thực JWT, kiểm tra quyền admin
│   │   └── routes/           # auth, addresses, products, orders, admin, retail
│   └── test/                 # smoke.mjs (online) + retail.mjs (bán tại quầy)
├── vercel.json               # cấu hình deploy frontend lên Vercel
└── BAN_GIAO.md               # ghi chú tiếp tục phát triển
```

## Security audit and isolated verification

See [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for findings, exploit prerequisites, patches, and remaining deployment work.

```bash
npm --prefix backend run test:security
npm --prefix backend run test:isolated
npm --prefix frontend run build
```

These test commands start temporary databases and generate test administrator credentials. They do not use `backend/data/app.db`. Existing sessions are intentionally invalidated by the security upgrade. Browser login now uses HttpOnly cookies; API clients can still request bearer tokens without `X-Session-Mode: cookie`. Logout revokes all sessions for that account.
