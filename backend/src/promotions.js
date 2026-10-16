import db from './db.js';
import { parseWeightKg } from './constants.js';

/**
 * Các đợt khuyến mãi tặng quà theo khối lượng gạo. Ngày tính theo giờ Việt Nam, gồm cả
 * ngày bắt đầu và ngày kết thúc. Máy chủ tự tính quà khi tạo đơn online / hoá đơn quầy;
 * trình duyệt chỉ hiển thị trước.
 *
 * Đợt 20/10/2026: từ 19 đến 21/10, mỗi 15kg gạo trong một đơn được tặng 1kg gạo nếp cái
 * hoa vàng, tối đa 3kg (từ 45kg trở lên vẫn chỉ 3kg).
 */
export const PROMOTIONS = [
  {
    code: '2010-nep',
    title: 'Khuyến mãi 20/10',
    start: '2026-10-19',
    end: '2026-10-21',
    minKg: 15,
    maxGiftKg: 3,
    giftName: 'Gạo nếp cái hoa vàng',
    // Sản phẩm dùng làm quà: túi 1kg có tên chứa chuỗi này.
    giftMatch: 'nếp cái hoa vàng',
  },
];

const VN_SHIFT_MS = 7 * 60 * 60 * 1000;

/** Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD. */
export function vietnamDate(date = new Date()) {
  return new Date(date.getTime() + VN_SHIFT_MS).toISOString().slice(0, 10);
}

/**
 * Ngày dùng để xét khuyến mãi. Bộ kiểm thử có thể ghim ngày bằng PROMO_TODAY; trên Vercel
 * (VERCEL_ENV luôn có) biến này bị bỏ qua để không ai bật nhầm khuyến mãi ngoài đợt.
 */
function promoToday() {
  const pinned = process.env.PROMO_TODAY;
  if (pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned) && !process.env.VERCEL_ENV) return pinned;
  return vietnamDate();
}

/** Đợt đang diễn ra hôm nay, hoặc null. */
export function activePromotion(today = promoToday()) {
  return PROMOTIONS.find((p) => today >= p.start && today <= p.end) || null;
}

/** Đợt đang diễn ra hoặc sắp diễn ra (để trang chủ báo trước), hoặc null. */
export function currentOrUpcomingPromotion(today = promoToday()) {
  return PROMOTIONS.find((p) => today <= p.end) || null;
}

/** Thông tin công khai cho trang khách. */
export function publicPromotion() {
  const promo = currentOrUpcomingPromotion();
  if (!promo) return null;
  return {
    code: promo.code, title: promo.title, start: promo.start, end: promo.end,
    min_kg: promo.minKg, max_gift_kg: promo.maxGiftKg, gift_name: promo.giftName,
  };
}

/** Tổng số kg GẠO (nhóm "gao", không tính đồ khô và quà) của các dòng [{ product, quantity }]. */
export function riceKgOf(lines) {
  return lines.reduce((sum, { product, quantity }) => {
    if (product.category && product.category !== 'gao') return sum;
    const kg = Number(product.weight_kg) || parseWeightKg(product.unit);
    return sum + kg * quantity;
  }, 0);
}

/** Số kg quà: mỗi `minKg` được 1kg, tối đa `maxGiftKg`. */
export function giftKgFor(riceKg, promo) {
  if (!promo) return 0;
  return Math.min(promo.maxGiftKg, Math.floor((riceKg + 1e-9) / promo.minKg));
}

/**
 * Quà khuyến mãi cho một đơn: { promo, kg, product } hoặc null nếu không được quà.
 * Gọi BÊN TRONG transaction của đơn (câu lệnh chuẩn bị tại chỗ, đúng yêu cầu của Turso).
 * product là túi 1kg dùng làm quà nếu còn bán; không có thì vẫn ghi quà theo tên để giao tay.
 */
export function promoGiftFor(lines) {
  const promo = activePromotion();
  const kg = giftKgFor(riceKgOf(lines), promo);
  if (!kg) return null;
  const product = db.prepare(`
    SELECT * FROM products
    WHERE is_active = 1 AND name LIKE ? AND (weight_kg = 1 OR unit LIKE '%1kg%' OR unit LIKE '%1 kg%')
    ORDER BY id LIMIT 1
  `).get(`%${promo.giftMatch}%`) || null;
  return { promo, kg, product };
}
