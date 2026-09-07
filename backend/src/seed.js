import 'dotenv/config';
import bcrypt from 'bcryptjs';
import db from './db.js';
import { isEmail } from './validate.js';
import { newPassword } from './schemas.js';

// Tài khoản quản trị đầu tiên. Có thể đặt qua biến môi trường khi cài đặt thật:
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed
const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const existingAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
if (ADMIN_EMAIL) {
  const existing = db.prepare('SELECT role FROM users WHERE email = ?').get(ADMIN_EMAIL);
  if (existing && existing.role !== 'admin') throw new Error('ADMIN_EMAIL belongs to a customer; choose a different administrator address.');
}
if (!existingAdmin || ADMIN_EMAIL || ADMIN_PASSWORD) {
  if (!isEmail(ADMIN_EMAIL) || !newPassword.safeParse(ADMIN_PASSWORD).success
      || /^(admin123|dat_mat_khau|change.?me)/i.test(ADMIN_PASSWORD)) {
    throw new Error('Set ADMIN_EMAIL and a strong ADMIN_PASSWORD (12+ characters, at most 72 UTF-8 bytes) before seeding.');
  }
}

/**
 * TỒN KHO LÀ SỐ TẠM.
 * Cửa hàng mới cung cấp bảng giá, chưa có số lượng còn lại của từng loại.
 * Mỗi loại được đặt tạm 100 để cửa hàng chạy thử được trọn luồng đặt hàng.
 * Chủ cửa hàng phải sửa lại trong /quan-tri → Sản phẩm trước khi bán thật.
 */
const STOCK_PLACEHOLDER = Number(process.env.SEED_STOCK ?? 100);

/**
 * Danh mục và giá theo bảng giá cửa hàng gửi ngày 04/09/2026.
 * `price` tính bằng đồng cho MỘT đơn vị đóng gói ghi ở `unit`.
 * `price: 0` nghĩa là cửa hàng chưa báo giá — khách không đặt mua được.
 */
const products = [
  /* ---------- Túi 5kg ---------- */
  { name: 'Gạo ST25 – Gạo sạch', origin: 'LVS – Bắc Ninh', unit: 'túi 5kg', price: 145_000,
    image: 'lvs-gao-sach-st25-5kg',
    description: 'Túi 5kg. Bao bì ghi: dẻo thơm, ngon đậm đà, giữ được vỏ cám mỡ, không tồn dư thuốc BVTV, không chất bảo quản.' },
  { name: 'Gạo ST25 Cỏ May cao cấp', origin: 'Cỏ May – Đặc sản Sóc Trăng', unit: 'túi 5kg', price: 160_000,
    image: 'co-may-st25-cao-cap-5kg',
    description: 'Túi 5kg, tinh hoa gạo Việt. Bao bì ghi “Gạo ngon nhất thế giới”, đạt tiêu chuẩn toàn cầu về chất lượng và an toàn thực phẩm.' },
  { name: 'Gạo 4 Mùa Cỏ May', origin: 'Cỏ May – Đồng Tháp', unit: 'túi 5kg', price: 140_000,
    image: 'co-may-4-mua-5kg',
    description: 'Túi 5kg thương hiệu Cỏ May. Trên bao bì ghi “Gạo thơm – Cơm ngon”.' },
  { name: 'Gạo Cỏ May thơm', origin: 'Cỏ May – Đồng Tháp', unit: 'túi 5kg', price: 120_000,
    image: 'co-may-thom-deo-vua-5kg',
    description: 'Túi 5kg, thơm dẻo vừa, bao bì hoa sen. Đạt tiêu chuẩn về chất lượng và an toàn thực phẩm.' },
  { name: 'Gạo Thái thơm đỏ', origin: 'LVS – Bắc Ninh', unit: 'túi 5kg', price: 120_000,
    image: 'lvs-thom-thai-do-5kg',
    description: 'Túi 5kg, gạo sạch chất lượng cao, dẻo thơm – ngon đậm đà.' },
  { name: 'Gạo Thơm Thái Vàng', origin: 'LVS – Bắc Ninh', unit: 'túi 5kg', price: 100_000,
    image: 'lvs-thom-thai-vang-5kg',
    description: 'Túi 5kg, gạo sạch chất lượng cao, dẻo thơm – ngon đậm đà.' },

  /* ---------- Túi / bao 10kg ---------- */
  { name: 'Gạo ST25 Cỏ May', origin: 'Cỏ May – Đặc sản Sóc Trăng', unit: 'bao 10kg', price: 300_000,
    image: 'st25-tinh-hoa-gao-viet-10kg',
    description: 'Bao 10kg, tinh hoa gạo Việt, đặc sản Sóc Trăng. Bao bì ghi “Gạo ngon nhất thế giới”.' },
  { name: 'Gạo ST25', origin: 'Đặc sản Sóc Trăng', unit: 'bao 10kg', price: 250_000,
    image: 'st25-tinh-tuy-gao-viet-10kg',
    description: 'Bao 10kg, gạo thơm thượng hạng, hạt dài trắng trong.' },
  { name: 'Gạo Lài Miên', origin: 'Khánh Vy TG – Đồng Tháp', unit: 'bao 10kg', price: 220_000,
    image: 'khanh-vy-thom-lai-mien-10kg',
    description: 'Bao 10kg, gạo thơm thượng hạng.' },
  { name: 'Gạo VIP', origin: 'Khánh Vy TG – Đồng Tháp', unit: 'bao 10kg', price: 220_000,
    image: 'khanh-vy-gao-vip-10kg',
    description: 'Bao 10kg thương hiệu Khánh Vy TG.' },
  { name: 'Gạo Sén Cù', origin: 'Tây Bắc', unit: 'bao 10kg', price: 220_000,
    description: 'Bao 10kg. Liên hệ cửa hàng nếu cần xem thêm hình ảnh bao bì.' },
  { name: 'Gạo Thái Hồng', origin: 'Việt Nam', unit: 'bao 10kg', price: 200_000,
    description: 'Bao 10kg. Liên hệ cửa hàng nếu cần xem thêm hình ảnh bao bì.' },
  { name: 'Gạo Bắc Hương', origin: 'Đặc sản lúa nước Việt Nam', unit: 'bao 10kg', price: 180_000,
    image: 'lvs-g9-bac-huong-10kg',
    description: 'Bao 10kg, gạo đặc sản. Bao bì ghi “Thơm dẻo – Ngon cơm”.' },
  { name: 'Gạo Thái', origin: 'Việt Nam', unit: 'bao 10kg', price: 180_000,
    description: 'Bao 10kg. Liên hệ cửa hàng nếu cần xem thêm hình ảnh bao bì.' },
  { name: 'Gạo Điện Biên', origin: 'Điện Biên', unit: 'bao 10kg', price: 170_000,
    image: 'lvs-g9-dien-bien-10kg',
    description: 'Bao 10kg, gạo đặc sản. Bao bì ghi “Thơm dẻo – Ngon cơm”.' },
  { name: 'Gạo Hải Hậu', origin: 'Hải Hậu – Nam Định', unit: 'bao 10kg', price: 170_000,
    image: 'lvs-g9-hai-hau-10kg',
    description: 'Bao 10kg, gạo đặc sản chất lượng cao.' },
  { name: 'Gạo BC', origin: 'Việt Nam', unit: 'bao 10kg', price: 160_000,
    description: 'Bao 10kg. Liên hệ cửa hàng nếu cần xem thêm hình ảnh bao bì.' },
  { name: 'Gạo Khang Dân', origin: 'Đặc sản lúa nước Việt Nam', unit: 'bao 10kg', price: 150_000,
    image: 'lvs-g9-khang-dan-10kg',
    description: 'Bao 10kg, gạo đặc sản, cơm khô ráo, phù hợp nấu ăn hằng ngày.' },

  /* ---------- Túi 1–2kg ---------- */
  { name: 'Gạo lứt Cỏ May', origin: 'Cỏ May – Đồng Tháp', unit: 'túi 2kg', price: 100_000,
    image: 'co-may-gao-lut-do-2kg',
    description: 'Gạo lứt đỏ, túi 2kg. Trên bao bì ghi “Cơm mềm dẻo – thơm ngon”.' },
  { name: 'Kê vàng', origin: 'Việt Nam', unit: 'túi 1kg', price: 50_000,
    description: 'Túi 1kg. Liên hệ cửa hàng nếu cần xem thêm hình ảnh bao bì.' },
  { name: 'Gạo nếp cái hoa vàng', origin: 'LVS – Bắc Ninh', unit: 'túi 1kg', price: 35_000,
    image: 'lvs-gao-nep-1kg',
    description: 'Túi 1kg, hạt tròn mẩy, dùng nấu xôi và gói bánh.' },
  { name: 'Gạo lứt', origin: 'LVS – Bắc Ninh', unit: 'túi 1kg', price: 35_000,
    image: 'lvs-gao-lut-den-1kg',
    description: 'Gạo lứt đen, túi 1kg, gạo sạch chất lượng cao.' },

  /* ---------- Bao 25kg — cửa hàng CHƯA báo giá ---------- */
  { name: 'Gạo Quê', origin: 'Việt Nam', unit: 'bao 25kg', price: 0,
    image: 'gao-thom-que-25kg',
    description: 'Bao 25kg, loại gạo bán chạy cho gia đình dùng thường xuyên.' },
  { name: 'Gạo Cỏ May', origin: 'Cỏ May – Đồng Tháp', unit: 'bao 25kg', price: 0,
    image: 'co-may-thom-deo-vua-25kg',
    description: 'Bao 25kg, thơm dẻo vừa, dành cho gia đình đông người hoặc dùng lâu dài.' },
  { name: 'Gạo Lài Miên', origin: 'Khánh Vy TG – Đồng Tháp', unit: 'bao 25kg', price: 0,
    image: 'khanh-vy-thom-lai-mien-25kg',
    description: 'Bao 25kg, gạo thơm thượng hạng.' },

  /* ---------- Có ảnh nhưng chưa khớp dòng nào trong bảng giá ---------- */
  { name: 'Gạo sạch G9 – ST25 (túi xanh)', origin: 'LVS – Bắc Ninh', unit: 'túi 5kg', price: 0,
    image: 'lvs-g9-st25-xanh-5kg',
    description: 'Túi 5kg, gạo sạch chất lượng cao, dẻo thơm – ngon đậm đà.' },
  { name: 'Gạo sạch G9 – ST25 (túi hồng)', origin: 'LVS – Bắc Ninh', unit: 'túi 5kg', price: 0,
    image: 'lvs-g9-st25-hong-5kg',
    description: 'Túi 5kg, gạo sạch chất lượng cao, dẻo thơm – ngon đậm đà.' },
  { name: 'Gạo ST25 (LVS túi vàng)', origin: 'LVS – Bắc Ninh', unit: 'túi 5kg', price: 0,
    image: 'lvs-st25-vang-5kg',
    description: 'Túi 5kg. Bao bì ghi “Thơm dẻo – Ngon cơm”, gạo sạch chất lượng cao.' },
  { name: 'Gạo thơm cơm dẻo', origin: 'Việt Nam', unit: 'bao 10kg', price: 0,
    image: 'gao-thom-com-deo-10kg',
    description: 'Bao 10kg. Bao bì ghi: gạo nguyên chất 100%, không chất bảo quản và hương liệu tạo mùi.' },
];

const tx = db.transaction(() => {
  if (ADMIN_EMAIL && !db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL)) {
    db.prepare(
      `INSERT INTO users (full_name, email, password_hash, phone, address, role)
       VALUES (?, ?, ?, NULL, NULL, 'admin')`
    ).run('Quản trị viên', ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 12));
    console.log(`✅ Tạo tài khoản quản trị: ${ADMIN_EMAIL}`);
  } else {
    console.log(`ℹ️  Tài khoản quản trị ${ADMIN_EMAIL} đã có sẵn, không tạo lại.`);
  }

  // Cùng tên nhưng khác quy cách đóng gói vẫn là hai sản phẩm khác nhau.
  const existed = db.prepare('SELECT id FROM products WHERE name = ? AND unit = ?');
  const ins = db.prepare(
    `INSERT INTO products (name, description, origin, price, unit, stock, image_url, is_reward)
     VALUES (@name, @description, @origin, @price, @unit, @stock, @image_url, @is_reward)`
  );

  let added = 0;
  for (const p of products) {
    if (existed.get(p.name, p.unit)) continue;
    ins.run({
      name: p.name,
      description: p.description,
      origin: p.origin,
      price: p.price,
      unit: p.unit,
      // Loại chưa có giá cũng chưa mở bán, để tồn kho 0 cho khỏi hiểu nhầm.
      stock: p.price > 0 ? STOCK_PLACEHOLDER : 0,
      image_url: p.image ? `/products/${p.image}.jpg` : null,
      is_reward: /1kg/.test(p.unit) && /nếp|lứt|ê vàng/.test(p.name) ? 1 : 0,
    });
    added++;
  }
  console.log(`✅ Thêm ${added} loại gạo.`);
});

tx();

const priced = db.prepare('SELECT COUNT(*) c FROM products WHERE price > 0').get().c;
const missing = db.prepare('SELECT COUNT(*) c FROM products WHERE price <= 0').get().c;

console.log(`\n📋 ${priced} loại đã có giá · ${missing} loại chưa có giá.`);
if (missing) {
  console.log('   Loại chưa có giá vẫn hiện với khách nhưng chưa đặt mua được:');
  for (const p of db.prepare('SELECT name, unit FROM products WHERE price <= 0 ORDER BY id').all()) {
    console.log(`     - ${p.name} (${p.unit})`);
  }
}
console.warn(
  `\n⚠️  TỒN KHO ĐANG LÀ SỐ TẠM (${STOCK_PLACEHOLDER} mỗi loại) vì cửa hàng chưa gửi số lượng thật.\n` +
  '   Phải sửa lại trong /quan-tri → Sản phẩm trước khi bán thật, nếu không sẽ nhận đơn quá số hàng đang có.'
);
console.log('\n🌾 Seed xong. Chạy `npm run dev` để khởi động API.');
