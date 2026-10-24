import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api, formatDateTime, formatVND, isPhone, vietnamClock } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import DeliveryPromise from '../components/DeliveryPromise.jsx';

const STEPS = [['pending', 'created_at'], ['confirmed', 'confirmed_at'], ['shipping', 'shipping_at'], ['completed', 'completed_at']];
const STEP_INDEX = { pending: 0, confirmed: 1, shipping: 2, completed: 3 };
const REFRESH_MS = 60_000;

/**
 * /tra-cuu-don — khách tra cứu tiến độ đơn bằng số điện thoại + mã đơn, không cần tài khoản.
 * Mở từ màn hình đặt hàng thành công thì điền sẵn và tra luôn; trang tự cập nhật mỗi phút.
 */
export default function TrackOrder() {
  const { t, unit } = useI18n();
  const { user } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const [phone, setPhone] = useState(location.state?.phone || '');
  const [code, setCode] = useState(params.get('ma') || '');
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState(null);
  const query = useRef(null);

  const lookup = useCallback(async (target, { quiet = false } = {}) => {
    if (!quiet) { setBusy(true); setError(''); }
    try {
      const { order } = await api.trackOrder(target.phone, target.code);
      query.current = target;
      setOrder(order);
      setCheckedAt(new Date());
    } catch (err) {
      if (!quiet) { setOrder(null); setError(err.message); }
    } finally {
      if (!quiet) setBusy(false);
    }
  }, []);

  // Mở từ màn hình đặt hàng thành công: đã có SĐT và mã thì tra luôn.
  useEffect(() => {
    if (location.state?.phone && params.get('ma')) lookup({ phone: location.state.phone, code: params.get('ma') });
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Đơn chưa xong thì tự cập nhật mỗi phút (và khi quay lại trang).
  useEffect(() => {
    if (!order || ['completed', 'cancelled'].includes(order.status)) return undefined;
    const refresh = () => { if (!document.hidden && query.current) lookup(query.current, { quiet: true }); };
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [order, lookup]);

  const submit = (event) => {
    event.preventDefault();
    if (!isPhone(phone)) { setError(t('error.phoneInvalid')); return; }
    if (!/^\s*(dh)?\s*\d{1,9}\s*$/i.test(code)) { setError(t('track.codeHelp')); return; }
    lookup({ phone, code });
  };

  const reached = order ? STEP_INDEX[order.status] ?? -1 : -1;

  return (
    <div className="track-page">
      <section className="form-card track-card">
        <h1>{t('track.title')}</h1>
        {!order && <p className="muted">{t('track.intro')}</p>}

        {!order && (
          <form onSubmit={submit} noValidate className="track-form">
            <label>{t('track.phone')}
              <input className="input" type="tel" inputMode="tel" autoComplete="tel" value={phone}
                     onChange={(e) => setPhone(e.target.value)} placeholder="0912 345 678" />
            </label>
            <label>{t('track.code')}
              <input className="input" value={code} onChange={(e) => setCode(e.target.value)}
                     placeholder="DH000236" autoCapitalize="characters" />
              <small className="field-help">{t('track.codeHelp')}</small>
            </label>
            {error && <p className="alert error" role="alert">{error}</p>}
            <button className="btn btn-primary btn-block btn-large" disabled={busy}>{busy ? t('track.busy') : t('track.submit')}</button>
            {!user && <p className="muted center"><Link to="/dang-nhap">{t('track.loginHint')}</Link></p>}
          </form>
        )}

        {order && (
          <div className="track-result" aria-live="polite">
            <div className="track-head">
              <strong>{t('track.order', { code: order.code })}</strong>
              <span>{t('track.placedAt', { time: formatDateTime(order.created_at) })}</span>
            </div>

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
            {['pending', 'confirmed', 'shipping'].includes(order.status) && (
              <DeliveryPromise order={{ ...order, code: null }} />
            )}

            <div className="track-items">
              <p className="detail-label">{t('track.items')}</p>
              <ul>
                {order.items.map((item, index) => (
                  <li key={index}><span>{item.product_name}</span><small>{item.quantity} {unit(item.unit)}</small></li>
                ))}
              </ul>
              <div className="track-total"><span>{t('track.total')}</span><b>{formatVND(order.total)}</b></div>
            </div>

            {!['completed', 'cancelled'].includes(order.status) && checkedAt && (
              <p className="track-updated">
                {t('track.updated', { time: vietnamClock(checkedAt) })}
                {' · '}<button type="button" className="link-button" onClick={() => lookup(query.current)}>{t('track.refresh')}</button>
              </p>
            )}
            <button type="button" className="btn btn-secondary btn-block" onClick={() => { setOrder(null); setError(''); }}>
              {t('track.another')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

