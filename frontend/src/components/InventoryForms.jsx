import { useMemo, useState } from 'react';
import { api } from '../api';

export const STORE = 'KH_NC';
export const MAIN = 'KH_BS';
export const WAREHOUSE_NAME = { [STORE]: 'Cửa hàng Nguyễn Cao', [MAIN]: 'Kho Bồ Sơn' };
export const WAREHOUSE_SHORT = { [STORE]: 'Nguyễn Cao', [MAIN]: 'Bồ Sơn' };
export const stockOf = (product, warehouse) => (warehouse === MAIN ? product.stock_bs : product.stock_nc);
export const formatQty = (n) => Number(n || 0).toLocaleString('vi-VN');
export const productLabel = (p) => `${p.sku ? `${p.sku} · ` : ''}${p.name} · ${p.unit}`;
const fold = (value) => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
const digits = (value) => String(value).replace(/\D/g, '').slice(0, 6);
const kgOf = (product, quantity) => (product?.weight_kg > 0 ? product.weight_kg * quantity : 0);

function FormShell({ title, onClose, children, onSubmit }) {
  return (
    <form className="form-card flat inv-form" onSubmit={onSubmit} noValidate>
      <div className="manual-order-head">
        <h2>{title}</h2>
        <button type="button" className="icon-close" onClick={onClose} aria-label="Đóng">×</button>
      </div>
      {children}
    </form>
  );
}

/** Ô chọn loại hàng: không lặp lại loại đã chọn ở dòng khác. */
function ProductSelect({ products, value, taken, onChange, label, hint }) {
  return (
    <select className="input" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Chọn loại hàng —</option>
      {products.filter((p) => String(p.id) === value || !taken.has(String(p.id))).map((p) => (
        <option key={p.id} value={p.id}>{productLabel(p)}{hint ? ` · ${hint(p)}` : ''}</option>
      ))}
    </select>
  );
}

/**
 * Phiếu nhập kho. Hai chế độ:
 *  - Nhập công gạo (kế toán): mặc định về Kho Bồ Sơn, có thể ghi luôn phần giao thẳng Cửa hàng Nguyễn Cao.
 *  - Nhập hàng cửa hàng: về Cửa hàng Nguyễn Cao (hàng lẻ từ nhà cung cấp phụ, đồ khô, miến, bột…).
 */
export function ReceiptForm({ products, canCost, initial = null, onSaved, onClose }) {
  const [kind, setKind] = useState(initial?.kind || 'cong-gao');
  const [info, setInfo] = useState({ source: '', vehicle: '', note: '' });
  const [rows, setRows] = useState(() => [{ product_id: initial?.product_id ? String(initial.product_id) : '', bs: '', nc: '', cost: '' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [String(p.id), p])), [products]);
  const taken = new Set(rows.map((r) => r.product_id).filter(Boolean));
  const setRow = (index, patch) => setRows((cur) => cur.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const shopOnly = kind === 'cua-hang';
  const filled = rows.filter((r) => r.product_id && (Number(r.bs) > 0 || Number(r.nc) > 0));
  const sum = (key) => filled.reduce((total, r) => total + (Number(r[key]) || 0), 0);
  const kg = filled.reduce((total, r) => total + kgOf(byId[r.product_id], (Number(r.bs) || 0) + (Number(r.nc) || 0)), 0);

  const save = async (event) => {
    event.preventDefault();
    if (!filled.length) { setError('Chọn loại hàng và nhập số lượng cho ít nhất một dòng.'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await api.inventoryReceive({
        kind, source: info.source.trim() || null, vehicle: shopOnly ? null : info.vehicle.trim() || null, note: info.note.trim() || null,
        items: filled.map((r) => ({
          product_id: Number(r.product_id), quantity_bs: shopOnly ? 0 : Number(r.bs) || 0, quantity_nc: Number(r.nc) || 0,
          ...(canCost && r.cost !== '' ? { cost_price: Number(r.cost) } : {}),
        })),
      });
      onSaved(result);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <FormShell title="📥 Tạo phiếu nhập kho" onClose={onClose} onSubmit={save}>
      <div className="customer-kind" role="group" aria-label="Loại phiếu nhập">
        <button type="button" className={!shopOnly ? 'active' : ''} onClick={() => setKind('cong-gao')}>Nhập công gạo<small>về Kho Bồ Sơn, có thể giao thẳng một phần cho cửa hàng</small></button>
        <button type="button" className={shopOnly ? 'active' : ''} onClick={() => setKind('cua-hang')}>Nhập hàng cửa hàng<small>về Cửa hàng Nguyễn Cao: hàng lẻ, đồ khô, miến, bột…</small></button>
      </div>
      <div className="about-admin-row">
        <label>{shopOnly ? 'Nhà cung cấp' : 'Nguồn nhập'} <small className="optional">không bắt buộc</small>
          <input className="input" value={info.source} maxLength={120} onChange={(e) => setInfo({ ...info, source: e.target.value })} placeholder={shopOnly ? 'VD: NCC miến dong' : 'VD: nhà máy, tên công gạo'} />
        </label>
        {!shopOnly && (
          <label>Số xe / số container <small className="optional">không bắt buộc</small>
            <input className="input" value={info.vehicle} maxLength={80} onChange={(e) => setInfo({ ...info, vehicle: e.target.value })} placeholder="VD: 99C-123.45" />
          </label>
        )}
        <label>Ghi chú <small className="optional">không bắt buộc</small>
          <input className="input" value={info.note} maxLength={300} onChange={(e) => setInfo({ ...info, note: e.target.value })} />
        </label>
      </div>

      <fieldset className="manual-lines inv-lines">
        <legend>Hàng nhập</legend>
        {rows.map((row, index) => (
          <div key={index} className={`inv-line${shopOnly ? ' one' : ''}${canCost ? ' with-cost' : ''}`}>
            <ProductSelect products={products} value={row.product_id} taken={taken} label={`Loại hàng nhập ${index + 1}`}
                           onChange={(value) => setRow(index, { product_id: value })} />
            {!shopOnly && (
              <label className="inv-qty">Vào Bồ Sơn
                <input className="input" inputMode="numeric" value={row.bs} disabled={!row.product_id} placeholder="0"
                       onChange={(e) => setRow(index, { bs: digits(e.target.value) })} aria-label={`Số nhập vào Bồ Sơn ${index + 1}`} />
              </label>
            )}
            <label className="inv-qty">{shopOnly ? 'Số lượng' : 'Giao thẳng Nguyễn Cao'}
              <input className="input" inputMode="numeric" value={row.nc} disabled={!row.product_id} placeholder="0"
                     onChange={(e) => setRow(index, { nc: digits(e.target.value) })} aria-label={`Số nhập vào Nguyễn Cao ${index + 1}`} />
            </label>
            {canCost && (
              <label className="inv-qty">Giá nhập
                <input className="input" inputMode="numeric" value={row.cost} disabled={!row.product_id} placeholder="để trống"
                       onChange={(e) => setRow(index, { cost: String(e.target.value).replace(/\D/g, '').slice(0, 9) })} aria-label={`Giá nhập ${index + 1}`} />
              </label>
            )}
            {rows.length > 1 && <button type="button" className="icon-close" aria-label="Bỏ dòng" onClick={() => setRows((cur) => cur.filter((_, i) => i !== index))}>×</button>}
          </div>
        ))}
        <button type="button" className="link-button" onClick={() => setRows((cur) => [...cur, { product_id: '', bs: '', nc: '', cost: '' }])}>+ Thêm loại hàng</button>
        {filled.length > 0 && (
          <p className="inv-summary">
            {!shopOnly && <>Vào Bồ Sơn: <b>{formatQty(sum('bs'))}</b> · </>}Vào Nguyễn Cao: <b>{formatQty(sum('nc'))}</b>
            {kg > 0 && <> · Tổng khoảng <b>{formatQty(kg)} kg</b></>}
          </p>
        )}
      </fieldset>
      {error && <p className="alert error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu phiếu nhập'}</button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Huỷ</button>
      </div>
    </FormShell>
  );
}

/**
 * Lệnh điều chuyển giữa hai kho. Bấm gửi: kho xuất trừ ngay; kho nhận chỉ cộng khi bên nhận bấm xác nhận.
 */
export function TransferForm({ products, initial = null, onSaved, onClose }) {
  const [from, setFrom] = useState(initial?.from || MAIN);
  const to = from === MAIN ? STORE : MAIN;
  const [note, setNote] = useState('');
  const [rows, setRows] = useState(() => [{ product_id: initial?.product_id ? String(initial.product_id) : '', quantity: '' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [String(p.id), p])), [products]);
  const taken = new Set(rows.map((r) => r.product_id).filter(Boolean));
  const setRow = (index, patch) => setRows((cur) => cur.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  // Chỉ chọn được hàng đang có ở kho xuất.
  const available = products.filter((p) => stockOf(p, from) > 0);
  const filled = rows.filter((r) => r.product_id && Number(r.quantity) > 0);
  const over = filled.find((r) => Number(r.quantity) > stockOf(byId[r.product_id], from));

  const save = async (event) => {
    event.preventDefault();
    if (!filled.length) { setError('Chọn loại hàng và nhập số lượng cần chuyển.'); return; }
    if (over) { setError(`“${byId[over.product_id].name}” ở ${WAREHOUSE_NAME[from]} chỉ còn ${formatQty(stockOf(byId[over.product_id], from))} ${byId[over.product_id].unit}.`); return; }
    setBusy(true);
    setError('');
    try {
      onSaved(await api.inventoryTransfer({
        from, to, note: note.trim() || null,
        items: filled.map((r) => ({ product_id: Number(r.product_id), quantity: Number(r.quantity) })),
      }));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <FormShell title="🔄 Điều chuyển hàng giữa hai kho" onClose={onClose} onSubmit={save}>
      <div className="customer-kind" role="group" aria-label="Chiều chuyển">
        <button type="button" className={from === MAIN ? 'active' : ''} onClick={() => { setFrom(MAIN); setRows([{ product_id: '', quantity: '' }]); }}>Kho Bồ Sơn ➔ Cửa hàng Nguyễn Cao<small>khi cửa hàng sắp hết gạo</small></button>
        <button type="button" className={from === STORE ? 'active' : ''} onClick={() => { setFrom(STORE); setRows([{ product_id: '', quantity: '' }]); }}>Cửa hàng Nguyễn Cao ➔ Kho Bồ Sơn<small>trả hàng về kho tổng</small></button>
      </div>
      <fieldset className="manual-lines inv-lines">
        <legend>Hàng chuyển</legend>
        {!available.length && <p className="muted">{WAREHOUSE_NAME[from]} hiện không có hàng để chuyển.</p>}
        {rows.map((row, index) => {
          const product = byId[row.product_id];
          const tooMany = product && Number(row.quantity) > stockOf(product, from);
          return (
            <div key={index} className="inv-line one">
              <ProductSelect products={available} value={row.product_id} taken={taken} label={`Loại hàng chuyển ${index + 1}`}
                             hint={(p) => `còn ${formatQty(stockOf(p, from))}`} onChange={(value) => setRow(index, { product_id: value })} />
              <label className="inv-qty">Số lượng chuyển
                <input className="input" inputMode="numeric" value={row.quantity} disabled={!row.product_id} placeholder="0" aria-invalid={!!tooMany}
                       onChange={(e) => setRow(index, { quantity: digits(e.target.value) })} aria-label={`Số lượng chuyển ${index + 1}`} />
                {product && <small className={tooMany ? 'err' : ''}>{WAREHOUSE_SHORT[from]} còn {formatQty(stockOf(product, from))} {product.unit}</small>}
              </label>
              {rows.length > 1 && <button type="button" className="icon-close" aria-label="Bỏ dòng" onClick={() => setRows((cur) => cur.filter((_, i) => i !== index))}>×</button>}
            </div>
          );
        })}
        <button type="button" className="link-button" onClick={() => setRows((cur) => [...cur, { product_id: '', quantity: '' }])}>+ Thêm loại hàng</button>
      </fieldset>
      <label>Ghi chú <small className="optional">không bắt buộc</small>
        <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="VD: xe anh Tuấn chở chuyến chiều" />
      </label>
      <p className="field-help">Bấm gửi là <b>{WAREHOUSE_NAME[from]}</b> bị trừ ngay. <b>{WAREHOUSE_NAME[to]}</b> chỉ được cộng khi người nhận đếm đủ và bấm "Xác nhận đã nhận".</p>
      {error && <p className="alert error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi lệnh chuyển'}</button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Huỷ</button>
      </div>
    </FormShell>
  );
}

/**
 * Kiểm kê / đặt tồn đầu kỳ: gõ số ĐẾM ĐƯỢC ở kho, máy tự tính chênh lệch. Chỉ dòng có gõ số mới được lưu.
 */
export function CountForm({ products, initialWarehouse = STORE, onSaved, onClose }) {
  const [warehouse, setWarehouse] = useState(initialWarehouse);
  const [kind, setKind] = useState('count');
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [counted, setCounted] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const q = fold(query.trim());
  const shown = products.filter((p) => !q || fold(`${p.sku || ''} ${p.name}`).includes(q));
  const changes = products
    .filter((p) => counted[p.id] !== undefined && counted[p.id] !== '' && Number(counted[p.id]) !== stockOf(p, warehouse))
    .map((p) => ({ product_id: p.id, counted: Number(counted[p.id]) }));

  const save = async (event) => {
    event.preventDefault();
    if (!changes.length) { setError('Chưa có dòng nào khác với số trên máy. Gõ số đếm được vào ô của loại hàng cần sửa.'); return; }
    if (!window.confirm(`Cập nhật tồn ${WAREHOUSE_NAME[warehouse]} cho ${changes.length} loại hàng theo số vừa đếm?`)) return;
    setBusy(true);
    setError('');
    try {
      onSaved(await api.inventoryCount({ warehouse, kind, note: note.trim() || null, items: changes }));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <FormShell title="📋 Kiểm kê kho" onClose={onClose} onSubmit={save}>
      <div className="customer-kind" role="group" aria-label="Kho kiểm kê">
        {[STORE, MAIN].map((code) => (
          <button key={code} type="button" className={warehouse === code ? 'active' : ''} onClick={() => { setWarehouse(code); setCounted({}); }}>
            {WAREHOUSE_NAME[code]}<small>{code === STORE ? 'kho bán lẻ, bán web, bán tại quầy' : 'kho tổng, hàng công và hàng sỉ'}</small>
          </button>
        ))}
      </div>
      <div className="about-admin-row">
        <label>Lý do
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="count">Kiểm kê (chốt sổ, sửa số lệch)</option>
            <option value="opening">Tồn đầu kỳ (lần đầu nhập số tồn thật)</option>
          </select>
        </label>
        <label>Ghi chú <small className="optional">không bắt buộc</small>
          <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="VD: kiểm cuối ngày 13/11" />
        </label>
        <label>Tìm loại hàng
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tên hoặc mã" />
        </label>
      </div>
      <div className="table-scroll inv-count">
        <table className="data-table">
          <thead><tr><th>Loại hàng</th><th>Trên máy</th><th>Đếm được</th><th>Chênh lệch</th></tr></thead>
          <tbody>
            {shown.map((p) => {
              const current = stockOf(p, warehouse);
              const value = counted[p.id] ?? '';
              const diff = value === '' ? 0 : Number(value) - current;
              return (
                <tr key={p.id} className={diff ? 'row-changed' : ''}>
                  <td>{p.sku && <small className="inv-sku">{p.sku}</small>} {p.name} <small className="muted">{p.unit}</small></td>
                  <td className={current < 0 ? 'inv-neg' : ''}>{formatQty(current)}</td>
                  <td><input className="input inv-count-input" inputMode="numeric" value={value} placeholder={String(Math.max(current, 0))}
                             onChange={(e) => setCounted({ ...counted, [p.id]: digits(e.target.value) })} aria-label={`Số đếm được: ${p.name}`} /></td>
                  <td className={diff > 0 ? 'price-down' : diff < 0 ? 'price-up' : 'muted'}>{diff ? `${diff > 0 ? '+' : '−'}${formatQty(Math.abs(diff))}` : '—'}</td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={4} className="muted">Không tìm thấy loại hàng nào.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="field-help">Chỉ những dòng có gõ số và khác số trên máy mới được lưu. Mỗi dòng thay đổi ghi vào nhật ký kho kèm tên người kiểm.</p>
      {error && <p className="alert error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu…' : `Lưu kiểm kê${changes.length ? ` (${changes.length} dòng thay đổi)` : ''}`}</button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Huỷ</button>
      </div>
    </FormShell>
  );
}
