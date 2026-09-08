import { createHash } from 'node:crypto';
import { parseWeightKg } from './constants.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const remoteDatabaseUrl = process.env.LIBSQL_URL;
const { default: Database } = await import(remoteDatabaseUrl ? 'libsql' : 'better-sqlite3');

let db;
if (remoteDatabaseUrl) {
  db = new Database(remoteDatabaseUrl, { authToken: process.env.LIBSQL_AUTH_TOKEN });
  // libsql deliberately has no .pragma() helper. Sending the SQL statement
  // directly preserves the cascading constraints used by the application.
  db.exec('PRAGMA foreign_keys = ON');
} else {
  const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(path.join(dataDir, 'app.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
}

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
    const setWeight = db.prepare('UPDATE products SET weight_kg = ? WHERE id = ?');
    db.transaction(() => {
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

export default db;
