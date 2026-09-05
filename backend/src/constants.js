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
