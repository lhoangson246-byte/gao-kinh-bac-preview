export function generatePassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Hex uses every random bit without modulo bias (128 bits of entropy).
  return Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('');
}

export function passwordError(value) {
  if (value.length < 12) return 'Mật khẩu tối thiểu 12 ký tự.';
  if (new TextEncoder().encode(value).length > 72) return 'Mật khẩu tối đa 72 byte UTF-8.';
  return '';
}
