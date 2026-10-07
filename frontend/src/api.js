import { getActiveLang, getLocale } from './i18n/state.js';
import { translateServerErrors, translateServerMessage } from './i18n/server.js';

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

// Cùng tên miền là cấu hình bình thường trên Vercel và bản preview local.
async function request(path, { method = 'GET', body, auth = false, signal } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Session-Mode': 'cookie', 'X-CSRF-Protection': '1' };

  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      credentials: 'include',
      signal,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    // Mất mạng hoặc máy chủ không phản hồi.
    const err = new Error(translateServerMessage('Không kết nối được tới cửa hàng. Vui lòng kiểm tra kết nối mạng và thử lại.', getActiveLang()));
    err.status = 0;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Máy chủ luôn trả tiếng Việt; dịch những câu khách hay gặp theo ngôn ngữ đang chọn.
    const lang = getActiveLang();
    const err = new Error(translateServerMessage(data.message || 'Có lỗi xảy ra. Vui lòng thử lại.', lang));
    err.errors = translateServerErrors(data.errors, lang);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Tải ảnh sản phẩm lên. Gửi thẳng nội dung tệp (không phải JSON) nên không
 * dùng chung hàm request() ở trên.
 */
async function uploadImage(blob) {
  let res;
  try {
    res = await fetch(`${BASE}/api/admin/images`, {
      method: 'POST',
      // Cùng cách xác thực bằng cookie phiên như request() ở trên.
      headers: {
        'Content-Type': blob.type || 'image/jpeg',
        'X-Session-Mode': 'cookie',
        'X-CSRF-Protection': '1',
      },
      credentials: 'include',
      body: blob,
    });
  } catch {
    const err = new Error('Không gửi được ảnh lên cửa hàng. Vui lòng kiểm tra kết nối mạng.');
    err.status = 0;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      res.status === 413
        ? 'Ảnh quá nặng. Vui lòng chọn ảnh khác nhẹ hơn.'
        : data.message || 'Chưa tải được ảnh lên. Vui lòng thử lại.'
    );
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  logout: () => request('/auth/logout', { method: 'POST', auth: true }),
  changePassword: (payload) => request('/auth/password', { method: 'PUT', body: payload, auth: true }),
  me: () => request('/auth/me', { auth: true }),
  updateMe: (payload) => request('/auth/me', { method: 'PUT', body: payload, auth: true }),

  addresses: () => request('/addresses', { auth: true }),
  createAddress: (payload) => request('/addresses', { method: 'POST', body: payload, auth: true }),
  updateAddress: (id, payload) => request(`/addresses/${id}`, { method: 'PUT', body: payload, auth: true }),
  deleteAddress: (id) => request(`/addresses/${id}`, { method: 'DELETE', auth: true }),
  setDefaultAddress: (id) => request(`/addresses/${id}/default`, { method: 'PATCH', auth: true }),

  products: (q = '', { inStockOnly = false, group = '', signal } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (inStockOnly) params.set('in_stock', '1');
    if (group) params.set('group', group);
    const query = params.toString();
    return request(`/products${query ? `?${query}` : ''}`, { signal });
  },
  product: (id) => request(`/products/${id}`),
  /** Ảnh banner trang chủ và các cài đặt công khai khác. */
  storefront: () => request('/settings/storefront'),
  adminUpdateStorefront: (payload) =>
    request('/admin/settings/storefront', { method: 'PUT', body: payload, auth: true }),

  createOrder: (payload) => request('/orders', { method: 'POST', body: payload, auth: true }),
  /** Đặt hàng nhanh không cần tài khoản. */
  createGuestOrder: (payload) => request('/orders/guest', { method: 'POST', body: payload }),
  myOrders: () => request('/orders', { auth: true }),
  cancelOrder: (id) => request(`/orders/${id}/cancel`, { method: 'PATCH', auth: true }),
  orderDiscount: () => request('/orders/discount', { auth: true }),

  adminStats: () => request('/admin/stats', { auth: true }),
  /** Đơn mới nhất + số đơn chờ, để báo chuông khi có đơn. */
  adminLatestOrder: () => request('/admin/orders/latest', { auth: true }),
  adminOrders: (status, { limit = 30, offset = 0 } = {}) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status && status !== 'all') params.set('status', status);
    return request(`/admin/orders?${params}`, { auth: true });
  },
  adminSetOrderStatus: (id, status) =>
    request(`/admin/orders/${id}/status`, { method: 'PATCH', body: { status }, auth: true }),
  adminProducts: () => request('/admin/products', { auth: true }),
  adminCreateProduct: (payload) => request('/admin/products', { method: 'POST', body: payload, auth: true }),
  adminUpdateProduct: (id, payload) =>
    request(`/admin/products/${id}`, { method: 'PUT', body: payload, auth: true }),
  adminDeleteProduct: (id) => request(`/admin/products/${id}`, { method: 'DELETE', auth: true }),
  /** Xoá hẳn khỏi cơ sở dữ liệu, khác với adminDeleteProduct chỉ ẩn đi. */
  adminDestroyProduct: (id) => request(`/admin/products/${id}/permanent`, { method: 'DELETE', auth: true }),
  adminUploadImage: uploadImage,
  adminImageLibrary: () => request('/admin/images', { auth: true }),
  /* --- Quản lý tài khoản khách --- */
  adminCustomers: ({ q = '', locked = '', segment = '', limit = 20, offset = 0 } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (locked !== '') params.set('locked', locked);
    if (segment) params.set('segment', segment);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return request(`/admin/customers?${params}`, { auth: true });
  },
  adminCustomer: (id) => request(`/admin/customers/${id}`, { auth: true }),
  adminRenameCustomer: (id, full_name) =>
    request(`/admin/customers/${id}`, { method: 'PUT', body: { full_name }, auth: true }),
  adminResetPassword: (id, password) =>
    request(`/admin/customers/${id}/reset-password`, { method: 'POST', body: { password }, auth: true }),
  /** Xoá hẳn tài khoản khách. Máy chủ từ chối nếu khách đã từng đặt đơn. */
  adminDeleteCustomer: (id) => request(`/admin/customers/${id}`, { method: 'DELETE', auth: true }),
  adminLockCustomer: (id, is_locked) =>
    request(`/admin/customers/${id}/lock`, { method: 'PATCH', body: { is_locked }, auth: true }),
  adminSetCustomerSegment: (id, segment) =>
    request(`/admin/customers/${id}/segment`, { method: 'PATCH', body: { segment }, auth: true }),

  /* --- Nhập kho --- */
  adminReceiveStock: (id, payload) =>
    request(`/admin/products/${id}/stock`, { method: 'POST', body: payload, auth: true }),
  adminStockHistory: (id) => request(`/admin/products/${id}/stock`, { auth: true }),
  adminStockEntries: (limit = 30) => request(`/admin/stock-entries?limit=${limit}`, { auth: true }),

  adminRevenue: (filters) => {
    const params = new URLSearchParams(filters);
    return request(`/admin/revenue?${params}`, { auth: true });
  },
  adminExportOrders: async (filters = {}) => {
    let response;
    try {
      response = await fetch(`${BASE}/api/admin/export/orders?${new URLSearchParams(filters)}`, {
        credentials: 'include', headers: { 'X-Session-Mode': 'cookie', 'X-CSRF-Protection': '1' },
      });
    } catch { throw new Error('Không kết nối được tới cửa hàng. Vui lòng thử tải lại.'); }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Chưa tạo được tệp Excel. Vui lòng thử lại.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'don-hang.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  adminActivity: (limit = 50) => request(`/admin/activity?limit=${limit}`, { auth: true }),

  /* --- Bán lẻ tại quầy --- */
  retailPolicy: () => request('/retail/policy', { auth: true }),
  retailStats: () => request('/retail/stats', { auth: true }),
  retailFindCustomer: (phone) =>
    request(`/retail/customers?phone=${encodeURIComponent(phone)}`, { auth: true }),
  retailUpdateCustomer: (id, payload) =>
    request(`/retail/customers/${id}`, { method: 'PUT', body: payload, auth: true }),
  retailCreateAccount: (payload) =>
    request('/retail/customers/account', { method: 'POST', body: payload, auth: true }),
  retailCreateInvoice: (payload) =>
    request('/retail/invoices', { method: 'POST', body: payload, auth: true }),
  retailInvoices: ({ q = '', from = '', to = '', limit = 20, offset = 0 } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return request(`/retail/invoices?${params}`, { auth: true });
  },
  retailInvoice: (id) => request(`/retail/invoices/${encodeURIComponent(id)}`, { auth: true }),
  retailReturns: (limit = 30) => request(`/retail/returns?limit=${limit}`, { auth: true }),
  retailCreateReturn: (payload) =>
    request('/retail/returns', { method: 'POST', body: payload, auth: true }),
};

/* ---- Hằng số và kiểm tra dùng chung với máy chủ ---- */

/**
 * Giảm giá đơn online: mỗi tài khoản được giảm 20.000đ cho ĐƠN ĐẦU TIÊN.
 * Chỉ để hiển thị trước cho khách — máy chủ luôn tự quyết khi tạo đơn.
 * Mua tại quầy dùng chính sách khác (giảm % khi hoá đơn từ 50kg).
 */
export const FIRST_ORDER_DISCOUNT = 20000;

/** 1.000đ khách trả = 1 điểm tích luỹ. Giống nhau ở cả đơn online và mua tại quầy. */
export const VND_PER_POINT = 1000;

/** Số điểm khách được cộng khi trả `amountPaid` đồng. */
export function pointsFor(amountPaid) {
  return Math.floor(Math.max(0, amountPaid) / VND_PER_POINT);
}

/**
 * Điểm theo từng loại gạo, giống hệt pointsForSale ở máy chủ: loại có điểm riêng
 * tính theo túi/bao, loại còn lại theo tiền khách thực trả (1.000đ = 1 điểm).
 * lines: [{ price, quantity, points_per_unit }]. Chỉ để hiển thị trước.
 */
export function pointsForLines(lines, amountPaid) {
  let subtotal = 0;
  let fixed = 0;
  let byMoney = 0;
  for (const line of lines) {
    const value = Math.max(0, line.price) * Math.max(0, line.quantity);
    subtotal += value;
    if (line.points_per_unit === null || line.points_per_unit === undefined || line.points_per_unit === '') byMoney += value;
    else fixed += Math.max(0, Math.floor(Number(line.points_per_unit) || 0)) * line.quantity;
  }
  const ratio = subtotal > 0 ? Math.min(1, Math.max(0, amountPaid) / subtotal) : 0;
  return fixed + Math.floor((byMoney * ratio) / VND_PER_POINT);
}

/** Nhóm khách, cùng mã với máy chủ. */
export const CUSTOMER_SEGMENTS = [
  ['thuong', 'Khách thường'],
  ['nha-hang', 'Khách nhà hàng'],
  ['dai-ly', 'Khách buôn · đại lý'],
];

/** Link Google Maps tới một toạ độ, hoặc '' nếu chưa có. */
export function mapLink(lat, lng) {
  if (lat == null || lng == null || lat === '' || lng === '') return '';
  return `https://www.google.com/maps/search/?api=1&query=${Number(lat)},${Number(lng)}`;
}

export const DELIVERY_AREA_CODE = 'bac-ninh';
export const DELIVERY_AREA_LABEL = 'Bắc Ninh';

/** Khung giờ giao hoả tốc trong ngày. Cửa hàng không thu phí giao hàng. */
export const DELIVERY_SLOTS = [
  ['sang', 'Buổi sáng', '07h00 – 11h30'],
  ['chieu', 'Buổi chiều', '13h30 – 18h00'],
];

/**
 * Giờ làm việc của cửa hàng (phút trong ngày, giờ Việt Nam):
 * sáng 07h00–11h30, nghỉ trưa 11h30–13h30, chiều 13h30–18h00, nghỉ từ 18h00.
 */
export const SHOP_HOURS = { open: 7 * 60, lunchStart: 11 * 60 + 30, lunchEnd: 13 * 60 + 30, close: 18 * 60 };
const VN_OFFSET_MIN = 7 * 60;

/*
 * Đồng hồ theo máy chủ. Điện thoại/máy tính của khách có thể đặt sai giờ; khi đó trang sẽ
 * báo sai giờ giao. Trang hỏi giờ chuẩn của máy chủ một lần (GET /api/time) rồi bù chênh lệch.
 * Lệch dưới 30 giây thì bỏ qua.
 */
let clockOffset = 0;
let clockSync = null;
const clockListeners = new Set();

/** Thời điểm hiện tại đã bù theo giờ máy chủ. */
export const shopNow = () => new Date(Date.now() + clockOffset);

/** Báo khi đã đồng bộ xong với máy chủ; trả về hàm huỷ đăng ký. */
export function onShopClock(listener) {
  clockListeners.add(listener);
  return () => clockListeners.delete(listener);
}

export function syncShopClock() {
  if (clockSync) return clockSync;
  clockSync = (async () => {
    try {
      const sentAt = Date.now();
      const { now } = await request('/time');
      const receivedAt = Date.now();
      const server = Date.parse(now);
      if (!Number.isFinite(server)) return;
      const offset = server - (sentAt + receivedAt) / 2;
      clockOffset = Math.abs(offset) < 30_000 ? 0 : Math.round(offset);
      clockListeners.forEach((listener) => listener());
    } catch {
      clockSync = null;   // mạng lỗi: dùng giờ máy, lần sau thử lại
    }
  })();
  return clockSync;
}

/** Phút trong ngày theo giờ Việt Nam, dù máy của khách đặt múi giờ nào. */
const vietnamMinutes = (date) => (date.getUTCHours() * 60 + date.getUTCMinutes() + VN_OFFSET_MIN) % 1440;

/** "10:05" theo giờ Việt Nam. */
export function vietnamClock(date = shopNow()) {
  const m = vietnamMinutes(date);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Đơn đặt vào thời điểm `date` được giao lúc nào:
 *  - trước 07h00: buổi sáng hôm nay
 *  - 07h00–11h30: trong buổi sáng
 *  - 11h30–13h30 (nghỉ trưa): buổi chiều, từ 13h30
 *  - 13h30–18h00: trong buổi chiều
 *  - từ 18h00: sáng hôm sau
 */
export function deliveryPlan(date = shopNow()) {
  const m = vietnamMinutes(date);
  if (m < SHOP_HOURS.open) return { phase: 'early', slot: 'sang' };
  if (m < SHOP_HOURS.lunchStart) return { phase: 'morning', slot: 'sang' };
  if (m < SHOP_HOURS.lunchEnd) return { phase: 'lunch', slot: 'chieu' };
  if (m < SHOP_HOURS.close) return { phase: 'afternoon', slot: 'chieu' };
  return { phase: 'closed', slot: 'sang' };
}

/** Chọn khung `slot` lúc `date` thì giao hôm nay hay ngày mai. */
export function slotDay(slot, date = shopNow()) {
  const m = vietnamMinutes(date);
  if (m >= SHOP_HOURS.close) return 'tomorrow';
  if (slot === 'sang' && m >= SHOP_HOURS.lunchStart) return 'tomorrow';
  return 'today';
}

/**
 * Ngày giao (dd/mm, giờ Việt Nam) của một đơn đã đặt, suy từ giờ đặt và khung giờ khách chọn.
 * created_at của máy chủ là giờ UTC dạng "YYYY-MM-DD HH:MM:SS".
 */
export function deliveryDateLabel(createdAt, slot) {
  const placed = new Date(String(createdAt).replace(' ', 'T') + (/[zZ+]/.test(String(createdAt)) ? '' : 'Z'));
  if (Number.isNaN(placed.getTime()) || !slot) return '';
  const vn = new Date(placed.getTime() + VN_OFFSET_MIN * 60_000);
  if (slotDay(slot, placed) === 'tomorrow') vn.setUTCDate(vn.getUTCDate() + 1);
  return `${String(vn.getUTCDate()).padStart(2, '0')}/${String(vn.getUTCMonth() + 1).padStart(2, '0')}`;
}
export const DELIVERY_SLOT_LABEL = Object.fromEntries(
  DELIVERY_SLOTS.map(([code, name, time]) => [code, `${name} (${time})`])
);

const OTHER_PROVINCES = [
  'hà nội', 'ha noi', 'hanoi', 'hồ chí minh', 'ho chi minh', 'sài gòn', 'sai gon',
  'hải phòng', 'hai phong', 'đà nẵng', 'da nang', 'cần thơ', 'can tho',
  'bắc giang', 'bac giang', 'hưng yên', 'hung yen', 'hải dương', 'hai duong',
  'vĩnh phúc', 'vinh phuc', 'thái nguyên', 'thai nguyen', 'quảng ninh', 'quang ninh',
  'lạng sơn', 'lang son', 'nam định', 'nam dinh', 'hà nam', 'ha nam',
  'thái bình', 'thai binh', 'ninh bình', 'ninh binh', 'thanh hoá', 'thanh hóa', 'thanh hoa',
  'nghệ an', 'nghe an', 'hà tĩnh', 'ha tinh', 'phú thọ', 'phu tho', 'hoà bình', 'hòa bình',
];

/** true nếu địa chỉ nhắc tới một tỉnh/thành khác Bắc Ninh. */
export function mentionsOtherProvince(address) {
  const text = String(address || '').toLowerCase();
  return OTHER_PROVINCES.some((province) => text.includes(province));
}

/**
 * Đưa số điện thoại về dạng "0xxxxxxxxx" giống hệt quy tắc của máy chủ.
 * Trả về chuỗi rỗng nếu không hợp lệ.
 */
export const normalizePhone = (value) => {
  const raw = String(value ?? '').replace(/[\s.\-()]/g, '');
  if (!raw) return '';
  const normalized = raw.startsWith('+84') ? `0${raw.slice(3)}`
    : raw.startsWith('84') && raw.length >= 11 ? `0${raw.slice(2)}`
    : raw;
  return /^0\d{9}$/.test(normalized) ? normalized : '';
};

export const isPhone = (value) => normalizePhone(value) !== '';

/**
 * Tiền đồng theo ngôn ngữ đang chọn. Quan trọng với khách đọc tiếng Anh/Trung:
 * "105.000₫" kiểu Việt dễ bị đọc nhầm thành 105 đồng, nên đổi sang "105,000₫".
 */
const currencyFormatters = new Map();
export const formatVND = (n) => {
  const locale = getLocale();
  if (!currencyFormatters.has(locale)) currencyFormatters.set(locale, new Intl.NumberFormat(locale));
  return currencyFormatters.get(locale).format(Number(n) || 0) + '₫';
};

/** Số theo ngôn ngữ đang chọn trong ứng dụng (3.000 / 3,000), không theo cài đặt của máy. */
export const formatNumber = (n) => {
  const locale = getLocale();
  if (!currencyFormatters.has(locale)) currencyFormatters.set(locale, new Intl.NumberFormat(locale));
  return currencyFormatters.get(locale).format(Number(n) || 0);
};

/** Nhóm hàng cửa hàng chọn cho từng sản phẩm; khớp PRODUCT_CATEGORIES ở máy chủ. */
export const PRODUCT_CATEGORIES = [
  ['gao', 'Gạo'],
  ['do-kho', 'Thực phẩm khô'],
];

/**
 * Phần trăm giảm của một sản phẩm, 0 nếu không giảm. Giảm khi cửa hàng nhập
 * giá gốc cao hơn giá bán; khách luôn trả đúng giá bán.
 */
export function salePercent(product) {
  const price = Number(product?.price) || 0;
  const original = Number(product?.original_price) || 0;
  if (price <= 0 || original <= price) return 0;
  return Math.max(1, Math.round(((original - price) / original) * 100));
}

const dateFormatters = new Map();
export const formatDateTime = (value) => {
  if (!value) return '';
  // SQLite trả về "YYYY-MM-DD HH:MM:SS" theo giờ UTC.
  const normalized = String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  const locale = getLocale();
  if (!dateFormatters.has(locale)) {
    dateFormatters.set(locale, new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }));
  }
  return dateFormatters.get(locale).format(date);
};

export const STATUS_LABEL = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  shipping: 'Đang giao',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};
