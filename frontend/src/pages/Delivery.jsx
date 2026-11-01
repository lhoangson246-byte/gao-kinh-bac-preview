import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, DELIVERY_SLOT_LABEL, formatDateTime, formatVND, mapLink } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import PushSettings from '../components/PushSettings.jsx';

const REFRESH_MS = 30_000;
const formatPhone = (phone) => String(phone || '').replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
const directions = (order) => mapLink(order.delivery_lat, order.delivery_lng)
  || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`;

/**
 * /quan-tri/giao-hang — trang của nhân viên giao hàng, làm cho điện thoại: đơn được phân công, gọi
 * khách, chỉ đường, số tiền phải thu, và hai nút "Bắt đầu giao" → "Đã giao xong".
 */
export default function Delivery() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const { orders } = await api.deliveryOrders();
      setOrders(orders);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  const setStatus = async (order, status) => {
    if (status === 'completed' && !window.confirm(`Xác nhận đã giao đơn ${order.code} cho ${order.receiver_name}${order.payment_method === 'cod' ? ` và đã thu ${formatVND(order.total)}` : ''}?`)) return;
    setBusyId(order.id);
    try {
      await api.deliverySetStatus(order.id, status);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const active = (orders || []).filter((o) => ['confirmed', 'shipping'].includes(o.status));
  const finished = (orders || []).filter((o) => !['confirmed', 'shipping'].includes(o.status));
  const toCollect = active.filter((o) => o.payment_method === 'cod').reduce((sum, o) => sum + o.total, 0);

  return (
    <div className="admin-app delivery-app">
      <header className="admin-topbar">
        <div className="admin-brand"><img src="/logo-mark.png" alt="" width="38" height="38" /><div><strong>Giao hàng</strong><small>{user?.full_name}</small></div></div>
        <div className="admin-account">
          <PushSettings />
          {can('orders.view') && <Link to="/quan-tri" className="btn btn-secondary">Quản trị</Link>}
          <button className="btn btn-ghost" onClick={() => { logout(); navigate('/'); }}>Đăng xuất</button>
        </div>
      </header>

      <main className="delivery-main">
        <div className="delivery-summary">
          <div><strong>{active.length}</strong><span>đơn cần giao</span></div>
          <div><strong>{formatVND(toCollect)}</strong><span>tiền mặt cần thu</span></div>
          <div><strong>{finished.filter((o) => o.status === 'completed').length}</strong><span>đã giao hôm nay</span></div>
        </div>
        {error && <p className="alert error" role="alert">{error} <button type="button" className="link-button" onClick={load}>Thử lại</button></p>}
        {!orders && !error && <div className="loading-state" role="status"><span></span>Đang tải đơn…</div>}
        {orders && active.length === 0 && (
          <div className="admin-empty"><span>✓</span><h2>Chưa có đơn nào cần giao</h2><p>Khi cửa hàng giao đơn cho bạn, điện thoại sẽ báo và đơn hiện ở đây.</p></div>
        )}

        <div className="delivery-list">
          {active.map((order) => (
            <article key={order.id} className={`delivery-card ${order.status}`}>
              <header>
                <strong>{order.code}</strong>
                <span className={`status ${order.status}`}>{order.status === 'shipping' ? 'Đang giao' : 'Chờ giao'}</span>
              </header>
              <h2>{order.receiver_name}</h2>
              <a className="btn btn-primary btn-block delivery-call" href={`tel:${order.phone}`}>📞 Gọi {formatPhone(order.phone)}</a>
              {order.fulfillment === 'pickup' ? (
                <p className="delivery-address">🏬 Khách lấy tại cửa hàng</p>
              ) : (
                <>
                  <p className="delivery-address">🏠 {order.address}</p>
                  <a className="btn btn-secondary btn-block" href={directions(order)} target="_blank" rel="noopener noreferrer">
                    🗺️ {order.delivery_lat ? 'Chỉ đường tới vị trí khách ghim' : 'Tìm địa chỉ trên Google Maps'}
                  </a>
                </>
              )}
              {order.delivery_slot && <p className="delivery-meta">🕒 {DELIVERY_SLOT_LABEL[order.delivery_slot]}</p>}
              {order.note && <p className="delivery-note">📝 {order.note}</p>}
              <ul className="delivery-items">
                {order.items.map((item, i) => (
                  <li key={i}><span>{item.product_name}{item.promo ? ' (quà khuyến mãi)' : item.is_reward ? ' (quà đổi điểm)' : ''}</span><b>{item.quantity} {item.unit}</b></li>
                ))}
              </ul>
              <p className={`delivery-money ${order.payment_method}`}>
                {order.payment_method === 'cod'
                  ? <>💵 Thu tiền mặt: <strong>{formatVND(order.total)}</strong></>
                  : <>🏦 Khách chuyển khoản: <strong>{formatVND(order.total)}</strong> — kiểm tra với cửa hàng đã nhận tiền chưa</>}
              </p>
              {order.status === 'confirmed' ? (
                <button type="button" className="btn btn-primary btn-block btn-large" disabled={busyId === order.id} onClick={() => setStatus(order, 'shipping')}>
                  {busyId === order.id ? 'Đang lưu…' : '🛵 Bắt đầu giao'}
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-block btn-large delivery-done" disabled={busyId === order.id} onClick={() => setStatus(order, 'completed')}>
                  {busyId === order.id ? 'Đang lưu…' : '✅ Đã giao xong'}
                </button>
              )}
            </article>
          ))}
        </div>

        {finished.length > 0 && (
          <section className="delivery-finished">
            <h2>Hôm nay</h2>
            <ul>
              {finished.map((order) => (
                <li key={order.id}>
                  <span><strong>{order.code}</strong> · {order.receiver_name}</span>
                  <span className={`status ${order.status}`}>{order.status === 'completed' ? `Đã giao ${formatDateTime(order.completed_at).split(' ')[0]}` : 'Đã huỷ'}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
