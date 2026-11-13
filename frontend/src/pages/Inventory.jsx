import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatDateTime } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import StaffNav from '../components/StaffNav.jsx';
import {
  CountForm, MAIN, ReceiptForm, STORE, TransferForm, WAREHOUSE_NAME, WAREHOUSE_SHORT, formatQty,
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
function TransferCard({ transfer, canAct, onDone }) {
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
    const items = transfer.items.map((i) => ({ item_id: i.id, received: received[i.id] === undefined || received[i.id] === '' ? i.quantity : Number(received[i.id]) }));
    const missing = items.reduce((sum, row, index) => sum + (transfer.items[index].quantity - row.received), 0);
    if (items.some((row, index) => row.received > transfer.items[index].quantity)) { setError('Số thực nhận không được lớn hơn số đã chuyển.'); return; }
    if (!window.confirm(missing > 0 ? `Xác nhận nhận THIẾU ${missing} so với lệnh ${transfer.code}? Phần thiếu sẽ được ghi lại.` : `Xác nhận nhận đủ hàng của lệnh ${transfer.code}?`)) return;
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
        <span>{WAREHOUSE_NAME[transfer.from_warehouse]} ➔ {WAREHOUSE_NAME[transfer.to_warehouse]}</span>
        <small>{formatDateTime(transfer.created_at)} · {transfer.actor_name || 'Không rõ'} tạo</small>
      </header>
      <ul>
        {transfer.items.map((item) => (
          <li key={item.id}>
            <span>{item.product_name} <small className="muted">{item.unit}</small></span>
            {counting ? (
              <label>Thực nhận
                <input className="input" inputMode="numeric" value={received[item.id] ?? String(item.quantity)} aria-label={`Thực nhận: ${item.product_name}`}
                       onChange={(e) => setReceived({ ...received, [item.id]: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
                <small>/ {formatQty(item.quantity)}</small>
              </label>
            ) : <b>{formatQty(item.quantity)}</b>}
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
      if (warehouse === STORE) return p.stock_nc !== 0 || p.moving_to_nc > 0;
      if (warehouse === MAIN) return p.stock_bs !== 0 || p.moving_to_bs > 0;
      // Hàng đã ẩn khỏi cửa hàng và không còn tồn ở đâu thì không cần hiện.
      return p.is_active || p.total !== 0 || p.moving_to_nc > 0 || p.moving_to_bs > 0;
    });
  }, [products, query, onlyAlert, warehouse]);
  const alerts = useMemo(() => ({
    out: products.filter((p) => p.is_active && ['out', 'negative'].includes(p.status.code)).length,
    low: products.filter((p) => p.is_active && ['low', 'main_only'].includes(p.status.code)).length,
  }), [products]);
  const historyOf = logFilter.product_id ? products.find((p) => String(p.id) === logFilter.product_id) : null;

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
        {!data ? <div className="loading-state" role="status"><span></span>Đang tải tồn kho…</div> : (
          <>
            <section className="inv-kpis" aria-label="Tổng quan tồn kho">
              <div className={`inv-kpi total${alerts.out ? ' warn' : ''}`}>
                <span>Tổng tồn hệ thống</span>
                <strong>{kgText(data.totals.all)}</strong>
                <small>{alerts.out ? `🔴 ${alerts.out} loại hết hàng hoặc âm kho` : '🟢 An toàn'}{data.totals.all.other_units ? ` · ${formatQty(data.totals.all.other_units)} đơn vị hàng khác` : ''}</small>
              </div>
              <div className="inv-kpi store">
                <span>Cửa hàng Nguyễn Cao</span>
                <strong>{kgText(data.totals[STORE])}</strong>
                <small>{alerts.low ? `🟡 ${alerts.low} loại sắp hết hoặc chưa có ở cửa hàng` : 'Đang bán lẻ, đủ hàng'}</small>
              </div>
              <div className="inv-kpi main">
                <span>Kho Bồ Sơn (kho tổng)</span>
                <strong>{kgText(data.totals[MAIN])}</strong>
                <small>{data.in_transit ? `🔄 ${data.in_transit} lệnh đang chuyển` : 'Hàng công lớn và hàng sỉ'}</small>
              </div>
            </section>

            {panel?.type === 'receive' && <ReceiptForm key={panel.key} products={products} canCost={canManageProducts} initial={panel.initial} onSaved={applyResult} onClose={() => setPanel(null)} />}
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
              <section className="inv-section" aria-label="Lệnh đang chuyển">
                <h2>🔄 Đang chuyển ({data.transfers.length} lệnh) <small>Bên nhận đếm hàng rồi bấm xác nhận</small></h2>
                <div className="inv-transfers">
                  {data.transfers.map((t) => <TransferCard key={t.id} transfer={t} canAct={canTransfer} onDone={applyResult} />)}
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
                <input className="input inv-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm theo tên hoặc mã" aria-label="Tìm loại hàng" />
                <label className="checkbox-label"><input type="checkbox" checked={onlyAlert} onChange={(e) => setOnlyAlert(e.target.checked)} /> Chỉ hàng cần chú ý</label>
              </div>
              <div className="table-scroll">
                <table className="data-table inv-table">
                  <thead>
                    <tr>
                      <th>Mã SP</th><th>Tên sản phẩm</th>
                      {showNc && <th>Tồn Nguyễn Cao</th>}{showBs && <th>Tồn Bồ Sơn</th>}
                      {showNc && showBs && <th>Tổng tồn</th>}
                      <th>Đang chuyển</th><th>Cảnh báo</th><th>Thao tác nhanh</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => {
                      const moving = (showNc ? p.moving_to_nc : 0) + (showBs ? p.moving_to_bs : 0);
                      return (
                        <tr key={p.id} className={p.is_active ? '' : 'inv-hidden'}>
                          <td data-label="Mã SP">
                            {canManageProducts
                              ? <button type="button" className="link-button inv-sku-edit" onClick={() => editSku(p)}>{p.sku || '+ mã'}</button>
                              : p.sku || '—'}
                          </td>
                          <td data-label="Tên"><strong>{p.name}</strong> <small className="muted">{p.unit}{p.is_active ? '' : ' · đang ẩn'}</small></td>
                          {showNc && <td data-label="Tồn Nguyễn Cao" className={`inv-num${p.stock_nc < 0 ? ' inv-neg' : p.stock_nc <= data.low_stock_at ? ' inv-low' : ''}`}>{formatQty(p.stock_nc)}</td>}
                          {showBs && <td data-label="Tồn Bồ Sơn" className={`inv-num${p.stock_bs < 0 ? ' inv-neg' : ''}`}>{formatQty(p.stock_bs)}</td>}
                          {showNc && showBs && <td data-label="Tổng tồn" className="inv-num"><strong>{formatQty(p.total)}</strong></td>}
                          <td data-label="Đang chuyển" className={`inv-num${moving > 0 ? '' : ' inv-none-mobile'}`}>
                            {moving > 0 ? <span className="inv-moving">{formatQty(moving)}{showNc && showBs ? ` ➔ ${p.moving_to_nc ? WAREHOUSE_SHORT[STORE] : WAREHOUSE_SHORT[MAIN]}` : ''}</span> : '—'}
                          </td>
                          <td data-label="Cảnh báo"><span className={`inv-status ${p.status.level}`}>{p.status.label}</span></td>
                          <td data-label="Thao tác" className="inv-row-actions">
                            <button type="button" className="link-button" onClick={() => showHistory(p)}>Xem lịch sử</button>
                            {canTransfer && p.stock_bs > 0 && ['low', 'main_only', 'negative'].includes(p.status.code) && !p.moving_to_nc && (
                              <button type="button" className="link-button" onClick={() => open('transfer', { from: MAIN, product_id: p.id })}>Chuyển từ Bồ Sơn</button>
                            )}
                            {canReceive && (p.status.code === 'out' || (p.status.code === 'low' && p.stock_bs <= 0)) && (
                              <button type="button" className="link-button" onClick={() => open('receive', { kind: 'cong-gao', product_id: p.id })}>Nhập kho</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {!rows.length && <tr><td colSpan={8} className="muted">Không có loại hàng nào khớp bộ lọc.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="field-help">
                Tồn Nguyễn Cao là số khách thấy trên web. Đơn web, đơn khách lẻ và bán tại quầy trừ ở Nguyễn Cao; đơn khách buôn trừ ở kho nhân viên chọn khi tạo đơn.
                "Sắp hết" khi Nguyễn Cao còn từ {data.low_stock_at} trở xuống.
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
                    <p className="inv-log-what"><b>{entry.kind_label}</b> · {entry.warehouse_name}{entry.ref_code ? ` · ${entry.ref_code}` : ''}</p>
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
