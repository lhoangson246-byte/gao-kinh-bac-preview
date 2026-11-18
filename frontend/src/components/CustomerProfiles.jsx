import { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatDateTime } from '../api';
import { ListSkeleton } from './Skeleton.jsx';

const formatPhone = (phone) => String(phone || '').replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');

/**
 * Khách đã đặt hàng (18/11/2026): hồ sơ tự lưu theo số điện thoại sau mỗi đơn — tên, địa chỉ giao, định vị
 * (link khách gửi hoặc vị trí khách ghim), số lần đặt, đơn gần nhất. Đơn mới tự cập nhật, không cần nhập tay.
 */
export default function CustomerProfiles() {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const request = useRef(0);

  const load = useCallback(async (offset = 0) => {
    const id = ++request.current;
    setBusy(true);
    try {
      const page = await api.customerProfiles({ q: q.trim(), offset });
      if (id !== request.current) return;
      setData((cur) => (offset && cur ? { ...page, profiles: [...cur.profiles, ...page.profiles] } : page));
      setError('');
    } catch (err) {
      if (id === request.current) setError(err.message);
    } finally {
      if (id === request.current) setBusy(false);
    }
  }, [q]);
  useEffect(() => {
    const timer = window.setTimeout(() => load(0), q ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [load, q]);

  return (
    <section className="form-card flat profiles-panel" aria-labelledby="profiles-title">
      <div className="banner-settings-head">
        <div>
          <h2 id="profiles-title">Khách đã đặt hàng (tự lưu)</h2>
          <p>Mỗi đơn online hoặc đơn nhân viên tạo đều tự lưu <b>tên, địa chỉ, định vị</b> của khách theo số điện thoại; đơn sau tự cập nhật. Tạo đơn mới chỉ cần gõ số điện thoại là điền sẵn.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Thu gọn' : `Mở${data ? ` (${data.total} khách)` : ''}`}
        </button>
      </div>
      {open && (
        <>
          <input className="input profiles-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Tìm tên, số điện thoại, địa chỉ (gõ không dấu cũng được)" aria-label="Tìm khách đã đặt hàng" />
          {error && <p className="alert error" role="alert">{error}</p>}
          {!data ? <ListSkeleton rows={3} label="Đang tải danh sách khách…" /> : data.profiles.length === 0 ? (
            <p className="muted">{q ? 'Không có khách nào khớp.' : 'Chưa có khách nào đặt hàng.'}</p>
          ) : (
            <>
              <p className="muted profiles-count">{data.total} khách{q ? ' khớp' : ''}</p>
              <ul className="profiles-list">
                {data.profiles.map((p) => (
                  <li key={p.phone}>
                    <div className="profiles-who">
                      <strong>{p.full_name || 'Chưa có tên'}</strong>
                      <a href={`tel:${p.phone}`}>{formatPhone(p.phone)}</a>
                    </div>
                    <p className="profiles-address">{p.address || <span className="muted">Chưa có địa chỉ giao (khách lấy tại cửa hàng)</span>}</p>
                    <div className="profiles-meta">
                      {p.location
                        ? <a className="map-link" href={p.location} target="_blank" rel="noopener noreferrer">📍 Mở định vị</a>
                        : <span className="muted">Chưa có định vị</span>}
                      <span>{p.order_count} đơn</span>
                      {p.last_order_at && <span>Gần nhất {formatDateTime(p.last_order_at)}{p.last_order_code ? ` · ${p.last_order_code}` : ''}</span>}
                    </div>
                  </li>
                ))}
              </ul>
              {data.profiles.length < data.total && (
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => load(data.profiles.length)}>
                  {busy ? 'Đang tải…' : `Xem thêm (${data.total - data.profiles.length} khách)`}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
