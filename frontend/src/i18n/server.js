import { translateUnit } from './state.js';

/**
 * Dịch thông báo lỗi do máy chủ trả về (máy chủ luôn trả tiếng Việt).
 * Chỉ gồm những câu khách hay gặp trong luồng mua hàng; câu nào không có ở đây
 * thì giữ nguyên tiếng Việt để khách vẫn đọc được nội dung thật.
 */

const EXACT = {
  'Số điện thoại/email hoặc mật khẩu không đúng.': {
    en: 'Incorrect phone number/email or password.', zh: '手机号/邮箱或密码不正确。',
  },
  'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.': {
    en: 'Too many attempts. Please try again in a few minutes.', zh: '操作过于频繁，请几分钟后再试。',
  },
  'Tài khoản đã bị khoá. Vui lòng liên hệ cửa hàng.': {
    en: 'This account is locked. Please contact the shop.', zh: '该账户已被锁定，请联系店铺。',
  },
  'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.': {
    en: 'Your session has expired. Please log in again.', zh: '登录已过期，请重新登录。',
  },
  'Tài khoản vừa thay đổi. Vui lòng đăng nhập lại.': {
    en: 'Your account was changed. Please log in again.', zh: '账户信息已变更，请重新登录。',
  },
  'Bạn cần đăng nhập.': { en: 'Please log in.', zh: '请先登录。' },
  'Tài khoản không tồn tại.': { en: 'This account does not exist.', zh: '该账户不存在。' },
  'Mật khẩu hiện tại không đúng.': { en: 'Your current password is incorrect.', zh: '当前密码不正确。' },
  'Nhập mật khẩu.': { en: 'Enter your password.', zh: '请输入密码。' },
  'Nhập số điện thoại hoặc email.': { en: 'Enter your phone number or email.', zh: '请输入手机号或邮箱。' },
  'Số điện thoại này đã được đăng ký.': {
    en: 'This phone number is already registered.', zh: '该手机号已注册。',
  },
  'Số điện thoại này đã được đăng ký. Bạn hãy đăng nhập.': {
    en: 'This phone number is already registered. Please log in.', zh: '该手机号已注册，请直接登录。',
  },
  'Số điện thoại này đã thuộc về một tài khoản khác.': {
    en: 'This phone number belongs to another account.', zh: '该手机号已被其他账户使用。',
  },
  'Email này đã được đăng ký.': { en: 'This email is already registered.', zh: '该邮箱已注册。' },
  'Số điện thoại không hợp lệ (10 số, ví dụ 0912345678).': {
    en: 'Invalid phone number (10 digits, e.g. 0912345678).', zh: '手机号无效（10位数字，例如 0912345678）。',
  },
  'Số điện thoại không hợp lệ (ví dụ 0912345678).': {
    en: 'Invalid phone number (e.g. 0912345678).', zh: '手机号无效（例如 0912345678）。',
  },
  'Vui lòng nhập họ tên.': { en: 'Please enter your full name.', zh: '请输入姓名。' },
  'Nhập tên người nhận.': { en: 'Enter the recipient’s name.', zh: '请输入收货人姓名。' },
  'Nhập địa chỉ giao hàng chi tiết.': { en: 'Enter a detailed delivery address.', zh: '请输入详细收货地址。' },
  'Nhập địa chỉ chi tiết: số nhà, đường/thôn, phường/xã.': {
    en: 'Enter the house number, street/village and ward/commune.', zh: '请输入门牌号、街道/村和坊/社。',
  },
  'Cửa hàng hiện chỉ giao hàng trong tỉnh Bắc Ninh.': {
    en: 'The shop currently only delivers within Bắc Ninh province.', zh: '店铺目前仅在北宁省内配送。',
  },
  'Địa chỉ đã bị xoá hoặc không thuộc tài khoản này.': {
    en: 'This address was deleted or does not belong to your account.', zh: '该地址已被删除或不属于您的账户。',
  },
  'Địa chỉ giao hàng không hợp lệ.': { en: 'Invalid delivery address.', zh: '收货地址无效。' },
  'Không tìm thấy địa chỉ giao hàng.': { en: 'Delivery address not found.', zh: '找不到收货地址。' },
  'Khung giờ giao hàng không hợp lệ.': { en: 'Invalid delivery window.', zh: '送货时段无效。' },
  'Hình thức thanh toán không hợp lệ.': { en: 'Invalid payment method.', zh: '付款方式无效。' },
  'Giỏ hàng đang trống.': { en: 'Your cart is empty.', zh: '购物车是空的。' },
  'Sản phẩm trong giỏ không hợp lệ.': { en: 'An item in your cart is invalid.', zh: '购物车中有无效商品。' },
  'Có loại gạo trong giỏ không còn được bán. Vui lòng cập nhật giỏ hàng.': {
    en: 'Some rice in your cart is no longer sold. Please update your cart.', zh: '购物车中有大米已停售，请更新购物车。',
  },
  'Không tìm thấy đơn hàng.': { en: 'Order not found.', zh: '找不到该订单。' },
  'Chỉ có thể tự huỷ đơn đang chờ xác nhận. Vui lòng liên hệ cửa hàng.': {
    en: 'Only orders awaiting confirmation can be cancelled. Please contact the shop.', zh: '只能取消待确认的订单，请联系店铺。',
  },
  'Dữ liệu chưa hợp lệ.': { en: 'Some details are invalid.', zh: '部分信息无效。' },
  'Thông tin đã tồn tại. Vui lòng kiểm tra lại.': { en: 'This already exists. Please check.', zh: '该信息已存在，请检查。' },
  'Lỗi máy chủ. Vui lòng thử lại.': { en: 'Server error. Please try again.', zh: '服务器错误，请重试。' },
  'Không kết nối được tới cửa hàng. Vui lòng kiểm tra kết nối mạng và thử lại.': {
    en: 'Cannot reach the shop. Please check your connection and try again.', zh: '无法连接到店铺，请检查网络后重试。',
  },
  'Có lỗi xảy ra. Vui lòng thử lại.': { en: 'Something went wrong. Please try again.', zh: '出现错误，请重试。' },
};

/** Câu có tên sản phẩm hay con số: dịch theo mẫu, giữ nguyên phần tên. */
const PATTERNS = [
  {
    re: /^“(.+)” chưa có giá bán\. Vui lòng liên hệ cửa hàng\.$/,
    en: (m) => `“${m[1]}” has no price yet. Please contact the shop.`,
    zh: (m) => `“${m[1]}”暂无价格，请联系店铺。`,
  },
  {
    re: /^“(.+)” chỉ còn (\d+) (.+)\.$/,
    en: (m) => `“${m[1]}”: only ${m[2]} left (${translateUnit(m[3], 'en')}).`,
    zh: (m) => `“${m[1]}”仅剩 ${m[2]} ${translateUnit(m[3], 'zh')}。`,
  },
  {
    re: /^“(.+)” vừa được mua hết\. Vui lòng thử lại\.$/,
    en: (m) => `“${m[1]}” just sold out. Please try again.`,
    zh: (m) => `“${m[1]}”刚刚售罄，请重试。`,
  },
  {
    re: /^Bạn chỉ có thể lưu tối đa (\d+) địa chỉ\.$/,
    en: (m) => `You can save up to ${m[1]} addresses.`,
    zh: (m) => `最多只能保存 ${m[1]} 个地址。`,
  },
];

export function translateServerMessage(message, lang) {
  if (!message || lang === 'vi') return message;
  const exact = EXACT[message]?.[lang];
  if (exact) return exact;
  for (const pattern of PATTERNS) {
    const match = message.match(pattern.re);
    if (match) return pattern[lang](match);
  }
  return message;
}

/** Dịch cả thông báo chung lẫn thông báo từng ô của một lỗi trả về. */
export function translateServerErrors(errors, lang) {
  if (!errors || lang === 'vi') return errors;
  return Object.fromEntries(Object.entries(errors).map(([field, text]) => [field, translateServerMessage(text, lang)]));
}
