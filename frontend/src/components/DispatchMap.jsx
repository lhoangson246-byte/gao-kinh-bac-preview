import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, DELIVERY_SLOT_LABEL, formatVND } from '../api';
import { hasGoogleMapsKey } from '../mapConfig.js';
import { createHtmlMarkerClass, loadGoogleMaps, onMapsAuthFailure } from '../dispatch/googleMaps.js';
import { applyShipperUpdate, createFleet, haversineKm, mergeFleet, nearestShippers, setShipperStatus, tickFleet } from '../dispatch/fleet.js';

/*
 * Bản đồ điều phối & giám sát giao hàng (21/11/2026) — cho kế toán và quản lý.
 *  - Bản đồ nhúng ngay trong trang (Google Maps JavaScript API, <div id="map">), không mở trang ngoài.
 *  - Chưa có khoá Google Maps → tự chuyển CHẾ ĐỘ MÔ PHỎNG: bản đồ sơ đồ vẽ trong trang, mọi chức năng như thật.
 *  - Ghim mọi đơn giao tận nơi đã xác nhận / đang giao (không tính đơn đã hoàn thành), di chuột xem địa chỉ,
 *    bấm xem chi tiết + shipper gần nhất + giao đơn cho shipper.
 *  - Shipper: ảnh đại diện + tên, huy hiệu ✕ đỏ (đang giao) / ✓ xanh (đã giao xong), di chuyển theo thời gian
 *    thực (mô phỏng, có Chạy / Dừng và tốc độ tua; sau này nối vị trí thật qua applyShipperUpdate).
 */

const TICK_MS = 250;              // nhịp cập nhật vị trí (mượt)
const BASE_KMH = 25;              // vận tốc xe máy trung bình trong phố
const REFRESH_MS = 30_000;        // tự tải lại đơn / shipper từ máy chủ
const SPEEDS = [1, 10, 30, 60];
const STATUS_LABEL = { confirmed: 'Chờ giao', shipping: 'Đang giao' };
const SHIPPER_STATUS = { delivering: 'Đang giao hàng', done: 'Đã giao xong', idle: 'Chưa bắt đầu' };
const km = (v) => `${(Math.round(v * 10) / 10).toString().replace('.', ',')} km`;
const readPref = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const savePref = (key, value) => { try { localStorage.setItem(key, value); } catch { /* bỏ qua */ } };

/** Chữ viết tắt + màu riêng cho ảnh đại diện khi nhân viên chưa có ảnh. */
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
const hue = (id) => (String(id).split('').reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 360 + 360) % 360;

/* ---------------------------------- Ghim (dùng chung cho cả hai chế độ) ---------------------------------- */

function OrderPin({ order, active, onSelect }) {
  return (
    <button type="button" className={`dpin ${order.status}${order.shipper_id ? ' assigned' : ''}${active ? ' active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'order', id: order.id }); }}
            aria-label={`Đơn ${order.code} · ${order.customer_label} · ${order.address}`}>
      <span className="dpin-label">{order.wholesale ? '🏢 ' : ''}{order.customer_label}</span>
      <span className="dpin-dot" aria-hidden="true" />
      {/* Di chuột vào ghim thì hiện địa chỉ chi tiết */}
      <span className="dpin-tip" role="tooltip"><b>{order.code}</b> · {order.address}</span>
    </button>
  );
}

function ShipperPin({ shipper, active, onSelect }) {
  return (
    <button type="button" className={`dship ${shipper.status}${active ? ' active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'shipper', id: shipper.id }); }}
            aria-label={`${shipper.full_name}: ${SHIPPER_STATUS[shipper.status]}`}>
      <span className="dship-avatar" style={{ background: `hsl(${hue(shipper.id)} 55% 42%)` }}>
        {shipper.avatar_url ? <img src={shipper.avatar_url} alt="" /> : initials(shipper.full_name)}
        {/* Huy hiệu trạng thái góc trên ảnh: ✕ đỏ = đang giao, ✓ xanh = đã giao xong */}
        {shipper.status === 'delivering' && <span className="dship-badge delivering" title="Đang giao hàng">✕</span>}
        {shipper.status === 'done' && <span className="dship-badge done" title="Đã giao xong">✓</span>}
      </span>
      <span className="dship-name">🛵 {shipper.full_name}</span>
    </button>
  );
}

function WarehousePin({ warehouse }) {
  return <span className="dwh" title={warehouse.address}>🏭 <b>{warehouse.name}</b></span>;
}

/* ---------------------------------- Bản đồ mô phỏng (chưa có khoá) ---------------------------------- */

/**
 * Bản đồ sơ đồ: chiếu kinh độ / vĩ độ ra mặt phẳng quanh kho (đủ chính xác trong phạm vi một tỉnh), có lưới,
 * vòng khoảng cách 1 / 2 / 5 / 10 km từ kho, đường lộ trình của shipper. Kéo để di chuyển, cuộn chuột hoặc
 * nút +/− để phóng to.
 */
function SimMap({ data, fleet, selected, onSelect, focus }) {
  const box = useRef(null);
  const drag = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [view, setView] = useState(null);   // { lat, lng, scale (px / km) }
  const wh = data.warehouse;
  const kx = 111.32 * Math.cos((wh.lat * Math.PI) / 180);
  const ky = 110.57;

  useEffect(() => {
    const el = box.current;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width || 800, h: entry.contentRect.height || 520 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Vừa khung: thấy kho, mọi đơn và mọi shipper. */
  const fit = useCallback(() => {
    const pts = [wh, ...data.orders.filter((o) => o.located), ...fleet];
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const spanX = Math.max((Math.max(...lngs) - Math.min(...lngs)) * kx, 1.5);
    const spanY = Math.max((Math.max(...lats) - Math.min(...lats)) * ky, 1.5);
    const scale = Math.max(4, Math.min(400, Math.min(size.w / (spanX * 1.3), size.h / (spanY * 1.3))));
    setView({ lat: (Math.max(...lats) + Math.min(...lats)) / 2, lng: (Math.max(...lngs) + Math.min(...lngs)) / 2, scale });
  }, [data, fleet, size, wh, kx]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!view && size.w > 0) fit(); }, [view, size, fit]);
  // Dời tới điểm được chọn; đặt điểm lệch sang trái để bảng chi tiết (bên phải) không che.
  useEffect(() => {
    if (!focus) return;
    setView((v) => {
      const scale = Math.max(v?.scale || 0, 160);
      return { lat: focus.lat, lng: focus.lng + (size.w * 0.2) / (kx * scale), scale };
    });
  }, [focus]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Cuộn chuột để phóng to / thu nhỏ (cần listener không thụ động để chặn cuộn trang).
  useEffect(() => {
    const el = box.current;
    const onWheel = (e) => {
      e.preventDefault();
      setView((v) => v && ({ ...v, scale: Math.max(4, Math.min(600, v.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2))) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  if (!view) return <div ref={box} className="sim-map" />;
  const project = (p) => ({ x: size.w / 2 + (p.lng - view.lng) * kx * view.scale, y: size.h / 2 - (p.lat - view.lat) * ky * view.scale });
  const W = project(wh);
  const onPointerDown = (e) => {
    if (e.target.closest('button')) return;
    drag.current = { x: e.clientX, y: e.clientY, view };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const d = drag.current;
    setView({ ...d.view, lng: d.view.lng - (e.clientX - d.x) / (kx * d.view.scale), lat: d.view.lat + (e.clientY - d.y) / (ky * d.view.scale) });
  };
  const onPointerUp = () => { drag.current = null; };
  const gridKm = view.scale > 120 ? 0.5 : view.scale > 40 ? 1 : view.scale > 12 ? 5 : 10;
  const lines = [];
  const halfW = size.w / 2 / (kx * view.scale);
  const halfH = size.h / 2 / (ky * view.scale);
  for (let x = Math.floor(((view.lng - halfW - wh.lng) * kx) / gridKm); x <= Math.ceil(((view.lng + halfW - wh.lng) * kx) / gridKm); x++) {
    const px = project({ lat: view.lat, lng: wh.lng + (x * gridKm) / kx }).x;
    lines.push(<line key={`x${x}`} x1={px} x2={px} y1={0} y2={size.h} />);
  }
  for (let y = Math.floor(((view.lat - halfH - wh.lat) * ky) / gridKm); y <= Math.ceil(((view.lat + halfH - wh.lat) * ky) / gridKm); y++) {
    const py = project({ lat: wh.lat + (y * gridKm) / ky, lng: view.lng }).y;
    lines.push(<line key={`y${y}`} x1={0} x2={size.w} y1={py} y2={py} />);
  }
  const located = data.orders.filter((o) => o.located);
  return (
    <div ref={box} className="sim-map" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <svg className="sim-bg" width={size.w} height={size.h} aria-hidden="true">
        <g className="sim-grid">{lines}</g>
        {[1, 2, 5, 10].map((r) => (
          <g key={r} className="sim-ring">
            <circle cx={W.x} cy={W.y} r={r * ky * view.scale} />
            <text x={W.x + 4} y={W.y - r * ky * view.scale - 4}>{r} km</text>
          </g>
        ))}
        {fleet.filter((s) => s.orderIds.length).map((s) => (
          <polyline key={s.id} className="sim-route" points={s.path.map((p) => { const q = project(p); return `${q.x},${q.y}`; }).join(' ')}
                    style={{ stroke: `hsl(${hue(s.id)} 55% 42%)` }} />
        ))}
      </svg>
      <div className="sim-layer" style={{ left: W.x, top: W.y, zIndex: 2 }}><WarehousePin warehouse={wh} /></div>
      {located.map((o) => { const q = project(o); return (
        <div key={`o${o.id}`} className="sim-layer" style={{ left: q.x, top: q.y, zIndex: selected?.kind === 'order' && selected.id === o.id ? 30 : 3 }}>
          <OrderPin order={o} active={selected?.kind === 'order' && selected.id === o.id} onSelect={onSelect} />
        </div>
      ); })}
      {fleet.map((s) => { const q = project(s); return (
        <div key={`s${s.id}`} className="sim-layer" style={{ left: q.x, top: q.y, zIndex: 20 }}>
          <ShipperPin shipper={s} active={selected?.kind === 'shipper' && selected.id === s.id} onSelect={onSelect} />
        </div>
      ); })}
      <div className="sim-zoom">
        <button type="button" onClick={() => setView((v) => ({ ...v, scale: Math.min(600, v.scale * 1.4) }))} aria-label="Phóng to">+</button>
        <button type="button" onClick={() => setView((v) => ({ ...v, scale: Math.max(4, v.scale / 1.4) }))} aria-label="Thu nhỏ">−</button>
        <button type="button" onClick={fit} title="Vừa khung: thấy hết đơn và shipper">⤢</button>
      </div>
      <span className="sim-credit">Bản đồ mô phỏng · lưới {String(gridKm).replace('.', ',')} km</span>
    </div>
  );
}

/* ---------------------------------- Bản đồ Google thật ---------------------------------- */

/**
 * Google Maps trong thẻ <div id="map">. Ghim là thẻ HTML (OverlayView) do React vẽ vào bằng createPortal,
 * nên giống hệt bản đồ mô phỏng. Khoá sai / bị chặn thì gọi onFail để chuyển sang mô phỏng.
 */
function GoogleMap({ maps, data, fleet, selected, onSelect, focus }) {
  const mapDiv = useRef(null);
  const mapRef = useRef(null);
  const Marker = useMemo(() => createHtmlMarkerClass(maps), [maps]);
  const overlays = useRef(new Map());   // key → { overlay, el }
  const [, setVersion] = useState(0);

  // Tạo bản đồ một lần.
  useEffect(() => {
    mapRef.current = new maps.Map(mapDiv.current, {
      center: { lat: data.warehouse.lat, lng: data.warehouse.lng }, zoom: 13,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: true, clickableIcons: false, gestureHandling: 'greedy',
    });
    const bounds = new maps.LatLngBounds();
    bounds.extend({ lat: data.warehouse.lat, lng: data.warehouse.lng });
    for (const o of data.orders) if (o.located) bounds.extend({ lat: o.lat, lng: o.lng });
    if (!bounds.isEmpty() && data.orders.some((o) => o.located)) mapRef.current.fitBounds(bounds, 60);
    const all = overlays.current;
    return () => { for (const { overlay } of all.values()) overlay.setMap(null); all.clear(); };
  }, [maps]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** Đồng bộ ghim với dữ liệu: thêm ghim mới, bỏ ghim không còn, dời ghim đã có. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const wanted = new Map([
      ['wh', { pos: data.warehouse, z: 2 }],
      ...data.orders.filter((o) => o.located).map((o) => [`o${o.id}`, { pos: { lat: o.lat, lng: o.lng }, z: 3 }]),
      ...fleet.map((s) => [`s${s.id}`, { pos: { lat: s.lat, lng: s.lng }, z: 20 }]),
    ]);
    let changed = false;
    for (const [key, { overlay }] of overlays.current) {
      if (!wanted.has(key)) { overlay.setMap(null); overlays.current.delete(key); changed = true; }
    }
    for (const [key, { pos, z }] of wanted) {
      const have = overlays.current.get(key);
      if (have) { have.overlay.setPosition(pos); continue; }
      const el = document.createElement('div');
      el.className = 'gm-layer';
      const overlay = new Marker(pos, el, z);
      overlay.setMap(map);
      overlays.current.set(key, { overlay, el });
      changed = true;
    }
    if (changed) setVersion((v) => v + 1);
  }, [data, fleet, Marker]);

  useEffect(() => {
    if (!focus || !mapRef.current) return;
    mapRef.current.panTo({ lat: focus.lat, lng: focus.lng });
    if (mapRef.current.getZoom() < 16) mapRef.current.setZoom(16);
    // Lệch điểm sang trái để bảng chi tiết bên phải không che.
    mapRef.current.panBy(Math.round((mapDiv.current?.offsetWidth || 0) * 0.2), 0);
  }, [focus]);

  const orderById = new Map(data.orders.map((o) => [`o${o.id}`, o]));
  const shipperById = new Map(fleet.map((s) => [`s${s.id}`, s]));
  return (
    <>
      <div id="map" ref={mapDiv} className="gmap" />
      {[...overlays.current.entries()].map(([key, { el }]) => {
        if (key === 'wh') return createPortal(<WarehousePin warehouse={data.warehouse} />, el, key);
        const order = orderById.get(key);
        if (order) return createPortal(<OrderPin order={order} active={selected?.kind === 'order' && selected.id === order.id} onSelect={onSelect} />, el, key);
        const shipper = shipperById.get(key);
        return shipper ? createPortal(<ShipperPin shipper={shipper} active={selected?.kind === 'shipper' && selected.id === shipper.id} onSelect={onSelect} />, el, key) : null;
      })}
    </>
  );
}

/* ---------------------------------- Trang điều phối ---------------------------------- */

export default function DispatchMap({ shippers: shipperOptions = [] }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [fleet, setFleet] = useState([]);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeedState] = useState(() => Number(readPref('gao_dispatch_speed', '30')) || 30);
  const setSpeed = (v) => { setSpeedState(v); savePref('gao_dispatch_speed', String(v)); };
  const [mode, setMode] = useState(hasGoogleMapsKey() ? 'loading' : 'sim');   // 'loading' | 'google' | 'sim'
  const [maps, setMaps] = useState(null);
  const [mapNote, setMapNote] = useState('');
  const [selected, setSelected] = useState(null);   // { kind: 'order' | 'shipper', id }
  const [focus, setFocus] = useState(null);         // { lat, lng, t } — yêu cầu bản đồ dời tới
  const [assignTo, setAssignTo] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      const fresh = await api.adminDispatch();
      setData(fresh);
      setFleet((cur) => (cur.length ? mergeFleet(cur, createFleet(fresh)) : createFleet(fresh)));
      if (!quiet) setError('');
    } catch (err) {
      if (!quiet) setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => { if (!document.hidden) load({ quiet: true }); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // Nạp Google Maps khi đã có khoá; lỗi thì dùng bản đồ mô phỏng.
  useEffect(() => {
    if (!hasGoogleMapsKey()) return undefined;
    let alive = true;
    loadGoogleMaps().then((m) => { if (alive) { setMaps(m); setMode('google'); } })
      .catch((err) => { if (alive) { setMapNote(err.message); setMode('sim'); } });
    const off = onMapsAuthFailure((message) => { if (alive) { setMapNote(message); setMode('sim'); } });
    return () => { alive = false; off(); };
  }, []);

  // Nhịp mô phỏng shipper di chuyển.
  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => setFleet((cur) => tickFleet(cur, { seconds: TICK_MS / 1000, kmh: BASE_KMH * speed })), TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, speed]);

  // Lối vào cho dữ liệu thật sau này (ví dụ nhận vị trí qua máy chủ): window.__gaoDispatch.update({...}).
  useEffect(() => {
    window.__gaoDispatch = { update: (patch) => setFleet((cur) => applyShipperUpdate(cur, patch)) };
    return () => { delete window.__gaoDispatch; };
  }, []);

  const select = (sel) => { setSelected(sel); setAssignTo(''); setMsg(''); };
  const focusOrder = (order) => {
    select({ kind: 'order', id: order.id });
    if (order.located) setFocus({ lat: order.lat, lng: order.lng, t: Date.now() });
  };
  const focusShipper = (s) => { select({ kind: 'shipper', id: s.id }); setFocus({ lat: s.lat, lng: s.lng, t: Date.now() }); };

  const assign = async (order) => {
    if (!assignTo) return;
    setBusy(true);
    try {
      const { order: updated } = await api.adminAssignShipper(order.id, Number(assignTo));
      setMsg(`Đã giao đơn ${order.code} cho ${updated.shipper_name}. Nhân viên nhận thông báo trên điện thoại.`);
      setAssignTo('');
      await load();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <p className="alert error" role="alert">{error} <button type="button" className="link-button" onClick={() => load()}>Thử lại</button></p>;
  if (!data) return <p className="route-hint">Đang tải bản đồ điều phối…</p>;

  const orders = data.orders;
  const order = selected?.kind === 'order' ? orders.find((o) => o.id === selected.id) : null;
  const shipper = selected?.kind === 'shipper' ? fleet.find((s) => s.id === selected.id) : null;
  // Danh sách đơn: chưa giao cho ai lên đầu, rồi gần kho trước.
  const list = [...orders].sort((a, b) => (!!a.shipper_id - !!b.shipper_id) || ((a.distance_km ?? 999) - (b.distance_km ?? 999)));
  const nearestOf = (o) => (o.located ? nearestShippers(fleet, o, 3) : []);
  const delivering = fleet.filter((s) => s.status === 'delivering').length;

  return (
    <div className="dispatch">
      <div className="dispatch-toolbar">
        <span className={`dispatch-mode ${mode}`}>{mode === 'google' ? '🗺️ Google Maps' : mode === 'loading' ? '⏳ Đang mở Google Maps…' : '🧪 Chế độ mô phỏng'}</span>
        <button type="button" className="btn btn-secondary" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
          {playing ? '⏸ Dừng mô phỏng' : '▶ Chạy mô phỏng'}
        </button>
        <label className="dispatch-speed">Tốc độ
          <select className="input" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((v) => <option key={v} value={v}>×{v}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-secondary" onClick={() => load()}>↻ Làm mới</button>
        <span className="dispatch-stats">{orders.length} đơn cần giao · {delivering}/{fleet.filter((s) => !s.demo).length} shipper đang giao</span>
      </div>
      {mode === 'sim' && (
        <p className="dispatch-note">
          {mapNote ? <>⚠️ {mapNote} </> : <>Chưa điền khoá Google Maps nên đang dùng <b>bản đồ mô phỏng</b> (vẫn đúng vị trí và khoảng cách). </>}
          Điền khoá ở biến môi trường <code>VITE_GOOGLE_MAPS_API_KEY</code> trên Vercel hoặc thay <code>YOUR_GOOGLE_MAPS_API_KEY</code> trong <code>frontend/src/mapConfig.js</code>.
          {mapNote && <> <button type="button" className="link-button" onClick={() => window.location.reload()}>Tải lại trang</button></>}
        </p>
      )}
      <p className="dispatch-legend">
        <span><i className="lg-pin confirmed" /> Chờ giao</span><span><i className="lg-pin shipping" /> Đang giao</span>
        <span><i className="lg-pin open" /> Chưa có người giao</span><span><b className="lg-x">✕</b> Shipper đang giao</span><span><b className="lg-ok">✓</b> Shipper đã giao xong</span>
        <span className="muted">Vị trí shipper đang mô phỏng theo lộ trình (chưa nối GPS điện thoại).</span>
      </p>

      <div className="dispatch-layout">
        <div className="dispatch-map-wrap">
          {mode === 'google' && maps
            ? <GoogleMap maps={maps} data={data} fleet={fleet} selected={selected} onSelect={select} focus={focus} />
            : (
              <div id="map" className="gmap">
                {mode === 'loading' ? <p className="route-hint">Đang mở Google Maps…</p>
                  : <SimMap data={data} fleet={fleet} selected={selected} onSelect={select} focus={focus} />}
              </div>
            )}

          {(order || shipper) && (
            <div className="dispatch-info" role="dialog" aria-label="Thông tin chi tiết">
              <button type="button" className="dispatch-info-close" onClick={() => setSelected(null)} aria-label="Đóng">×</button>
              {order && (
                <>
                  <h3>Đơn {order.code} <span className={`status ${order.status}`}>{STATUS_LABEL[order.status]}</span></h3>
                  <p className="dispatch-info-name">{order.wholesale ? <>🏢 {order.customer_label} <small>({order.wholesale_code} · người nhận {order.receiver_name})</small></> : order.receiver_name}</p>
                  <p><a href={`tel:${order.phone}`}>📞 {order.phone}</a></p>
                  <p>🏠 {order.address}</p>
                  {order.delivery_slot && <p>🕒 {DELIVERY_SLOT_LABEL[order.delivery_slot]}{order.delivery_day ? ` · ngày ${order.delivery_day.slice(8)}/${order.delivery_day.slice(5, 7)}` : ''}</p>}
                  <ul className="dispatch-items">{order.items.map((i, k) => <li key={k}>{i.product_name} <b>{i.quantity} {i.unit}</b></li>)}</ul>
                  <p>Khách trả <b>{formatVND(order.total)}</b> · {order.payment_method === 'bank' ? 'chuyển khoản' : 'tiền mặt khi nhận'}</p>
                  <p>{order.distance_km != null ? <>📏 Cách {data.warehouse.name} ≈ {km(order.distance_km)}</> : '📍 Chưa có định vị (dán link ở thẻ "Gợi ý gom chuyến")'}</p>
                  <p>🛵 Người giao: <b>{order.shipper_name || 'chưa giao cho ai'}</b></p>
                  {order.located && (
                    <div className="dispatch-near">
                      <b>Shipper gần nhất:</b>
                      <ol>{nearestOf(order).map(({ shipper: s, km: d }) => (
                        <li key={s.id}>{s.full_name} · {km(d)} · {SHIPPER_STATUS[s.status].toLowerCase()}</li>
                      ))}</ol>
                    </div>
                  )}
                  <div className="dispatch-assign">
                    <select className="input" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} aria-label="Chọn shipper giao đơn này">
                      <option value="">— Giao đơn này cho —</option>
                      {(order.located ? [...shipperOptions].sort((a, b) => {
                        const pa = fleet.find((s) => s.id === a.id); const pb = fleet.find((s) => s.id === b.id);
                        return (pa ? haversineKm(pa, order) : 999) - (pb ? haversineKm(pb, order) : 999);
                      }) : shipperOptions).map((s) => {
                        const pos = fleet.find((f) => f.id === s.id);
                        return <option key={s.id} value={s.id}>{s.full_name}{pos && order.located ? ` (cách ${km(haversineKm(pos, order))})` : ''}</option>;
                      })}
                    </select>
                    <button type="button" className="btn btn-primary" disabled={!assignTo || busy} onClick={() => assign(order)}>{busy ? 'Đang giao…' : 'Giao đơn'}</button>
                  </div>
                </>
              )}
              {shipper && (
                <>
                  <h3>🛵 {shipper.full_name}</h3>
                  <p>Trạng thái: <b className={`dship-status ${shipper.status}`}>{shipper.status === 'delivering' ? '✕ ' : shipper.status === 'done' ? '✓ ' : ''}{SHIPPER_STATUS[shipper.status]}</b></p>
                  <p>Đang giữ {shipper.active_count} đơn · đã giao xong hôm nay {shipper.done_today} đơn</p>
                  <p className="muted">{shipper.source === 'live' ? 'Vị trí thật từ điện thoại.' : shipper.demo ? 'Shipper mô phỏng để thử giao diện (chưa có tài khoản giao hàng).' : 'Vị trí đang mô phỏng theo lộ trình.'}</p>
                  {shipper.orderIds.length > 0 && (
                    <ol className="dispatch-items">{shipper.orderIds.map((id) => { const o = orders.find((x) => x.id === id); return o ? <li key={id}>{o.code} · {o.customer_label}</li> : null; })}</ol>
                  )}
                  <div className="dispatch-assign">
                    <span>Thử trạng thái:</span>
                    <button type="button" className={`btn btn-secondary${shipper.status === 'delivering' ? ' active' : ''}`} onClick={() => setFleet((f) => setShipperStatus(f, shipper.id, 'delivering'))}>✕ Đang giao</button>
                    <button type="button" className={`btn btn-secondary${shipper.status === 'done' ? ' active' : ''}`} onClick={() => setFleet((f) => setShipperStatus(f, shipper.id, 'done'))}>✓ Đã giao</button>
                  </div>
                </>
              )}
              {msg && <p className="dispatch-msg" role="status">{msg}</p>}
            </div>
          )}
        </div>

        <aside className="dispatch-side">
          <h3>Shipper ({fleet.length})</h3>
          <ul className="dispatch-shippers">
            {fleet.map((s) => (
              <li key={s.id} className={selected?.kind === 'shipper' && selected.id === s.id ? 'active' : ''}>
                <button type="button" onClick={() => focusShipper(s)}>
                  <span className="dship-avatar small" style={{ background: `hsl(${hue(s.id)} 55% 42%)` }}>
                    {initials(s.full_name)}
                    {s.status === 'delivering' && <span className="dship-badge delivering">✕</span>}
                    {s.status === 'done' && <span className="dship-badge done">✓</span>}
                  </span>
                  <span><b>{s.full_name}</b><small>{SHIPPER_STATUS[s.status]} · {s.active_count} đơn</small></span>
                </button>
              </li>
            ))}
          </ul>
          <h3>Đơn cần giao ({orders.length})</h3>
          {orders.length === 0 && <p className="route-hint">Không có đơn đã xác nhận nào đang chờ giao.</p>}
          <ul className="dispatch-orders">
            {list.map((o) => {
              const near = nearestOf(o)[0];
              return (
                <li key={o.id} className={`${selected?.kind === 'order' && selected.id === o.id ? 'active' : ''}${o.located ? '' : ' nolocation'}`}>
                  <button type="button" onClick={() => focusOrder(o)}>
                    <span className="dispatch-order-top"><b>{o.code}</b> <span className={`status ${o.status}`}>{STATUS_LABEL[o.status]}</span></span>
                    <span className="dispatch-order-name">{o.wholesale ? '🏢 ' : ''}{o.customer_label}</span>
                    <small>{o.address}</small>
                    <small>{o.shipper_name ? `🛵 ${o.shipper_name}` : '⚠️ Chưa giao cho ai'}{o.located
                      ? ` · cách kho ${km(o.distance_km)}${near ? ` · gần nhất: ${near.shipper.full_name} (${km(near.km)})` : ''}`
                      : ' · chưa có định vị'}</small>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}
