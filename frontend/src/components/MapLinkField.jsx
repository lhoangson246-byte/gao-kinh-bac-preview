import { pastedMapLink } from '../api';

/**
 * Ô dán định vị khách gửi: link Google Maps (kể cả khi dán kèm chữ) hoặc toạ độ "21.18,106.07".
 * Dán đúng thì hiện link "Mở thử" để kiểm tra trước khi lưu; máy chủ kiểm tra lại lần nữa.
 */
export default function MapLinkField({ value, onChange, error, label = 'Định vị (link Google Maps)' }) {
  const link = pastedMapLink(value);
  const filled = !!String(value || '').trim();
  return (
    <label className="map-field">{label} <small className="optional">không bắt buộc</small>
      <input className="input" value={value} maxLength={2000} inputMode="url" autoComplete="off" spellCheck={false}
             onChange={(e) => onChange(e.target.value)} placeholder="Dán link khách gửi, VD: https://maps.app.goo.gl/…"
             aria-invalid={!!error || (filled && !link)} />
      {error ? <small className="err">{error}</small>
        : link ? <small className="field-help map-ok">✓ Đã nhận định vị. <a href={link} target="_blank" rel="noopener noreferrer">Mở thử trên bản đồ ↗</a></small>
        : filled ? <small className="field-help warn">Chưa đúng link Google Maps. Trong Google Maps bấm Chia sẻ → Sao chép đường liên kết rồi dán vào đây.</small>
        : <small className="field-help">Nhân viên giao hàng bấm "Chỉ đường" sẽ mở đúng vị trí này.</small>}
    </label>
  );
}
