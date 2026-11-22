import { useState } from 'react';
import { api } from '../api';

const km = (v) => `${String(v).replace('.', ',')} km`;
const mapsAt = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/**
 * Định vị của đơn trên thẻ đơn hàng (22/11/2026): khoảng cách từ Kho Bồ Sơn; định vị TỰ TÌM theo địa chỉ chữ
 * (gần đúng) kèm tên địa điểm tìm được và nút xem trên Google Maps; nút "Sửa định vị" để dán link Google Maps
 * hoặc toạ độ đúng khi cần.
 */
export default function OrderLocation({ order, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const { order: saved } = await api.adminSetOrderLocation(order.id, value.trim());
      if (!saved.located) {
        setError('Đã lưu link nhưng chưa đọc được toạ độ. Trong Google Maps bấm Chia sẻ → Sao chép đường liên kết, hoặc dán toạ độ dạng 21.18,106.07.');
      } else {
        setEditing(false);
        setValue('');
      }
      onSaved?.({ map_url: saved.map_url, distance_km: saved.distance_km, geo_source: saved.located ? 'map' : null, geo_label: null });
    } catch (err) {
      setError(err.errors?.map_url || err.message);
    } finally {
      setBusy(false);
    }
  };

  const auto = order.geo_source === 'address' && order.geo_lat != null && order.delivery_lat == null;
  return (
    <div className="order-location">
      <p className="distance-text">
        {order.distance_km != null
          ? <>📏 Cách Kho Bồ Sơn ≈ <strong>{km(order.distance_km)}</strong> (đường chim bay)</>
          : <>📏 Chưa có định vị để tính khoảng cách</>}
      </p>
      {auto && (
        <p className="geo-auto">
          📍 Định vị tự tìm theo địa chỉ{order.geo_label ? <>: <b>{order.geo_label}</b></> : ''} — <i>gần đúng, nên kiểm tra</i>.{' '}
          <a href={mapsAt(order.geo_lat, order.geo_lng)} target="_blank" rel="noopener noreferrer">Xem trên Google Maps</a>
        </p>
      )}
      {canEdit && !editing && (
        <button type="button" className="link-button" onClick={() => { setEditing(true); setError(''); }}>
          ✏️ {order.distance_km != null ? 'Sửa định vị' : 'Thêm định vị'}
        </button>
      )}
      {canEdit && editing && (
        <div className="geo-edit">
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Dán link Google Maps hoặc toạ độ 21.18,106.07"
                 aria-label={`Định vị đơn ${order.code}`} autoComplete="off" />
          <button type="button" className="btn btn-primary" disabled={busy || !value.trim()} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu định vị'}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setEditing(false); setError(''); }}>Huỷ</button>
          <small className="field-help">Mở Google Maps, tìm đúng nhà khách → bấm Chia sẻ → Sao chép đường liên kết, rồi dán vào đây.</small>
          {error && <small className="err">{error}</small>}
        </div>
      )}
    </div>
  );
}
