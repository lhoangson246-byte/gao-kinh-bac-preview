import { createHash } from 'node:crypto';
import { parseWeightKg } from './constants.js';
import { SCHEMA_VERSION } from './schema-version.js';

// Giữ nguyên thứ tự và điều kiện của các migration cũ; chỉ chạy theo lệnh triển khai.
export function migrate(db) {
db.exec(`
-- Khách có thể đăng ký chỉ bằng số điện thoại, nên email được phép để trống.
-- SQLite cho phép nhiều dòng NULL trong cột UNIQUE, đúng với nhu cầu này.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL,
  email         TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  phone         TEXT,
  address       TEXT,
  role          TEXT NOT NULL DEFAULT 'customer',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  origin      TEXT,
  price       INTEGER NOT NULL,          -- giá VND cho 1 đơn vị (kg / bao)
  unit        TEXT NOT NULL DEFAULT 'kg',
  stock       INTEGER NOT NULL DEFAULT 0,
  image_url   TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_name     TEXT NOT NULL,
  phone             TEXT NOT NULL,
  address           TEXT NOT NULL,
  note              TEXT,
  payment_method    TEXT NOT NULL DEFAULT 'cod',
  total             INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  unit         TEXT NOT NULL,
  price        INTEGER NOT NULL,
  quantity     INTEGER NOT NULL
);

-- ---------------------------------------------------------------- --
-- Bán lẻ tại quầy (POS). Tách riêng khỏi đơn đặt online: hoá đơn tại
-- quầy KHÔNG trừ tồn kho của cửa hàng trên web.
-- ---------------------------------------------------------------- --

-- Khách quen của cửa hàng, nhận diện bằng số điện thoại.
CREATE TABLE IF NOT EXISTS retail_customers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT NOT NULL UNIQUE,      -- luôn ở dạng chuẩn 0xxxxxxxxx
  full_name   TEXT,
  points      INTEGER NOT NULL DEFAULT 0,
  total_spent INTEGER NOT NULL DEFAULT 0,
  visit_count INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS retail_invoices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT UNIQUE,            -- mã hoá đơn cho khách tra cứu, ví dụ HD000012
  customer_id    INTEGER REFERENCES retail_customers(id) ON DELETE SET NULL,
  customer_phone TEXT,                   -- chép lại để hoá đơn cũ không đổi khi sửa khách
  customer_name  TEXT,
  customer_address TEXT,
  subtotal       INTEGER NOT NULL,       -- tiền hàng trước giảm giá
  discount       INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL,       -- số tiền khách thực trả
  points_earned  INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  note           TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS retail_invoice_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id   INTEGER NOT NULL REFERENCES retail_invoices(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,            -- chép lại tên/giá lúc bán
  unit         TEXT NOT NULL,
  price        INTEGER NOT NULL,
  quantity     INTEGER NOT NULL
);

-- Phiếu đổi/trả tại quầy. Dữ liệu được tách khỏi hoá đơn gốc để hoá đơn cũ
-- luôn giữ nguyên và một hoá đơn có thể phát sinh nhiều lần xử lý.
CREATE TABLE IF NOT EXISTS retail_returns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT UNIQUE,
  invoice_id      INTEGER NOT NULL REFERENCES retail_invoices(id) ON DELETE RESTRICT,
  return_type     TEXT NOT NULL CHECK (return_type IN ('return', 'exchange')),
  reason          TEXT NOT NULL,
  refund_amount   INTEGER NOT NULL DEFAULT 0,
  refund_method   TEXT NOT NULL DEFAULT 'cash' CHECK (refund_method IN ('cash', 'transfer', 'none')),
  note            TEXT,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS retail_return_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id      INTEGER NOT NULL REFERENCES retail_returns(id) ON DELETE CASCADE,
  invoice_item_id INTEGER NOT NULL REFERENCES retail_invoice_items(id) ON DELETE RESTRICT,
  product_name   TEXT NOT NULL,
  unit           TEXT NOT NULL,
  price          INTEGER NOT NULL,
  quantity       INTEGER NOT NULL
);

-- Nhật ký giúp biết quản trị viên nào đã thay đổi dữ liệu nào. Không lưu mật khẩu
-- hoặc token trong bảng này.
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name    TEXT,
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  before_json   TEXT,
  after_json    TEXT,
  ip_address    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lịch sử đăng nhập thành công. Chỉ lưu tài khoản, cách đăng nhập và thông tin
-- thiết bị cơ bản; tuyệt đối không lưu mật khẩu hay JWT.
CREATE TABLE IF NOT EXISTS login_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  login_method  TEXT NOT NULL,
  ip_address    TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_retail_inv_customer ON retail_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_retail_inv_phone ON retail_invoices(customer_phone);
CREATE INDEX IF NOT EXISTS idx_retail_inv_created ON retail_invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_retail_items_inv ON retail_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_retail_returns_invoice ON retail_returns(invoice_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_retail_return_items_return ON retail_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(id DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id, id DESC);
`);

/* ------------------------------------------------------------------ *
 * Chuyển đổi cơ sở dữ liệu đã tạo từ phiên bản trước
 * ------------------------------------------------------------------ */

// 0. Khung giờ giao hàng khách chọn (thêm sau khi cửa hàng công bố khung giờ hoả tốc).
const orderColumns = db.prepare('PRAGMA table_info(orders)').all();
if (!orderColumns.some((c) => c.name === 'delivery_slot')) {
  db.exec("ALTER TABLE orders ADD COLUMN delivery_slot TEXT");
  console.log('✅ Đã thêm cột delivery_slot vào bảng orders.');
}

const userColumns = db.prepare('PRAGMA table_info(users)').all();

// 1. Cho phép email để trống (bảng cũ khai báo email NOT NULL).
if (userColumns.find((c) => c.name === 'email')?.notnull === 1) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE users_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name     TEXT NOT NULL,
        email         TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        phone         TEXT,
        address       TEXT,
        role          TEXT NOT NULL DEFAULT 'customer',
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, full_name, email, password_hash, phone, address, role, created_at)
        SELECT id, full_name, NULLIF(email, ''), password_hash, phone, address, role, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  })();
  db.exec('PRAGMA foreign_keys = ON');
  console.log('✅ Đã cập nhật bảng users: email trở thành không bắt buộc.');
}

// 2. Chuẩn hoá số điện thoại đã lưu về dạng "0xxxxxxxxx" để tra cứu chính xác.
const normalizeStoredPhone = (value) => {
  const raw = String(value ?? '').replace(/[\s.\-()]/g, '');
  if (!raw) return null;
  const normalized = raw.startsWith('+84') ? `0${raw.slice(3)}`
    : raw.startsWith('84') && raw.length >= 11 ? `0${raw.slice(2)}`
    : raw;
  return /^0\d{9}$/.test(normalized) ? normalized : null;
};

db.transaction(() => {
  const setPhone = db.prepare('UPDATE users SET phone = ? WHERE id = ?');
  for (const user of db.prepare('SELECT id, phone FROM users WHERE phone IS NOT NULL').all()) {
    const normalized = normalizeStoredPhone(user.phone);
    if (normalized !== user.phone) setPhone.run(normalized, user.id);
  }
})();

// 3. Mỗi số điện thoại chỉ thuộc về một tài khoản, nếu không thì đăng nhập
//    bằng số điện thoại sẽ luôn tìm nhầm sang tài khoản đăng ký sớm nhất.
const duplicatePhones = db
  .prepare('SELECT phone, COUNT(*) c FROM users WHERE phone IS NOT NULL GROUP BY phone HAVING c > 1')
  .all();

if (duplicatePhones.length) {
  // Không tự ý xoá dữ liệu của khách — chỉ báo để chủ cửa hàng tự xử lý.
  console.warn(
    '\n⚠️  Chưa đặt được ràng buộc "mỗi số điện thoại một tài khoản" vì đang có số bị trùng:'
  );
  throw new Error('Duplicate account phone numbers: resolve database conflicts before starting the API.');
} else {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL');
}

// 4. Sổ địa chỉ giao hàng: tách khỏi thông tin đăng ký để một khách có thể lưu
//    nhiều địa chỉ và chọn lại ở những lần mua sau.
db.exec(`
CREATE TABLE IF NOT EXISTS delivery_addresses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         TEXT NOT NULL DEFAULT 'Nhà riêng',
  receiver_name TEXT NOT NULL,
  phone         TEXT NOT NULL,
  address       TEXT NOT NULL,
  is_default    INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_delivery_addresses_user
  ON delivery_addresses(user_id, is_default DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_addresses_one_default
  ON delivery_addresses(user_id) WHERE is_default = 1;
`);

// Giữ nguyên dữ liệu của phiên bản cũ: địa chỉ từng lưu trong users trở thành
// địa chỉ mặc định đầu tiên. Điều kiện NOT EXISTS khiến migration chạy an toàn
// ở mọi lần khởi động.
db.prepare(`
  INSERT INTO delivery_addresses (user_id, label, receiver_name, phone, address, is_default)
  SELECT u.id, 'Nhà riêng', u.full_name, u.phone, u.address, 1
  FROM users u
  WHERE u.address IS NOT NULL AND u.address != ''
    AND u.phone IS NOT NULL AND u.phone != ''
    AND NOT EXISTS (SELECT 1 FROM delivery_addresses a WHERE a.user_id = u.id)
`).run();

// 5. Khoá tài khoản khách: cửa hàng cần chặn được tài khoản phá rối.
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'is_locked')) {
  db.exec('ALTER TABLE users ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0');
  console.log('✅ Đã thêm cột is_locked vào bảng users.');
}

if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'session_version')) {
  db.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0');
}

// 6. Giá nhập của từng loại gạo — chỉ cửa hàng thấy, dùng để tính lãi và
//    giá trị hàng đang có trong kho. 0 nghĩa là chưa khai báo giá nhập.
if (!db.prepare('PRAGMA table_info(products)').all().some((c) => c.name === 'cost_price')) {
  db.exec('ALTER TABLE products ADD COLUMN cost_price INTEGER NOT NULL DEFAULT 0');
  console.log('✅ Đã thêm cột cost_price vào bảng products.');
}

// 7. Chép giá nhập vào từng dòng hàng đã bán. Giá nhập đổi về sau sẽ không
//    làm sai lãi của những đơn cũ.
for (const table of ['order_items', 'retail_invoice_items']) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'cost_price')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN cost_price INTEGER NOT NULL DEFAULT 0`);
    console.log(`✅ Đã thêm cột cost_price vào bảng ${table}.`);
  }
}

// 8. Lịch sử nhập kho: mỗi lần nhập thêm hàng được ghi lại một dòng.
db.exec(`
CREATE TABLE IF NOT EXISTS stock_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity    INTEGER NOT NULL,          -- số lượng nhập thêm (luôn > 0)
  cost_price  INTEGER,                   -- giá nhập của lần này, để trống nếu không khai
  stock_after INTEGER NOT NULL,          -- tồn kho ngay sau khi nhập
  note        TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stock_entries_product ON stock_entries(product_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_stock_entries_created ON stock_entries(created_at);
`);

// 9. Cập nhật giá Gạo ST25 LVS túi 5kg theo thông báo giảm 5.000đ. Migration
// chỉ chạy một lần để những lần quản trị viên sửa giá sau này không bị ghi đè.
db.exec(`
CREATE TABLE IF NOT EXISTS app_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const st25PriceMigration = '2026-09-06-lvs-st25-5kg-price-145000';
if (!db.prepare('SELECT name FROM app_migrations WHERE name = ?').get(st25PriceMigration)) {
  db.transaction(() => {
    db.prepare(`
      UPDATE products SET price = 145000
      WHERE unit = 'túi 5kg'
        AND (image_url = '/products/lvs-gao-sach-st25-5kg.jpg'
          OR (name = 'Gạo ST25 – Gạo sạch' AND origin LIKE 'LVS%'))
    `).run();
    db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(st25PriceMigration);
  })();
}

/* ------------------------------------------------------------------ *
 * Đổi điểm lấy quà: 1.000 điểm = 1 túi 1kg (gạo nếp / gạo lứt / kê vàng)
 * ------------------------------------------------------------------ */

// Loại gạo nào được dùng làm quà đổi điểm.
if (!db.prepare('PRAGMA table_info(products)').all().some((c) => c.name === 'is_reward')) {
  db.exec('ALTER TABLE products ADD COLUMN is_reward INTEGER NOT NULL DEFAULT 0');
  console.log('✅ Đã thêm cột is_reward vào bảng products.');
}

// Đánh dấu dòng hàng là quà đổi điểm (giá 0) để hoá đơn cũ đọc lại vẫn đúng.
if (!db.prepare('PRAGMA table_info(retail_invoice_items)').all().some((c) => c.name === 'is_reward')) {
  db.exec('ALTER TABLE retail_invoice_items ADD COLUMN is_reward INTEGER NOT NULL DEFAULT 0');
  console.log('✅ Đã thêm cột is_reward vào bảng retail_invoice_items.');
}

// Số điểm đã dùng để đổi quà trong hoá đơn.
if (!db.prepare('PRAGMA table_info(retail_invoices)').all().some((c) => c.name === 'points_used')) {
  db.exec('ALTER TABLE retail_invoices ADD COLUMN points_used INTEGER NOT NULL DEFAULT 0');
  console.log('✅ Đã thêm cột points_used vào bảng retail_invoices.');
}

// Đặt sẵn ba loại quà cửa hàng công bố: gạo nếp, gạo lứt và kê vàng loại 1kg.
// Chỉ chạy một lần; sau đó chủ cửa hàng tự bật/tắt trong trang quản trị.
const rewardMigration = '2026-09-mark-default-rewards';
if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(rewardMigration)) {
  db.transaction(() => {
    const marked = db.prepare(`
      UPDATE products SET is_reward = 1
      WHERE unit LIKE '%1kg%'
        AND (name LIKE '%nếp%' OR name LIKE '%lứt%' OR name LIKE '%ê vàng%')
    `).run().changes;
    db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(rewardMigration);
    if (marked) console.log(`✅ Đã đánh dấu ${marked} loại gạo làm quà đổi điểm.`);
  })();
}

/* ------------------------------------------------------------------ *
 * Đơn online cũng được giảm giá theo mốc và tích điểm vào cùng hồ sơ
 * số điện thoại như mua tại quầy.
 * ------------------------------------------------------------------ */
{
  const cols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);

  // Tiền hàng trước giảm giá. Đơn cũ chưa có cột này thì lấy bằng total.
  if (!cols.includes('subtotal')) {
    db.exec('ALTER TABLE orders ADD COLUMN subtotal INTEGER NOT NULL DEFAULT 0');
    db.prepare('UPDATE orders SET subtotal = total WHERE subtotal = 0').run();
    console.log('✅ Đã thêm cột subtotal vào bảng orders.');
  }
  if (!cols.includes('discount')) {
    db.exec('ALTER TABLE orders ADD COLUMN discount INTEGER NOT NULL DEFAULT 0');
    console.log('✅ Đã thêm cột discount vào bảng orders.');
  }
  // Điểm đã cộng cho đơn này. Chỉ cộng một lần, lúc đơn chuyển sang "hoàn thành".
  if (!cols.includes('points_earned')) {
    db.exec('ALTER TABLE orders ADD COLUMN points_earned INTEGER NOT NULL DEFAULT 0');
    console.log('✅ Đã thêm cột points_earned vào bảng orders.');
  }
}

/* ------------------------------------------------------------------ *
 * Ảnh sản phẩm do cửa hàng tự tải lên
 *
 * Ảnh nằm luôn trong SQLite để đi cùng ổ đĩa bền vững của cơ sở dữ liệu.
 * Nếu để trên thư mục của máy chủ thì mỗi lần Render dựng lại máy là mất
 * ảnh, trong khi tệp SQLite đã được gắn ổ đĩa riêng qua DATA_DIR.
 * ------------------------------------------------------------------ */
db.exec(`
CREATE TABLE IF NOT EXISTS product_images (
  id         TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  bytes      BLOB NOT NULL,
  size       INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Vân tay nội dung ảnh. Tải lên đúng tấm ảnh đã có thì dùng lại bản cũ, nhờ vậy
// thư viện ảnh không đầy những tấm giống hệt nhau và cơ sở dữ liệu không phình.
if (!db.prepare('PRAGMA table_info(product_images)').all().some((c) => c.name === 'sha256')) {
  db.exec('ALTER TABLE product_images ADD COLUMN sha256 TEXT');
  console.log('✅ Đã thêm cột sha256 vào bảng product_images.');
}
{
  // Tính vân tay cho những ảnh tải lên trước khi có cột này.
  const missing = db.prepare('SELECT id, bytes FROM product_images WHERE sha256 IS NULL').all();
  if (missing.length) {
    const setHash = db.prepare('UPDATE product_images SET sha256 = ? WHERE id = ?');
    db.transaction(() => {
      for (const row of missing) {
        setHash.run(createHash('sha256').update(row.bytes).digest('hex'), row.id);
      }
    })();
  }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_product_images_sha256 ON product_images(sha256)');


/* ------------------------------------------------------------------ *
 * Chính sách giảm giá mới (cửa hàng chốt 08/09/2026)
 *
 * Mua tại quầy chỉ giảm khi hoá đơn đạt 50kg trở lên, nên phải biết mỗi
 * loại gạo nặng bao nhiêu kg cho một đơn vị bán.
 * ------------------------------------------------------------------ */
if (!db.prepare('PRAGMA table_info(products)').all().some((c) => c.name === 'weight_kg')) {
  db.exec('ALTER TABLE products ADD COLUMN weight_kg REAL NOT NULL DEFAULT 0');
  console.log('✅ Đã thêm cột weight_kg vào bảng products.');
}
{
  // Suy khối lượng từ tên đơn vị ("bao 10kg" → 10). Chỉ điền cho những dòng
  // còn bỏ trống, để cửa hàng sửa tay rồi thì không bị ghi đè.
  const rows = db.prepare('SELECT id, unit FROM products WHERE weight_kg <= 0').all();
  if (rows.length) {
    db.transaction(() => {
      const setWeight = db.prepare('UPDATE products SET weight_kg = ? WHERE id = ?');
      for (const row of rows) {
        const kg = parseWeightKg(row.unit);
        if (kg > 0) setWeight.run(kg, row.id);
      }
    })();
  }
}

// Mức phần trăm nhân viên đã nhập cho hoá đơn tại quầy. Lưu lại để mở hoá đơn
// cũ vẫn thấy đúng cửa hàng đã giảm bao nhiêu phần trăm.
if (!db.prepare('PRAGMA table_info(retail_invoices)').all().some((c) => c.name === 'discount_percent')) {
  db.exec('ALTER TABLE retail_invoices ADD COLUMN discount_percent REAL NOT NULL DEFAULT 0');
  console.log('✅ Đã thêm cột discount_percent vào bảng retail_invoices.');
}

// Tổng khối lượng của hoá đơn tại quầy, để đối chiếu mốc 50kg về sau.
if (!db.prepare('PRAGMA table_info(retail_invoices)').all().some((c) => c.name === 'total_kg')) {
  db.exec('ALTER TABLE retail_invoices ADD COLUMN total_kg REAL NOT NULL DEFAULT 0');
  console.log('✅ Đã thêm cột total_kg vào bảng retail_invoices.');
}

// Chép địa chỉ vào từng hoá đơn để bản in cũ không đổi khi khách cập nhật hồ sơ.
if (!db.prepare('PRAGMA table_info(retail_invoices)').all().some((c) => c.name === 'customer_address')) {
  db.exec('ALTER TABLE retail_invoices ADD COLUMN customer_address TEXT');
  console.log('✅ Đã thêm địa chỉ khách vào hoá đơn tại quầy.');
}

/* ------------------------------------------------------------------ *
 * Dọn các đơn do bộ smoke/manage test cũ vô tình ghi vào Production.
 *
 * Dấu vân tay cố ý rất hẹp: đúng tên/tài khoản/địa chỉ của fixture, đúng
 * khoảng thời gian chạy test và (với smoke test) chỉ chứa mặt hàng test.
 * Nhờ vậy đơn thật còn lại không bị ảnh hưởng. Khi bỏ đơn chưa huỷ phải
 * hoàn kho; khi bỏ đơn đã hoàn thành phải hoàn tác phần tích điểm đã cộng.
 * ------------------------------------------------------------------ */
const testOrderCleanup = 'cleanup:test-orders:2026-09-17-v1';
if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(testOrderCleanup)) {
  let removed = 0;
  db.transaction(() => {
    const candidates = db.prepare(`
      SELECT o.id, o.status, o.total, o.points_earned, u.phone AS account_phone
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE o.created_at >= ? AND o.created_at < ?
        AND (
          (
            o.receiver_name = ? AND o.phone = ? AND u.full_name = ?
            AND o.address LIKE ?
            AND EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id)
            AND NOT EXISTS (
              SELECT 1 FROM order_items i
              WHERE i.order_id = o.id
                AND i.product_name NOT LIKE ?
                AND i.product_name NOT LIKE ?
            )
          )
          OR (
            o.receiver_name = ? AND u.full_name = ? AND o.address LIKE ?
          )
        )
      ORDER BY o.id
    `).all(
      '2026-09-06 00:00:00', '2026-09-09 00:00:00',
      'Nguyễn Văn Test', '0912345678', 'Nguyễn Văn Test',
      'Số 1, đường Ngô Gia Tự, phường Tiền An%',
      'Gạo kiểm thử %', 'Gạo tồn ít %',
      'Cô Tám', 'Cô Tám', 'Số 9, đường Ngô Gia Tự, phường Tiền An%'
    );

    const listItems = db.prepare(`
      SELECT product_id, quantity FROM order_items
      WHERE order_id = ? AND product_id IS NOT NULL
    `);
    const restoreStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
    const reverseLoyalty = db.prepare(`
      UPDATE retail_customers
      SET points = MAX(0, points - ?),
          total_spent = MAX(0, total_spent - ?),
          visit_count = MAX(0, visit_count - ?),
          updated_at = datetime('now')
      WHERE phone = ?
    `);
    const deleteOrder = db.prepare('DELETE FROM orders WHERE id = ?');

    const loyaltyByPhone = new Map();
    for (const order of candidates) {
      if (order.status !== 'cancelled') {
        for (const item of listItems.all(order.id)) {
          restoreStock.run(item.quantity, item.product_id);
        }
      }
      // creditPoints chỉ cộng doanh số/lượt mua khi số điểm kiếm được > 0.
      if (order.status === 'completed' && order.points_earned > 0 && order.account_phone) {
        const totals = loyaltyByPhone.get(order.account_phone) || { points: 0, spent: 0, visits: 0 };
        totals.points += order.points_earned;
        totals.spent += order.total;
        totals.visits += 1;
        loyaltyByPhone.set(order.account_phone, totals);
      }
    }
    for (const [phone, totals] of loyaltyByPhone) {
      reverseLoyalty.run(totals.points, totals.spent, totals.visits, phone);
    }
    for (const order of candidates) removed += deleteOrder.run(order.id).changes;

    db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(testOrderCleanup);
  })();
  console.log(`✅ Đã dọn ${removed} đơn hàng do bộ kiểm thử tạo.`);
}

// Một số tài khoản trong manage test bị chính bài test đổi tên sau khi tạo đơn,
// nên không còn khớp điều kiện u.full_name ở lần dọn đầu. Danh sách ID dưới đây
// là 9 đơn Production còn lại đã được đối chiếu qua API quản trị; vẫn kiểm tra
// kèm tên người nhận, địa chỉ và thời gian để không thể xoá nhầm ở DB khác.
const residualTestOrderCleanup = 'cleanup:test-orders:2026-09-17-v2';
if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(residualTestOrderCleanup)) {
  let removed = 0;
  db.transaction(() => {
    const candidates = db.prepare(`
      SELECT id, status FROM orders
      WHERE id IN (181, 182, 183, 200, 201, 202, 213, 214, 215)
        AND receiver_name = ?
        AND address LIKE ?
        AND created_at >= ? AND created_at < ?
      ORDER BY id
    `).all(
      'Cô Tám', 'Số 9, đường Ngô Gia Tự, phường Tiền An%',
      '2026-09-08 00:00:00', '2026-09-09 00:00:00'
    );
    const listItems = db.prepare(`
      SELECT product_id, quantity FROM order_items
      WHERE order_id = ? AND product_id IS NOT NULL
    `);
    const restoreStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
    const deleteOrder = db.prepare('DELETE FROM orders WHERE id = ?');
    for (const order of candidates) {
      if (order.status !== 'cancelled') {
        for (const item of listItems.all(order.id)) restoreStock.run(item.quantity, item.product_id);
      }
      removed += deleteOrder.run(order.id).changes;
    }
    db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(residualTestOrderCleanup);
  })();
  console.log(`✅ Đã dọn ${removed} đơn kiểm thử còn sót sau khi tài khoản bị đổi tên.`);
}

/* ------------------------------------------------------------------ *
 * Bộ lọc danh mục cho khách (26/09/2026)
 * ------------------------------------------------------------------ */
{
  const productColumns = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);

  // Nhóm hàng: mọi sản phẩm cũ đều là gạo; cửa hàng tự đổi khi bán thêm đồ khô.
  if (!productColumns.includes('category')) {
    db.exec("ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT 'gao'");
    console.log('✅ Đã thêm cột category vào bảng products.');
  }

  // Giá gốc trước khi giảm. Chỉ để hiển thị nhãn giảm giá: khách luôn trả đúng
  // cột price, nên đơn hàng và hoá đơn quầy không phải đổi cách tính tiền.
  if (!productColumns.includes('original_price')) {
    db.exec('ALTER TABLE products ADD COLUMN original_price INTEGER NOT NULL DEFAULT 0');
    console.log('✅ Đã thêm cột original_price vào bảng products.');
  }
}

/* ------------------------------------------------------------------ *
 * Banner đổi được ảnh, mã đơn online, đợt giảm giá đầu tiên (26/09/2026)
 * ------------------------------------------------------------------ */

// Cài đặt cửa hàng dạng khoá–giá trị. Hiện chỉ có ảnh banner trang chủ.
db.exec(`
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Mã đơn online dạng DH000123, cùng kiểu với mã hoá đơn quầy HD000123.
// Lưu hẳn vào đơn để tra cứu và xuất Excel dùng đúng một mã.
if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'code')) {
  db.exec('ALTER TABLE orders ADD COLUMN code TEXT');
  console.log('✅ Đã thêm cột code vào bảng orders.');
}
{
  const missing = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE code IS NULL').get().n;
  if (missing) {
    db.transaction(() => {
      db.prepare(`UPDATE orders SET code = 'DH' || printf('%06d', id) WHERE code IS NULL`).run();
    })();
    console.log(`✅ Đã tạo mã cho ${missing} đơn online cũ.`);
  }
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_code ON orders(code)');

// Đợt giảm giá cửa hàng yêu cầu ngày 26/09/2026. Giá bán hạ theo phần trăm,
// giá cũ chuyển sang giá gốc để khách thấy nhãn giảm giá. Chỉ chạy một lần, và
// bỏ qua sản phẩm đã đang giảm giá hoặc chưa có giá, để không giảm chồng lên.
// Nhận sản phẩm bằng ảnh bao bì + quy cách thay vì id, vì id có thể khác nhau
// giữa các cơ sở dữ liệu.
const firstSaleMigration = '2026-09-26-first-sale-cm4mua-cmthom-25pct-cm25-que25-5pct';
if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(firstSaleMigration)) {
  const plan = [
    { image: '/products/co-may-4-mua-5kg.jpg', unit: 'túi 5kg', percent: 25 },       // Gạo 4 Mùa Cỏ May
    { image: '/products/co-may-thom-deo-vua-5kg.jpg', unit: 'túi 5kg', percent: 25 }, // Cỏ May thơm, bao hình bông sen
    { image: '/products/co-may-thom-deo-vua-25kg.jpg', unit: 'bao 25kg', percent: 5 }, // Gạo Cỏ May bao 25kg
    { image: '/products/gao-thom-que-25kg.jpg', unit: 'bao 25kg', percent: 5 },        // Gạo Quê bao 25kg
  ];
  let applied = 0;
  db.transaction(() => {
    const find = db.prepare(`
      SELECT id, name, price FROM products
      WHERE image_url = ? AND unit = ? AND price > 0 AND original_price = 0
    `);
    const discount = db.prepare('UPDATE products SET original_price = price, price = ? WHERE id = ? AND original_price = 0');
    for (const item of plan) {
      for (const product of find.all(item.image, item.unit)) {
        // Giữ số nguyên đồng: 5% của 470.000đ là 446.500đ.
        const salePrice = Math.round((product.price * (100 - item.percent)) / 100);
        applied += discount.run(salePrice, product.id).changes;
        console.log(`   · ${product.name}: ${product.price}đ → ${salePrice}đ (giảm ${item.percent}%)`);
      }
    }
    db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(firstSaleMigration);
  })();
  console.log(`✅ Đợt giảm giá 26/09: đã áp dụng cho ${applied} sản phẩm.`);
}


/* ------------------------------------------------------------------ *
 * 02/10/2026: định vị giao hàng, điểm theo loại gạo, phân loại khách,
 * đổi 1.000 điểm lấy voucher 30.000đ hoặc 1kg gạo nếp / gạo lứt / mì chũ.
 * ------------------------------------------------------------------ */
{
  const addColumn = (table, column, definition) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`✅ Đã thêm cột ${column} vào bảng ${table}.`);
    }
  };

  // Vị trí khách tự ghim trên điện thoại (không bắt buộc). Đơn giữ bản sao lúc đặt.
  addColumn('delivery_addresses', 'latitude', 'REAL');
  addColumn('delivery_addresses', 'longitude', 'REAL');
  addColumn('delivery_addresses', 'location_accuracy', 'REAL');
  addColumn('orders', 'delivery_lat', 'REAL');
  addColumn('orders', 'delivery_lng', 'REAL');

  // Điểm riêng cho mỗi túi/bao. NULL = theo tiền (1.000đ = 1 điểm), 0 = không cộng điểm.
  addColumn('products', 'points_per_unit', 'INTEGER');
  // Dòng hàng giữ quy tắc điểm lúc đặt, để đổi cài đặt sau này không làm sai đơn cũ.
  addColumn('order_items', 'points_per_unit', 'INTEGER');
  addColumn('order_items', 'is_reward', 'INTEGER NOT NULL DEFAULT 0');

  // Đổi điểm trong đơn online: voucher, số điểm đã trừ và hồ sơ đã trừ (để hoàn khi huỷ).
  addColumn('orders', 'voucher_discount', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('orders', 'points_used', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('orders', 'points_phone', 'TEXT');
  addColumn('retail_invoices', 'voucher_discount', 'INTEGER NOT NULL DEFAULT 0');

  // Khách thường / nhà hàng / buôn · đại lý, theo số điện thoại.
  addColumn('retail_customers', 'segment', "TEXT NOT NULL DEFAULT 'thuong'");
}

// Đặt hàng nhanh không cần tài khoản (03/10/2026). Bảng orders bắt buộc có user_id, nên các
// đơn này đứng tên một tài khoản hệ thống role = 'guest': không email, không số điện thoại,
// bị khoá và mật khẩu không phải bcrypt, nên không ai đăng nhập được. Các truy vấn khách hàng
// đều lọc role = 'customer' nên tài khoản này không hiện trong danh sách khách.
if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'is_guest')) {
  db.exec('ALTER TABLE orders ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0');
  console.log('✅ Đã thêm cột is_guest vào bảng orders.');
}
// Mã băm của mã bí mật trả cho trình duyệt vừa đặt đơn: dùng một lần để gắn đơn vào tài khoản
// nếu khách tạo tài khoản ngay sau khi đặt.
if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'guest_token_hash')) {
  db.exec('ALTER TABLE orders ADD COLUMN guest_token_hash TEXT');
  console.log('✅ Đã thêm cột guest_token_hash vào bảng orders.');
}
if (!db.prepare("SELECT 1 FROM users WHERE role = 'guest'").get()) {
  db.transaction(() => {
    db.prepare(`
      INSERT INTO users (full_name, email, password_hash, phone, address, role, is_locked)
      VALUES ('Khách mua nhanh (không tài khoản)', NULL, '!no-login', NULL, NULL, 'guest', 1)
    `).run();
  })();
  console.log('✅ Đã tạo tài khoản hệ thống cho đơn mua nhanh.');
}

// Trả hàng tại quầy trừ lại điểm của phần tiền đã hoàn (03/10/2026): ghi số điểm đã trừ
// vào phiếu để các lần trả tiếp theo không trừ trùng.
if (!db.prepare('PRAGMA table_info(retail_returns)').all().some((c) => c.name === 'points_removed')) {
  db.exec('ALTER TABLE retail_returns ADD COLUMN points_removed INTEGER NOT NULL DEFAULT 0');
  console.log('✅ Đã thêm cột points_removed vào bảng retail_returns.');
}

// Dòng quà khuyến mãi theo đợt (16/10/2026): ghi mã đợt để hiển thị "Quà 20/10" và để báo cáo
// phân biệt với hàng bán và quà đổi điểm.
for (const table of ['order_items', 'retail_invoice_items']) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'promo')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN promo TEXT`);
    console.log(`✅ Đã thêm cột promo vào bảng ${table}.`);
  }
}

// Nhóm gạo do cửa hàng tự tạo (21/10/2026): một sản phẩm thuộc được nhiều nhóm.
db.exec(`
CREATE TABLE IF NOT EXISTS product_groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS product_group_items (
  group_id   INTEGER NOT NULL REFERENCES product_groups(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_product_group_items_product ON product_group_items(product_id);
`);

// Tạo sẵn các nhóm cửa hàng nêu ví dụ và gắn sản phẩm theo tên / quy cách. Chạy một lần, chỉ khi
// chưa có nhóm nào; sau đó cửa hàng tự sửa trong trang quản trị. Hai nhóm cũ "nha-hang" và "do-kho"
// giữ đúng mã để đường dẫn bộ lọc cũ vẫn dùng được.
const seedGroups = '2026-10-21-seed-product-groups';
if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(seedGroups)) {
  db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM product_groups LIMIT 1').get()) {
      const plan = [
        ['nha-hang', 'Gạo nhà hàng', "category = 'gao' AND (weight_kg >= 25 OR name LIKE '%nhà hàng%')"],
        ['tui-5kg', 'Gạo túi bóng 5kg', "category = 'gao' AND weight_kg = 5"],
        ['co-may', 'Gạo Cỏ May', "name LIKE '%cỏ may%'"],
        ['thom-thai', 'Gạo thơm Thái', "category = 'gao' AND name LIKE '%thái%'"],
        ['di-le', 'Gạo đi lễ', "category = 'gao' AND (name LIKE '%lứt%' OR name LIKE '%nếp%' OR weight_kg = 2)"],
        ['dinh-duong', 'Gạo dinh dưỡng', "name LIKE '%kê%' OR name LIKE '%đường huyết%'"],
        ['do-kho', 'Thực phẩm khô', "category = 'do-kho'"],
      ];
      const insertGroup = db.prepare('INSERT INTO product_groups (slug, name, sort_order) VALUES (?, ?, ?)');
      plan.forEach(([slug, name, rule], index) => {
        const groupId = insertGroup.run(slug, name, index + 1).lastInsertRowid;
        // Điều kiện là chuỗi cố định trong mã nguồn, không ghép dữ liệu người dùng.
        const added = db.prepare(`INSERT INTO product_group_items (group_id, product_id) SELECT ?, id FROM products WHERE ${rule}`)
          .run(groupId).changes;
        console.log(`   · Nhóm "${name}": ${added} sản phẩm`);
      });
      console.log('✅ Đã tạo các nhóm gạo mặc định.');
    }
    db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(seedGroups);
  })();
}

// 21/10/2026: bao "Gạo Cỏ May ST25 - 25KG" bị nhập khối lượng 50kg, nên mua 1 bao được tính 50kg
// (tặng 3kg nếp thay vì 1kg, và tính sai mốc 50kg giảm giá tại quầy). Chỉ sửa đúng trường hợp tên
// ghi 25kg mà khối lượng đang là 50; chạy một lần.
const fix25kgWeight = '2026-10-21-fix-25kg-bag-weight-50';
if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(fix25kgWeight)) {
  db.transaction(() => {
    const rows = db.prepare(`
      SELECT id, name FROM products
      WHERE weight_kg = 50 AND (name LIKE '%25kg%' OR name LIKE '%25 kg%') AND name NOT LIKE '%50kg%'
    `).all();
    const fix = db.prepare('UPDATE products SET weight_kg = 25 WHERE id = ?');
    for (const row of rows) {
      fix.run(row.id);
      console.log(`   · ${row.name}: khối lượng 50kg → 25kg`);
    }
    db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(fix25kgWeight);
    console.log(`✅ Đã sửa khối lượng ${rows.length} bao 25kg bị nhập 50kg.`);
  })();
}

// Quà đổi 1.000 điểm theo yêu cầu cửa hàng ngày 02/10/2026: 1kg gạo nếp, 1kg gạo lứt
// hoặc 1kg mì chũ (cùng voucher 30.000đ). Kê vàng không còn nằm trong danh sách quà.
// Chỉ chạy một lần; sau đó chủ cửa hàng tự bật/tắt ở form sản phẩm.
const rewardsOct2026 = '2026-10-02-rewards-nep-lut-michu-1kg';
if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(rewardsOct2026)) {
  db.transaction(() => {
    const on = db.prepare(`
      UPDATE products SET is_reward = 1
      WHERE is_reward = 0 AND (
        (lower(name) LIKE '%mì chũ%' OR lower(name) LIKE '%mỳ chũ%' OR lower(name) LIKE '%mi chu%')
        AND (unit = 'kg' OR unit LIKE '%1kg%' OR unit LIKE '%1 kg%')
      )
    `).run().changes;
    const off = db.prepare(`
      UPDATE products SET is_reward = 0 WHERE is_reward = 1 AND name LIKE '%ê vàng%'
    `).run().changes;
    db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(rewardsOct2026);
    console.log(`✅ Quà đổi điểm: bật ${on} loại mì chũ 1kg, tắt ${off} loại kê vàng.`);
  })();
}

// Thông báo đẩy (Web Push) cho chủ cửa hàng, 24/10/2026: mỗi dòng là một trình duyệt/điện thoại đã
// bật "thông báo khi tắt màn hình". Lưu độc lập với phiên đăng nhập: hết phiên hay đăng xuất thì
// máy vẫn nhận báo đơn; chỉ ngừng khi bấm Tắt trên máy đó, khi dịch vụ push báo máy đã huỷ
// (404/410), hoặc khi tài khoản không còn là quản trị / bị khoá (lọc lúc gửi).
db.exec(`
CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_push_subscriptions_user ON admin_push_subscriptions(user_id);
`);

// 24/10/2026: giờ của từng bước xử lý đơn, để khách tra cứu tiến độ giao bằng SĐT + mã đơn.
{
  const columns = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  for (const column of ['confirmed_at', 'shipping_at', 'completed_at', 'cancelled_at']) {
    if (!columns.includes(column)) {
      db.exec(`ALTER TABLE orders ADD COLUMN ${column} TEXT`);
      console.log(`✅ Đã thêm cột ${column} vào bảng orders.`);
    }
  }
}

// Trang "Về chúng tôi": giấy tờ (an toàn thực phẩm, công bố sản phẩm…) và đánh giá dịch vụ giao
// hàng cửa hàng gom từ nhóm Zalo. Cả hai do quản trị viên nhập; khách chỉ xem.
db.exec(`
CREATE TABLE IF NOT EXISTS about_documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'khac' CHECK (category IN ('attp', 'cong-bo', 'khac')),
  image_url   TEXT NOT NULL,
  note        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_visible  INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS service_reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT,
  content       TEXT NOT NULL,
  score         INTEGER CHECK (score IS NULL OR (score BETWEEN 1 AND 6)),
  review_date   TEXT,
  is_visible    INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// 01/11/2026: mã giảm giá khách tự nhập khi đặt hàng. Mỗi đơn chỉ một khuyến mãi (đơn đầu hoặc mã).
db.exec(`
CREATE TABLE IF NOT EXISTS discount_codes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  starts_on       TEXT,
  ends_on         TEXT,
  min_subtotal    INTEGER NOT NULL DEFAULT 0,
  per_phone_limit INTEGER NOT NULL DEFAULT 0,
  max_uses        INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
{
  const columns = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (!columns.includes('discount_code')) db.exec('ALTER TABLE orders ADD COLUMN discount_code TEXT');
  if (!columns.includes('code_discount')) db.exec('ALTER TABLE orders ADD COLUMN code_discount INTEGER NOT NULL DEFAULT 0');
  // Phí giao hàng (09/11/2026): đã tính trong orders.total. Đơn cũ giữ 0 vì trước đây giao miễn phí.
  if (!columns.includes('shipping_fee')) db.exec('ALTER TABLE orders ADD COLUMN shipping_fee INTEGER NOT NULL DEFAULT 0');
}
// Mã tháng 11/2026 theo yêu cầu cửa hàng: GAOKINHBAC11 giảm 10.000đ, 01/11 – 30/11/2026. Chạy một lần;
// sau đó cửa hàng tự sửa / tắt trong trang quản trị.
const novemberCode = '2026-11-01-code-gaokinhbac11';
if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(novemberCode)) {
  db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO discount_codes (code, amount, starts_on, ends_on, note)
      VALUES ('GAOKINHBAC11', 10000, '2026-11-01', '2026-11-30', 'Mã tháng 11/2026')
    `).run();
    db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(novemberCode);
    console.log('✅ Đã tạo mã giảm giá GAOKINHBAC11 (giảm 10.000đ, 01/11 – 30/11/2026).');
  })();
}

// 01/11/2026: tài khoản nhân viên (role = 'staff') với quyền do chủ cửa hàng cấp, và đơn có người
// giao / người tạo / nguồn tạo / cách nhận hàng.
{
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userColumns.includes('permissions')) db.exec('ALTER TABLE users ADD COLUMN permissions TEXT');
  if (!userColumns.includes('staff_title')) db.exec('ALTER TABLE users ADD COLUMN staff_title TEXT');
  const orderColumns = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (!orderColumns.includes('shipper_id')) db.exec('ALTER TABLE orders ADD COLUMN shipper_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
  if (!orderColumns.includes('created_by')) db.exec('ALTER TABLE orders ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
  if (!orderColumns.includes('source')) db.exec("ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'online'");
  if (!orderColumns.includes('fulfillment')) db.exec("ALTER TABLE orders ADD COLUMN fulfillment TEXT NOT NULL DEFAULT 'delivery'");
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_shipper ON orders(shipper_id, status)');
}

// 12/11/2026: ảnh chứng từ giao hàng / hoá đơn nợ (riêng tư, không nằm trong kho ảnh sản phẩm công
// khai), đơn công nợ duyệt nhiều cấp, và phiếu đóng ngày của kế toán.
db.exec(`
CREATE TABLE IF NOT EXISTS proof_photos (
  id          TEXT PRIMARY KEY,
  mime        TEXT NOT NULL,
  bytes       BLOB NOT NULL,
  size        INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS debt_accounts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  phone        TEXT NOT NULL UNIQUE,
  contact_name TEXT NOT NULL,
  company      TEXT,
  term_days    INTEGER NOT NULL DEFAULT 15 CHECK (term_days BETWEEN 1 AND 365),
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS debt_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  account_id      INTEGER NOT NULL REFERENCES debt_accounts(id),
  amount          INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending_accounting'
                  CHECK (status IN ('pending_accounting', 'pending_final', 'open', 'paid_pending_final', 'settled', 'rejected')),
  delivered_photo TEXT NOT NULL,
  invoice_photo   TEXT NOT NULL,
  delivered_on    TEXT NOT NULL,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  accounting_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  accounting_at   TEXT,
  final_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  final_at        TEXT,
  paid_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  paid_at         TEXT,
  paid_method     TEXT CHECK (paid_method IS NULL OR paid_method IN ('cash', 'transfer')),
  settled_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  settled_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_debt_records_status ON debt_records(status, account_id);
CREATE TABLE IF NOT EXISTS debt_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id    INTEGER NOT NULL REFERENCES debt_records(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name  TEXT,
  action     TEXT NOT NULL,
  comment    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_debt_events_debt ON debt_events(debt_id, id);
CREATE TABLE IF NOT EXISTS day_closings (
  day        TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  closed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closer_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
{
  const columns = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (!columns.includes('delivery_photo')) db.exec('ALTER TABLE orders ADD COLUMN delivery_photo TEXT');
  if (!columns.includes('payment_status')) db.exec("ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'normal'");
}

// 09/11/2026: bỏ bước mẹ duyệt ở giữa (mẹ chỉ duyệt tất toán). Khoản đang chờ bước đó đã được kế
// toán duyệt nên chuyển sang "Đang nợ" để không bị kẹt.
const dropMiddleApproval = '2026-11-09-debt-drop-middle-approval';
if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(dropMiddleApproval)) {
  db.transaction(() => {
    const moved = db.prepare("UPDATE debt_records SET status = 'open', updated_at = datetime('now') WHERE status = 'pending_final'").run().changes;
    db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(dropMiddleApproval);
    console.log(`✅ Công nợ: chuyển ${moved} khoản chờ mẹ duyệt sang đang nợ.`);
  })();
}

// 09/11/2026: cửa hàng yêu cầu xoá đơn thử DH000257 (tên "testing"). Chỉ khớp đúng đơn đó; hoàn lại tồn
// kho và điểm đơn đã cộng, xoá đơn nợ, ảnh chứng từ và khách nợ không còn đơn nào. Chạy một lần.
const deleteTestOrder = '2026-11-09-delete-test-order-dh000257';
if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(deleteTestOrder)) {
  db.transaction(() => {
    const order = db.prepare(`
      SELECT * FROM orders WHERE code = 'DH000257' AND receiver_name = 'testing' AND phone = '0398196786'
        AND total = 480000 AND payment_status = 'debt'
    `).get();
    if (order) {
      const restock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
      for (const item of db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ? AND product_id IS NOT NULL').all(order.id)) {
        restock.run(item.quantity, item.product_id);
      }
      const loyaltyPhone = order.is_guest ? order.phone : db.prepare('SELECT phone FROM users WHERE id = ?').get(order.user_id)?.phone;
      if (loyaltyPhone && order.points_earned > 0) {
        db.prepare(`
          UPDATE retail_customers SET points = MAX(0, points - ?), total_spent = MAX(0, total_spent - ?),
            visit_count = MAX(0, visit_count - 1), updated_at = datetime('now') WHERE phone = ?
        `).run(order.points_earned, order.total, loyaltyPhone);
      }
      const debt = db.prepare('SELECT id, account_id, delivered_photo, invoice_photo FROM debt_records WHERE order_id = ?').get(order.id);
      if (debt) {
        db.prepare('DELETE FROM debt_events WHERE debt_id = ?').run(debt.id);
        db.prepare('DELETE FROM debt_records WHERE id = ?').run(debt.id);
        db.prepare('DELETE FROM proof_photos WHERE id IN (?, ?)').run(debt.delivered_photo, debt.invoice_photo);
        db.prepare('DELETE FROM debt_accounts WHERE id = ? AND NOT EXISTS (SELECT 1 FROM debt_records WHERE account_id = ?)').run(debt.account_id, debt.account_id);
      }
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(order.id);
      db.prepare('DELETE FROM orders WHERE id = ?').run(order.id);
      db.prepare(`
        INSERT INTO admin_audit_logs (actor_name, action, entity_type, entity_id, before_json)
        VALUES ('Theo yêu cầu cửa hàng', 'delete_test_order', 'order', ?, ?)
      `).run(String(order.id), JSON.stringify({ code: order.code, total: order.total, points_earned: order.points_earned }));
      console.log('✅ Đã xoá đơn thử DH000257, hoàn kho và điểm.');
    }
    db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(deleteTestOrder);
  })();
}

  // Chuyển khoản (12/11/2026): khách gửi ảnh đã chuyển khoản, cửa hàng xác nhận đã nhận tiền sau.
  {
    const cols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
    if (!cols.includes('transfer_proof')) db.exec('ALTER TABLE orders ADD COLUMN transfer_proof TEXT');
    if (!cols.includes('transfer_reported_at')) db.exec('ALTER TABLE orders ADD COLUMN transfer_reported_at TEXT');
    if (!cols.includes('transfer_confirmed_at')) db.exec('ALTER TABLE orders ADD COLUMN transfer_confirmed_at TEXT');
    if (!cols.includes('transfer_confirmed_by')) db.exec('ALTER TABLE orders ADD COLUMN transfer_confirmed_by INTEGER REFERENCES users(id)');
  }

  // Thứ tự toàn bộ sản phẩm trên trang chủ (12/11/2026), kéo thả ở trang quản trị. Ban đầu giữ đúng thứ tự
  // khách đang thấy: hàng đang giảm giá trước, rồi theo mã sản phẩm.
  if (!db.prepare('PRAGMA table_info(products)').all().some((c) => c.name === 'sort_order')) {
    db.exec('ALTER TABLE products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
    db.prepare(`
      UPDATE products SET sort_order = (
        SELECT r FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY (original_price > price AND price > 0) DESC, id) AS r FROM products) x
        WHERE x.id = products.id)
    `).run();
  }

  // Thứ tự sản phẩm trong từng nhóm (11/11/2026), kéo thả ở trang quản trị. Ban đầu theo mã sản phẩm.
  if (!db.prepare('PRAGMA table_info(product_group_items)').all().some((c) => c.name === 'sort_order')) {
    db.exec('ALTER TABLE product_group_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
    db.prepare('UPDATE product_group_items SET sort_order = product_id').run();
  }

  // Khách buôn (11/11/2026): mã cố định KB…, bảng giá cố định theo từng loại gạo, gắn tài khoản đăng nhập.
  db.exec(`
    CREATE TABLE IF NOT EXISTS wholesale_customers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      code         TEXT UNIQUE,
      company      TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      phone        TEXT NOT NULL,
      address      TEXT,
      note         TEXT,
      user_id      INTEGER UNIQUE REFERENCES users(id),
      is_active    INTEGER NOT NULL DEFAULT 1,
      created_by   INTEGER REFERENCES users(id),
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT
    );
    CREATE TABLE IF NOT EXISTS wholesale_prices (
      customer_id INTEGER NOT NULL REFERENCES wholesale_customers(id) ON DELETE CASCADE,
      product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      price       INTEGER NOT NULL CHECK (price > 0),
      updated_by  INTEGER REFERENCES users(id),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (customer_id, product_id)
    );
  `);
  if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'wholesale_customer_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN wholesale_customer_id INTEGER REFERENCES wholesale_customers(id)');
  }
  // Định vị (12/11/2026): link Google Maps nhân viên dán khi tạo đơn, và định vị lưu sẵn của khách buôn.
  if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'map_url')) {
    db.exec('ALTER TABLE orders ADD COLUMN map_url TEXT');
  }
  if (!db.prepare('PRAGMA table_info(wholesale_customers)').all().some((c) => c.name === 'map_url')) {
    db.exec('ALTER TABLE wholesale_customers ADD COLUMN map_url TEXT');
  }

  // Chấm công (11/11/2026): mỗi người một dòng mỗi ngày; giờ lưu UTC, ngày công theo giờ Việt Nam.
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      work_date  TEXT NOT NULL,
      clock_in   TEXT NOT NULL,
      clock_out  TEXT,
      note       TEXT,
      edited_by  INTEGER REFERENCES users(id),
      edited_at  TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, work_date)
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(work_date);
  `);

  // Hai kho (13/11/2026): Cửa hàng Nguyễn Cao (products.stock — kho bán lẻ, bán web, bán tại quầy) và
  // Kho Bồ Sơn (products.stock_bs — kho tổng, nhận công gạo, xuất bán sỉ). Mọi thay đổi tồn ghi một dòng
  // vào stock_movements, nên tồn một kho = tổng quantity các dòng nhật ký của kho đó.
  const productColumns = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
  if (!productColumns.includes('stock_bs')) db.exec('ALTER TABLE products ADD COLUMN stock_bs INTEGER NOT NULL DEFAULT 0');
  if (!productColumns.includes('sku')) db.exec('ALTER TABLE products ADD COLUMN sku TEXT');
  if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'warehouse')) {
    db.exec("ALTER TABLE orders ADD COLUMN warehouse TEXT NOT NULL DEFAULT 'KH_NC'");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS warehouses (
      code       TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      kind       TEXT NOT NULL,            -- store: cửa hàng bán lẻ · main: kho tổng
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO warehouses (code, name, kind, sort_order) VALUES
      ('KH_NC', 'Cửa hàng Nguyễn Cao', 'store', 1),
      ('KH_BS', 'Kho Bồ Sơn', 'main', 2);
    CREATE TABLE IF NOT EXISTS stock_movements (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name  TEXT NOT NULL,         -- chụp lại tên lúc ghi, xoá sản phẩm vẫn còn lịch sử
      unit          TEXT,
      warehouse     TEXT NOT NULL REFERENCES warehouses(code),
      kind          TEXT NOT NULL,         -- opening, receipt, transfer_out, transfer_in, order, counter, count…
      quantity      INTEGER NOT NULL,      -- dương: vào kho · âm: ra kho
      balance_after INTEGER NOT NULL,      -- tồn của kho này ngay sau biến động
      ref_type      TEXT,                  -- receipt, transfer, order, retail_invoice
      ref_id        INTEGER,
      ref_code      TEXT,
      note          TEXT,
      created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name    TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse ON stock_movements(warehouse, id DESC);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at);
    CREATE TABLE IF NOT EXISTS stock_receipts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      code       TEXT UNIQUE,              -- NK000123
      kind       TEXT NOT NULL,            -- cong-gao · cua-hang
      source     TEXT,                     -- nguồn nhập / nhà cung cấp
      vehicle    TEXT,                     -- số xe, số container
      note       TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS stock_receipt_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id   INTEGER NOT NULL REFERENCES stock_receipts(id) ON DELETE CASCADE,
      product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      unit         TEXT,
      warehouse    TEXT NOT NULL REFERENCES warehouses(code),
      quantity     INTEGER NOT NULL CHECK (quantity > 0),
      cost_price   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_stock_receipt_items_receipt ON stock_receipt_items(receipt_id);
    CREATE TABLE IF NOT EXISTS stock_transfers (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      code           TEXT UNIQUE,          -- DC000123
      from_warehouse TEXT NOT NULL REFERENCES warehouses(code),
      to_warehouse   TEXT NOT NULL REFERENCES warehouses(code),
      status         TEXT NOT NULL DEFAULT 'in_transit',   -- in_transit · received · cancelled
      note           TEXT,
      created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name     TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      received_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      receiver_name  TEXT,
      received_at    TEXT,
      receive_note   TEXT,
      cancelled_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      cancelled_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers(status, id DESC);
    CREATE TABLE IF NOT EXISTS stock_transfer_items (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      transfer_id       INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
      product_id        INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name      TEXT NOT NULL,
      unit              TEXT,
      quantity          INTEGER NOT NULL CHECK (quantity > 0),
      received_quantity INTEGER           -- số thực nhận khi xác nhận; nhỏ hơn quantity = thiếu trên đường
    );
    CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer ON stock_transfer_items(transfer_id);
  `);
  // Số tồn đang có trước ngày chia hai kho là tồn đầu kỳ của Cửa hàng Nguyễn Cao (số tồn không đổi, chỉ
  // ghi thêm dòng nhật ký mở đầu). Kho Bồ Sơn bắt đầu từ 0, cửa hàng tự nhập tồn đầu kỳ thật.
  if (!db.prepare("SELECT 1 FROM app_migrations WHERE name = 'stock-opening-2026-11-13'").get()) {
    db.prepare(`
      INSERT INTO stock_movements (product_id, product_name, unit, warehouse, kind, quantity, balance_after, note)
      SELECT id, name, unit, 'KH_NC', 'opening', stock, stock, 'Số tồn đang có khi bắt đầu quản lý hai kho'
      FROM products WHERE stock <> 0
    `).run();
    db.prepare("INSERT OR IGNORE INTO app_migrations (name) VALUES ('stock-opening-2026-11-13')").run();
  }

  // Mua kèm / upsale (13/11/2026): sản phẩm có upsell_rank hiện ở giỏ hàng khách, gắn nhãn HOT, xếp theo số
  // này (NULL = không upsale). Lần đầu: trứng gà (cửa hàng yêu cầu "thêm trứng gà vào giỏ hàng, 30 quả 92k").
  if (!db.prepare('PRAGMA table_info(products)').all().some((c) => c.name === 'upsell_rank')) {
    db.exec('ALTER TABLE products ADD COLUMN upsell_rank INTEGER');
  }
  if (!db.prepare("SELECT 1 FROM app_migrations WHERE name = 'upsell-eggs-2026-11-13'").get()) {
    if (!db.prepare('SELECT 1 FROM products WHERE upsell_rank IS NOT NULL').get()) {
      db.prepare("UPDATE products SET upsell_rank = 1 WHERE id = (SELECT id FROM products WHERE is_active = 1 AND LOWER(name) LIKE '%trứng gà%' ORDER BY id LIMIT 1)").run();
    }
    db.prepare("INSERT OR IGNORE INTO app_migrations (name) VALUES ('upsell-eggs-2026-11-13')").run();
  }

  db.prepare('INSERT OR IGNORE INTO app_migrations (name) VALUES (?)').run(SCHEMA_VERSION);
}
