import { useEffect, useState } from 'react';
import { api } from '../api';
import ImagePicker from './ImagePicker.jsx';
import { invoiceHeader, loadShopSettings } from '../shopInfo.js';

const FIELDS = [
  ['company', 'Tên công ty (đầu hoá đơn)', 'Công Ty CP Lương Thực Lúa Vàng Châu Á'],
  ['company_short', 'Tên viết tắt (đầu báo cáo đóng ngày)', 'CTY CP LƯƠNG THỰC LÚA VÀNG CHÂU Á'],
  ['address1', 'Địa chỉ cơ sở 1', 'CS1: 51A Nguyễn Cao - Kinh Bắc - Bắc Ninh'],
  ['address2', 'Địa chỉ cơ sở 2 (để trống nếu không có)', 'CS2: …'],
  ['phones', 'Điện thoại in trên hoá đơn', '0986.407.975 - 0979.848.405'],
  ['bank_name', 'Ngân hàng', 'Vietcombank'],
  ['bank_number', 'Số tài khoản', '1204372888'],
  ['bank_holder', 'Chủ tài khoản', 'CTY CP LƯƠNG THỰC LÚA VÀNG CHÂU Á'],
];
const fmt = (day) => (day ? day.split('-').reverse().join('/') : '…');
const blank = (kind) => ({ kind, title: kind === 'holiday' ? '' : 'Cập nhật trang web', start: '', end: '', reopen: '', show_from: '', note: '' });

/** Câu khách sẽ đọc trên banner (bản tiếng Việt), để chủ cửa hàng xem trước. */
export function noticeSentence(n) {
  if (n.kind === 'holiday') {
    return `${n.title || 'Nghỉ lễ'}: cửa hàng nghỉ từ ${fmt(n.start)} đến hết ${fmt(n.end)}${n.reopen ? `, mở cửa lại ngày ${fmt(n.reopen)}` : ''}.${n.note ? ` ${n.note}` : ''}`;
  }
  return `Trang web cập nhật từ ${fmt(n.start)} đến ${fmt(n.end)}. Nếu đặt hàng gặp lỗi, vui lòng gọi cửa hàng.${n.note ? ` ${n.note}` : ''}`;
}

/**
 * Quản trị → CẬP NHẬT (20/11/2026, chỉ chủ cửa hàng):
 *  - Thông tin trên hoá đơn: tên công ty, địa chỉ, điện thoại, tài khoản ngân hàng, mã QR chuyển khoản.
 *    Dùng cho hoá đơn in, khung chuyển khoản của khách, đầu báo cáo đóng ngày.
 *  - Thông báo trên banner trang khách: nghỉ lễ / Tết (từ ngày – đến ngày – mở lại ngày) và cập nhật trang web
 *    (từ ngày – đến ngày). Mặc định hiện trước 7 ngày; chọn "Hiện từ ngày" để đổi.
 */
export default function BusinessUpdate() {
  const [data, setData] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [qr, setQr] = useState('');
  const [notices, setNotices] = useState([]);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');

  const apply = (d) => {
    setData(d);
    setInvoice(d.invoice);
    setQr(d.bank_qr_url || '');
    setNotices(d.notices.map((n) => ({ ...blank(n.kind), ...n, reopen: n.reopen || '', show_from: n.show_from || '' })));
  };
  useEffect(() => { api.adminBusiness().then(apply).catch((err) => setErrors({ form: err.message })); }, []);

  const save = async (part) => {
    setBusy(part);
    setErrors({});
    setMessage('');
    try {
      const body = part === 'invoice'
        ? { invoice, bank_qr_url: qr || null }
        : { notices: notices.map((n) => ({ ...n, reopen: n.kind === 'holiday' && n.reopen ? n.reopen : null, show_from: n.show_from || null })) };
      const result = await api.adminSaveBusiness(body);
      apply(result);
      loadShopSettings({ fresh: true });
      setMessage(part === 'invoice' ? 'Đã lưu thông tin hoá đơn. Hoá đơn in và khung chuyển khoản dùng thông tin mới ngay.' : 'Đã lưu thông báo. Trang khách cập nhật trong khoảng 30 giây.');
    } catch (err) {
      setErrors({ [part]: err.message, ...(err.errors || {}) });
    } finally {
      setBusy('');
    }
  };
  const setNotice = (i, patch) => setNotices((cur) => cur.map((n, j) => (j === i ? { ...n, ...patch } : n)));

  if (!data) return errors.form ? <p className="alert error">{errors.form}</p> : <p className="muted">Đang tải…</p>;
  const header = invoiceHeader(invoice);

  return (
    <div className="business-update">
      {message && <p className="alert success" role="status">{message}</p>}

      <section className="form-card flat">
        <h2>Thông tin trên hoá đơn</h2>
        <p className="field-help">In trên hoá đơn bán hàng, hiện ở khung chuyển khoản của khách và đầu báo cáo đóng ngày.</p>
        <div className="business-grid">
          {FIELDS.map(([key, label, placeholder]) => (
            <label key={key}>{label}
              <input className="input" value={invoice[key] || ''} placeholder={placeholder} maxLength={key === 'bank_number' ? 30 : 200}
                     onChange={(e) => setInvoice({ ...invoice, [key]: e.target.value })} aria-invalid={!!errors[key]} />
              {errors[key] && <small className="err">{errors[key]}</small>}
            </label>
          ))}
        </div>
        <div className="business-qr">
          <ImagePicker label="Mã QR chuyển khoản" subject="mã QR tài khoản ngân hàng" maxEdge={1200}
                       value={qr} error={errors.bank_qr_url} onChange={(url) => setQr(url || '')} />
          <div className="business-preview" aria-label="Xem trước đầu hoá đơn">
            <small>Xem trước đầu hoá đơn</small>
            <strong>{header.company}</strong>
            {header.lines.map((parts) => <p key={parts[0]}>{parts.join(' | ')}</p>)}
          </div>
        </div>
        {errors.invoice && <p className="alert error" role="alert">{errors.invoice}</p>}
        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => save('invoice')}>{busy === 'invoice' ? 'Đang lưu…' : 'Lưu thông tin hoá đơn'}</button>
      </section>

      <section className="form-card flat">
        <h2>Thông báo trên banner</h2>
        <p className="field-help">
          Hiện thành dải thông báo trên đầu các trang khách (tiếng Việt, Anh, Trung). Mặc định hiện trước ngày bắt đầu 7 ngày và tự ẩn sau
          ngày nghỉ cuối cùng (ngày trước ngày mở lại) hoặc ngày cập nhật cuối cùng.
        </p>
        {data.active.length > 0 && <p className="alert info">Đang hiện hôm nay: {data.active.length} thông báo.</p>}
        {notices.length === 0 && <p className="muted">Chưa có thông báo nào.</p>}
        <div className="business-notices">
          {notices.map((n, i) => (
            <fieldset key={i} className={`business-notice ${n.kind}`}>
              <legend>{n.kind === 'holiday' ? '🏮 Nghỉ lễ / Tết' : '🛠️ Cập nhật trang web'}</legend>
              <div className="business-notice-grid">
                {n.kind === 'holiday' && (
                  <label className="wide">Tên dịp nghỉ
                    <input className="input" value={n.title} maxLength={120} placeholder="VD: Nghỉ Tết Nguyên Đán" onChange={(e) => setNotice(i, { title: e.target.value })} />
                  </label>
                )}
                <label>{n.kind === 'holiday' ? 'Nghỉ từ ngày' : 'Cập nhật từ ngày'}
                  <input className="input" type="date" value={n.start} onChange={(e) => setNotice(i, { start: e.target.value })} />
                </label>
                <label>Đến hết ngày
                  <input className="input" type="date" value={n.end} min={n.start || undefined} onChange={(e) => setNotice(i, { end: e.target.value })} />
                </label>
                {n.kind === 'holiday' && (
                  <label>Mở cửa lại ngày
                    <input className="input" type="date" value={n.reopen} min={n.end || undefined} onChange={(e) => setNotice(i, { reopen: e.target.value })} />
                  </label>
                )}
                <label>Hiện thông báo từ ngày <small>(trống = trước 7 ngày)</small>
                  <input className="input" type="date" value={n.show_from} max={n.start || undefined} onChange={(e) => setNotice(i, { show_from: e.target.value })} />
                </label>
                <label className="wide">Ghi chú thêm <small>(không bắt buộc)</small>
                  <input className="input" value={n.note} maxLength={300} placeholder="VD: Đơn đặt trong thời gian nghỉ sẽ giao từ ngày mở lại." onChange={(e) => setNotice(i, { note: e.target.value })} />
                </label>
              </div>
              <p className="business-notice-preview">Khách thấy: “{noticeSentence(n)}”</p>
              <button type="button" className="link-button danger" onClick={() => setNotices((cur) => cur.filter((_, j) => j !== i))}>Xoá thông báo này</button>
            </fieldset>
          ))}
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setNotices((cur) => [...cur, blank('holiday')])}>+ Thông báo nghỉ lễ / Tết</button>
          <button type="button" className="btn btn-secondary" onClick={() => setNotices((cur) => [...cur, blank('maintenance')])}>+ Thông báo cập nhật trang web</button>
        </div>
        {errors.notices && <p className="alert error" role="alert">{errors.notices}</p>}
        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => save('notices')}>{busy === 'notices' ? 'Đang lưu…' : 'Lưu thông báo'}</button>
      </section>
    </div>
  );
}
