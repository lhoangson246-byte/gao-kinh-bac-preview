import { useEffect, useState } from 'react';
import { api, DELIVERY_SLOTS, formatVND, shippingFeeFor } from '../api';

const EMPTY = {
  receiver_name: '', phone: '', home_delivery: true, address: '', delivery_slot: '', payment_method: 'cod',
  note: '', discount_code: '', shipper_id: '',
};

/**
 * Nhân viên nhập đơn bằng tay (khách gọi điện / nhắn Zalo) rồi giao cho khách. Giá, tồn kho, ưu đãi
 * đơn đầu và mã giảm giá do máy chủ tính như đơn online; đơn được xác nhận ngay.
 */
export default function ManualOrderForm({ shippers, onCreated, onClose }) {
  const [form, setForm] = useState(EMPTY);
  const [lines, setLines] = useState([{ product_id: '', quantity: 1 }]);
  const [products, setProducts] = useState([]);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.products().then((d) => setProducts((d.products || []).filter((p) => p.price > 0 && p.stock > 0))).catch(() => {});
  }, []);

  const set = (field, value) => setForm((cur) => ({ ...cur, [field]: value }));
  const setLine = (index, patch) => setLines((cur) => cur.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const byId = Object.fromEntries(products.map((p) => [String(p.id), p]));
  const chosen = lines.filter((l) => l.product_id && Number(l.quantity) > 0);
  const subtotal = chosen.reduce((sum, l) => sum + (byId[l.product_id]?.price || 0) * Number(l.quantity), 0);

  const submit = async (event) => {
    event.preventDefault();
    if (!chosen.length) { setErrors({ items: 'Chọn ít nhất một loại gạo.' }); return; }
    setBusy(true);
    setErrors({});
    try {
      const { order } = await api.adminCreateOrder({
        receiver_name: form.receiver_name.trim(),
        phone: form.phone.trim(),
        home_delivery: form.home_delivery,
        address: form.home_delivery ? form.address.trim() : null,
        delivery_slot: form.delivery_slot || null,
        payment_method: form.payment_method,
        note: form.note.trim() || null,
        discount_code: form.discount_code.trim() || null,
        shipper_id: form.shipper_id ? Number(form.shipper_id) : null,
        items: chosen.map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity) })),
      });
      setForm(EMPTY);
      setLines([{ product_id: '', quantity: 1 }]);
      onCreated(order);
    } catch (err) {
      setErrors({ form: err.message, ...(err.errors || {}) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form-card flat manual-order" onSubmit={submit} noValidate>
      <div className="manual-order-head">
        <h2>Tạo đơn (khách gọi điện, nhắn Zalo)</h2>
        <button type="button" className="icon-close" onClick={onClose} aria-label="Đóng">×</button>
      </div>
      <div className="about-admin-row">
        <label>Họ tên khách
          <input className="input" value={form.receiver_name} maxLength={120} onChange={(e) => set('receiver_name', e.target.value)} aria-invalid={!!errors.receiver_name} />
          {errors.receiver_name && <small className="err">{errors.receiver_name}</small>}
        </label>
        <label>Số điện thoại
          <input className="input" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="0912345678" aria-invalid={!!errors.phone} />
          {errors.phone && <small className="err">{errors.phone}</small>}
        </label>
      </div>
      <label className="checkbox-label manual-delivery">
        <input type="checkbox" checked={form.home_delivery} onChange={(e) => set('home_delivery', e.target.checked)} />
        <strong>Giao hàng tận nơi</strong> <small>(bỏ tick nếu khách tự đến lấy tại cửa hàng)</small>
      </label>
      {form.home_delivery && (
        <label>Địa chỉ giao
          <textarea className="input" rows={2} value={form.address} maxLength={300} onChange={(e) => set('address', e.target.value)}
                    placeholder="Số nhà, đường, phường — trong tỉnh Bắc Ninh" aria-invalid={!!errors.address} />
          {errors.address && <small className="err">{errors.address}</small>}
        </label>
      )}

      <fieldset className="manual-lines">
        <legend>Hàng khách đặt</legend>
        {lines.map((line, index) => (
          <div key={index} className="manual-line">
            <select className="input" value={line.product_id} onChange={(e) => setLine(index, { product_id: e.target.value })} aria-label={`Loại gạo ${index + 1}`}>
              <option value="">— Chọn loại gạo —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.unit} · {formatVND(p.price)} (còn {p.stock})</option>)}
            </select>
            <input className="input manual-qty" type="number" min="1" max="1000" value={line.quantity}
                   onChange={(e) => setLine(index, { quantity: e.target.value })} aria-label={`Số lượng ${index + 1}`} />
            {lines.length > 1 && (
              <button type="button" className="icon-close" onClick={() => setLines((cur) => cur.filter((_, i) => i !== index))} aria-label="Bỏ dòng">×</button>
            )}
          </div>
        ))}
        <button type="button" className="link-button" onClick={() => setLines((cur) => [...cur, { product_id: '', quantity: 1 }])}>+ Thêm loại gạo</button>
        {errors.items && <small className="err">{errors.items}</small>}
        <p className="manual-subtotal">Tiền hàng: <strong>{formatVND(subtotal)}</strong>
          {form.home_delivery && subtotal > 0 && <> · Phí giao: <strong>{shippingFeeFor(subtotal) ? formatVND(shippingFeeFor(subtotal)) : 'Freeship'}</strong></>}
          {' '}<small>(đơn đầu của số điện thoại tự giảm 20.000đ, hoặc nhập mã)</small></p>
      </fieldset>

      <div className="about-admin-row">
        <label>Khung giờ giao
          <select className="input" value={form.delivery_slot} onChange={(e) => set('delivery_slot', e.target.value)}>
            <option value="">Chưa hẹn giờ</option>
            {DELIVERY_SLOTS.map(([code, label, time]) => <option key={code} value={code}>{label} ({time})</option>)}
          </select>
        </label>
        <label>Thanh toán
          <select className="input" value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
            <option value="cod">Tiền mặt khi nhận hàng</option>
            <option value="bank">Chuyển khoản</option>
          </select>
        </label>
        <label>Mã giảm giá (nếu có)
          <input className="input code-input" value={form.discount_code} maxLength={40} onChange={(e) => set('discount_code', e.target.value.toUpperCase())} aria-invalid={!!errors.discount_code} />
          {errors.discount_code && <small className="err">{errors.discount_code}</small>}
        </label>
        <label>Người giao
          <select className="input" value={form.shipper_id} onChange={(e) => set('shipper_id', e.target.value)} aria-invalid={!!errors.shipper_id}>
            <option value="">— Chọn sau —</option>
            {shippers.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
          {errors.shipper_id && <small className="err">{errors.shipper_id}</small>}
        </label>
      </div>
      <label>Ghi chú
        <input className="input" value={form.note} maxLength={500} onChange={(e) => set('note', e.target.value)} placeholder="VD: Khách gọi lúc 9h, giao trước 11h" />
      </label>
      {errors.form && <p className="alert error">{errors.form}</p>}
      <div className="form-actions">
        <button className="btn btn-primary btn-large" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo đơn (đã xác nhận)'}</button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Huỷ</button>
      </div>
    </form>
  );
}
