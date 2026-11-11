import { useEffect, useMemo, useState } from 'react';
import { api, DELIVERY_SLOTS, formatVND, shippingFeeFor } from '../api';
import { foldText } from './WholesaleManager.jsx';

const EMPTY = {
  receiver_name: '', phone: '', home_delivery: true, address: '', delivery_slot: '', payment_method: 'cod',
  note: '', discount_code: '', shipper_id: '',
};
const EMPTY_LINE = { product_id: '', quantity: 1, price: '' };

/**
 * Nhân viên nhập đơn bằng tay (khách gọi điện / nhắn Zalo) rồi giao cho khách.
 *  - Khách lẻ: giá web, không sửa giá; ưu đãi đơn đầu và mã giảm giá do máy chủ tính như đơn online.
 *  - Khách buôn: chọn khách trong danh sách (tìm theo mã, công ty, tên, số điện thoại); giá tự điền theo
 *    bảng giá cố định của khách (chưa có thì giá web) và sửa được từng dòng; không mã giảm giá.
 * Đơn được xác nhận ngay.
 */
export default function ManualOrderForm({ shippers, onCreated, onClose }) {
  const [form, setForm] = useState(EMPTY);
  const [kind, setKind] = useState('retail');
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [products, setProducts] = useState([]);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [wsList, setWsList] = useState(null);
  const [wsQuery, setWsQuery] = useState('');
  const [wsOpen, setWsOpen] = useState(false);
  const [ws, setWs] = useState(null);              // { customer, prices: Map }
  const wholesale = kind === 'wholesale';

  useEffect(() => {
    api.products().then((d) => setProducts((d.products || []).filter((p) => p.stock > 0))).catch(() => {});
  }, []);
  useEffect(() => {
    if (!wholesale || wsList) return;
    api.adminWholesaleList().then((d) => setWsList(d.customers)).catch((err) => setErrors({ form: err.message }));
  }, [wholesale, wsList]);

  const set = (field, value) => setForm((cur) => ({ ...cur, [field]: value }));
  const byId = Object.fromEntries(products.map((p) => [String(p.id), p]));
  const fixedPrice = (productId) => ws?.prices.get(Number(productId));
  const defaultPrice = (productId) => fixedPrice(productId) ?? byId[productId]?.price ?? '';
  const setLine = (index, patch) => setLines((cur) => cur.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const pickProduct = (index, productId) => setLine(index, { product_id: productId, price: wholesale && productId ? String(defaultPrice(productId)) : '' });
  const selectable = products.filter((p) => p.price > 0 || (wholesale && fixedPrice(p.id)));
  const chosen = lines.filter((l) => l.product_id && Number(l.quantity) > 0);
  const unitPrice = (l) => (wholesale ? Number(l.price) || 0 : byId[l.product_id]?.price || 0);
  const subtotal = chosen.reduce((sum, l) => sum + unitPrice(l) * Number(l.quantity), 0);

  const matches = useMemo(() => {
    const q = foldText(wsQuery.trim());
    return (wsList || []).filter((c) => !q || [c.code, c.company, c.contact_name, c.phone].some((v) => foldText(v).includes(q))).slice(0, 8);
  }, [wsList, wsQuery]);

  const switchKind = (next) => {
    setKind(next);
    setErrors({});
    setWs(null);
    setWsQuery('');
    setLines((cur) => cur.map((l) => ({ ...l, price: '' })));
    if (next === 'wholesale') set('discount_code', '');
  };

  const chooseCustomer = async (customer) => {
    setWsOpen(false);
    setWsQuery('');
    try {
      const detail = await api.adminWholesaleGet(customer.id);
      const prices = new Map(detail.prices.map((p) => [p.product_id, p.price]));
      setWs({ customer: detail.customer, prices });
      setForm((cur) => ({
        ...cur, receiver_name: detail.customer.contact_name, phone: detail.customer.phone,
        address: detail.customer.address || cur.address, discount_code: '',
      }));
      setLines((cur) => cur.map((l) => (l.product_id ? { ...l, price: String(prices.get(Number(l.product_id)) ?? byId[l.product_id]?.price ?? '') } : l)));
      setErrors({});
    } catch (err) {
      setErrors({ form: err.message });
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (wholesale && !ws) { setErrors({ wholesale: 'Chọn khách buôn trong danh sách.' }); return; }
    if (!chosen.length) { setErrors({ items: 'Chọn ít nhất một loại gạo.' }); return; }
    if (wholesale && chosen.some((l) => !(Number.isInteger(Number(l.price)) && Number(l.price) > 0))) {
      setErrors({ items: 'Nhập giá bán (số nguyên lớn hơn 0) cho từng loại gạo.' });
      return;
    }
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
        discount_code: wholesale ? null : form.discount_code.trim() || null,
        shipper_id: form.shipper_id ? Number(form.shipper_id) : null,
        customer_type: kind,
        wholesale_customer_id: wholesale ? ws.customer.id : null,
        items: chosen.map((l) => ({
          product_id: Number(l.product_id), quantity: Number(l.quantity), ...(wholesale ? { price: Number(l.price) } : {}),
        })),
      });
      setForm(EMPTY);
      setLines([{ ...EMPTY_LINE }]);
      setWs(null);
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

      <div className="customer-kind" role="radiogroup" aria-label="Loại khách">
        <button type="button" role="radio" aria-checked={!wholesale} className={!wholesale ? 'active' : ''} onClick={() => switchKind('retail')}>
          Khách lẻ <small>giá web, không sửa giá</small>
        </button>
        <button type="button" role="radio" aria-checked={wholesale} className={wholesale ? 'active' : ''} onClick={() => switchKind('wholesale')}>
          Khách buôn <small>giá riêng, sửa được giá</small>
        </button>
      </div>

      {wholesale && (
        <div className="ws-picker">
          {ws ? (
            <div className="ws-chosen">
              <span><b>{ws.customer.code}</b> · {ws.customer.company}<small>{ws.customer.contact_name} · {ws.customer.phone}{ws.prices.size ? ` · ${ws.prices.size} loại có giá riêng` : ' · chưa có giá riêng'}</small></span>
              <button type="button" className="btn btn-secondary" onClick={() => { setWs(null); setWsOpen(true); }}>Đổi khách</button>
            </div>
          ) : (
            <label className="ws-search">Khách buôn
              <input className="input" type="search" value={wsQuery} autoComplete="off" role="combobox" aria-expanded={wsOpen} aria-controls="ws-options"
                     placeholder={wsList ? 'Gõ mã KB…, tên công ty, tên hoặc số điện thoại' : 'Đang tải danh sách…'}
                     onFocus={() => setWsOpen(true)} onChange={(e) => { setWsQuery(e.target.value); setWsOpen(true); }}
                     onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) { e.preventDefault(); chooseCustomer(matches[0]); } if (e.key === 'Escape') setWsOpen(false); }}
                     aria-invalid={!!(errors.wholesale || errors.wholesale_customer_id)} />
              {wsOpen && wsList && (
                <ul className="ws-options" id="ws-options" role="listbox">
                  {matches.length === 0 && <li className="muted">Không tìm thấy. Chủ cửa hàng thêm khách ở Quản trị → Khách buôn.</li>}
                  {matches.map((c) => (
                    <li key={c.id} role="option" aria-selected="false">
                      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => chooseCustomer(c)}>
                        <span><b>{c.code}</b> · {c.company}</span><small>{c.contact_name} · {c.phone}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {(errors.wholesale || errors.wholesale_customer_id) && <small className="err">{errors.wholesale || errors.wholesale_customer_id}</small>}
            </label>
          )}
        </div>
      )}

      <div className="about-admin-row">
        <label>{wholesale ? 'Người nhận hàng' : 'Họ tên khách'}
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
        {lines.map((line, index) => {
          const product = byId[line.product_id];
          return (
            <div key={index} className={`manual-line${wholesale ? ' with-price' : ''}`}>
              <select className="input" value={line.product_id} onChange={(e) => pickProduct(index, e.target.value)} aria-label={`Loại gạo ${index + 1}`}>
                <option value="">— Chọn loại gạo —</option>
                {selectable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.unit} · {wholesale && fixedPrice(p.id) ? `giá riêng ${formatVND(fixedPrice(p.id))}` : formatVND(p.price)} (còn {p.stock})
                  </option>
                ))}
              </select>
              <input className="input manual-qty" type="number" min="1" max="1000" value={line.quantity}
                     onChange={(e) => setLine(index, { quantity: e.target.value })} aria-label={`Số lượng ${index + 1}`} />
              {wholesale ? (
                <label className="manual-price">
                  <input className="input" inputMode="numeric" value={line.price} disabled={!line.product_id}
                         onChange={(e) => setLine(index, { price: e.target.value.replace(/\D/g, '') })} aria-label={`Giá bán ${index + 1}`} placeholder="Giá bán" />
                  {product && <small>web {formatVND(product.price)}{fixedPrice(product.id) ? ` · riêng ${formatVND(fixedPrice(product.id))}` : ''}</small>}
                </label>
              ) : (
                product && <span className="manual-unit-price">{formatVND(product.price)}</span>
              )}
              {lines.length > 1 && (
                <button type="button" className="icon-close" onClick={() => setLines((cur) => cur.filter((_, i) => i !== index))} aria-label="Bỏ dòng">×</button>
              )}
            </div>
          );
        })}
        <button type="button" className="link-button" onClick={() => setLines((cur) => [...cur, { ...EMPTY_LINE }])}>+ Thêm loại gạo</button>
        {errors.items && <small className="err">{errors.items}</small>}
        <p className="manual-subtotal">Tiền hàng: <strong>{formatVND(subtotal)}</strong>
          {form.home_delivery && subtotal > 0 && <> · Phí giao: <strong>{shippingFeeFor(subtotal) ? formatVND(shippingFeeFor(subtotal)) : 'Freeship'}</strong></>}
          {' '}<small>{wholesale ? '(khách buôn: không áp dụng mã giảm giá, không tích điểm)' : '(đơn đầu của số điện thoại tự giảm 20.000đ, hoặc nhập mã)'}</small></p>
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
        {!wholesale && (
          <label>Mã giảm giá (nếu có)
            <input className="input code-input" value={form.discount_code} maxLength={40} onChange={(e) => set('discount_code', e.target.value.toUpperCase())} aria-invalid={!!errors.discount_code} />
            {errors.discount_code && <small className="err">{errors.discount_code}</small>}
          </label>
        )}
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
