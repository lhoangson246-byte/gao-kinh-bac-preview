import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, DELIVERY_SLOT_LABEL, formatVND, mapLink } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import PushSettings from '../components/PushSettings.jsx';
import ProofPhoto from '../components/ProofPhoto.jsx';
import StaffNav from '../components/StaffNav.jsx';
import CustomerFinder from '../components/CustomerFinder.jsx';
import { ListSkeleton } from '../components/Skeleton.jsx';
import { shortTime } from '../components/ProofHover.jsx';

const REFRESH_MS = 30_000;
const formatPhone = (phone) => String(phone || '').replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
const km = (v) => `${String(v).replace('.', ',')} km`;
// Chia sẻ vị trí thật (21/11/2026): gửi khi đã đi ≥ 40 m hoặc sau 20 giây, để bản đồ điều phối thấy mà không tốn pin / mạng.
const GPS_PREF = 'gao_gps_share';
const GPS_MIN_MS = 20_000;
const GPS_MIN_M = 40;
const readPref = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const savePref = (key, value) => { try { localStorage.setItem(key, value); } catch { /* bỏ qua */ } };
const metersBetween = (a, b) => {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
};
const clock = (t) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const directions = (order) => order.map_url || mapLink(order.delivery_lat, order.delivery_lng)
  || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`;

/**
 * /quan-tri/giao-hang — trang của nhân viên giao hàng, làm cho điện thoại: đơn được phân công, gọi
 * khách, chỉ đường, số tiền phải thu, và hai nút "Bắt đầu giao" → "Đã giao xong".
 */
export default function Delivery() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState(null);
  const [route, setRoute] = useState(null);   // lộ trình: thứ tự đi rồi về Kho Bồ Sơn ngắn nhất (20/11/2026)
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  // { orderId: { goods: { id, url }, transfer: { id, url } } } — ảnh gạo đã giao (luôn bắt buộc, 25/11/2026) và ảnh chuyển khoản.
  const [photos, setPhotos] = useState({});
  const setPhoto = (orderId, kind, value) => setPhotos((cur) => ({ ...cur, [orderId]: { ...cur[orderId], [kind]: value } }));
  const [payWays, setPayWays] = useState({});   // { orderId: 'cash' | 'transfer' } khách trả bằng gì (19/11/2026)
  // Mặc định theo cách khách chọn lúc đặt; cửa hàng đã nhận chuyển khoản thì luôn là chuyển khoản.
  const payWayOf = (order) => (order.transfer_confirmed_at ? 'transfer' : payWays[order.id] || (order.payment_method === 'bank' ? 'transfer' : 'cash'));
  const pickPayWay = (order, way) => {
    if (payWayOf(order) === way) return;
    setPayWays((cur) => ({ ...cur, [order.id]: way }));
    // Đổi cách trả: giữ ảnh gạo đã chụp, chỉ bỏ ảnh chuyển khoản.
    setPhotos((cur) => ({ ...cur, [order.id]: { goods: cur[order.id]?.goods } }));
  };
  // Chia sẻ vị trí GPS cho bản đồ điều phối của kế toán / quản lý (mặc định bật; nhân viên tắt được).
  const [gpsOn, setGpsOn] = useState(() => readPref(GPS_PREF, '1') === '1');
  const [gps, setGps] = useState({ state: 'idle', at: null, error: '' });   // idle | asking | on | error
  const [gpsTry, setGpsTry] = useState(0);
  const lastSent = useRef(null);
  const [debtForms, setDebtForms] = useState({});   // { orderId: { delivered, invoice, company, comment, errors } }
  const setDebt = (orderId, patch) => setDebtForms((cur) => ({ ...cur, [orderId]: { ...cur[orderId], ...patch } }));

  const load = useCallback(async () => {
    try {
      const { orders, route } = await api.deliveryOrders();
      setOrders(orders);
      setRoute(route || null);
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

  // Cần ảnh chuyển khoản: khách trả chuyển khoản mà cửa hàng chưa nhận tiền và khách chưa gửi ảnh trên web.
  const needTransferPhoto = (order) => payWayOf(order) === 'transfer' && !order.transfer_confirmed_at && !order.has_transfer_proof;
  const photosReady = (order) => !!photos[order.id]?.goods && (!needTransferPhoto(order) || !!photos[order.id]?.transfer);
  const setStatus = async (order, status) => {
    const way = payWayOf(order);
    if (status === 'shipping' && !window.confirm(`Nhận đơn ${order.code} và bắt đầu giao ngay?`)) return;
    if (status === 'completed' && !window.confirm(`Xác nhận đã giao đơn ${order.code} cho ${order.receiver_name}${way === 'cash'
      ? ` và đã thu tiền mặt ${formatVND(order.total)}` : order.transfer_confirmed_at ? '' : `, khách đã chuyển khoản ${formatVND(order.total)}`}?`)) return;
    setBusyId(order.id);
    try {
      const done = status === 'completed';
      await api.deliverySetStatus(order.id, status, done ? photos[order.id]?.goods?.id : undefined, done ? way : undefined,
        done && needTransferPhoto(order) ? photos[order.id]?.transfer?.id : undefined);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  // Khách nợ: ảnh gạo đã giao + ảnh hoá đơn nợ → chuyển kế toán duyệt.
  const submitDebt = async (order) => {
    const form = debtForms[order.id] || {};
    if (!form.delivered || !form.invoice) {
      setDebt(order.id, { errors: { delivered: !form.delivered ? 'Chụp ảnh gạo đã giao.' : '', invoice: !form.invoice ? 'Chụp ảnh hoá đơn nợ.' : '' } });
      return;
    }
    if (!window.confirm(`Ghi nợ đơn ${order.code} (${formatVND(order.total)}) và gửi kế toán duyệt?`)) return;
    setBusyId(order.id);
    try {
      await api.deliveryDebt(order.id, {
        delivered_photo: form.delivered.id, invoice_photo: form.invoice.id,
        company: form.company?.trim() || null, comment: form.comment?.trim() || null,
      });
      setDebtForms((cur) => { const next = { ...cur }; delete next[order.id]; return next; });
      await load();
    } catch (err) {
      setDebt(order.id, { errors: { form: err.message, ...(err.errors || {}) } });
    } finally {
      setBusyId(null);
    }
  };

  // Đơn cần giao xếp theo lộ trình; đơn chưa có định vị và khách lấy tại cửa hàng để cuối.
  const stepOf = new Map((route?.stops || []).map((s) => [s.id, s]));
  const active = (orders || []).filter((o) => ['confirmed', 'shipping'].includes(o.status))
    .sort((a, b) => (stepOf.get(a.id)?.step ?? 999) - (stepOf.get(b.id)?.step ?? 999));
  const finished = (orders || []).filter((o) => !['confirmed', 'shipping'].includes(o.status));
  // Có đơn cần giao và đang bật chia sẻ thì theo dõi vị trí (trình duyệt hỏi quyền "Vị trí" lần đầu).
  const needGps = active.some((o) => o.fulfillment !== 'pickup');
  useEffect(() => {
    if (!gpsOn || !needGps) return undefined;
    if (!('geolocation' in navigator)) { setGps({ state: 'error', at: null, error: 'Điện thoại / trình duyệt này không hỗ trợ định vị.' }); return undefined; }
    setGps((g) => (g.state === 'on' ? g : { ...g, state: 'asking', error: '' }));
    const watchId = navigator.geolocation.watchPosition((pos) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const last = lastSent.current;
      const now = Date.now();
      if (last && now - last.t < GPS_MIN_MS && metersBetween(last, here) < GPS_MIN_M) { setGps((g) => ({ ...g, state: 'on' })); return; }
      lastSent.current = { ...here, t: now };
      api.deliveryLocation(here.lat, here.lng, Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null)
        .then(() => setGps({ state: 'on', at: now, error: '' }))
        .catch((err) => { lastSent.current = null; setGps({ state: 'error', at: null, error: err.message }); });
    }, (err) => {
      setGps({ state: 'error', at: null, error: err.code === 1
        ? 'Bạn chưa cho phép định vị. Vào cài đặt trình duyệt → Quyền "Vị trí" → Cho phép trang này, rồi bấm "Thử lại".'
        : 'Chưa lấy được vị trí. Bật GPS (Vị trí) trên điện thoại hoặc ra chỗ thoáng rồi bấm "Thử lại".' });
    }, { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [gpsOn, needGps, gpsTry]);
  const toggleGps = () => {
    const next = !gpsOn;
    setGpsOn(next);
    savePref(GPS_PREF, next ? '1' : '0');
    lastSent.current = null;
    if (!next) { setGps({ state: 'idle', at: null, error: '' }); api.deliveryStopLocation().catch(() => {}); }
  };

  const toCollect = active.filter((o) => o.payment_method === 'cod').reduce((sum, o) => sum + o.total, 0);
  const collected = finished.filter((o) => o.status === 'completed' && o.payment_status !== 'debt' && o.payment_method === 'cod')
    .reduce((sum, o) => sum + o.total, 0);

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
      <StaffNav />

      <main className="delivery-main">
        <CustomerFinder />
        {needGps && (
          <div className={`delivery-gps${gpsOn ? (gps.state === 'error' ? ' error' : ' on') : ''}`} role="status">
            <p>
              {!gpsOn ? <>📍 Đang <b>tắt</b> chia sẻ vị trí. Bật để kế toán thấy bạn đang ở đâu trên bản đồ và giao đơn gần bạn nhất.</>
                : gps.state === 'on' ? <>📡 Đang chia sẻ vị trí với cửa hàng{gps.at ? ` · gửi lúc ${clock(gps.at)}` : ''}. Chỉ gửi khi đang có đơn giao.</>
                  : gps.state === 'error' ? <>⚠️ {gps.error}</>
                    : <>📡 Đang bật định vị… Điện thoại hỏi quyền <b>Vị trí</b> thì bấm <b>Cho phép</b>.</>}
            </p>
            {gpsOn && gps.state === 'error' && <button type="button" className="btn btn-primary" onClick={() => { lastSent.current = null; setGpsTry((n) => n + 1); }}>Thử lại</button>}
            <button type="button" className={`btn ${gpsOn ? 'btn-secondary' : 'btn-primary'}`} onClick={toggleGps}>{gpsOn ? 'Tắt chia sẻ' : '📡 Bật chia sẻ vị trí'}</button>
          </div>
        )}
        <div className="delivery-summary">
          <div><strong>{active.length}</strong><span>đơn cần giao</span></div>
          <div><strong>{formatVND(toCollect)}</strong><span>tiền mặt cần thu</span></div>
          <div><strong>{finished.filter((o) => o.status === 'completed').length}</strong><span>đã giao hôm nay · thu {formatVND(collected)}</span></div>
        </div>
        {error && <p className="alert error" role="alert">{error} <button type="button" className="link-button" onClick={load}>Thử lại</button></p>}
        {route && route.stops.length >= 2 && (
          <section className="delivery-route" aria-label="Lộ trình giao">
            <h2>🧭 Lộ trình {route.stops.length} điểm · ≈ {km(route.total_km)}</h2>
            <p>
              {route.from_code ? <>Tính từ chỗ đơn vừa giao {route.from_code}</> : <>Xuất phát từ {route.warehouse.name}</>}, đi theo thứ tự{' '}
              {route.stops.map((s) => active.find((o) => o.id === s.id)?.code).filter(Boolean).join(' → ')}, rồi về {route.warehouse.name} (chặng cuối ≈ {km(route.return_km)}).
              Đây là thứ tự có tổng quãng đường ngắn nhất (đường chim bay).
            </p>
            {route.missing.length > 0 && <p className="delivery-route-warn">⚠️ {route.missing.length} đơn chưa có định vị nên chưa xếp vào lộ trình, gọi khách hỏi đường.</p>}
            <div className="delivery-route-links">
              {route.directions_urls.map((url, i) => (
                <a key={url} className="btn btn-primary" href={url} target="_blank" rel="noopener noreferrer">
                  🗺️ Mở lộ trình trên Google Maps{route.directions_urls.length > 1 ? ` (phần ${i + 1})` : ''}
                </a>
              ))}
            </div>
          </section>
        )}
        {!orders && !error && <ListSkeleton rows={2} label="Đang tải đơn…" />}
        {orders && active.length === 0 && (
          <div className="admin-empty"><span>✓</span><h2>Chưa có đơn nào cần giao</h2><p>Khi cửa hàng giao đơn cho bạn, điện thoại sẽ báo và đơn hiện ở đây.</p></div>
        )}

        <div className="delivery-list">
          {active.map((order) => (
            <article key={order.id} className={`delivery-card ${order.status}`}>
              <header>
                <strong>{stepOf.get(order.id) && route.stops.length >= 2 && <span className="delivery-step">Điểm {stepOf.get(order.id).step}</span>}{order.code}</strong>
                <span className={`status ${order.status}`}>{order.status === 'shipping' ? 'Đang giao' : 'Chờ nhận đơn'}</span>
              </header>
              <p className="delivery-address">{order.fulfillment === 'pickup' ? '🏬 Khách lấy tại cửa hàng' : `🏠 ${order.address}`}</p>
              {order.fulfillment !== 'pickup' && (
                <p className="delivery-distance">{order.distance_km != null
                  ? <>📏 Cách kho {km(order.distance_km)}{stepOf.get(order.id) && route.stops.length >= 2 && stepOf.get(order.id).step > 1 ? ` · cách điểm trước ${km(stepOf.get(order.id).leg_km)}` : ''}</>
                  : 'Chưa có định vị, gọi khách hỏi đường'}</p>
              )}
              {order.delivery_slot && <p className="delivery-meta">🕒 {DELIVERY_SLOT_LABEL[order.delivery_slot]}</p>}
              {order.store_pickups?.length > 0 && (
                <p className="delivery-pickup">🏬 Qua <b>Cửa hàng Nguyễn Cao</b> lấy: {order.store_pickups.map((p) => `${p.product_name} ${p.weight_kg > 0 ? `${String(Math.round(p.quantity * p.weight_kg * 10) / 10).replace('.', ',')} kg` : `${p.quantity} ${p.unit}`}${p.status === 'requested' ? ' (cửa hàng chưa nhận lệnh)' : ''}`).join(', ')}</p>
              )}
              {order.status === 'confirmed' ? (
                <div className="delivery-start">
                  <p>Bấm <b>Bắt đầu</b> để nhận đơn — sau đó mới hiện tên, số điện thoại khách, hàng cần giao và tiền cần thu.</p>
                  <button type="button" className="btn btn-primary btn-block btn-large" disabled={busyId === order.id} onClick={() => setStatus(order, 'shipping')}>
                    {busyId === order.id ? 'Đang lưu…' : '🛵 Bắt đầu'}
                  </button>
                </div>
              ) : (
                <>
              {order.shipping_at && <p className="delivery-started">🛵 Bắt đầu giao lúc <b>{shortTime(order.shipping_at)}</b></p>}
              <h2>{order.receiver_name}</h2>
              {/* Hai nút to cạnh nhau, bấm được bằng một ngón khi đang cầm lái. */}
              <div className={`delivery-quick${order.fulfillment === 'pickup' ? ' one' : ''}`}>
                <a className="btn btn-primary delivery-call" href={`tel:${order.phone}`}>📞 Gọi<small>{formatPhone(order.phone)}</small></a>
                {order.fulfillment !== 'pickup' && (
                  <a className="btn btn-secondary delivery-map" href={directions(order)} target="_blank" rel="noopener noreferrer">
                    🗺️ Chỉ đường<small>{order.map_url ? 'tới định vị khách gửi' : order.delivery_lat ? 'tới vị trí khách ghim' : 'tìm theo địa chỉ'}</small>
                  </a>
                )}
              </div>
              {order.warehouse === 'KH_BS' && <p className="delivery-meta">📦 Lấy hàng ở Kho Bồ Sơn</p>}
              {order.note && <p className="delivery-note">📝 {order.note}</p>}
              <ul className="delivery-items">
                {order.items.map((item, i) => (
                  <li key={i}><span>{item.product_name}{item.promo ? ' (quà khuyến mãi)' : item.is_reward ? ' (quà đổi điểm)' : ''}</span><b>{item.quantity} {item.unit}</b></li>
                ))}
              </ul>
              <p className={`delivery-money ${payWayOf(order) === 'cash' ? 'cod' : 'bank'}`}>
                {order.transfer_confirmed_at
                  ? <>🏦 Đã chuyển khoản: <strong>{formatVND(order.total)}</strong> — cửa hàng đã nhận tiền</>
                  : payWayOf(order) === 'cash'
                    ? <>💵 Thu tiền mặt: <strong>{formatVND(order.total)}</strong></>
                    : <>🏦 Khách chuyển khoản: <strong>{formatVND(order.total)}</strong>{order.has_transfer_proof ? ' — khách đã gửi ảnh chuyển khoản' : ' — chụp ảnh chuyển khoản khi giao'}</>}
              </p>
              {debtForms[order.id] ? (
                <div className="delivery-debt">
                  <h3>📝 Khách nợ — gửi kế toán duyệt</h3>
                  <ProofPhoto label="Chụp gạo đã giao tới nơi" value={debtForms[order.id].delivered}
                              onChange={(v) => setDebt(order.id, { delivered: v })} error={debtForms[order.id].errors?.delivered} />
                  <ProofPhoto label="Chụp hoá đơn nợ" value={debtForms[order.id].invoice}
                              onChange={(v) => setDebt(order.id, { invoice: v })} error={debtForms[order.id].errors?.invoice} />
                  <label>Tên công ty (nếu có)
                    <input className="input" value={debtForms[order.id].company || ''} maxLength={160}
                           onChange={(e) => setDebt(order.id, { company: e.target.value })} placeholder="VD: Công ty TNHH ABC" />
                  </label>
                  <label>Ghi chú cho kế toán
                    <textarea className="input" rows={2} maxLength={1000} value={debtForms[order.id].comment || ''}
                              onChange={(e) => setDebt(order.id, { comment: e.target.value })} placeholder="VD: Khách hẹn trả sau 15 ngày" />
                  </label>
                  {debtForms[order.id].errors?.form && <p className="alert error">{debtForms[order.id].errors.form}</p>}
                  <button type="button" className="btn btn-primary btn-block btn-large" disabled={busyId === order.id} onClick={() => submitDebt(order)}>
                    {busyId === order.id ? 'Đang gửi…' : 'Gửi kế toán duyệt'}
                  </button>
                  <button type="button" className="link-button" onClick={() => setDebtForms((cur) => { const next = { ...cur }; delete next[order.id]; return next; })}>Huỷ, khách trả tiền</button>
                </div>
              ) : (
                <>
                  {order.transfer_confirmed_at ? (
                    <p className="delivery-paid-ok">✓ Cửa hàng đã nhận tiền chuyển khoản, không thu thêm.</p>
                  ) : (
                    <div className="delivery-payway" role="radiogroup" aria-label="Khách trả bằng">
                      <span>Khách trả bằng</span>
                      {[['cash', '💵 Tiền mặt'], ['transfer', '🏦 Chuyển khoản']].map(([way, label]) => (
                        <button key={way} type="button" role="radio" aria-checked={payWayOf(order) === way}
                                className={payWayOf(order) === way ? 'active' : ''} onClick={() => pickPayWay(order, way)}>{label}</button>
                      ))}
                    </div>
                  )}
                  {/* Tiền mặt hay chuyển khoản đều phải chụp ảnh gạo đã giao tới nơi (25/11/2026). */}
                  <ProofPhoto key={`${order.id}-goods`} label="Chụp ảnh gạo đã giao tới nơi" value={photos[order.id]?.goods}
                              onChange={(v) => setPhoto(order.id, 'goods', v)} />
                  {needTransferPhoto(order) && (
                    <>
                      <ProofPhoto key={`${order.id}-transfer`} camera={false} label="Chụp ảnh chuyển khoản của khách" value={photos[order.id]?.transfer}
                                  onChange={(v) => setPhoto(order.id, 'transfer', v)} />
                      <small className="field-help">Chụp màn hình báo chuyển tiền thành công trên điện thoại khách, hoặc chọn ảnh khách gửi. Cửa hàng kiểm tra tiền về rồi xác nhận.</small>
                    </>
                  )}
                  <button type="button" className="btn btn-primary btn-block btn-large delivery-done" disabled={busyId === order.id || !photosReady(order)}
                          onClick={() => setStatus(order, 'completed')}>
                    {busyId === order.id ? 'Đang lưu…' : photosReady(order) ? '✅ Hoàn thành đơn'
                      : !photos[order.id]?.goods ? '✅ Hoàn thành đơn (chụp ảnh gạo trước)' : '✅ Hoàn thành đơn (chụp ảnh chuyển khoản trước)'}
                  </button>
                  <button type="button" className="btn btn-secondary btn-block" onClick={() => setDebt(order.id, {})}>📝 Khách nợ (công nợ)</button>
                </>
              )}
                </>
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
                  <span className={`status ${order.status}`}>
                    {order.status === 'completed' ? `${order.payment_status === 'debt' ? 'Ghi nợ' : 'Đã giao'} ${shortTime(order.completed_at)}` : 'Đã huỷ'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
