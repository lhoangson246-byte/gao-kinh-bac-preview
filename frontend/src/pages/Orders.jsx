import { useCallback, useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { api, formatDateTime, formatVND, DELIVERY_SLOTS } from '../api';
import { useI18n } from '../i18n/index.jsx';

const SLOT_TIME = Object.fromEntries(DELIVERY_SLOTS.map(([code, , time]) => [code, time]));
const STATUSES = ['pending', 'confirmed', 'shipping', 'completed', 'cancelled'];
const PAYMENTS = ['cod', 'bank'];

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const { justOrdered, code: newCode } = useLocation().state || {};
  const { t, unit } = useI18n();

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
    if (!window.confirm(t('orders.confirmCancel', { code: order.code || `#${order.id}` }))) return;
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
    return <div className="loading-state page-loading" role="status"><span></span>{t('orders.loading')}</div>;
  }

  if (loadError) {
    return (
      <div className="empty empty-page">
        <h1>{t('orders.loadError')}</h1>
        <p>{loadError}</p>
        <button className="btn btn-primary btn-large" onClick={load}>{t('common.retry')}</button>
      </div>
    );
  }

  return (
    <div className="page-shell narrow">
      {justOrdered && (
        <div className="success-banner" role="status">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>{t('orders.success')}{newCode && <> {t('orders.yourCode')} <span className="order-code">{newCode}</span></>}</strong>
            <p>{t('orders.successBody')}</p>
          </div>
        </div>
      )}
      <div className="page-heading">
        <div><p className="eyebrow dark"><span></span>{t('orders.eyebrow')}</p><h1>{t('orders.title')}</h1></div>
        <Link to="/" className="btn btn-secondary">{t('orders.shopMore')}</Link>
      </div>

      {actionError && <div className="alert error" role="alert">{actionError}</div>}

      {orders.length === 0 ? (
        <div className="empty empty-page">
          <span className="empty-icon" aria-hidden="true">📦</span>
          <h2>{t('orders.emptyTitle')}</h2>
          <p>{t('orders.emptyBody')}</p>
          <Link className="btn btn-primary btn-large" to="/">{t('orders.shopNow')}</Link>
        </div>
      ) : (
        <div className="orders-list">
          {orders.map((order) => (
            <article key={order.id} className="order order-customer">
              <header>
                <div>
                  <span className="order-label">{t('orders.order')}</span>
                  <strong className="order-code">{order.code || `#${order.id}`}</strong>
                  <small>{formatDateTime(order.created_at)}</small>
                </div>
                <span className={`status ${order.status}`}>{STATUSES.includes(order.status) ? t(`status.${order.status}`) : order.status}</span>
              </header>
              <ul className="order-items">
                {order.items.map((item) => (
                  <li key={item.id}>
                    <span>
                      <strong>{item.product_name}</strong>
                      <small>{t('line.qty', { qty: item.quantity, unit: unit(item.unit), price: formatVND(item.price) })}</small>
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
                  {SLOT_TIME[order.delivery_slot] && (
                    <small>{t('orders.delivery', {
                      slot: `${t(`slot.${order.delivery_slot}`)} (${SLOT_TIME[order.delivery_slot]})`,
                    })}</small>
                  )}
                  <small>{PAYMENTS.includes(order.payment_method) ? t(`orders.${order.payment_method}`) : order.payment_method}</small>
                  {order.points_earned > 0 && (
                    <small>{t('orders.pointsEarned', { n: order.points_earned })}</small>
                  )}
                  {order.note && <small>{t('orders.note', { note: order.note })}</small>}
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
                      {busyId === order.id ? t('orders.cancelling') : t('orders.cancel')}
                    </button>
                  ) : (
                    <span className="order-hint">
                      {order.status === 'cancelled'
                        ? t('orders.hintCancelled')
                        : order.status === 'completed'
                          ? t('orders.hintCompleted')
                          : t('orders.hintOther')}
                    </span>
                  )}
                </div>
                <div className="total">
                  {order.discount > 0 && (
                    <small className="order-discount">{t('orders.discounted', { amount: formatVND(order.discount) })}</small>
                  )}
                  {t('orders.total')} <strong>{formatVND(order.total)}</strong>
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
