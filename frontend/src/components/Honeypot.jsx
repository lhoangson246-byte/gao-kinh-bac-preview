/**
 * Ô bẫy bot (21/11/2026). Người thật không nhìn thấy, không bấm tới được (nằm ngoài màn hình, bỏ qua khi
 * bấm Tab, trình đọc màn hình không đọc) nên luôn để trống; bot tự điền mọi ô sẽ điền cả ô này và bị máy
 * chủ từ chối. Không làm phiền khách như CAPTCHA.
 */
export default function Honeypot() {
  return (
    <div className="hp-field" aria-hidden="true">
      <label>
        Website
        <input type="text" name="website" data-hp="1" tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
    </div>
  );
}

/** Giá trị các ô bẫy đang có trên trang (người thật luôn là chuỗi rỗng). */
export function readHoneypot() {
  if (typeof document === 'undefined') return '';
  return [...document.querySelectorAll('input[data-hp="1"]')].map((el) => el.value).join('').slice(0, 200);
}
