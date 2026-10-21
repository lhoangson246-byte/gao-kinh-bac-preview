import db from './db.js';
import { parseWeightKg } from './constants.js';

/**
 * Các đợt khuyến mãi tặng quà theo khối lượng gạo. Ngày tính theo giờ Việt Nam, gồm cả
 * ngày bắt đầu và ngày kết thúc. Máy chủ tự tính quà khi tạo đơn online / hoá đơn quầy;
 * trình duyệt chỉ hiển thị trước.
 *
 * Đợt 20/10/2026 (19–21/10), theo bậc trên tổng kg gạo của một đơn:
 *   từ 15kg tặng 1kg · từ 30kg tặng 2kg · từ 50kg tặng 3kg (25kg vẫn là 1kg).
 * Khách chọn quà là gạo nếp cái hoa vàng hoặc gạo lứt (mặc định nếp).
 */
export const PROMOTIONS = [
  {
    code: '2010-nep',
    title: 'Khuyến mãi 20/10',
    start: '2026-10-19',
    end: '2026-10-21',
    // [số kg gạo tối thiểu, số kg quà], tăng dần.
    tiers: [[15, 1], [30, 2], [50, 3]],
    // Các loại quà khách được chọn. match: tên túi 1kg dùng làm quà có chứa chuỗi này.
    gifts: [
      { key: 'nep', name: 'Gạo nếp cái hoa vàng', match: 'nếp cái hoa vàng' },
      { key: 'lut', name: 'Gạo lứt', match: 'lứt' },
    ],
  },
];

export const PROMO_GIFT_KEYS = ['nep', 'lut'];

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
    tiers: promo.tiers,
    gifts: promo.gifts.map(({ key, name }) => ({ key, name })),
    // Giữ cho bản trang cũ còn trong bộ nhớ đệm của khách.
    min_kg: promo.tiers[0][0],
    max_gift_kg: promo.tiers[promo.tiers.length - 1][1],
    gift_name: promo.gifts.map((g) => g.name).join(' hoặc '),
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

/** Số kg quà theo bậc: bậc cao nhất mà tổng kg gạo đạt tới. */
export function giftKgFor(riceKg, promo) {
  if (!promo) return 0;
  let gift = 0;
  for (const [minKg, kg] of promo.tiers) if (riceKg + 1e-9 >= minKg) gift = kg;
  return gift;
}

/**
 * Quà khuyến mãi cho một đơn: { promo, kg, choice, product } hoặc null nếu không được quà.
 * `giftKey` là loại quà khách chọn ('nep' | 'lut'); sai hoặc bỏ trống thì dùng loại đầu tiên.
 * Gọi BÊN TRONG transaction của đơn (câu lệnh chuẩn bị tại chỗ, đúng yêu cầu của Turso).
 * product là túi 1kg dùng làm quà nếu còn bán; không có thì vẫn ghi quà theo tên để giao tay.
 */
export function promoGiftFor(lines, giftKey) {
  const promo = activePromotion();
  const kg = giftKgFor(riceKgOf(lines), promo);
  if (!kg) return null;
  const choice = promo.gifts.find((g) => g.key === giftKey) || promo.gifts[0];
  const product = db.prepare(`
    SELECT * FROM products
    WHERE is_active = 1 AND name LIKE ? AND (weight_kg = 1 OR unit LIKE '%1kg%' OR unit LIKE '%1 kg%')
    ORDER BY id LIMIT 1
  `).get(`%${choice.match}%`) || null;
  return { promo, kg, choice, product };
}
