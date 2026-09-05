import { useCallback, useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { api, formatDateTime, formatVND, STATUS_LABEL, DELIVERY_SLOT_LABEL } from '../api';

const PAYMENT_LABEL = {
  cod: 'Thanh toán khi nhận hàng',
  bank: 'Chuyển khoản — cửa hàng gửi thông tin sau khi xác nhận',
};

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const justOrdered = useLocation().state?.justOrdered;

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    return api.myOrders()
      .then(({ orders }) => setOrders(orders))
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const cancelOrder = async (order) => {
    if (!window.confirm(`Huỷ đơn #${order.id}? Số lượng gạo sẽ được trả lại cho cửa hàng.`)) return;
    setBusyId(order.id);
    setActionError('');
    try {
      const { order: updated } = await api.cancelOrder(order.id);
      setOrders((current) => current.map((item) => (item.id === order.id ? { ...item, ...updated } : item)));
    } catch (err) {
      setActionError(err.message);
      // Đơn có thể vừa được cửa hàng xử lý — tải lại để hiển thị đúng trạng thái.
      load();
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div className="loading-state page-loading" role="status"><span></span>Đang tải đơn hàng…</div>;
  }

  if (loadError) {
    return (
      <div className="empty empty-page">
        <h1>Chưa tải được đơn hàng</h1>
        <p>{loadError}</p>
        <button className="btn btn-primary btn-large" onClick={load}>Thử lại</button>
      </div>
    );
  }

  return (
    <div className="page-shell narrow">
      {justOrdered && (
        <div className="success-banner" role="status">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Đặt hàng thành công!</strong>
            <p>Cửa hàng sẽ gọi xác nhận địa chỉ và khung giờ giao. Giao hàng miễn phí.</p>
          </div>
        </div>
      )}
      <div className="page-heading">
        <div><p className="eyebrow dark"><span></span>Theo dõi mua hàng</p><h1>Đơn hàng của tôi</h1></div>
        <Link to="/" className="btn btn-secondary">Mua thêm gạo</Link>
      </div>

      {actionError && <div className="alert error" role="alert">{actionError}</div>}

      {orders.length === 0 ? (
        <div className="empty empty-page">
          <span className="empty-icon" aria-hidden="true">📦</span>
          <h2>Bạn chưa có đơn hàng nào</h2>
          <p>Các đơn đã đặt sẽ hiện ở đây để bạn theo dõi từng bước giao hàng.</p>
          <Link className="btn btn-primary btn-large" to="/">Mua gạo ngay</Link>
        </div>
      ) : (
        <div className="orders-list">
          {orders.map((order) => (
            <article key={order.id} className="order order-customer">
              <header>
                <div>
                  <span className="order-label">Đơn hàng</span>
                  <strong>#{order.id}</strong>
                  <small>{formatDateTime(order.created_at)}</small>
                </div>
                <span className={`status ${order.status}`}>{STATUS_LABEL[order.status] || order.status}</span>
              </header>
              <ul className="order-items">
                {order.items.map((item) => (
                  <li key={item.id}>
                    <span>
                      <strong>{item.product_name}</strong>
                      <small>{item.quantity} {item.unit} × {formatVND(item.price)}</small>
                    </span>
                    <span>{formatVND(item.price * item.quantity)}</span>
                  </li>
                ))}
              </ul>
              <div className="delivery-detail">
                <span aria-hidden="true">⌖</span>
                <div>
                  <strong>{order.receiver_name} · {order.phone}</strong>
                  <p>{order.address}</p>
                  {order.delivery_slot && (
                    <small>Giao {DELIVERY_SLOT_LABEL[order.delivery_slot]} · miễn phí</small>
                  )}
                  <small>{PAYMENT_LABEL[order.payment_method] || order.payment_method}</small>
                  {order.note && <small>Ghi chú: {order.note}</small>}
                </div>
              </div>
              <footer>
                <div>
                  {order.status === 'pending' ? (
                    <button
                      type="button"
                      className="link-button danger"
                      disabled={busyId === order.id}
                      onClick={() => cancelOrder(order)}
                    >
                      {busyId === order.id ? 'Đang huỷ…' : 'Huỷ đơn hàng'}
                    </button>
                  ) : (
                    <span className="order-hint">
                      {order.status === 'cancelled'
                        ? 'Đơn đã huỷ, số lượng đã trả lại cửa hàng.'
                        : order.status === 'completed'
                          ? 'Cảm ơn bạn đã mua gạo của cửa hàng.'
                          : 'Cần thay đổi? Vui lòng liên hệ cửa hàng.'}
                    </span>
                  )}
                </div>
                <div className="total">Tổng tiền hàng <strong>{formatVND(order.total)}</strong></div>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
