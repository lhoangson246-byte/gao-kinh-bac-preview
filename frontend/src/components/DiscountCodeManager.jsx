import { useEffect, useState } from 'react';
import { api, formatVND, vietnamDate } from '../api';

const EMPTY = { code: '', amount: '', starts_on: '', ends_on: '', min_subtotal: '', per_phone_limit: '', max_uses: '', note: '' };
const formatDay = (value) => (value ? value.split('-').reverse().join('/') : '');

/** Trạng thái hiện tại của mã theo ngày hôm nay (giờ Việt Nam). */
function codeState(code, today) {
  if (!code.is_active) return ['off', 'Đang tắt'];
  if (code.starts_on && today < code.starts_on) return ['soon', `Từ ${formatDay(code.starts_on)}`];
  if (code.ends_on && today > code.ends_on) return ['ended', 'Đã hết hạn'];
  if (code.max_uses > 0 && code.uses >= code.max_uses) return ['ended', 'Hết lượt'];
  return ['on', 'Đang áp dụng'];
}

/**
 * Mã giảm giá khách nhập khi đặt hàng. Mỗi đơn chỉ một khuyến mãi: đơn đầu (20.000đ) hoặc mã —
 * máy chủ tự chọn cái lợi hơn cho khách.
 */
export default function DiscountCodeManager() {
  const [codes, setCodes] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const today = vietnamDate();

  useEffect(() => { api.adminDiscountCodes().then((d) => setCodes(d.codes)).catch((err) => setErrors({ load: err.message })); }, []);

  const set = (field, value) => setForm((cur) => ({ ...cur, [field]: value }));
  const run = async (action, done) => {
    setBusy(true); setErrors({}); setMessage('');
    try {
      const data = await action();
      setCodes(data.codes);
      setMessage(done);
      return true;
    } catch (err) {
      setErrors({ form: err.message, ...(err.errors || {}) });
      return false;
    } finally { setBusy(false); }
  };

  const save = async (event) => {
    event.preventDefault();
    const body = { ...form, code: form.code.trim(), starts_on: form.starts_on || null, ends_on: form.ends_on || null, note: form.note || null };
    const ok = await run(() => (editing ? api.adminUpdateDiscountCode(editing, body) : api.adminCreateDiscountCode(body)),
      editing ? 'Đã lưu mã.' : `Đã tạo mã ${body.code.toUpperCase()}.`);
    if (ok) { setForm(EMPTY); setEditing(null); }
  };

  const edit = (c) => {
    setEditing(c.id);
    setForm({
      code: c.code, amount: String(c.amount), starts_on: c.starts_on || '', ends_on: c.ends_on || '',
      min_subtotal: c.min_subtotal ? String(c.min_subtotal) : '', per_phone_limit: c.per_phone_limit ? String(c.per_phone_limit) : '',
      max_uses: c.max_uses ? String(c.max_uses) : '', note: c.note || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (errors.load) return <p className="alert error">{errors.load}</p>;
  if (!codes) return <div className="loading-state" role="status"><span></span>Đang mở…</div>;

  return (
    <div className="about-manager">
      {message && <p className="alert success" role="status">{message}</p>}
      <section className="form-card flat">
        <h2>{editing ? 'Sửa mã giảm giá' : 'Tạo mã giảm giá'}</h2>
        <p className="field-help">
          Khách nhập mã ở trang đặt hàng. <strong>Mỗi đơn chỉ 1 khuyến mãi</strong>: đơn đầu tiên của khách được giảm
          20.000đ thì mã nhỏ hơn không cộng thêm (máy chủ tự chọn cái lợi hơn). Voucher đổi điểm vẫn dùng kèm được.
        </p>
        <form className="about-admin-form" onSubmit={save} noValidate>
          <div className="about-admin-row">
            <label>Mã
              <input className="input code-input" value={form.code} maxLength={30} onChange={(e) => set('code', e.target.value.toUpperCase())}
                     placeholder="VD: GAOKINHBAC12" aria-invalid={!!errors.code} />
              {errors.code && <small className="err">{errors.code}</small>}
            </label>
            <label>Giảm (đồng)
              <input className="input" inputMode="numeric" value={form.amount} onChange={(e) => set('amount', e.target.value.replace(/\D/g, ''))}
                     placeholder="10000" aria-invalid={!!errors.amount} />
              {errors.amount && <small className="err">{errors.amount}</small>}
            </label>
            <label>Từ ngày
              <input className="input" type="date" value={form.starts_on} onChange={(e) => set('starts_on', e.target.value)} />
              {errors.starts_on && <small className="err">{errors.starts_on}</small>}
            </label>
            <label>Đến hết ngày
              <input className="input" type="date" value={form.ends_on} onChange={(e) => set('ends_on', e.target.value)} />
              {errors.ends_on && <small className="err">{errors.ends_on}</small>}
            </label>
          </div>
          <div className="about-admin-row">
            <label>Đơn tối thiểu (đồng, bỏ trống = không)
              <input className="input" inputMode="numeric" value={form.min_subtotal} onChange={(e) => set('min_subtotal', e.target.value.replace(/\D/g, ''))} />
            </label>
            <label>Mỗi SĐT dùng tối đa (bỏ trống = không giới hạn)
              <input className="input" inputMode="numeric" value={form.per_phone_limit} onChange={(e) => set('per_phone_limit', e.target.value.replace(/\D/g, ''))} />
            </label>
            <label>Tổng số lượt (bỏ trống = không giới hạn)
              <input className="input" inputMode="numeric" value={form.max_uses} onChange={(e) => set('max_uses', e.target.value.replace(/\D/g, ''))} />
            </label>
          </div>
          <label>Ghi chú
            <input className="input" value={form.note} maxLength={200} onChange={(e) => set('note', e.target.value)} placeholder="VD: Mã tháng 12 gửi nhóm Zalo" />
          </label>
          {errors.form && <p className="alert error">{errors.form}</p>}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>{editing ? 'Lưu mã' : 'Tạo mã'}</button>
            {editing && <button type="button" className="btn btn-secondary" onClick={() => { setEditing(null); setForm(EMPTY); setErrors({}); }}>Huỷ</button>}
          </div>
        </form>
      </section>

      <section className="form-card flat">
        <h2>Các mã đã tạo</h2>
        {codes.length === 0 ? <p className="muted">Chưa có mã nào.</p> : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Mã</th><th>Giảm</th><th>Thời gian</th><th>Điều kiện</th><th>Đã dùng</th><th>Trạng thái</th><th></th></tr></thead>
              <tbody>
                {codes.map((c) => {
                  const [state, label] = codeState(c, today);
                  return (
                    <tr key={c.id}>
                      <td><strong>{c.code}</strong>{c.note && <small className="cell-note">{c.note}</small>}</td>
                      <td>{formatVND(c.amount)}</td>
                      <td>{c.starts_on || c.ends_on ? `${formatDay(c.starts_on) || '…'} – ${formatDay(c.ends_on) || '…'}` : 'Không hạn'}</td>
                      <td>
                        {[c.min_subtotal > 0 && `Đơn từ ${formatVND(c.min_subtotal)}`, c.per_phone_limit > 0 && `${c.per_phone_limit} lần/SĐT`,
                          c.max_uses > 0 && `Tối đa ${c.max_uses} lượt`].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td>{c.uses} đơn<small className="cell-note">đã giảm {formatVND(c.discounted)}</small></td>
                      <td><span className={`code-state ${state}`}>{label}</span></td>
                      <td className="cell-actions">
                        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => edit(c)}>Sửa</button>
                        <button type="button" className="btn btn-secondary" disabled={busy}
                                onClick={() => run(() => api.adminUpdateDiscountCode(c.id, { is_active: !c.is_active }), c.is_active ? `Đã tắt mã ${c.code}.` : `Đã bật mã ${c.code}.`)}>
                          {c.is_active ? 'Tắt' : 'Bật'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
