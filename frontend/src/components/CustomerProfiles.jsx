import { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatDateTime, formatVND, STATUS_LABEL, DELIVERY_SLOT_LABEL } from '../api';
import { ListSkeleton } from './Skeleton.jsx';

const formatPhone = (phone) => String(phone || '').replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
const payLabel = (o) => (o.payment_status === 'debt' ? 'Công nợ'
  : o.payment_method === 'bank' ? (o.transfer_confirmed_at ? 'Chuyển khoản ✓' : 'Chuyển khoản (chờ xác nhận)') : 'Tiền mặt');

/** Bảng các đơn một khách đã đặt (19/11/2026): bấm vào khách trong danh sách thì hiện. */
function CustomerOrders({ phone }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api.customerOrders(phone).then((d) => alive && setData(d)).catch((err) => alive && setError(err.message));
    return () => { alive = false; };
  }, [phone]);
  if (error) return <p className="alert error" role="alert">{error}</p>;
  if (!data) return <ListSkeleton rows={2} label="Đang tải đơn của khách…" />;
  if (!data.orders.length) return <p className="muted">Chưa có đơn nào.</p>;
  const done = data.orders.filter((o) => o.status === 'completed');
  return (
    <div className="profile-orders">
      <p className="profile-orders-sum">
        {data.total} đơn · đã giao {done.length} · tổng đã mua <b>{formatVND(done.reduce((s, o) => s + o.total, 0))}</b>
        {data.total > data.orders.length && ` · hiện ${data.orders.length} đơn gần nhất`}
      </p>
      <div className="table-scroll">
        <table className="data-table responsive-table profile-orders-table">
          <thead>
            <tr><th>Ngày đặt</th><th>Mã đơn</th><th>Hàng đã đặt</th><th className="num">Tổng tiền</th><th>Thanh toán</th><th>Trạng thái</th><th>Giao hàng</th></tr>
          </thead>
          <tbody>
            {data.orders.map((o) => (
              <tr key={o.id}>
                <td data-label="Ngày đặt">{formatDateTime(o.created_at)}</td>
                <td data-label="Mã đơn"><strong>{o.code}</strong>{o.wholesale_company && <small> · {o.wholesale_company}</small>}</td>
                <td data-label="Hàng đã đặt">
                  <ul className="profile-order-items">
                    {o.items.map((i, n) => (
                      <li key={n}>{i.product_name} <small>{i.unit}</small> × <b>{i.quantity}</b>{i.is_reward ? ' (quà đổi điểm)' : i.promo ? ' (quà KM)' : ` · ${formatVND(i.price)}`}</li>
                    ))}
                  </ul>
                  {o.note && <small className="muted">Ghi chú: {o.note}</small>}
                </td>
                <td data-label="Tổng tiền" className="num"><strong>{formatVND(o.total)}</strong>{o.shipping_fee > 0 && <small> (ship {formatVND(o.shipping_fee)})</small>}</td>
                <td data-label="Thanh toán">{payLabel(o)}</td>
                <td data-label="Trạng thái"><span className={`status ${o.status}`}>{STATUS_LABEL[o.status] || o.status}</span></td>
                <td data-label="Giao hàng">
                  {o.fulfillment === 'pickup' ? 'Lấy tại cửa hàng' : o.address}
                  <small className="muted">
                    {[o.delivery_slot && DELIVERY_SLOT_LABEL[o.delivery_slot], o.shipper_name && `Người giao: ${o.shipper_name}`,
                      o.completed_at && `Giao xong ${formatDateTime(o.completed_at)}`, o.warehouse === 'KH_NC' ? 'Xuất từ cửa hàng' : 'Xuất từ Kho Bồ Sơn']
                      .filter(Boolean).join(' · ')}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
  const [picked, setPicked] = useState(null);   // số điện thoại khách đang xem đơn
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
                  <li key={p.phone} className={picked === p.phone ? 'open' : ''}>
                    <div className="profiles-who">
                      <button type="button" className="profiles-name" aria-expanded={picked === p.phone}
                              onClick={() => setPicked(picked === p.phone ? null : p.phone)}>
                        <strong>{p.full_name || 'Chưa có tên'}</strong>
                        <span className="profiles-toggle">{picked === p.phone ? '▲ Ẩn đơn' : `▼ Xem ${p.order_count} đơn`}</span>
                      </button>
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
                    {picked === p.phone && <CustomerOrders phone={p.phone} />}
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
