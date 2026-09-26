export function generatePassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Hex uses every random bit without modulo bias (128 bits of entropy).
  return Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('');
}

const PASSWORD_ERRORS = {
  'error.passwordShort': 'Mật khẩu tối thiểu 12 ký tự.',
  'error.passwordLong': 'Mật khẩu tối đa 72 byte UTF-8.',
};

/** Khoá thông báo lỗi (để trang khách dịch qua t()), hoặc '' nếu mật khẩu hợp lệ. */
export function passwordErrorKey(value) {
  if (value.length < 12) return 'error.passwordShort';
  if (new TextEncoder().encode(value).length > 72) return 'error.passwordLong';
  return '';
}

/** Bản tiếng Việt, dùng ở trang quản trị. */
export function passwordError(value) {
  return PASSWORD_ERRORS[passwordErrorKey(value)] || '';
}
