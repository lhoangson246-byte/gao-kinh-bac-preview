import { useState } from 'react';
import DispatchMap from './DispatchMap.jsx';
import RouteSuggestions from './RouteSuggestions.jsx';

const readPref = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const savePref = (key, value) => { try { localStorage.setItem(key, value); } catch { /* bỏ qua */ } };

/**
 * Khung "Bản đồ điều phối & giám sát giao hàng" trên trang Đơn hàng (21/11/2026), cho kế toán và quản lý.
 * Hai thẻ: Bản đồ trực tiếp (đơn, shipper, giao đơn) và Gợi ý gom chuyến (gom đơn gần nhau, lộ trình ngắn nhất).
 */
export default function DispatchPanel({ shippers, onChanged }) {
  const [open, setOpen] = useState(() => readPref('gao_dispatch_open', '1') === '1');
  const [tab, setTab] = useState(() => (readPref('gao_dispatch_tab', 'map') === 'trips' ? 'trips' : 'map'));
  const toggle = () => setOpen((v) => { savePref('gao_dispatch_open', v ? '0' : '1'); return !v; });
  const pick = (value) => { setTab(value); savePref('gao_dispatch_tab', value); };
  return (
    <section className={`route-panel dispatch-panel${open ? ' open' : ''}`}>
      <button type="button" className="route-toggle" aria-expanded={open} onClick={toggle}>
        <span>🗺️ Bản đồ điều phối &amp; giám sát giao hàng <small>thời gian thực · từ Kho Bồ Sơn</small></span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <>
          <div className="dispatch-tabs" role="tablist" aria-label="Điều phối giao hàng">
            <button type="button" role="tab" aria-selected={tab === 'map'} className={tab === 'map' ? 'active' : ''} onClick={() => pick('map')}>🗺️ Bản đồ trực tiếp</button>
            <button type="button" role="tab" aria-selected={tab === 'trips'} className={tab === 'trips' ? 'active' : ''} onClick={() => pick('trips')}>🧭 Gợi ý gom chuyến</button>
          </div>
          {tab === 'map' ? <DispatchMap shippers={shippers} /> : <RouteSuggestions shippers={shippers} onChanged={onChanged} />}
        </>
      )}
    </section>
  );
}
