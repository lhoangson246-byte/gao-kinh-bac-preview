import { useCallback, useEffect, useState } from 'react';
import { api, formatDateTime } from '../api';

/*
 * Lệnh lấy hàng ở Cửa hàng Nguyễn Cao cho đơn giao (25/11/2026).
 *  - Kế toán: đơn web trừ ở Kho Bồ Sơn; kho hết thì thẻ đơn báo thiếu ngay ở phần sản phẩm và có nút mở form
 *    "Lấy từ Cửa hàng Nguyễn Cao" (PickupForm).
 *  - Nhân viên bán tại quầy: bảng "Lệnh lấy hàng cho đơn giao" (StorePickupInbox) — bấm "Nhận lệnh" thì cửa hàng bị
 *    trừ đúng số đó; shipper qua cửa hàng lấy hàng đi giao.
 */

const kg = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
/** "10 kg" cho hàng có khối lượng, "3 gói" cho hàng không có. */
export const pickupAmount = (item, quantity = item.quantity) => (item.weight_kg > 0 ? `${kg(quantity * item.weight_kg)} kg` : `${kg(quantity)} ${String(item.unit || '').split(' ')[0] || ''}`.trim());
const STATUS = { requested: '⏳ Chờ cửa hàng nhận', accepted: '✅ Cửa hàng đã xuất hàng — shipper qua lấy', rejected: '✕ Cửa hàng từ chối' };

/** Form (cửa sổ nổi) kế toán tạo lệnh lấy hàng cho các món đang thiếu ở kho. */
export function PickupForm({ order, warnings, onDone, onClose }) {
  // Số lấy mặc định = số đang thiếu, nhập theo kg (hàng không có khối lượng nhập theo đơn vị của nó).
  const [rows, setRows] = useState(() => warnings.map((w) => {
    const item = order.items.find((i) => i.product_name === w.product_name && i.product_id);
    const weight = w.short_kg != null && w.short ? w.short_kg / w.short : 0;
    return { product_id: item?.product_id, name: w.product_name, unit: w.unit, weight, value: String(weight > 0 ? w.short_kg : w.short).replace('.', ','), other: w.other_kg != null ? `${kg(w.other_kg)} kg` : `${kg(w.other_stock)} ${w.unit}` };
  }).filter((r) => r.product_id));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const num = (v) => Number(String(v).replace(',', '.')) || 0;
  const save = async () => {
    const items = rows.filter((r) => num(r.value) > 0).map((r) => ({ product_id: r.product_id, quantity: Math.round((r.weight > 0 ? num(r.value) / r.weight : num(r.value)) * 1000) / 1000 }));
    if (!items.length) { setError('Nhập số cần lấy cho ít nhất một món.'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await api.inventoryCreatePickup({ order_id: order.id, items, note: note.trim() || null });
      onDone(result.message);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="pickup-modal" role="dialog" aria-modal="true" aria-label="Lấy hàng từ Cửa hàng Nguyễn Cao">
      <div className="pickup-modal-box">
        <button type="button" className="icon-close" onClick={onClose} aria-label="Đóng">×</button>
        <h3>📦 Lấy hàng từ Cửa hàng Nguyễn Cao</h3>
        <p className="muted">Đơn <b>{order.code}</b> · Kho Bồ Sơn đang thiếu. Gửi lệnh tới cửa hàng; nhân viên bán tại quầy bấm <b>Nhận lệnh</b> thì cửa hàng
          bị trừ đúng số này và shipper qua cửa hàng lấy hàng đi giao.</p>
        {rows.map((r, i) => (
          <label key={r.product_id} className="pickup-row">
            <span><b>{r.name}</b><small>cửa hàng còn {r.other}</small></span>
            <span className="pickup-qty">
              <input className="input" inputMode="decimal" value={r.value} aria-label={`Số cần lấy: ${r.name}`}
                     onChange={(e) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, value: e.target.value.replace(/[^\d.,]/g, '').slice(0, 9) } : x)))} />
              <small>{r.weight > 0 ? 'kg' : String(r.unit || '').split(' ')[0]}</small>
            </span>
          </label>
        ))}
        <label>Ghi chú cho cửa hàng <small className="optional">không bắt buộc</small>
          <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="VD: anh Diệu qua lấy lúc 9h" />
        </label>
        {error && <p className="alert error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Đang gửi…' : 'Gửi lệnh tới cửa hàng'}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Huỷ</button>
        </div>
      </div>
    </div>
  );
}

/** Các lệnh lấy hàng của một đơn (trên thẻ đơn). */
export function OrderPickups({ pickups }) {
  if (!pickups?.length) return null;
  return (
    <ul className="order-pickups">
      {pickups.map((p) => (
        <li key={p.id} className={p.status}>
          <b>{p.code}</b> · {STATUS[p.status]} · {p.items.map((i) => `${i.product_name} ${pickupAmount(i)}`).join(', ')}
          {p.handler_name && <small> · {p.handler_name} {formatDateTime(p.handled_at)}</small>}
          {p.handle_note && <small> · {p.handle_note}</small>}
        </li>
      ))}
    </ul>
  );
}

/** Trang bán tại quầy: lệnh lấy hàng cho đơn giao đang chờ cửa hàng nhận. Tự tải lại mỗi 30 giây. */
export function StorePickupInbox() {
  const [pickups, setPickups] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setPickups((await api.inventoryPickups({ status: 'requested' })).pickups); setError(''); } catch (err) { setError(err.message); }
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);
  const act = async (p, accept) => {
    let note = null;
    if (!accept) {
      note = window.prompt(`Từ chối lệnh ${p.code}? Ghi lý do cho kế toán (ví dụ cửa hàng cũng hết):`, '');
      if (note === null) return;
    } else if (!window.confirm(`Nhận lệnh ${p.code}: cửa hàng xuất ${p.items.map((i) => `${i.product_name} ${pickupAmount(i)}`).join(', ')} cho đơn ${p.order_code}?`)) return;
    setBusy(p.id);
    try {
      const result = accept ? await api.inventoryAcceptPickup(p.id) : await api.inventoryRejectPickup(p.id, note.trim() || null);
      setMsg(result.message);
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(null); }
  };
  if (!pickups?.length && !msg && !error) return null;
  return (
    <section className="pickup-inbox" aria-label="Lệnh lấy hàng cho đơn giao">
      <h2>📦 Lệnh lấy hàng cho đơn giao {pickups?.length ? <span className="pickup-count">{pickups.length}</span> : null}</h2>
      <p className="muted">Kho Bồ Sơn hết hàng cho đơn giao: kế toán nhờ cửa hàng xuất hàng, shipper sẽ qua cửa hàng lấy. Bấm <b>Nhận lệnh</b> khi đã chuẩn bị hàng — tồn cửa hàng bị trừ đúng số này.</p>
      {error && <p className="alert error" role="alert">{error}</p>}
      {msg && <p className="alert success" role="status">{msg}</p>}
      {pickups?.map((p) => (
        <article key={p.id} className="pickup-card">
          <header><b>{p.code}</b> · đơn <b>{p.order_code}</b> · {p.receiver_name}{p.shipper_name ? ` · shipper ${p.shipper_name}` : ''}<small>{formatDateTime(p.created_at)} · {p.actor_name || 'kế toán'} gửi</small></header>
          <ul>{p.items.map((i) => <li key={i.id}>{i.product_name} <small className="muted">{i.unit}</small>: <b>{pickupAmount(i)}</b></li>)}</ul>
          {p.note && <p className="muted">Ghi chú: {p.note}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn-primary" disabled={busy === p.id} onClick={() => act(p, true)}>✅ Nhận lệnh (xuất hàng)</button>
            <button type="button" className="btn btn-danger-ghost" disabled={busy === p.id} onClick={() => act(p, false)}>Từ chối</button>
          </div>
        </article>
      ))}
    </section>
  );
}
