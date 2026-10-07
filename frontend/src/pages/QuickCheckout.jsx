import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import DeliveryHours, { useNow } from '../components/DeliveryHours.jsx';
import { passwordErrorKey } from '../password';
import {
  api, formatVND, isPhone, mapLink, mentionsOtherProvince, normalizePhone, pointsForLines,
  DELIVERY_AREA_CODE, DELIVERY_SLOTS, FIRST_ORDER_DISCOUNT, deliveryPlan, slotDay,
} from '../api';

/** Thông tin nhận hàng lần trước, chỉ lưu trên máy của khách để lần sau khỏi gõ lại. */
const SAVED_KEY = 'gao_quick_info';
const readSaved = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY));
    return saved && typeof saved === 'object'
      ? { name: String(saved.name || ''), phone: String(saved.phone || ''), address: String(saved.address || '') }
      : null;
  } catch {
    return null;
  }
};
const writeSaved = (info) => {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(info)); } catch { /* chế độ riêng tư */ }
};
const clearSaved = () => {
  try { localStorage.removeItem(SAVED_KEY); } catch { /* chế độ riêng tư */ }
};

const formatPhone = (phone) => phone.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');

/**
 * Đặt hàng nhanh không cần tài khoản: một trang, chữ to, ít ô nhất có thể, cho khách
 * không quen dùng điện thoại. Giỏ hàng → điền tên, số điện thoại, địa chỉ → Đặt hàng ngay.
 * Tạo tài khoản là tuỳ chọn, mời sau khi đặt xong.
 */
export default function QuickCheckout() {
  const { user, loading } = useAuth();
  const { items, total, clear } = useCart();
  const { t, unit } = useI18n();
  const saved = useRef(readSaved()).current;
  const now = useNow();

  const [form, setForm] = useState({
    receiver_name: saved?.name || '',
    phone: saved?.phone || '',
    address: saved?.address || '',
    // Chọn sẵn khung giao sớm nhất theo giờ hiện tại (đặt giờ nghỉ trưa thì giao chiều).
    delivery_slot: deliveryPlan().slot,
    payment_method: 'cod',
    note: '',
  });
  const [location, setLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);        // { order, token }
  const fieldRefs = { receiver_name: useRef(null), phone: useRef(null), address: useRef(null) };
  // Khung giờ chọn sẵn theo giờ hiện tại; tự chỉnh khi đồng bộ giờ máy chủ hoặc qua mốc giờ,
  // trừ khi khách đã tự chọn.
  const slotTouched = useRef(false);
  const plannedSlot = deliveryPlan(now).slot;
  useEffect(() => {
    if (!slotTouched.current) setForm((current) => ({ ...current, delivery_slot: plannedSlot }));
  }, [plannedSlot]);

  const orderable = items.filter((item) => item.stock > 0 && item.quantity > 0);
  const count = orderable.reduce((sum, item) => sum + item.quantity, 0);

  if (loading) return <div className="loading-state page-loading" role="status"><span></span>{t('common.loading')}</div>;
  // Đã đăng nhập thì dùng trang đặt hàng có sổ địa chỉ và đổi điểm.
  if (user && !done) return <Navigate to="/dat-hang" replace />;

  if (done) return <QuickSuccess order={done.order} token={done.token} />;

  if (orderable.length === 0) {
    return (
      <div className="empty empty-page quick-empty">
        <span className="empty-icon" aria-hidden="true">🧺</span>
        <h1>{t('cart.emptyTitle')}</h1>
        <p>{t('cart.emptyBody')}</p>
        <Link className="btn btn-primary btn-large" to="/">{t('cart.browse')}</Link>
      </div>
    );
  }

  const set = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }));
    if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const validate = () => {
    const next = {};
    if (form.receiver_name.trim().length < 2) next.receiver_name = t('quick.errName');
    if (!isPhone(form.phone)) next.phone = t('quick.errPhone');
    if (form.address.trim().length < 8) next.address = t('quick.errAddress');
    else if (mentionsOtherProvince(form.address)) next.address = t('address.errArea');
    return next;
  };

  const locate = () => {
    if (!window.isSecureContext || !navigator.geolocation) { setError(t('location.unsupported')); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        setLocation({
          latitude: Math.round(coords.latitude * 1e5) / 1e5,
          longitude: Math.round(coords.longitude * 1e5) / 1e5,
          location_accuracy: Math.round(coords.accuracy),
        });
      },
      (err) => {
        setLocating(false);
        setError(err.code === 1 ? t('location.denied') : t('location.unavailable'));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  const submit = async (event) => {
    event?.preventDefault();
    setError('');
    const found = validate();
    if (Object.keys(found).length) {
      setErrors(found);
      const first = ['receiver_name', 'phone', 'address'].find((name) => found[name]);
      fieldRefs[first]?.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const { order, guest_token: token } = await api.createGuestOrder({
        receiver_name: form.receiver_name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        delivery_area: DELIVERY_AREA_CODE,
        delivery_slot: form.delivery_slot,
        payment_method: form.payment_method,
        note: form.note.trim() || undefined,
        items: orderable.map((item) => ({ product_id: item.id, quantity: item.quantity })),
        ...(location || {}),
      });
      writeSaved({ name: form.receiver_name.trim(), phone: normalizePhone(form.phone), address: form.address.trim() });
      clear();
      setDone({ order, token });
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err.message);
      setErrors(err.errors || {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="quick-page" onSubmit={submit} noValidate>
      <div className="quick-head">
        <h1>{t('quick.title')}</h1>
        <p>{t('quick.subtitle')}</p>
      </div>

      {error && <div className="alert error quick-alert" role="alert">{error}</div>}

      <div className="quick-layout">
        <section className="quick-card quick-form" aria-label={t('quick.formAria')}>
          {saved && (
            <p className="quick-saved">
              {t('quick.welcomeBack')}{' '}
              <button type="button" className="link-button" onClick={() => {
                clearSaved();
                setForm((current) => ({ ...current, receiver_name: '', phone: '', address: '' }));
              }}>{t('quick.notMe')}</button>
            </p>
          )}

          <label className="quick-field quick-half">
            <span>{t('quick.name')}</span>
            <input ref={fieldRefs.receiver_name} className="input" value={form.receiver_name} autoComplete="name"
                   onChange={(e) => set('receiver_name', e.target.value)} placeholder={t('quick.namePlaceholder')}
                   aria-invalid={!!errors.receiver_name} />
            {errors.receiver_name && <small className="err">{errors.receiver_name}</small>}
          </label>

          <label className="quick-field quick-half">
            <span>{t('quick.phone')}</span>
            <input ref={fieldRefs.phone} className="input" value={form.phone} type="tel" inputMode="tel" autoComplete="tel"
                   onChange={(e) => set('phone', e.target.value)} placeholder="0912 345 678"
                   aria-invalid={!!errors.phone} />
            {errors.phone
              ? <small className="err">{errors.phone}</small>
              : <small className="field-help">{t('quick.phoneHelp')}</small>}
          </label>

          <label className="quick-field">
            <span>{t('quick.address')}</span>
            <textarea ref={fieldRefs.address} className="input" rows={2} value={form.address} autoComplete="street-address"
                      onChange={(e) => set('address', e.target.value)} placeholder={t('address.detailPlaceholder')}
                      aria-invalid={!!errors.address} />
            {errors.address
              ? <small className="err">{errors.address}</small>
              : <small className="field-help">{t('address.area')}</small>}
          </label>

          <div className="quick-locate">
            {location ? (
              <>
                <span>📍 {t('location.pinned')}</span>
                <a href={mapLink(location.latitude, location.longitude)} target="_blank" rel="noopener noreferrer">{t('location.view')}</a>
                <button type="button" className="link-button danger" onClick={() => setLocation(null)}>{t('location.remove')}</button>
              </>
            ) : (
              <button type="button" className="link-button" onClick={locate} disabled={locating}>
                {locating ? t('location.locating') : t('quick.pin')}
              </button>
            )}
          </div>

          <div className="quick-hours"><DeliveryHours now={now} compact /></div>

          <fieldset className="quick-choice quick-half">
            <legend>{t('quick.when')}</legend>
            <div className="quick-options">
              {DELIVERY_SLOTS.map(([code, , time]) => (
                <button key={code} type="button" className={form.delivery_slot === code ? 'active' : ''}
                        aria-pressed={form.delivery_slot === code}
                        onClick={() => { slotTouched.current = true; set('delivery_slot', code); }}>
                  <strong>{t(`slot.${code}`)}</strong>
                  <small>{time}</small>
                  <small className={`slot-day ${slotDay(code, now)}`}>{t(`slot.day.${slotDay(code, now)}`)}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="quick-choice quick-half">
            <legend>{t('quick.pay')}</legend>
            <div className="quick-options">
              {[['cod', '💵', t('quick.cod')], ['bank', '🏦', t('quick.bank')]].map(([code, icon, label]) => (
                <button key={code} type="button" className={form.payment_method === code ? 'active' : ''}
                        aria-pressed={form.payment_method === code} onClick={() => set('payment_method', code)}>
                  <strong><span aria-hidden="true">{icon}</span> {label}</strong>
                </button>
              ))}
            </div>
            {form.payment_method === 'bank' && <small className="field-help">{t('checkout.bankHint')}</small>}
          </fieldset>

          {showNote ? (
            <label className="quick-field">
              <span>{t('checkout.note')} <small className="optional">{t('common.optional')}</small></span>
              <input className="input" value={form.note} onChange={(e) => set('note', e.target.value)}
                     placeholder={t('checkout.notePlaceholder')} autoFocus />
            </label>
          ) : (
            <button type="button" className="link-button quick-note-toggle" onClick={() => setShowNote(true)}>
              {t('quick.addNote')}
            </button>
          )}
        </section>

        <aside className="quick-card quick-summary" aria-label={t('quick.summaryAria')}>
          <div className="quick-summary-head">
            <h2>{t('quick.yourOrder', { n: count })}</h2>
            <Link to="/gio-hang" className="link-button">{t('quick.editCart')}</Link>
          </div>
          <ul className="quick-items">
            {orderable.map((item) => (
              <li key={item.id}>
                <span><strong>{item.name}</strong><small>{item.quantity} × {unit(item.unit)}</small></span>
                <b>{formatVND(item.price * item.quantity)}</b>
              </li>
            ))}
          </ul>
          <div className="quick-total-row"><span>{t('cart.shipping')}</span><b className="free-tag">{t('common.free')}</b></div>
          <div className="quick-total-row grand"><span>{t('quick.total')}</span><b>{formatVND(total)}</b></div>
          <p className="quick-promo">🎁 {t('quick.firstOrder', { amount: formatVND(FIRST_ORDER_DISCOUNT) })}</p>
          <ul className="quick-trust">
            <li>✓ {t('quick.trustCall')}</li>
            <li>✓ {t('quick.trustFree')}</li>
            <li>✓ {t('quick.trustPoints')}</li>
          </ul>
          <button className="btn btn-primary btn-block quick-submit desktop-only" disabled={busy}>
            {busy ? t('checkout.sending') : t('quick.submit', { total: formatVND(total) })}
          </button>
          <p className="quick-login">
            {t('quick.haveAccount')} <Link to="/dang-nhap" state={{ from: '/dat-hang' }}>{t('quick.login')}</Link>
          </p>
        </aside>
      </div>

      {/* Thanh dưới cùng trên điện thoại: luôn thấy tổng tiền và nút đặt hàng. */}
      <div className="quick-bar">
        <div><small>{t('quick.total')}</small><b>{formatVND(total)}</b></div>
        <button className="btn btn-primary quick-submit" disabled={busy}>
          {busy ? t('checkout.sending') : t('quick.submitShort')}
        </button>
      </div>
    </form>
  );
}

/** Màn hình đặt hàng thành công, kèm lời mời tạo tài khoản (không bắt buộc). */
function QuickSuccess({ order, token }) {
  const { t } = useI18n();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const points = pointsForLines(order.items.filter((item) => !item.is_reward), order.total);

  useEffect(() => { document.title = `${t('quick.successTitle')} · Gạo Kinh Bắc`; }, [t]);

  const createAccount = async (event) => {
    event.preventDefault();
    setError('');
    const key = passwordErrorKey(password);
    if (key) { setError(t(key)); return; }
    setBusy(true);
    try {
      await register({
        full_name: order.receiver_name,
        phone: order.phone,
        password,
        guest_order: { id: order.id, token },
      });
      navigate('/don-hang', { replace: true, state: { justOrdered: true, code: order.code } });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="quick-page quick-done">
      <section className="quick-card quick-success" role="status">
        <span className="quick-check" aria-hidden="true">✓</span>
        <h1>{t('quick.successTitle')}</h1>
        <p className="quick-code">{t('orders.yourCode')} <b>{order.code}</b></p>
        <p>{t('quick.successCall', { phone: formatPhone(order.phone) })}</p>
        <div className="quick-total-row grand"><span>{t('quick.total')}</span><b>{formatVND(order.total)}</b></div>
        {order.discount > 0 && <p className="quick-promo">🎁 {t('orders.discounted', { amount: formatVND(order.discount) })}</p>}
        {points > 0 && <p className="quick-points">★ {t('quick.successPoints', { n: points, phone: formatPhone(order.phone) })}</p>}
        <Link className="btn btn-secondary btn-block quick-continue" to="/">{t('quick.continue')}</Link>
      </section>

      <form className="quick-card quick-account" onSubmit={createAccount} noValidate>
        <h2>{t('quick.accountTitle')}</h2>
        <ul className="quick-trust">
          <li>✓ {t('quick.accountTrack')}</li>
          <li>✓ {t('quick.accountRedeem')}</li>
        </ul>
        <p className="muted">{t('quick.accountFor', { name: order.receiver_name, phone: formatPhone(order.phone) })}</p>
        <label className="quick-field">
          <span>{t('quick.accountPassword')}</span>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)}
                         autoComplete="new-password" minLength={12} aria-invalid={!!error} />
          {error
            ? <small className="err" role="alert">{error}</small>
            : <small className="field-help">{t('error.passwordShort')}</small>}
        </label>
        <button className="btn btn-primary btn-block quick-submit" disabled={busy}>
          {busy ? t('register.busy') : t('quick.accountCreate')}
        </button>
        <p className="muted quick-skip">{t('quick.accountSkip')}</p>
      </form>
    </div>
  );
}
