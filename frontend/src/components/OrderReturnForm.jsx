import { useState } from 'react';
import { api, formatVND } from '../api';

const WAREHOUSES = [['KH_BS', 'Kho Bồ Sơn'], ['KH_NC', 'Cửa hàng Nguyễn Cao']];
const digits = (v) => String(v ?? '').replace(/\D/g, '').slice(0, 11);

/**
 * Trả / đổi hàng cho đơn online đã giao xong (19/11/2026). Chọn số lượng khách trả từng món, trả hàng (hoàn
 * tiền mặt / chuyển khoản) hoặc đổi hàng (không hoàn tiền), nhập lại kho nào. Tiền hoàn mặc định = tiền các
 * món trả, không vượt số tiền khách còn lại của đơn; sửa bớt được (ví dụ trừ phí giao). Máy chủ kiểm tra lại.
 */
export default function OrderReturnForm({ order, onDone, onCancel }) {
  const lines = order.items.filter((i) => i.quantity - (i.returned || 0) > 0);
  const [qty, setQty] = useState({});
  const [type, setType] = useState('return');
  const [method, setMethod] = useState(order.payment_method === 'bank' ? 'transfer' : 'cash');
  const [amount, setAmount] = useState('');           // trống = tự tính
  const [restock, setRestock] = useState(true);
  const [warehouse, setWarehouse] = useState(order.warehouse || 'KH_BS');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const value = lines.reduce((s, i) => s + i.price * (Number(qty[i.id]) || 0), 0);
  const refunded = (order.returns || []).filter((r) => r.return_type === 'return').reduce((s, r) => s + r.refund_amount, 0);
  const room = Math.max(0, order.total - refunded);
  const auto = Math.min(value, room);
  const refund = amount === '' ? auto : Number(amount);
  const picked = lines.some((i) => Number(qty[i.id]) > 0);

  const submit = async (event) => {
    event.preventDefault();
    if (!picked) { setError('Nhập số lượng khách trả cho ít nhất một món.'); return; }
    if (reason.trim().length < 3) { setError('Nhập lý do trả / đổi hàng.'); return; }
    if (type === 'return' && refund > room) { setError(`Tiền hoàn tối đa ${formatVND(room)}.`); return; }
    const summary = type === 'return' ? `hoàn ${formatVND(refund)} ${method === 'cash' ? 'tiền mặt' : 'chuyển khoản'}` : 'đổi hàng, không hoàn tiền';
    if (!window.confirm(`Lập phiếu ${type === 'return' ? 'trả hàng' : 'đổi hàng'} cho đơn ${order.code}: ${summary}${restock ? `, nhập lại ${WAREHOUSES.find(([c]) => c === warehouse)[1]}` : ''}?`)) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.adminOrderReturn(order.id, {
        return_type: type, reason: reason.trim(), restock, ...(restock ? { warehouse } : {}),
        ...(type === 'return' ? { refund_method: method, refund_amount: amount === '' ? null : Number(amount) } : {}),
        items: lines.filter((i) => Number(qty[i.id]) > 0).map((i) => ({ order_item_id: i.id, quantity: Number(qty[i.id]) })),
      });
      onDone(`Đã lập phiếu ${result.return.code}${type === 'return' ? ` · hoàn ${formatVND(result.return.refund_amount)}` : ''}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="order-return" onSubmit={submit}>
      <h3>↩️ Trả / đổi hàng — đơn {order.code}</h3>
      <div className="order-return-type" role="radiogroup" aria-label="Hình thức">
        {[['return', 'Trả hàng, hoàn tiền'], ['exchange', 'Đổi hàng (không hoàn tiền)']].map(([code, label]) => (
          <button key={code} type="button" role="radio" aria-checked={type === code} className={type === code ? 'active' : ''} onClick={() => setType(code)}>{label}</button>
        ))}
      </div>
      <table className="order-return-items">
        <thead><tr><th>Món</th><th className="num">Đã mua</th><th className="num">Khách trả</th><th className="num">Thành tiền</th></tr></thead>
        <tbody>
          {lines.map((i) => {
            const left = i.quantity - (i.returned || 0);
            return (
              <tr key={i.id}>
                <td>{i.product_name} <small>{i.unit}{i.returned ? ` · đã trả ${i.returned}` : ''}</small></td>
                <td className="num">{i.quantity}</td>
                <td className="num">
                  <input className="input" type="number" min="0" max={left} inputMode="numeric" value={qty[i.id] ?? ''}
                         onChange={(e) => setQty((cur) => ({ ...cur, [i.id]: e.target.value === '' ? '' : String(Math.min(left, Math.max(0, Math.floor(Number(e.target.value) || 0)))) }))}
                         aria-label={`Số lượng khách trả: ${i.product_name}`} />
                </td>
                <td className="num">{formatVND(i.price * (Number(qty[i.id]) || 0))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {type === 'return' && (
        <div className="order-return-refund">
          <label>Hoàn tiền bằng
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">💵 Tiền mặt</option>
              <option value="transfer">🏦 Chuyển khoản</option>
            </select>
          </label>
          <label>Số tiền hoàn
            <input className="input" inputMode="numeric" value={amount === '' ? (auto ? auto.toLocaleString('vi-VN') : '') : Number(amount).toLocaleString('vi-VN')}
                   onChange={(e) => setAmount(digits(e.target.value))} aria-describedby="return-room" />
            <small id="return-room" className="field-help">Tự tính {formatVND(auto)} · tối đa {formatVND(room)}{refunded ? ` (đã hoàn ${formatVND(refunded)})` : ''}</small>
          </label>
        </div>
      )}
      <div className="order-return-stock">
        <label className="checkbox-label"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Nhập lại kho hàng khách trả</label>
        {restock && (
          <select className="input" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} aria-label="Nhập lại vào kho">
            {WAREHOUSES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        )}
        <small className="field-help">Hàng hỏng không bán lại được, hoặc đổi cùng loại cho khách: bỏ chọn để tồn kho không đổi.</small>
      </div>
      <label>Lý do
        <input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="VD: Gạo bị ẩm, khách đổi loại khác" />
      </label>
      {error && <p className="alert error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu…' : type === 'return' ? `Lập phiếu trả · hoàn ${formatVND(refund || 0)}` : 'Lập phiếu đổi hàng'}</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Huỷ</button>
      </div>
    </form>
  );
}
