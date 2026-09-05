import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
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
  for (const row of duplicatePhones) {
    const owners = db
      .prepare('SELECT id, full_name, email FROM users WHERE phone = ? ORDER BY id')
      .all(row.phone);
    console.warn(`   ${row.phone} — ${row.c} tài khoản: ` +
      owners.map((u) => `#${u.id} ${u.full_name}${u.email ? ` <${u.email}>` : ''}`).join(', '));
  }
  console.warn(
    '   Chỉ tài khoản có id nhỏ nhất đăng nhập được bằng số điện thoại.\n' +
    '   Hãy sửa hoặc xoá số trùng trong trang quản trị rồi khởi động lại API.\n'
  );
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

export default db;
