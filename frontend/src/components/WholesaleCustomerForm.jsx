import { useEffect, useState } from 'react';
import { api, formatVND } from '../api';
import MapLinkField, { addressMapProps } from './MapLinkField.jsx';

const EMPTY = { company: '', contact_name: '', phone: '', address: '', map_url: '', note: '', password: '' };
const EMPTY_ROW = { product_id: '', price: '' };
const validPrice = (value) => Number.isInteger(Number(value)) && Number(value) > 0;

/**
 * Thêm / sửa một khách buôn trong một lần lưu: thông tin, tên công ty, địa chỉ, định vị Google Maps,
 * và "gạo hay đặt" kèm giá cố định (chính là bảng giá riêng của khách). Dùng ở Quản trị → Khách buôn
 * và ngay trong form Tạo đơn. `onSaved({ customer, prices, message })`.
 */
export default function WholesaleCustomerForm({ customer = null, onSaved, onCancel }) {
  const editing = !!customer?.id;
  const [form, setForm] = useState(() => ({
    ...EMPTY, ...(customer || {}), address: customer?.address || '', map_url: customer?.map_url || '', note: customer?.note || '', password: '',
  }));
  const [products, setProducts] = useState(null);
  const [rows, setRows] = useState([{ ...EMPTY_ROW }]);
  const [initial, setInitial] = useState({});      // product_id → giá đang lưu
  const [ready, setReady] = useState(!editing);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [mapFromAddress, setMapFromAddress] = useState(false);

  useEffect(() => {
    let alive = true;
    api.products().then((d) => { if (alive) setProducts(d.products || []); }).catch(() => { if (alive) setProducts([]); });
    if (editing) {
      api.adminWholesaleGet(customer.id).then((d) => {
        if (!alive) return;
        setInitial(Object.fromEntries(d.prices.map((p) => [p.product_id, p.price])));
        setRows([...d.prices.map((p) => ({ product_id: String(p.product_id), price: String(p.price) })), { ...EMPTY_ROW }]);
        setReady(true);
      }).catch((err) => { if (alive) setErrors({ form: err.message }); });
    }
    return () => { alive = false; };
  }, [editing, customer?.id]);

  const set = (field, value) => setForm((cur) => ({ ...cur, [field]: value }));
  const setRow = (index, patch) => setRows((cur) => cur.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const byId = Object.fromEntries((products || []).map((p) => [String(p.id), p]));
  const taken = new Set(rows.map((r) => r.product_id).filter(Boolean));

  const save = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const filled = rows.filter((r) => r.product_id);
    const bad = filled.find((r) => !validPrice(r.price));
    if (bad) { setErrors({ rows: `Nhập giá cố định (số nguyên lớn hơn 0) cho ${byId[bad.product_id]?.name || 'loại gạo đã chọn'}, hoặc bỏ dòng đó.` }); return; }
    const wanted = Object.fromEntries(filled.map((r) => [r.product_id, Number(r.price)]));
    const prices = [
      ...Object.entries(wanted).filter(([id, price]) => initial[id] !== price).map(([id, price]) => ({ product_id: Number(id), price })),
      ...Object.keys(initial).filter((id) => wanted[id] === undefined).map((id) => ({ product_id: Number(id), price: null })),
    ];
    const payload = {
      company: form.company.trim(), contact_name: form.contact_name.trim(), phone: form.phone.trim(),
      address: form.address.trim() || null, map_url: form.map_url.trim() || null, note: form.note.trim() || null,
      ...(form.password ? { password: form.password } : {}),
      ...(editing ? { is_active: !!form.is_active } : {}),
      ...(prices.length ? { prices } : {}),
    };
    setBusy(true);
    setErrors({});
    try {
      const result = editing ? await api.adminWholesaleUpdate(customer.id, payload) : await api.adminWholesaleCreate(payload);
      onSaved(result);
    } catch (err) {
      const fieldErrors = err.errors || {};
      const priceError = Object.keys(fieldErrors).find((k) => k.startsWith('price_'));
      setErrors({ form: err.message, ...fieldErrors, ...(priceError ? { rows: fieldErrors[priceError] } : {}) });
    } finally { setBusy(false); }
  };

  return (
    <form className="form-card flat wholesale-form" onSubmit={save} noValidate>
      <div className="manual-order-head">
        <h2>{editing ? `Sửa khách ${customer.code}` : 'Thêm khách mới'}</h2>
        <button type="button" className="icon-close" onClick={onCancel} aria-label="Đóng">×</button>
      </div>
      <div className="about-admin-row">
        <label>Tên công ty / cửa hàng
          <input className="input" value={form.company} maxLength={160} onChange={(e) => set('company', e.target.value)} aria-invalid={!!errors.company} placeholder="VD: Công ty Bếp ăn Kinh Bắc" />
          {errors.company && <small className="err">{errors.company}</small>}
        </label>
        <label>Người liên hệ
          <input className="input" value={form.contact_name} maxLength={120} onChange={(e) => set('contact_name', e.target.value)} aria-invalid={!!errors.contact_name} />
          {errors.contact_name && <small className="err">{errors.contact_name}</small>}
        </label>
        <label>Số điện thoại
          <input className="input" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} aria-invalid={!!errors.phone} placeholder="0912345678" />
          {errors.phone && <small className="err">{errors.phone}</small>}
        </label>
      </div>
      <div className="about-admin-row">
        <label>Địa chỉ giao
          <input className="input" value={form.address} maxLength={300} aria-invalid={!!errors.address}
                 {...addressMapProps(form.address, (v) => set('address', v), (v) => set('map_url', v), () => setMapFromAddress(true))}
                 placeholder="Số nhà, đường, phường — hoặc dán link Google Maps" />
          {errors.address && <small className="err">{errors.address}</small>}
        </label>
        <MapLinkField value={form.map_url} onChange={(v) => { set('map_url', v); setMapFromAddress(false); }} error={errors.map_url} fromAddress={mapFromAddress} />
      </div>

      <fieldset className="manual-lines usual-rows">
        <legend>Gạo hay đặt và giá cố định</legend>
        {!ready || !products ? <p className="muted">Đang tải…</p> : rows.map((row, index) => {
          const product = byId[row.product_id];
          return (
            <div key={index} className="manual-line with-price">
              <select className="input" value={row.product_id} aria-label={`Gạo hay đặt ${index + 1}`}
                      onChange={(e) => setRow(index, { product_id: e.target.value, price: e.target.value ? row.price : '' })}>
                <option value="">— Chọn loại gạo —</option>
                {row.product_id && !product && <option value={row.product_id}>Loại gạo đang ẩn (#{row.product_id})</option>}
                {products.filter((p) => String(p.id) === row.product_id || !taken.has(String(p.id))).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {p.unit} · {p.price > 0 ? `giá web ${formatVND(p.price)}` : 'chưa có giá web'}</option>
                ))}
              </select>
              <label className="manual-price">
                <input className="input" inputMode="numeric" value={row.price} disabled={!row.product_id} placeholder="Giá cố định"
                       onChange={(e) => setRow(index, { price: e.target.value.replace(/\D/g, '') })} aria-label={`Giá cố định ${index + 1}`} />
                {product && validPrice(row.price) && product.price > 0 && Number(row.price) !== product.price && (
                  <small>{Number(row.price) < product.price ? 'thấp hơn' : 'cao hơn'} giá web {formatVND(Math.abs(Number(row.price) - product.price))}</small>
                )}
              </label>
              {(rows.length > 1 || row.product_id) && (
                <button type="button" className="icon-close" aria-label="Bỏ dòng"
                        onClick={() => setRows((cur) => (cur.length > 1 ? cur.filter((_, i) => i !== index) : [{ ...EMPTY_ROW }]))}>×</button>
              )}
            </div>
          );
        })}
        {ready && products && <button type="button" className="link-button" onClick={() => setRows((cur) => [...cur, { ...EMPTY_ROW }])}>+ Thêm loại gạo hay đặt</button>}
        {errors.rows && <small className="err" role="alert">{errors.rows}</small>}
        <small className="field-help">Khi tạo đơn cho khách này, các loại gạo ở đây hiện sẵn để bấm chọn và tự điền đúng giá. Loại không có trong danh sách tính giá web.</small>
      </fieldset>

      <div className="about-admin-row">
        <label>Ghi chú
          <input className="input" value={form.note} maxLength={300} onChange={(e) => set('note', e.target.value)} placeholder="VD: công nợ 30 ngày, giao trước 10h" />
        </label>
        <label>{form.has_login ? 'Đặt lại mật khẩu đăng nhập' : 'Mật khẩu đăng nhập (không bắt buộc)'}
          <input className="input" value={form.password} autoComplete="new-password" onChange={(e) => set('password', e.target.value)}
                 placeholder={form.has_login ? 'Để trống nếu không đổi' : 'Tối thiểu 8 ký tự'} aria-invalid={!!errors.password} />
          {errors.password
            ? <small className="err">{errors.password}</small>
            : <small className="field-help">Khách đăng nhập bằng <b>mã khách buôn</b> và mật khẩu này để xem đơn của mình.</small>}
        </label>
      </div>
      {editing && (
        <label className="checkbox-label"><input type="checkbox" checked={!!form.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Đang mua buôn (bỏ tick để ngừng: không chọn được khi tạo đơn, không đăng nhập bằng mã)</label>
      )}
      {errors.form && <p className="alert error">{errors.form}</p>}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy || !ready}>{busy ? 'Đang lưu…' : editing ? 'Lưu' : 'Thêm khách'}</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>{editing ? 'Huỷ' : 'Quay lại'}</button>
      </div>
    </form>
  );
}
