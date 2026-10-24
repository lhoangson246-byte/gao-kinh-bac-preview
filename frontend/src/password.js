export function generatePassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Hex uses every random bit without modulo bias (128 bits of entropy).
  return Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('');
}

const PASSWORD_ERRORS = {
  'error.passwordShort': 'Mật khẩu tối thiểu 8 ký tự.',
  'error.passwordLong': 'Mật khẩu tối đa 72 byte UTF-8.',
  'error.passwordCommon': 'Mật khẩu quá dễ đoán. Vui lòng chọn mật khẩu khác.',
};

// Giống danh sách ở máy chủ (backend/src/schemas.js); máy chủ vẫn là nơi kiểm tra cuối cùng.
const COMMON = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '88888888', '66666666',
  'abcd1234', '12345678a', 'a12345678', 'password', 'password1', 'qwerty123', 'matkhau123', 'iloveyou',
]);
export const PASSWORD_MIN = 8;

/** Khoá thông báo lỗi (để trang khách dịch qua t()), hoặc '' nếu mật khẩu hợp lệ. */
export function passwordErrorKey(value) {
  if (value.length < PASSWORD_MIN) return 'error.passwordShort';
  if (new TextEncoder().encode(value).length > 72) return 'error.passwordLong';
  if (COMMON.has(value.toLowerCase())) return 'error.passwordCommon';
  return '';
}

/** Bản tiếng Việt, dùng ở trang quản trị. */
export function passwordError(value) {
  return PASSWORD_ERRORS[passwordErrorKey(value)] || '';
}
