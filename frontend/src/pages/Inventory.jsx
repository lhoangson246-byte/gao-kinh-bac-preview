import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatDateTime } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import StaffNav from '../components/StaffNav.jsx';
import { DashboardSkeleton } from '../components/Skeleton.jsx';
import useDragReorder from '../components/useDragReorder.js';
import {
  CountForm, MAIN, ReceiptForm, STORE, TransferForm, WAREHOUSE_NAME, WAREHOUSE_SHORT, amountText, formatQty,
} from '../components/InventoryForms.jsx';

export const INVENTORY_PERMISSIONS = ['inventory.view', 'inventory.receive', 'inventory.transfer', 'inventory.count'];
const LOG_PAGE = 30;
const LOG_GROUPS = [['', 'Mọi việc'], ['in', 'Nhập kho'], ['transfer', 'Điều chuyển'], ['sale', 'Bán hàng'], ['count', 'Kiểm kê']];
const fold = (value) => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatQty(Math.abs(n))}`;
const kgText = (total) => `${formatQty(Math.round(total?.kg || 0))} kg`;

/** Gộp các dòng nhật ký liền nhau của cùng một phiếu (một phiếu nhập nhiều loại gạo là một việc). */
function groupMovements(movements) {
  const groups = [];
  for (const m of movements) {
    const last = groups[groups.length - 1];
    if (last && m.ref_code && last.ref_code === m.ref_code && last.kind === m.kind && last.warehouse === m.warehouse && last.actor_name === m.actor_name) {
      last.lines.push(m);
    } else {
      groups.push({ ...m, lines: [m] });
    }
  }
  return groups;
}

/** Một lệnh chuyển đang trên đường: bên nhận đếm hàng rồi xác nhận. */
function TransferCard({ transfer, canAct, onDone, products = [] }) {
  // Lệnh chuyển hiện và đếm theo kg (24/11/2026); số gửi lên máy chủ vẫn là số bao / túi.
  const weightOf = (item) => products.find((p) => p.id === item.product_id)?.weight_kg || 0;
  const toKg = (item, units) => Math.round(units * weightOf(item) * 1000) / 1000;
  const fromInput = (item, value) => { const n = Number(String(value).replace(',', '.')); const w = weightOf(item); return w > 0 ? Math.round((n / w) * 1000) / 1000 : n; };
  const shown = (item, units) => amountText({ weight_kg: weightOf(item), unit: item.unit }, units);
  const [counting, setCounting] = useState(false);
  const [received, setReceived] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action) => {
    setBusy(true);
    setError('');
    try { onDone(await action()); } catch (err) { setError(err.message); setBusy(false); }
  };
  const confirmAll = () => {
    if (!window.confirm(`Đã đếm đủ hàng của lệnh ${transfer.code}? Tồn ${WAREHOUSE_NAME[transfer.to_warehouse]} sẽ được cộng.`)) return;
    run(() => api.inventoryTransferReceive(transfer.id, {}));
  };
  const confirmCounted = () => {
    const items = transfer.items.map((i) => ({ item_id: i.id, received: received[i.id] === undefined || received[i.id] === '' ? i.quantity : fromInput(i, received[i.id]) }));
    const missing = Math.round(items.reduce((sum, row, index) => sum + (transfer.items[index].quantity - row.received), 0) * 1000) / 1000;
    if (items.some((row, index) => row.received > transfer.items[index].quantity)) { setError('Số thực nhận không được lớn hơn số đã chuyển.'); return; }
    const missingText = transfer.items.map((i, index) => ({ i, gap: Math.round((i.quantity - items[index].received) * 1000) / 1000 })).filter((x) => x.gap > 0)
      .map(({ i, gap }) => `${i.product_name}: ${shown(i, gap)}`).join(', ');
    if (!window.confirm(missing > 0 ? `Xác nhận nhận THIẾU so với lệnh ${transfer.code} (${missingText})? Phần thiếu sẽ được ghi lại.` : `Xác nhận nhận đủ hàng của lệnh ${transfer.code}?`)) return;
    run(() => api.inventoryTransferReceive(transfer.id, { items }));
  };
  const cancel = () => {
    const reason = window.prompt(`Huỷ lệnh ${transfer.code}? Hàng sẽ trả về ${WAREHOUSE_NAME[transfer.from_warehouse]}. Ghi lý do (có thể để trống):`, '');
    if (reason === null) return;
    run(() => api.inventoryTransferCancel(transfer.id, { note: reason.trim() || null }));
  };
  return (
    <article className="inv-transfer">
      <header>
        <strong>{transfer.code}</strong>
        <span className="inv-route"><i className={`wh-chip ${transfer.from_warehouse}`}>{WAREHOUSE_NAME[transfer.from_warehouse]}</i> ➔ <i className={`wh-chip ${transfer.to_warehouse}`}>{WAREHOUSE_NAME[transfer.to_warehouse]}</i></span>
        <small>{formatDateTime(transfer.created_at)} · {transfer.actor_name || 'Không rõ'} tạo</small>
      </header>
      <ul>
        {transfer.items.map((item) => (
          <li key={item.id}>
            <span>{item.product_name} <small className="muted">{item.unit}</small></span>
            {counting ? (
              <label>Thực nhận{weightOf(item) > 0 ? ' (kg)' : ''}
                <input className="input" inputMode="decimal" value={received[item.id] ?? String(weightOf(item) > 0 ? toKg(item, item.quantity) : item.quantity).replace('.', ',')} aria-label={`Thực nhận: ${item.product_name}`}
                       onChange={(e) => setReceived({ ...received, [item.id]: e.target.value.replace(/[^\d.,]/g, '').slice(0, 9) })} />
                <small>/ {shown(item, item.quantity)}</small>
              </label>
            ) : <b>{shown(item, item.quantity)}</b>}
          </li>
        ))}
      </ul>
      {transfer.note && <p className="inv-note">Ghi chú: {transfer.note}</p>}
      {error && <p className="alert error" role="alert">{error}</p>}
      {canAct && (
        <div className="inv-transfer-actions">
          {counting
            ? <button type="button" className="btn btn-primary" disabled={busy} onClick={confirmCounted}>Xác nhận số thực nhận</button>
            : <button type="button" className="btn btn-primary" disabled={busy} onClick={confirmAll}>✅ Xác nhận đã nhận đủ</button>}
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setCounting(!counting)}>{counting ? 'Nhận đủ' : 'Nhận thiếu…'}</button>
          <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={cancel}>Huỷ lệnh</button>
        </div>
      )}
    </article>
  );
}

export default function Inventory() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const canView = INVENTORY_PERMISSIONS.some((p) => can(p));
  const canReceive = can('inventory.receive');
  const canTransfer = can('inventory.transfer');
  const canCount = can('inventory.count');
  const canManageProducts = can('products.manage');

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [panel, setPanel] = useState(null);         // { type: 'receive' | 'transfer' | 'count', initial }
  const [warehouse, setWarehouse] = useState('all');
  const [query, setQuery] = useState('');
  const [onlyAlert, setOnlyAlert] = useState(false);
  const [log, setLog] = useState({ movements: [], total: 0 });
  const [logFilter, setLogFilter] = useState({ warehouse: '', group: '', product_id: '' });
  const [logBusy, setLogBusy] = useState(false);
  const logRef = useRef(null);
  const topRef = useRef(null);

  const load = useCallback(async () => {
    try { setData(await api.inventory()); setError(''); } catch (err) { setError(err.message); }
  }, []);
  const loadLog = useCallback(async (filter, offset = 0) => {
    setLogBusy(true);
    try {
      const params = Object.fromEntries(Object.entries({ ...filter, limit: LOG_PAGE, offset }).filter(([, v]) => v !== '' && v != null));
      const page = await api.inventoryMovements(params);
      setLog((cur) => ({ total: page.total, movements: offset ? [...cur.movements, ...page.movements] : page.movements }));
    } catch (err) { setError(err.message); } finally { setLogBusy(false); }
  }, []);
  useEffect(() => { if (canView) load(); }, [canView, load]);
  useEffect(() => { if (canView) loadLog(logFilter); }, [canView, logFilter, loadLog]);

  /** Sau mỗi thao tác máy chủ trả luôn bảng tồn mới: cập nhật màn hình, báo kết quả, tải lại nhật ký. */
  const applyResult = (result) => {
    setData((cur) => ({ ...cur, ...result, transfers: result.transfers || cur?.transfers || [] }));
    setMessage(result.message || 'Đã lưu.');
    setPanel(null);
    loadLog(logFilter);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const open = (type, initial = null) => {
    setMessage('');
    setPanel({ type, initial, key: Date.now() });
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const showHistory = (product) => {
    setLogFilter({ warehouse: '', group: '', product_id: String(product.id) });
    logRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const editSku = async (product) => {
    const value = window.prompt(`Mã sản phẩm của “${product.name}” (ví dụ SP014). Để trống để bỏ mã:`, product.sku || '');
    if (value === null) return;
    try {
      await api.adminUpdateProduct(product.id, { sku: value.trim() || null });
      await load();
    } catch (err) { setError(err.errors?.sku || err.message); }
  };

  const products = data?.products || [];
  const rows = useMemo(() => {
    const q = fold(query.trim());
    return products.filter((p) => {
      if (q && !fold(`${p.sku || ''} ${p.name}`).includes(q)) return false;
      if (onlyAlert && p.status.level === 'green') return false;
      // 24/11/2026: Cửa hàng Nguyễn Cao = hàng chọn "Đơn web trừ ở Nguyễn Cao" + hàng đang có ở cửa hàng;
      // Kho Bồ Sơn = chỉ hàng của Kho Bồ Sơn (đơn web trừ ở Bồ Sơn).
      if (warehouse === STORE) return p.online === STORE || p.stock_nc !== 0 || p.moving_to_nc > 0;
      if (warehouse === MAIN) return p.online === MAIN && (p.is_active || p.stock_bs !== 0 || p.moving_to_bs > 0);
      // Hàng đã ẩn khỏi cửa hàng và không còn tồn ở đâu thì không cần hiện.
      return p.is_active || p.total !== 0 || p.moving_to_nc > 0 || p.moving_to_bs > 0;
    });
  }, [products, query, onlyAlert, warehouse]);
  const alerts = useMemo(() => ({
    out: products.filter((p) => p.is_active && ['out', 'negative'].includes(p.status.code)).length,
    webLow: products.filter((p) => p.is_active && p.status.code === 'low').length,
    storeLow: products.filter((p) => p.is_active && ['store_empty', 'store_low'].includes(p.status.code)).length,
  }), [products]);
  const historyOf = logFilter.product_id ? products.find((p) => String(p.id) === logFilter.product_id) : null;

  // Kéo thả đổi thứ tự dòng trong bảng tồn (19/11/2026). Lúc sắp xếp hiện đủ mọi dòng, bộ lọc tạm tắt.
  const [sorting, setSorting] = useState(false);
  const canSort = canReceive || canTransfer || canCount || canManageProducts;
  const sort = useDragReorder({
    ids: products.map((p) => p.id),
    disabled: !sorting,
    onSave: async (ids) => {
      try {
        const result = await api.inventoryReorder(ids);
        setData((cur) => ({ ...cur, ...result, transfers: result.transfers || cur?.transfers || [] }));
      } catch (err) { setError(err.message); }
    },
  });
  const shownRows = sorting ? sort.order.map((id) => products.find((p) => p.id === id)).filter(Boolean) : rows;

  // Kho bán online của từng sản phẩm (19/11/2026): hàng đã chuyển sang cửa hàng vẫn bán trên web được.
  const canSetOnline = canTransfer || canManageProducts;
  const setOnline = async (p, code) => {
    if (code === p.online) return;
    if (!window.confirm(`Đơn web của “${p.name}” trừ hàng ở ${WAREHOUSE_NAME[code]}?\nKhách vẫn thấy tổng tồn cửa hàng + kho (${amountText(p, p.total)}). ${WAREHOUSE_NAME[code]} hết thì đơn vẫn nhận và thẻ đơn báo kế toán điều chuyển.`)) return;
    try {
      const result = await api.inventorySetOnline(p.id, code);
      setData((cur) => ({ ...cur, ...result, transfers: result.transfers || cur?.transfers || [] }));
      setMessage(result.message);
    } catch (err) { setError(err.message); }
  };

  if (!canView) {
    return (
      <div className="admin-app">
        <StaffNav />
        <div className="empty empty-page"><h1>Chưa có quyền xem kho</h1><p>Tài khoản của bạn chưa được cấp quyền Kho hàng. Vui lòng hỏi chủ cửa hàng.</p></div>
      </div>
    );
  }

  const showNc = warehouse !== MAIN;
  const showBs = warehouse !== STORE;
  return (
    <div className="admin-app inventory-app">
      <header className="admin-topbar">
        <div className="admin-brand"><img src="/logo-mark.png" alt="" width="38" height="38" /><div><strong>Kho hàng</strong><small>{user?.full_name}</small></div></div>
        <div className="admin-account">
          <button className="btn btn-ghost" onClick={() => { logout(); navigate('/'); }}>Đăng xuất</button>
        </div>
      </header>
      <StaffNav />

      <main className="inventory-main" ref={topRef}>
        {error && <p className="alert error" role="alert">{error}</p>}
        {message && <p className="alert success" role="status">{message}</p>}
        {!data ? <DashboardSkeleton label="Đang tải tồn kho…" /> : (
          <>
            <section className="inv-kpis" aria-label="Tổng quan tồn kho">
              <div className={`inv-kpi total${alerts.out ? ' warn' : ''}`}>
                <span>Tổng tồn hệ thống</span>
                <strong>{kgText(data.totals.all)}</strong>
                <small>{alerts.out ? `🔴 ${alerts.out} loại hết hàng hoặc kho thiếu cho đơn` : '🟢 An toàn'}{data.totals.all.other_units ? ` · ${formatQty(data.totals.all.other_units)} đơn vị hàng khác` : ''}</small>
              </div>
              <div className="inv-kpi store">
                <span>Cửa hàng Nguyễn Cao (bán tại quầy)</span>
                <strong>{kgText(data.totals[STORE])}</strong>
                <small>{alerts.storeLow ? `🟡 ${alerts.storeLow} loại sắp hết hoặc hết ở cửa hàng` : 'Bán tại quầy trừ ở đây, đủ hàng'}</small>
              </div>
              <div className="inv-kpi main">
                <span>Kho Bồ Sơn (đơn web trừ ở đây)</span>
                <strong>{kgText(data.totals[MAIN])}</strong>
                <small>{[alerts.webLow ? `🟡 ${alerts.webLow} loại sắp hết trên web` : '', data.in_transit ? `🔄 ${data.in_transit} lệnh đang chuyển` : ''].filter(Boolean).join(' · ') || 'Web hiện tổng cửa hàng + kho'}</small>
              </div>
            </section>

            {panel?.type === 'receive' && <ReceiptForm key={panel.key} products={products} canCost={canManageProducts} initial={panel.initial} onSaved={applyResult} onClose={() => setPanel(null)}
                                                    onProductAdded={(result) => { setData((cur) => ({ ...cur, ...result, transfers: cur?.transfers || [] })); setMessage(result.message); }} />}
            {panel?.type === 'transfer' && <TransferForm key={panel.key} products={products} initial={panel.initial} onSaved={applyResult} onClose={() => setPanel(null)} />}
            {panel?.type === 'count' && <CountForm key={panel.key} products={products} initialWarehouse={panel.initial?.warehouse || STORE} onSaved={applyResult} onClose={() => setPanel(null)} />}

            {!panel && (canReceive || canTransfer || canCount) && (
              <section className="inv-actions" aria-label="Thao tác kho">
                {canReceive && <button type="button" onClick={() => open('receive')}><span aria-hidden="true">📥</span><strong>Nhập kho</strong><small>Công gạo về Bồ Sơn, hàng mới về cửa hàng</small></button>}
                {canTransfer && <button type="button" onClick={() => open('transfer')}><span aria-hidden="true">🔄</span><strong>Điều chuyển hàng</strong><small>Từ Kho Bồ Sơn về Nguyễn Cao hoặc ngược lại</small></button>}
                {canCount && <button type="button" onClick={() => open('count', { warehouse: warehouse === MAIN ? MAIN : STORE })}><span aria-hidden="true">📋</span><strong>Kiểm kê</strong><small>Chốt sổ cuối ngày; bán hàng thì máy tự trừ</small></button>}
              </section>
            )}

            {data.transfers?.length > 0 && (
              <section className="inv-section inv-transit" aria-label="Lệnh đang chuyển">
                <h2>🔄 Đang chuyển ({data.transfers.length} lệnh) <small>Bên nhận đếm hàng rồi bấm xác nhận</small></h2>
                <div className="inv-transfers">
                  {data.transfers.map((t) => <TransferCard key={t.id} transfer={t} canAct={canTransfer} onDone={applyResult} products={products} />)}
                </div>
              </section>
            )}

            <section className="inv-section" aria-label="Bảng tồn kho">
              <div className="inv-toolbar">
                <div className="quick-filters" role="group" aria-label="Lọc theo kho">
                  {[['all', 'Tất cả hệ thống'], [STORE, 'Cửa hàng Nguyễn Cao'], [MAIN, 'Kho Bồ Sơn']].map(([code, label]) => (
                    <button key={code} type="button" className={warehouse === code ? 'active' : ''} onClick={() => setWarehouse(code)}>{label}</button>
                  ))}
                </div>
                <input className="input inv-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm theo tên hoặc mã" aria-label="Tìm loại hàng" disabled={sorting} />
                <label className="checkbox-label"><input type="checkbox" checked={onlyAlert} onChange={(e) => setOnlyAlert(e.target.checked)} disabled={sorting} /> Chỉ hàng cần chú ý</label>
                {canSort && (
                  <button type="button" className={`btn ${sorting ? 'btn-primary' : 'btn-secondary'} inv-sort-toggle`} aria-pressed={sorting} onClick={() => setSorting(!sorting)}>
                    {sorting ? '✓ Xong sắp xếp' : '↕ Sắp xếp thứ tự'}
                  </button>
                )}
              </div>
              {sorting && <p className="alert info inv-sort-hint" role="status">Bấm nút <b>▲</b> / <b>▼</b> ở đầu dòng để đưa hàng lên / xuống (hoặc kéo tay nắm ⠿). Đổi là lưu ngay. Thứ tự này chỉ áp dụng cho bảng kho, không đổi thứ tự trên web.</p>}
              <div className="table-scroll">
                <table className="data-table inv-table">
                  <thead>
                    <tr>
                      {sorting && <th aria-label="Kéo để đổi thứ tự" />}
                      <th>Mã SP</th><th>Tên sản phẩm</th>
                      {showNc && showBs && <th className="inv-total-col">Tổng tồn</th>}
                      {showNc && <th className="wh-col KH_NC">Tồn Nguyễn Cao</th>}{showBs && <th className="wh-col KH_BS">Tồn Bồ Sơn</th>}
                      <th title="Đơn khách đặt trên web và đơn kế toán tạo trừ hàng ở kho này">Đơn web trừ ở</th><th>Đang chuyển</th><th>Cảnh báo</th><th>Thao tác nhanh</th>
                    </tr>
                  </thead>
                  <tbody ref={sort.listRef}>
                    {shownRows.map((p) => {
                      const moving = (showNc ? p.moving_to_nc : 0) + (showBs ? p.moving_to_bs : 0);
                      const webAtStore = p.online === STORE;
                      const fromOther = webAtStore ? MAIN : STORE;
                      const otherStock = webAtStore ? p.stock_bs : p.stock_nc;
                      const movingToWeb = webAtStore ? p.moving_to_nc : p.moving_to_bs;
                      return (
                        <tr key={p.id} className={`inv-row-${p.status.level}${p.is_active ? '' : ' inv-hidden'}${sort.dragId === p.id ? ' dragging' : ''}`}>
                          {sorting && (
                            <td className="inv-grip-cell">
                              <span className="inv-move">
                                <button type="button" className="inv-move-btn" aria-label={`Đưa ${p.name} lên`} title="Lên"
                                        disabled={sort.order[0] === p.id} onClick={() => sort.move(p.id, -1)}>▲</button>
                                <button type="button" className="group-grip" title="Kéo để đổi thứ tự" aria-label={`Kéo để đổi thứ tự ${p.name}. Hoặc bấm mũi tên lên, xuống.`}
                                        onPointerDown={(event) => sort.start(event, p.id)} onKeyDown={(event) => sort.keyMove(event, p.id)}>⠿</button>
                                <button type="button" className="inv-move-btn" aria-label={`Đưa ${p.name} xuống`} title="Xuống"
                                        disabled={sort.order[sort.order.length - 1] === p.id} onClick={() => sort.move(p.id, 1)}>▼</button>
                              </span>
                            </td>
                          )}
                          <td data-label="Mã SP">
                            {canManageProducts
                              ? <button type="button" className="link-button inv-sku-edit" onClick={() => editSku(p)}>{p.sku || '+ mã'}</button>
                              : p.sku || '—'}
                          </td>
                          <td data-label="Tên"><strong>{p.name}</strong> <small className="muted">{p.unit}{p.is_active ? '' : ' · đang ẩn'}</small></td>
                          {showNc && showBs && <td data-label="Tổng tồn" className="inv-num inv-total-col"><strong>{amountText(p, p.total)}</strong></td>}
                          {showNc && <td data-label="Tồn Nguyễn Cao" className={`inv-num${p.stock_nc < 0 ? ' inv-neg' : p.stock_nc <= data.low_stock_at ? ' inv-low' : ''}`}>{amountText(p, p.stock_nc)}</td>}
                          {showBs && <td data-label="Tồn Bồ Sơn" className={`inv-num${p.stock_bs < 0 ? ' inv-neg' : p.stock_bs <= data.low_stock_at ? ' inv-low' : ''}`}>{amountText(p, p.stock_bs)}</td>}
                          <td data-label="Bán web từ">
                            {canSetOnline ? (
                              <select className={`input inv-online ${p.online}`} value={p.online} onChange={(e) => setOnline(p, e.target.value)} aria-label={`Bán web ${p.name} từ kho`}>
                                <option value={MAIN}>Bồ Sơn</option>
                                <option value={STORE}>Nguyễn Cao</option>
                              </select>
                            ) : <i className={`wh-chip ${p.online}`}>{WAREHOUSE_SHORT[p.online]}</i>}
                          </td>
                          <td data-label="Đang chuyển" className={`inv-num${moving > 0 ? '' : ' inv-none-mobile'}`}>
                            {moving > 0 ? <span className="inv-moving">{amountText(p, moving)}{showNc && showBs ? ` ➔ ${p.moving_to_nc ? WAREHOUSE_SHORT[STORE] : WAREHOUSE_SHORT[MAIN]}` : ''}</span> : '—'}
                          </td>
                          <td data-label="Cảnh báo"><span className={`inv-status ${p.status.level}`}>{p.status.label}</span></td>
                          <td data-label="Thao tác" className="inv-row-actions">
                            <button type="button" className="link-button" onClick={() => showHistory(p)}>Xem lịch sử</button>
                            {canTransfer && p.stock_bs >= 1 && ['store_empty', 'store_low'].includes(p.status.code) && !p.moving_to_nc && (
                              <button type="button" className="link-button" onClick={() => open('transfer', { from: MAIN, product_id: p.id })}>Chuyển từ Bồ Sơn</button>
                            )}
                            {canTransfer && otherStock >= 1 && ['web_out', 'low'].includes(p.status.code) && !movingToWeb && (
                              <button type="button" className="link-button" onClick={() => open('transfer', { from: fromOther, product_id: p.id })}>
                                {fromOther === STORE ? 'Chuyển từ cửa hàng' : 'Chuyển từ Bồ Sơn'}
                              </button>
                            )}
                            {canReceive && (p.status.code === 'out' || (['web_out', 'low'].includes(p.status.code) && otherStock <= 0)) && (
                              <button type="button" className="link-button" onClick={() => open('receive', { kind: 'cong-gao', product_id: p.id })}>Nhập kho</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {!shownRows.length && <tr><td colSpan={10} className="muted">Không có loại hàng nào khớp bộ lọc.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="field-help">
                Khách thấy trên web <b>tổng tồn</b> cửa hàng + kho. Cột "Đơn web trừ ở": đơn khách đặt online trừ hàng ở kho đó (mặc định Bồ Sơn); kho đó hết thì đơn vẫn nhận,
                thẻ đơn báo kế toán điều chuyển từ nơi kia sang hoặc để shipper qua cửa hàng lấy. Bán tại quầy trừ ở Cửa hàng Nguyễn Cao. Đơn kế toán tạo trừ ở kho chọn khi tạo đơn.
                "Sắp hết" khi tổng còn từ {data.low_stock_at} trở xuống.
              </p>
            </section>

            <section className="inv-section" ref={logRef} aria-label="Nhật ký kho">
              <h2>📒 Nhật ký kho <small>Ai làm gì, ở kho nào, bao nhiêu</small></h2>
              <div className="inv-toolbar">
                <select className="input" value={logFilter.warehouse} onChange={(e) => setLogFilter({ ...logFilter, warehouse: e.target.value })} aria-label="Lọc nhật ký theo kho">
                  <option value="">Cả hai kho</option>
                  <option value={STORE}>{WAREHOUSE_NAME[STORE]}</option>
                  <option value={MAIN}>{WAREHOUSE_NAME[MAIN]}</option>
                </select>
                <select className="input" value={logFilter.group} onChange={(e) => setLogFilter({ ...logFilter, group: e.target.value })} aria-label="Lọc nhật ký theo việc">
                  {LOG_GROUPS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                {historyOf && (
                  <span className="inv-history-of">Lịch sử của <b>{historyOf.name}</b>
                    <button type="button" className="link-button" onClick={() => setLogFilter({ ...logFilter, product_id: '' })}>Xem tất cả</button>
                  </span>
                )}
              </div>
              <ol className="inv-log">
                {groupMovements(log.movements).map((entry) => (
                  <li key={entry.id} className={`inv-log-entry ${entry.quantity < 0 || entry.lines.some((l) => l.quantity < 0) ? 'out' : 'in'}`}>
                    <p className="inv-log-head"><time>{formatDateTime(entry.created_at)}</time> — <strong>{entry.actor_name || (entry.kind === 'order' ? 'Khách đặt trên web' : 'Hệ thống')}</strong></p>
                    <p className="inv-log-what"><b>{entry.kind_label}</b> <i className={`wh-chip ${entry.warehouse}`}>{entry.warehouse_name}</i>{entry.ref_code ? ` · ${entry.ref_code}` : ''}</p>
                    <ul>
                      {entry.lines.map((line) => (
                        <li key={line.id}>
                          {line.product_name} <small className="muted">{line.unit}</small>: <b className={line.quantity < 0 ? 'price-up' : 'price-down'}>{signed(line.quantity)}</b>
                          <span className="muted"> → tồn {formatQty(line.balance_after)}</span>
                          {line.note && line.note !== entry.lines[0].note && <small className="inv-note"> · {line.note}</small>}
                        </li>
                      ))}
                    </ul>
                    {entry.lines[0].note && <p className="inv-note">{entry.lines[0].note}</p>}
                  </li>
                ))}
                {!log.movements.length && !logBusy && <li className="muted">Chưa có biến động nào khớp bộ lọc.</li>}
              </ol>
              {log.movements.length < log.total && (
                <button type="button" className="btn btn-secondary" disabled={logBusy} onClick={() => loadLog(logFilter, log.movements.length)}>
                  {logBusy ? 'Đang tải…' : `Xem thêm (còn ${formatQty(log.total - log.movements.length)} dòng)`}
                </button>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
