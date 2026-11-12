import { pastedMapLink, splitAddressMap } from '../api';

/**
 * Cho ô "Địa chỉ giao": dán link Google Maps (hoặc toạ độ) vào ô địa chỉ thì link tự chuyển sang ô Định vị,
 * phần chữ còn lại ở lại làm địa chỉ. `onMoved` báo để hiện dòng "đã lấy từ ô địa chỉ".
 */
export function addressMapProps(value, setAddress, setMap, onMoved) {
  const move = (link) => { setMap(link); onMoved?.(); };
  return {
    onChange: (event) => {
      // Bàn phím điện thoại có thể chèn thẳng từ bộ nhớ tạm mà không qua sự kiện dán.
      const split = splitAddressMap(event.target.value);
      if (split) { setAddress(split.address); move(split.link); } else setAddress(event.target.value);
    },
    onPaste: (event) => {
      const text = event.clipboardData?.getData('text') || '';
      const link = pastedMapLink(text);
      if (!link) return;
      event.preventDefault();          // ô địa chỉ giới hạn 300 ký tự sẽ cắt cụt link dài
      const rest = splitAddressMap(text)?.address || '';
      if (rest) setAddress([String(value || '').trim(), rest].filter(Boolean).join(', '));
      move(link);
    },
  };
}

/**
 * Ô dán định vị khách gửi: link Google Maps (kể cả khi dán kèm chữ) hoặc toạ độ "21.18,106.07".
 * Dán đúng thì hiện link "Mở thử" để kiểm tra trước khi lưu; máy chủ kiểm tra lại lần nữa.
 */
export default function MapLinkField({ value, onChange, error, label = 'Định vị (link Google Maps)', fromAddress = false }) {
  const link = pastedMapLink(value);
  const filled = !!String(value || '').trim();
  return (
    <label className="map-field">{label} <small className="optional">không bắt buộc</small>
      <input className="input" value={value} maxLength={2000} inputMode="url" autoComplete="off" spellCheck={false}
             onChange={(e) => onChange(e.target.value)} placeholder="Dán link khách gửi, VD: https://maps.app.goo.gl/…"
             aria-invalid={!!error || (filled && !link)} />
      {error ? <small className="err">{error}</small>
        : link ? <small className="field-help map-ok">✓ Đã nhận định vị{fromAddress ? ' từ link dán ở ô Địa chỉ giao' : ''}. <a href={link} target="_blank" rel="noopener noreferrer">Mở thử trên bản đồ ↗</a></small>
        : filled ? <small className="field-help warn">Chưa đúng link Google Maps. Trong Google Maps bấm Chia sẻ → Sao chép đường liên kết rồi dán vào đây.</small>
        : <small className="field-help">Nhân viên giao hàng bấm "Chỉ đường" sẽ mở đúng vị trí này.</small>}
    </label>
  );
}
