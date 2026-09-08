/** Hằng số dùng chung cho toàn bộ API. */

/** Cửa hàng chỉ giao trong tỉnh Bắc Ninh. */
export const DELIVERY_AREA_CODE = 'bac-ninh';
export const DELIVERY_AREA_LABEL = 'Bắc Ninh';

export const ORDER_STATUSES = ['pending', 'confirmed', 'shipping', 'completed', 'cancelled'];

/** Khung giờ giao hoả tốc trong ngày. Cửa hàng không thu phí giao hàng. */
export const DELIVERY_SLOTS = {
  sang: 'Sáng: 07h00 – 11h30',
  chieu: 'Chiều: 14h00 – 18h00',
};
export const DELIVERY_SLOT_CODES = Object.keys(DELIVERY_SLOTS);

/** Chỉ cho phép đi tiếp theo đúng quy trình xử lý đơn. */
export const ALLOWED_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipping', 'cancelled'],
  shipping: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/** Giới hạn dữ liệu đầu vào để tránh đơn hàng bất thường. */
export const LIMITS = {
  name: 120,
  email: 160,
  phone: 20,
  address: 300,
  note: 500,
  description: 1000,
  origin: 120,
  unit: 40,
  imageUrl: 500,
  price: 100_000_000,      // 100 triệu đồng cho một đơn vị
  stock: 1_000_000,
  quantityPerLine: 1000,
  linesPerOrder: 50,
};

/**
 * Danh sách tỉnh/thành khác — dùng để từ chối địa chỉ nằm ngoài Bắc Ninh.
 * Chỉ cần bắt các trường hợp khách gõ rõ tên tỉnh khác.
 */
const OTHER_PROVINCES = [
  'hà nội', 'ha noi', 'hanoi', 'hồ chí minh', 'ho chi minh', 'sài gòn', 'sai gon',
  'hải phòng', 'hai phong', 'đà nẵng', 'da nang', 'cần thơ', 'can tho',
  'bắc giang', 'bac giang', 'hưng yên', 'hung yen', 'hải dương', 'hai duong',
  'vĩnh phúc', 'vinh phuc', 'thái nguyên', 'thai nguyen', 'quảng ninh', 'quang ninh',
  'lạng sơn', 'lang son', 'nam định', 'nam dinh', 'hà nam', 'ha nam',
  'thái bình', 'thai binh', 'ninh bình', 'ninh binh', 'thanh hoá', 'thanh hóa', 'thanh hoa',
  'nghệ an', 'nghe an', 'hà tĩnh', 'ha tinh', 'phú thọ', 'phu tho', 'hoà bình', 'hòa bình',
];

/* ------------------------------------------------------------------ *
 * Múi giờ dùng khi tính báo cáo
 * ------------------------------------------------------------------ */

/**
 * SQLite lưu created_at theo giờ UTC. Báo cáo doanh thu phải tính theo ngày
 * ở Việt Nam (UTC+7), nếu không thì đơn bán lúc sáng sớm sẽ bị tính sang
 * ngày hôm trước. Đổi bằng biến môi trường REPORT_TIME_SHIFT nếu cần.
 */
const RAW_SHIFT = process.env.REPORT_TIME_SHIFT || '+7 hours';
// Chỉ nhận đúng dạng "+7 hours" / "-3 hours" vì chuỗi này được ghép vào câu SQL.
export const REPORT_TIME_SHIFT = /^[+-]\d{1,2}(\.\d+)? hours$/.test(RAW_SHIFT)
  ? RAW_SHIFT
  : '+7 hours';

if (RAW_SHIFT !== REPORT_TIME_SHIFT) {
  console.warn(`⚠️  REPORT_TIME_SHIFT="${RAW_SHIFT}" không hợp lệ, dùng mặc định "+7 hours".`);
}

/** Ngày (theo giờ Việt Nam) của một cột thời gian trong SQLite. */
export const localDate = (column) => `date(${column}, '${REPORT_TIME_SHIFT}')`;
/** Tháng (YYYY-MM, theo giờ Việt Nam) của một cột thời gian. */
export const localMonth = (column) => `strftime('%Y-%m', ${column}, '${REPORT_TIME_SHIFT}')`;

/* ------------------------------------------------------------------ *
 * Chính sách giảm giá và tích điểm
 *
 * Hai kênh bán có hai chính sách giảm giá KHÁC NHAU:
 *   - Đặt online: đơn ĐẦU TIÊN của mỗi tài khoản được giảm 20.000đ.
 *   - Mua tại quầy: chỉ giảm khi hoá đơn đạt 50kg trở lên, mức phần trăm
 *     do nhân viên tự nhập cho từng hoá đơn.
 * Tích điểm thì giống nhau ở cả hai kênh.
 * ------------------------------------------------------------------ */

/** Đơn online đầu tiên của mỗi tài khoản được giảm cố định 20.000đ. */
export const FIRST_ORDER_DISCOUNT = 20_000;

/** Mua tại quầy chỉ được giảm khi hoá đơn đạt mức khối lượng này. */
export const RETAIL_DISCOUNT_MIN_KG = 50;

/** Chặn trên cho mức phần trăm nhân viên nhập tay, tránh gõ nhầm. */
export const RETAIL_DISCOUNT_MAX_PERCENT = 50;

/** Số tiền (đồng) tương ứng 1 điểm tích luỹ. 1.000đ = 1 điểm. */
export const RETAIL_VND_PER_POINT = 1_000;

/**
 * Đổi điểm lấy quà: đủ 1.000 điểm được lấy 1 túi 1kg.
 * Loại nào được làm quà thì bật cột `is_reward` của sản phẩm đó
 * (mặc định: gạo nếp, gạo lứt, kê vàng loại 1kg).
 */
export const RETAIL_POINTS_PER_REWARD = 1_000;

/** Số phần quà đổi được với số điểm đang có. */
export function retailRewardsAffordable(points) {
  return Math.floor(Math.max(0, points) / RETAIL_POINTS_PER_REWARD);
}

export const RETAIL_PAYMENT_METHODS = {
  cash: 'Tiền mặt',
  transfer: 'Chuyển khoản',
};

/**
 * Đọc số kg từ tên đơn vị: "bao 10kg" → 10, "túi 1kg" → 1.
 * Trả về 0 khi không đọc được; khi đó cửa hàng tự nhập khối lượng cho sản phẩm.
 */
export function parseWeightKg(unit) {
  const match = String(unit || '').match(/(\d+(?:[.,]\d+)?)\s*kg/i);
  if (!match) return 0;
  const kg = Number(match[1].replace(',', '.'));
  return Number.isFinite(kg) && kg > 0 ? kg : 0;
}

/**
 * Số tiền giảm cho một hoá đơn tại quầy.
 * Chỉ giảm khi đủ khối lượng tối thiểu; phần trăm do cửa hàng nhập.
 */
export function retailDiscountFor(subtotal, { percent = 0, totalKg = 0 } = {}) {
  if (!(percent > 0) || totalKg < RETAIL_DISCOUNT_MIN_KG) return 0;
  const capped = Math.min(percent, RETAIL_DISCOUNT_MAX_PERCENT);
  return Math.min(subtotal, Math.floor((subtotal * capped) / 100));
}

/** Điểm tích được từ số tiền khách thực trả. */
export function retailPointsFor(amountPaid) {
  return Math.floor(Math.max(0, amountPaid) / RETAIL_VND_PER_POINT);
}

/** true nếu địa chỉ có nhắc tới một tỉnh/thành khác Bắc Ninh. */
export function mentionsOtherProvince(address) {
  const text = String(address || '').toLowerCase();
  return OTHER_PROVINCES.some((province) => text.includes(province));
}

/** Chuẩn hoá địa chỉ: luôn kết thúc bằng ", Bắc Ninh". */
export function normalizeBacNinhAddress(address) {
  const clean = String(address || '').trim().replace(/[,\s]+$/, '');
  return /bắc\s*ninh/i.test(clean) ? clean : `${clean}, ${DELIVERY_AREA_LABEL}`;
}
