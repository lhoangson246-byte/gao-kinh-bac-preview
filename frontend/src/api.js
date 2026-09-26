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
  myOrders: () => request('/orders', { auth: true }),
  cancelOrder: (id) => request(`/orders/${id}/cancel`, { method: 'PATCH', auth: true }),
  orderDiscount: () => request('/orders/discount', { auth: true }),

  adminStats: () => request('/admin/stats', { auth: true }),
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
  adminCustomers: ({ q = '', locked = '', limit = 20, offset = 0 } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (locked !== '') params.set('locked', locked);
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

export const DELIVERY_AREA_CODE = 'bac-ninh';
export const DELIVERY_AREA_LABEL = 'Bắc Ninh';

/** Khung giờ giao hoả tốc trong ngày. Cửa hàng không thu phí giao hàng. */
export const DELIVERY_SLOTS = [
  ['sang', 'Buổi sáng', '07h00 – 11h30'],
  ['chieu', 'Buổi chiều', '14h00 – 18h00'],
];
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
