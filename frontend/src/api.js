const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

// Khi chạy dev không cần VITE_API_URL vì Vite đã proxy /api sang cổng 4000.
if (import.meta.env.PROD && !BASE) {
  console.warn('Chưa đặt VITE_API_URL — ứng dụng sẽ gọi API cùng tên miền với trang web.');
}

async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Session-Mode': 'cookie', 'X-CSRF-Protection': '1' };

  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Mất mạng hoặc máy chủ không phản hồi.
    const err = new Error('Không kết nối được tới cửa hàng. Vui lòng kiểm tra kết nối mạng và thử lại.');
    err.status = 0;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Có lỗi xảy ra. Vui lòng thử lại.');
    err.errors = data.errors;
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

  products: (q = '', { inStockOnly = false } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (inStockOnly) params.set('in_stock', '1');
    const query = params.toString();
    return request(`/products${query ? `?${query}` : ''}`);
  },
  product: (id) => request(`/products/${id}`),

  createOrder: (payload) => request('/orders', { method: 'POST', body: payload, auth: true }),
  myOrders: () => request('/orders', { auth: true }),
  cancelOrder: (id) => request(`/orders/${id}/cancel`, { method: 'PATCH', auth: true }),
  orderDiscount: () => request('/orders/discount', { auth: true }),

  adminStats: () => request('/admin/stats', { auth: true }),
  adminOrders: (status) =>
    request(`/admin/orders${status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : ''}`, { auth: true }),
  adminSetOrderStatus: (id, status) =>
    request(`/admin/orders/${id}/status`, { method: 'PATCH', body: { status }, auth: true }),
  adminProducts: () => request('/admin/products', { auth: true }),
  adminCreateProduct: (payload) => request('/admin/products', { method: 'POST', body: payload, auth: true }),
  adminUpdateProduct: (id, payload) =>
    request(`/admin/products/${id}`, { method: 'PUT', body: payload, auth: true }),
  adminDeleteProduct: (id) => request(`/admin/products/${id}`, { method: 'DELETE', auth: true }),
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

export const formatVND = (n) => new Intl.NumberFormat('vi-VN').format(Number(n) || 0) + '₫';

export const formatDateTime = (value) => {
  if (!value) return '';
  // SQLite trả về "YYYY-MM-DD HH:MM:SS" theo giờ UTC.
  const normalized = String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
};

export const STATUS_LABEL = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  shipping: 'Đang giao',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};
