import { useCallback, useEffect, useState } from 'react';
import { api, DELIVERY_SLOT_LABEL, formatVND } from '../api';

const km = (v) => (v == null ? '—' : `${String(v).replace('.', ',')} km`);
const dayLabel = (day) => (day ? day.slice(5).split('-').reverse().join('/') : '');
const OPEN_KEY = 'gao_routes_open';
// Trang quản trị tải lại cả danh sách sau khi giao chuyến, nên nhớ lựa chọn để mở lại đúng như cũ.
const readPref = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const savePref = (key, value) => { try { localStorage.setItem(key, value); } catch { /* bỏ qua */ } };

/** Danh sách điểm dừng: Kho → 1 → 2 → … → về kho. */
function Stops({ route, warehouse }) {
  return (
    <ol className="route-stops">
      <li className="route-depot">🏭 {warehouse.name}</li>
      {route.stops.map((s) => (
        <li key={s.id}>
          <span className="route-step">{s.step}</span>
          <span className="route-stop-main">
            <strong>{s.code}</strong> · {s.receiver_name}{s.status === 'shipping' ? ' · đang giao' : ''}
            <small>{s.address}</small>
          </span>
          <span className="route-leg">+{km(s.leg_km)}<small>cách kho {km(s.distance_km)}</small></span>
        </li>
      ))}
      <li className="route-depot">↩️ Về {warehouse.name} <span className="route-leg">+{km(route.return_km)}</span></li>
    </ol>
  );
}

function MapsLinks({ urls }) {
  return urls.map((url, i) => (
    <a key={url} className="btn btn-secondary" href={url} target="_blank" rel="noopener noreferrer">
      🗺️ Xem lộ trình trên Google Maps{urls.length > 1 ? ` (phần ${i + 1})` : ''}
    </a>
  ));
}

/**
 * Gợi ý gom đơn giao (20/11/2026) cho quản trị và kế toán: khoảng cách từ Kho Bồ Sơn, nhóm các đơn gần
 * nhau thành chuyến, thứ tự đi rồi quay về kho ngắn nhất, giao cả chuyến cho một nhân viên giao bằng một nút.
 */
export default function RouteSuggestions({ shippers, onChanged }) {
  const [open, setOpen] = useState(() => readPref(OPEN_KEY, '0') === '1');
  const [radius, setRadiusState] = useState(() => (['1', '2', '3', '5'].includes(readPref('gao_routes_radius', '2')) ? readPref('gao_routes_radius', '2') : '2'));
  const [split, setSplitState] = useState(() => readPref('gao_routes_split', '1') !== '0');
  const setRadius = (v) => { setRadiusState(v); savePref('gao_routes_radius', v); };
  const setSplit = (v) => { setSplitState(v); savePref('gao_routes_split', v ? '1' : '0'); };
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [pick, setPick] = useState({});      // chuyến → id nhân viên giao
  const [links, setLinks] = useState({});    // đơn chưa có định vị → link dán vào
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.adminRoutes({ radius, split }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [radius, split]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const toggle = () => { setOpen((v) => { savePref(OPEN_KEY, v ? '0' : '1'); return !v; }); };

  const assignTrip = async (trip, key) => {
    const shipperId = pick[key];
    if (!shipperId) { setError('Chọn nhân viên giao cho chuyến này.'); return; }
    setBusy(key);
    setError('');
    try {
      const r = await api.adminAssignTrip(trip.stops.map((s) => s.id), Number(shipperId));
      const message = `Đã giao ${r.assigned.length} đơn (${trip.stops.map((s) => s.code).join(', ')}) cho ${r.shipper_name}.`;
      setMsg(message);
      await load();
      onChanged?.(message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const saveLocation = async (order) => {
    setBusy(`loc-${order.id}`);
    setError('');
    try {
      const r = await api.adminSetOrderLocation(order.id, links[order.id] || '');
      const message = r.order.located ? `Đã lưu định vị đơn ${order.code}: cách kho ≈ ${km(r.order.distance_km)}.`
        : `Đã lưu link cho đơn ${order.code} nhưng chưa đọc được toạ độ. Trong Google Maps bấm Chia sẻ → Sao chép đường liên kết, hoặc dán toạ độ dạng 21.18,106.07.`;
      setMsg(message);
      setLinks((cur) => { const next = { ...cur }; delete next[order.id]; return next; });
      // Không tải lại cả trang (lời nhắc ở đây cần ở lại để đọc); khoảng cách trên thẻ đơn cập nhật ở lần tải sau.
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const tripCount = data?.trips.length || 0;
  return (
    <section className={`route-panel${open ? ' open' : ''}`}>
      <button type="button" className="route-toggle" aria-expanded={open} onClick={toggle}>
        <span>🧭 Gợi ý gom đơn và lộ trình giao <small>tính từ Kho Bồ Sơn</small></span>
        {open && data && <span className="route-badge">{tripCount} chuyến gợi ý</span>}
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="route-body">
          <div className="route-controls">
            <label>Gom các đơn cách nhau tối đa
              <select className="input" value={radius} onChange={(e) => setRadius(e.target.value)}>
                {['1', '2', '3', '5'].map((v) => <option key={v} value={v}>{v} km</option>)}
              </select>
            </label>
            <label className="route-check">
              <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Chỉ gom đơn cùng ngày và khung giờ giao
            </label>
            <button type="button" className="btn btn-secondary" disabled={loading} onClick={load}>{loading ? 'Đang tính…' : '↻ Tính lại'}</button>
          </div>
          <p className="route-hint">Khoảng cách tính theo đường chim bay từ {data?.warehouse?.address || 'Kho Bồ Sơn'}. Đường đi thật dài hơn một chút; bấm “Xem lộ trình trên Google Maps” để xem đường và thời gian thực tế.</p>
          {error && <p className="alert error" role="alert">{error}</p>}
          {msg && <p className="alert success" role="status">{msg}</p>}
          {!data && loading && <p className="route-hint">Đang tính khoảng cách…</p>}
          {data && (
            <>
              <h3>Chuyến gợi ý ({tripCount})</h3>
              {tripCount === 0 && <p className="route-hint">Chưa có đơn nào gần nhau để gom (đơn chưa giao cho ai). Thử tăng khoảng cách gom hoặc bỏ tách theo khung giờ.</p>}
              <div className="route-trips">
                {data.trips.map((trip, i) => {
                  const key = trip.stops.map((s) => s.id).join('-');
                  const total = trip.stops.reduce((s, o) => s + (o.total || 0), 0);
                  return (
                    <article key={key} className="route-trip">
                      <header>
                        <strong>Chuyến {i + 1} · {trip.stops.length} đơn</strong>
                        <span>{!data.split ? 'Không tách khung giờ' : trip.slot ? DELIVERY_SLOT_LABEL[trip.slot] : 'Giao sớm nhất'}{trip.day ? ` · ngày ${dayLabel(trip.day)}` : ''}</span>
                      </header>
                      <p className="route-stats">
                        Đi hết rồi về kho ≈ <strong>{km(trip.total_km)}</strong>
                        {trip.saved_km > 0 && <> · đi riêng từng đơn {km(trip.separate_km)}, <b className="route-saved">bớt {km(trip.saved_km)}</b></>}
                        {' '}· tiền hàng {formatVND(total)}
                      </p>
                      <Stops route={trip} warehouse={data.warehouse} />
                      <div className="route-actions">
                        <select className="input" value={pick[key] || ''} onChange={(e) => setPick((cur) => ({ ...cur, [key]: e.target.value }))}
                                aria-label={`Nhân viên giao chuyến ${i + 1}`}>
                          <option value="">— Chọn nhân viên giao —</option>
                          {shippers.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                        </select>
                        <button type="button" className="btn btn-primary" disabled={busy === key} onClick={() => assignTrip(trip, key)}>
                          {busy === key ? 'Đang giao…' : `🛵 Giao cả ${trip.stops.length} đơn`}
                        </button>
                        <MapsLinks urls={trip.directions_urls} />
                      </div>
                    </article>
                  );
                })}
              </div>

              {data.singles.length > 0 && (
                <>
                  <h3>Đơn đi lẻ ({data.singles.length})</h3>
                  <ul className="route-singles">
                    {data.singles.map((o) => (
                      <li key={o.id}><span><strong>{o.code}</strong> · {o.receiver_name} · {o.address}</span>
                        <span>{o.delivery_slot ? DELIVERY_SLOT_LABEL[o.delivery_slot].split(':')[0] : ''} · cách kho <b>{km(o.distance_km)}</b> · khứ hồi ≈ {km(Math.round(o.distance_km * 20) / 10)}</span></li>
                    ))}
                  </ul>
                </>
              )}

              {data.missing.length > 0 && (
                <>
                  <h3>Chưa có định vị ({data.missing.length})</h3>
                  <p className="route-hint">Đơn chỉ có địa chỉ chữ nên chưa tính được khoảng cách. Xin khách vị trí qua Zalo rồi dán link Google Maps (hoặc toạ độ) vào đây.</p>
                  <ul className="route-missing">
                    {data.missing.map((o) => (
                      <li key={o.id}>
                        <span><strong>{o.code}</strong> · {o.receiver_name} · {o.address}</span>
                        <span className="route-missing-form">
                          <input className="input" value={links[o.id] || ''} placeholder="https://maps.app.goo.gl/…"
                                 onChange={(e) => setLinks((cur) => ({ ...cur, [o.id]: e.target.value }))} aria-label={`Định vị đơn ${o.code}`} />
                          <button type="button" className="btn btn-secondary" disabled={!links[o.id]?.trim() || busy === `loc-${o.id}`} onClick={() => saveLocation(o)}>
                            {busy === `loc-${o.id}` ? 'Đang lưu…' : 'Lưu định vị'}
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {data.drivers.length > 0 && (
                <>
                  <h3>Lộ trình của nhân viên giao</h3>
                  <div className="route-trips">
                    {data.drivers.map((d) => (
                      <article key={d.shipper_id} className="route-trip driver">
                        <header><strong>🛵 {d.shipper_name}</strong><span>{d.count} đơn đang giữ</span></header>
                        {d.stops.length > 0 && <p className="route-stats">Đi hết rồi về kho ≈ <strong>{km(d.total_km)}</strong>{d.stops.length > 1 && d.saved_km > 0 ? <> · bớt {km(d.saved_km)} so với đi riêng</> : null}</p>}
                        {d.stops.length > 0 && <Stops route={d} warehouse={data.warehouse} />}
                        {d.missing.length > 0 && <p className="route-hint">Chưa có định vị: {d.missing.map((o) => o.code).join(', ')}</p>}
                        {d.stops.length > 0 && <div className="route-actions"><MapsLinks urls={d.directions_urls} /></div>}
                      </article>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
