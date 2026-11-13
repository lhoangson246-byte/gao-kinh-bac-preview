import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api, formatDateTime, formatVND, isPhone, vietnamClock } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import DeliveryPromise from '../components/DeliveryPromise.jsx';

const STEPS = [['pending', 'created_at'], ['confirmed', 'confirmed_at'], ['shipping', 'shipping_at'], ['completed', 'completed_at']];
const STEP_INDEX = { pending: 0, confirmed: 1, shipping: 2, completed: 3 };
const REFRESH_MS = 60_000;
const isOpen = (order) => !['completed', 'cancelled'].includes(order.status);

/** Tiến độ và hàng của một đơn. */
function OrderDetail({ order }) {
  const { t, unit } = useI18n();
  const reached = STEP_INDEX[order.status] ?? -1;
  return (
    <div className="track-detail">
      {order.status === 'cancelled' ? (
        <div className="track-cancelled" role="status">
          <strong>✕ {t('track.cancelled')}</strong>
          {order.cancelled_at && <span>{formatDateTime(order.cancelled_at)}</span>}
          <p>{t('track.cancelledBody')}</p>
        </div>
      ) : (
        <ol className="track-steps">
          {STEPS.map(([step, stamp], index) => {
            const state = index < reached ? 'done' : index === reached ? 'current' : 'todo';
            return (
              <li key={step} className={state}>
                <span className="track-dot" aria-hidden="true">{state === 'todo' ? '' : '✓'}</span>
                <div>
                  <strong>{t(`track.step.${step}`)}</strong>
                  <small>{order[stamp] ? formatDateTime(order[stamp]) : state === 'todo' ? t('track.waiting') : ''}</small>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {order.status === 'completed' && <p className="track-done">🌾 {t('track.done')}</p>}
      {isOpen(order) && <DeliveryPromise order={{ ...order, code: null }} />}
      <ul className="track-items">
        {order.items.map((item, index) => (
          <li key={index}><span>{item.product_name}</span><small>{item.quantity} {unit(item.unit)}</small></li>
        ))}
      </ul>
      <div className="track-total">
        <span>{t('track.total')}{order.shipping_fee > 0 ? <small> · {t('cart.shipping')} {formatVND(order.shipping_fee)}</small> : null}</span>
        <b>{formatVND(order.total)}</b>
      </div>
    </div>
  );
}

/**
 * /tra-cuu-don — khách tra cứu đơn chỉ bằng số điện thoại (13/11/2026), không cần mã đơn hay tài khoản.
 * Ra các đơn gần đây, đơn mới nhất mở sẵn. Mở từ màn hình đặt hàng thành công (có ?ma=) thì tra luôn đúng
 * đơn đó. Đơn chưa xong thì trang tự cập nhật mỗi phút.
 */
export default function TrackOrder() {
  const { t } = useI18n();
  const { user } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const [phone, setPhone] = useState(location.state?.phone || '');
  const [orders, setOrders] = useState(null);
  const [openCode, setOpenCode] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState(null);
  const query = useRef(null);

  const lookup = useCallback(async (target, { quiet = false } = {}) => {
    if (!quiet) { setBusy(true); setError(''); }
    try {
      const data = await api.trackOrder(target.phone, target.code || null);
      const list = data.orders || (data.order ? [data.order] : []);
      query.current = target;
      setOrders(list);
      if (!quiet) setOpenCode(list[0]?.code || null);
      setCheckedAt(new Date());
    } catch (err) {
      if (!quiet) { setOrders(null); setError(err.message); }
    } finally {
      if (!quiet) setBusy(false);
    }
  }, []);

  // Mở từ màn hình đặt hàng thành công: đã có SĐT (và mã đơn) thì tra luôn.
  useEffect(() => {
    if (location.state?.phone) lookup({ phone: location.state.phone, code: params.get('ma') || null });
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Còn đơn chưa xong thì tự cập nhật mỗi phút (và khi quay lại trang).
  useEffect(() => {
    if (!orders?.some(isOpen)) return undefined;
    const refresh = () => { if (!document.hidden && query.current) lookup(query.current, { quiet: true }); };
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [orders, lookup]);

  const submit = (event) => {
    event.preventDefault();
    if (!isPhone(phone)) { setError(t('error.phoneInvalid')); return; }
    lookup({ phone, code: null });
  };
  const statusLabel = (order) => (order.status === 'cancelled' ? t('track.cancelled') : t(`track.step.${order.status}`));

  return (
    <div className="track-page">
      <section className="form-card track-card">
        <h1>{t('track.title')}</h1>

        {!orders && (
          <form onSubmit={submit} noValidate className="track-form">
            <p className="muted">{t('track.introPhone')}</p>
            <div className="track-form-row">
              <input className="input" type="tel" inputMode="tel" autoComplete="tel" value={phone} aria-label={t('track.phone')}
                     onChange={(e) => setPhone(e.target.value)} placeholder="0912 345 678" />
              <button className="btn btn-primary" disabled={busy}>{busy ? t('track.busy') : t('track.submit')}</button>
            </div>
            {error && <p className="alert error" role="alert">{error}</p>}
            {!user && <p className="muted center track-login"><Link to="/dang-nhap">{t('track.loginHint')}</Link></p>}
          </form>
        )}

        {orders && (
          <div className="track-result" aria-live="polite">
            {orders.length > 1 && <p className="track-count muted">{t('track.recent', { n: orders.length })}</p>}
            <ul className="track-orders">
              {orders.map((order) => {
                const open = openCode === order.code;
                return (
                  <li key={order.code} className={`track-order${open ? ' open' : ''}`}>
                    <button type="button" className="track-order-head" aria-expanded={open} onClick={() => setOpenCode(open ? null : order.code)}>
                      <span>
                        <strong>{t('track.order', { code: order.code })}</strong>
                        <small>{formatDateTime(order.created_at)}{order.receiver_name ? ` · ${order.receiver_name}` : ''}</small>
                      </span>
                      <span className={`track-chip ${order.status}`}>{statusLabel(order)}</span>
                    </button>
                    {open && <OrderDetail order={order} />}
                  </li>
                );
              })}
            </ul>
            {orders.some(isOpen) && checkedAt && (
              <p className="track-updated">
                {t('track.updated', { time: vietnamClock(checkedAt) })}
                {' · '}<button type="button" className="link-button" onClick={() => lookup(query.current)}>{t('track.refresh')}</button>
              </p>
            )}
            <button type="button" className="btn btn-secondary btn-block" onClick={() => { setOrders(null); setError(''); }}>
              {t('track.another')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
