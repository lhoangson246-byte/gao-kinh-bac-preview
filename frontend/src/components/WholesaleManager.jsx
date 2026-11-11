import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatVND } from '../api';
import WholesaleCustomerForm from './WholesaleCustomerForm.jsx';

export const foldText = (value) => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();

/**
 * Quản trị → Khách buôn: thêm khách buôn (mã KB… cố định, tên công ty, định vị, gạo hay đặt), đặt mật
 * khẩu để khách đăng nhập bằng mã, và bảng giá cố định từng loại gạo. Giá riêng chỉ áp dụng khi nhân viên tạo đơn cho khách
 * buôn; khách tự đặt trên web vẫn trả giá web. Khách buôn không dùng mã giảm giá, không tích điểm.
 */
export default function WholesaleManager() {
  const [list, setList] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(null);          // { id?, ...fields }
  const [notice, setNotice] = useState('');
  const [pricing, setPricing] = useState(null);    // khách đang sửa bảng giá

  const load = useCallback(async () => {
    try { setList((await api.adminWholesaleList({ all: showAll })).customers); } catch (err) { setNotice(err.message); }
  }, [showAll]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const q = foldText(query.trim());
    return (list || []).filter((c) => !q || [c.code, c.company, c.contact_name, c.phone].some((v) => foldText(v).includes(q)));
  }, [list, query]);

  return (
    <div className="wholesale-manager">
      {notice && <p className="alert success" role="status">{notice}</p>}
      <div className="wholesale-toolbar">
        <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm theo mã, công ty, tên, số điện thoại" aria-label="Tìm khách buôn" />
        <label className="checkbox-label"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Hiện cả khách đã ngừng</label>
        <button type="button" className="btn btn-primary" onClick={() => { setForm({}); setPricing(null); }}>+ Thêm khách buôn</button>
      </div>

      {form && (
        <WholesaleCustomerForm key={form.id || 'new'} customer={form.id ? form : null} onCancel={() => setForm(null)}
                               onSaved={(result) => {
                                 setNotice(`${form.id ? 'Đã lưu' : 'Đã thêm'} khách buôn ${result.customer.code}.${result.message ? ` ${result.message}` : ''}`);
                                 setForm(null);
                                 load();
                               }} />
      )}

      {pricing && <PriceEditor customer={pricing} onClose={() => setPricing(null)} onSaved={(text) => { setNotice(text); load(); }} />}

      <section className="form-card flat">
        <h2>Khách buôn ({shown.length})</h2>
        {!list ? <p className="muted">Đang tải…</p> : shown.length === 0 ? <p className="muted">Chưa có khách buôn nào.</p> : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Mã</th><th>Công ty</th><th>Liên hệ</th><th>Địa chỉ</th><th>Giá riêng</th><th>Đăng nhập</th><th></th></tr></thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} className={c.is_active ? '' : 'row-muted'}>
                    <td><strong className="wholesale-code">{c.code}</strong>{!c.is_active && <small className="cell-note">đã ngừng</small>}</td>
                    <td><strong>{c.company}</strong>{c.note && <small className="cell-note">{c.note}</small>}</td>
                    <td>{c.contact_name}<small className="cell-note"><a href={`tel:${c.phone}`}>{c.phone}</a></small></td>
                    <td className="wholesale-address">{c.address || '—'}{c.map_url && <a className="map-link" href={c.map_url} target="_blank" rel="noopener noreferrer">📍 Mở định vị</a>}</td>
                    <td>{c.price_count ? `${c.price_count} loại` : 'Chưa đặt'}</td>
                    <td>{c.has_login ? 'Có' : 'Chưa'}</td>
                    <td className="wholesale-actions">
                      <button type="button" className="btn btn-secondary" onClick={() => { setPricing(c); setForm(null); }}>Bảng giá</button>
                      <button type="button" className="btn btn-secondary" onClick={() => { setForm(c); setPricing(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Sửa</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Bảng giá cố định của một khách buôn: mỗi loại gạo một ô giá; để trống = dùng giá web. */
function PriceEditor({ customer, onClose, onSaved }) {
  const [products, setProducts] = useState(null);
  const [values, setValues] = useState({});       // product_id → chuỗi giá đang nhập
  const [initial, setInitial] = useState({});
  const [filter, setFilter] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api.adminProducts(), api.adminWholesaleGet(customer.id)]).then(([p, d]) => {
      if (!alive) return;
      const start = Object.fromEntries(d.prices.map((x) => [x.product_id, String(x.price)]));
      setInitial(start);
      setValues(start);
      setProducts(p.products.filter((x) => x.is_active || start[x.id] !== undefined));
    }).catch((err) => setErrors({ form: err.message }));
    return () => { alive = false; };
  }, [customer.id]);

  const shown = (products || []).filter((p) => !filter || foldText(p.name).includes(foldText(filter)));
  const changed = Object.keys({ ...initial, ...values }).filter((id) => (values[id] || '') !== (initial[id] || ''));

  const save = async () => {
    const bad = changed.find((id) => values[id] && !(Number.isInteger(Number(values[id])) && Number(values[id]) > 0));
    if (bad) { setErrors({ [`price_${bad}`]: 'Giá phải là số nguyên lớn hơn 0.' }); return; }
    setBusy(true);
    setErrors({});
    try {
      await api.adminWholesalePrices(customer.id, changed.map((id) => ({ product_id: Number(id), price: values[id] ? Number(values[id]) : null })));
      onSaved(`Đã lưu bảng giá của ${customer.code} · ${customer.company}.`);
      onClose();
    } catch (err) {
      setErrors({ form: err.message, ...(err.errors || {}) });
    } finally { setBusy(false); }
  };

  return (
    <section className="form-card flat wholesale-prices">
      <div className="manual-order-head">
        <h2>Bảng giá cố định · {customer.code} · {customer.company}</h2>
        <button type="button" className="icon-close" onClick={onClose} aria-label="Đóng">×</button>
      </div>
      <p className="muted">Để trống = loại đó tính theo giá web. Khi tạo đơn, nhân viên vẫn sửa được giá từng dòng cho riêng đơn đó.</p>
      <input className="input" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Lọc theo tên gạo" aria-label="Lọc loại gạo" />
      {!products ? <p className="muted">Đang tải…</p> : (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Loại gạo</th><th className="num">Giá web</th><th className="num">Giá khách buôn</th><th className="num">Chênh</th></tr></thead>
            <tbody>
              {shown.map((p) => {
                const value = values[p.id] ?? '';
                const diff = value && p.price > 0 ? Number(value) - p.price : null;
                return (
                  <tr key={p.id} className={changed.includes(String(p.id)) ? 'row-changed' : ''}>
                    <td><strong>{p.name}</strong><small className="cell-note">{p.unit}{p.is_active ? '' : ' · đang ẩn'}</small></td>
                    <td className="num">{p.price > 0 ? formatVND(p.price) : 'Chưa có giá'}</td>
                    <td className="num">
                      <input className="input wholesale-price-input" inputMode="numeric" value={value} placeholder="Giá web"
                             onChange={(e) => setValues((cur) => ({ ...cur, [p.id]: e.target.value.replace(/\D/g, '') }))}
                             aria-label={`Giá khách buôn cho ${p.name}`} aria-invalid={!!errors[`price_${p.id}`]} />
                      {errors[`price_${p.id}`] && <small className="err">{errors[`price_${p.id}`]}</small>}
                    </td>
                    <td className={`num${diff < 0 ? ' price-down' : diff > 0 ? ' price-up' : ''}`}>{diff == null ? '' : `${diff > 0 ? '+' : ''}${formatVND(diff)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {errors.form && <p className="alert error">{errors.form}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn-primary" disabled={busy || changed.length === 0} onClick={save}>{busy ? 'Đang lưu…' : `Lưu bảng giá${changed.length ? ` (${changed.length} thay đổi)` : ''}`}</button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Đóng</button>
      </div>
    </section>
  );
}
