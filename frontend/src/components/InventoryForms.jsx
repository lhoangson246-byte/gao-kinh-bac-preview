import { useMemo, useState } from 'react';
import { api } from '../api';

export const STORE = 'KH_NC';
export const MAIN = 'KH_BS';
export const WAREHOUSE_NAME = { [STORE]: 'Cửa hàng Nguyễn Cao', [MAIN]: 'Kho Bồ Sơn' };
export const WAREHOUSE_SHORT = { [STORE]: 'Nguyễn Cao', [MAIN]: 'Bồ Sơn' };
export const stockOf = (product, warehouse) => (warehouse === MAIN ? product.stock_bs : product.stock_nc);
export const formatQty = (n) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
/** Tên trong ô chọn: chỉ tên (kèm mã nếu có). Trùng tên với loại khác thì ghi thêm quy cách để khỏi nhầm. */
export const productLabel = (p, all = []) => {
  const same = all.some((o) => o.id !== p.id && o.name.trim().toLowerCase() === p.name.trim().toLowerCase());
  return `${p.sku ? `${p.sku} · ` : ''}${p.name}${same ? ` (${p.unit})` : ''}`;
};

/*
 * Số lượng lẻ và nhập theo kg (18/11/2026): kho nhập bao to rồi đóng ra túi nên hay đếm bằng kg. Chế độ "Kg"
 * đổi số kg ra số bao / túi theo khối lượng một đơn vị (582 kg gạo bao 10kg = 58,2 bao). Hàng không có
 * khối lượng (miến, trứng…) vẫn tính theo đơn vị của nó.
 */
const qtyInput = (value) => {
  const [whole, ...rest] = String(value).replace(/[^\d.,]/g, '').replace('.', ',').split(',');
  return rest.length ? `${whole.slice(0, 7)},${rest.join('').slice(0, 3)}` : whole.slice(0, 7);
};
const num = (value) => Number(String(value ?? '').replace(',', '.')) || 0;
const round3 = (n) => Math.round(n * 1000) / 1000;
const canKg = (p) => p?.weight_kg > 0;
const unitWord = (p) => String(p?.unit || '').split(' ')[0] || 'đơn vị';
/** Số gõ vào → số đơn vị của sản phẩm. */
const toUnits = (p, value, mode) => (mode === 'kg' && canKg(p) ? round3(num(value) / p.weight_kg) : round3(num(value)));
const kgText = (p, units) => (canKg(p) ? `${formatQty(round3(units * p.weight_kg))} kg` : '');
/**
 * Số tồn / số chuyển hiện theo KG (24/11/2026): hàng có khối lượng (gạo bao, túi) ghi "480 kg"; hàng không có
 * khối lượng (miến, trứng…) ghi theo đơn vị của nó ("12 gói").
 */
export const amountText = (p, units) => (p?.weight_kg > 0 ? `${formatQty(Math.round(units * p.weight_kg * 10) / 10)} kg` : `${formatQty(units)} ${unitWord(p)}`);

/** Chọn nhập theo bao / túi hay theo kg. */
function UnitToggle({ mode, onChange }) {
  return (
    <div className="inv-unit" role="radiogroup" aria-label="Nhập số lượng theo">
      <span>Nhập theo</span>
      {[['pack', 'Bao / túi'], ['kg', 'Kg']].map(([value, label]) => (
        <button key={value} type="button" role="radio" aria-checked={mode === value} className={mode === value ? 'active' : ''} onClick={() => onChange(value)}>{label}</button>
      ))}
    </div>
  );
}

/** Dòng đổi đơn vị ngay dưới ô số lượng: "= 58,2 bao" hoặc "= 582 kg". */
function QtyHint({ product, value, mode }) {
  if (!product || !num(value)) return null;
  if (mode === 'kg') {
    return <small className="inv-conv">{canKg(product) ? `= ${formatQty(toUnits(product, value, mode))} ${unitWord(product)}` : `tính theo ${product.unit}`}</small>;
  }
  return canKg(product) ? <small className="inv-conv">= {kgText(product, num(value))}</small> : null;
}
const fold = (value) => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
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
        <option key={p.id} value={p.id}>{productLabel(p, products)}{hint ? ` · ${hint(p)}` : ''}</option>
      ))}
    </select>
  );
}

/**
 * Phiếu nhập kho. Hai chế độ:
 *  - Nhập công gạo (kế toán): mặc định về Kho Bồ Sơn, có thể ghi luôn phần giao thẳng Cửa hàng Nguyễn Cao.
 *  - Nhập hàng cửa hàng: về Cửa hàng Nguyễn Cao (hàng lẻ từ nhà cung cấp phụ, đồ khô, miến, bột…).
 */
/**
 * Thêm mặt hàng mới ngay trong phiếu nhập (24/11/2026): hàng về mà chưa có trên web. Mặt hàng tạo ra đang ẨN trên
 * web (giá 0đ); chủ cửa hàng đặt giá, ảnh ở trang Sản phẩm rồi bật hiện khi muốn bán online.
 */
function NewProductForm({ onCreated, onCancel }) {
  const [form, setForm] = useState({ name: '', unit: '', weight_kg: '', category: 'gao' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (patch) => setForm((cur) => ({ ...cur, ...patch }));
  // Gõ quy cách có số kg ("bao 25kg", "túi 5 kg") thì tự điền khối lượng.
  const setUnit = (unit) => {
    const m = /(\d+(?:[.,]\d+)?)\s*kg/i.exec(unit);
    set({ unit, ...(m && !form.weight_kg ? { weight_kg: m[1].replace('.', ',') } : {}) });
  };
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const result = await api.inventoryNewProduct({
        name: form.name.trim(), unit: form.unit.trim(), category: form.category,
        weight_kg: form.weight_kg === '' ? null : Number(String(form.weight_kg).replace(',', '.')),
      });
      onCreated(result);
    } catch (err) {
      setErrors({ form: err.message, ...(err.errors || {}) });
    } finally { setBusy(false); }
  };
  return (
    <div className="inv-new-product" role="group" aria-label="Thêm mặt hàng mới">
      <strong>➕ Mặt hàng mới (chưa có trên web)</strong>
      <div className="inv-new-grid">
        <label>Tên mặt hàng
          <input className="input" value={form.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="VD: Gạo Bắc Hương" aria-invalid={!!errors.name} />
          {errors.name && <small className="err">{errors.name}</small>}
        </label>
        <label>Quy cách
          <input className="input" value={form.unit} maxLength={40} onChange={(e) => setUnit(e.target.value)} placeholder="VD: bao 25kg, túi 5kg, gói" aria-invalid={!!errors.unit} />
          {errors.unit && <small className="err">{errors.unit}</small>}
        </label>
        <label>Kg mỗi bao / túi <small className="optional">để trống nếu không tính kg</small>
          <input className="input" inputMode="decimal" value={form.weight_kg} onChange={(e) => set({ weight_kg: qtyInput(e.target.value) })} placeholder="VD: 25" aria-invalid={!!errors.weight_kg} />
          {errors.weight_kg && <small className="err">{errors.weight_kg}</small>}
        </label>
        <label>Nhóm hàng
          <select className="input" value={form.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="gao">Gạo</option>
            <option value="do-kho">Thực phẩm khô</option>
          </select>
        </label>
      </div>
      {errors.form && <p className="alert error" role="alert">{errors.form}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !form.name.trim() || !form.unit.trim()} onClick={save}>{busy ? 'Đang thêm…' : 'Thêm vào danh sách'}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>Huỷ</button>
      </div>
      <small className="field-help">Mặt hàng mới đang <b>ẩn trên web</b>. Chủ cửa hàng vào trang Sản phẩm đặt giá bán, ảnh rồi bật hiện khi muốn bán online.</small>
    </div>
  );
}

export function ReceiptForm({ products, canCost, initial = null, onSaved, onClose, onProductAdded }) {
  const [kind, setKind] = useState(initial?.kind || 'cong-gao');
  const [info, setInfo] = useState({ source: '', vehicle: '', note: '' });
  const [rows, setRows] = useState(() => [{ product_id: initial?.product_id ? String(initial.product_id) : '', bs: '', nc: '', cost: '' }]);
  const [mode, setMode] = useState('pack');     // 'pack' = bao / túi · 'kg'
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);   // đang mở ô thêm mặt hàng mới
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [String(p.id), p])), [products]);
  const taken = new Set(rows.map((r) => r.product_id).filter(Boolean));
  const setRow = (index, patch) => setRows((cur) => cur.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const shopOnly = kind === 'cua-hang';
  const productAdded = (result) => {
    onProductAdded?.(result);
    const id = String(result.product_id);
    // Điền mặt hàng vừa thêm vào dòng trống đầu tiên, không có thì thêm dòng mới.
    setRows((cur) => {
      const empty = cur.findIndex((r) => !r.product_id);
      if (empty >= 0) return cur.map((r, i) => (i === empty ? { ...r, product_id: id } : r));
      return [...cur, { product_id: id, bs: '', nc: '', cost: '' }];
    });
    setAdding(false);
  };
  const units = (r, key) => toUnits(byId[r.product_id], r[key], mode);
  const filled = rows.filter((r) => r.product_id && (units(r, 'bs') > 0 || units(r, 'nc') > 0));
  const sumKg = (key) => filled.reduce((total, r) => total + kgOf(byId[r.product_id], units(r, key)), 0);
  const kg = sumKg('bs') + sumKg('nc');
  const sumUnits = (key) => round3(filled.reduce((total, r) => total + units(r, key), 0));
  const hasPacks = filled.some((r) => !canKg(byId[r.product_id]));
  const kgSuffix = mode === 'kg' ? ' (kg)' : '';

  const save = async (event) => {
    event.preventDefault();
    if (!filled.length) { setError('Chọn loại hàng và nhập số lượng cho ít nhất một dòng.'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await api.inventoryReceive({
        kind, source: info.source.trim() || null, vehicle: shopOnly ? null : info.vehicle.trim() || null, note: info.note.trim() || null,
        items: filled.map((r) => ({
          product_id: Number(r.product_id), quantity_bs: shopOnly ? 0 : units(r, 'bs'), quantity_nc: units(r, 'nc'),
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
        <UnitToggle mode={mode} onChange={setMode} />
        {rows.map((row, index) => (
          <div key={index} className={`inv-line${shopOnly ? ' one' : ''}${canCost ? ' with-cost' : ''}`}>
            <ProductSelect products={products} value={row.product_id} taken={taken} label={`Loại hàng nhập ${index + 1}`}
                           onChange={(value) => setRow(index, { product_id: value })} />
            {!shopOnly && (
              <label className="inv-qty">Vào Bồ Sơn{kgSuffix}
                <input className="input" inputMode="decimal" value={row.bs} disabled={!row.product_id} placeholder="0"
                       onChange={(e) => setRow(index, { bs: qtyInput(e.target.value) })} aria-label={`Số nhập vào Bồ Sơn ${index + 1}`} />
                <QtyHint product={byId[row.product_id]} value={row.bs} mode={mode} />
              </label>
            )}
            <label className="inv-qty">{shopOnly ? 'Số lượng' : 'Giao thẳng Nguyễn Cao'}{kgSuffix}
              <input className="input" inputMode="decimal" value={row.nc} disabled={!row.product_id} placeholder="0"
                     onChange={(e) => setRow(index, { nc: qtyInput(e.target.value) })} aria-label={`Số nhập vào Nguyễn Cao ${index + 1}`} />
              <QtyHint product={byId[row.product_id]} value={row.nc} mode={mode} />
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
        <div className="inv-line-actions">
          <button type="button" className="link-button" onClick={() => setRows((cur) => [...cur, { product_id: '', bs: '', nc: '', cost: '' }])}>+ Thêm loại hàng</button>
          {onProductAdded && !adding && <button type="button" className="link-button" onClick={() => setAdding(true)}>➕ Mặt hàng mới (chưa có trên web)</button>}
        </div>
        {adding && <NewProductForm onCreated={productAdded} onCancel={() => setAdding(false)} />}
        {filled.length > 0 && (
          <p className="inv-summary">
            {/* Theo bao / túi: ghi số bao như đã gõ; theo kg: ghi số kg. Dòng cuối luôn có tổng kg. */}
            {!shopOnly && <>Vào Bồ Sơn: <b>{mode === 'kg' ? `${formatQty(round3(sumKg('bs')))} kg` : formatQty(sumUnits('bs'))}</b> · </>}
            Vào Nguyễn Cao: <b>{mode === 'kg' ? `${formatQty(round3(sumKg('nc')))} kg` : formatQty(sumUnits('nc'))}</b>
            {kg > 0 && <> · Tổng <b>{formatQty(round3(kg))} kg</b></>}
            {hasPacks && <> · cộng thêm hàng tính theo gói / khay</>}
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
  // Điều chuyển chỉ tính theo KG (24/11/2026); hàng không có khối lượng (miến, trứng…) tính theo đơn vị của nó.
  const mode = 'kg';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [String(p.id), p])), [products]);
  const taken = new Set(rows.map((r) => r.product_id).filter(Boolean));
  const setRow = (index, patch) => setRows((cur) => cur.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  // Chỉ chọn được hàng đang có ở kho xuất.
  const available = products.filter((p) => stockOf(p, from) > 0);
  const units = (r) => toUnits(byId[r.product_id], r.quantity, mode);
  const filled = rows.filter((r) => r.product_id && units(r) > 0);
  const over = filled.find((r) => units(r) > stockOf(byId[r.product_id], from));
  const left = (p) => amountText(p, stockOf(p, from));

  const save = async (event) => {
    event.preventDefault();
    if (!filled.length) { setError('Chọn loại hàng và nhập số lượng cần chuyển.'); return; }
    if (over) { setError(`“${byId[over.product_id].name}” ở ${WAREHOUSE_NAME[from]} chỉ còn ${left(byId[over.product_id])}.`); return; }
    setBusy(true);
    setError('');
    try {
      onSaved(await api.inventoryTransfer({
        from, to, note: note.trim() || null,
        items: filled.map((r) => ({ product_id: Number(r.product_id), quantity: units(r) })),
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
        <legend>Hàng chuyển <small className="muted">(tính theo kg)</small></legend>
        {!available.length && <p className="muted">{WAREHOUSE_NAME[from]} hiện không có hàng để chuyển.</p>}
        {rows.map((row, index) => {
          const product = byId[row.product_id];
          const tooMany = product && units(row) > stockOf(product, from);
          return (
            <div key={index} className="inv-line one">
              <ProductSelect products={available} value={row.product_id} taken={taken} label={`Loại hàng chuyển ${index + 1}`}
                             hint={(p) => `còn ${left(p)}`} onChange={(value) => setRow(index, { product_id: value })} />
              <label className="inv-qty">{!product || canKg(product) ? 'Số kg chuyển' : `Số lượng chuyển (${unitWord(product)})`}
                <input className="input" inputMode="decimal" value={row.quantity} disabled={!row.product_id} placeholder="0" aria-invalid={!!tooMany}
                       onChange={(e) => setRow(index, { quantity: qtyInput(e.target.value) })} aria-label={`Số lượng chuyển ${index + 1}`} />
                {product && <small className={tooMany ? 'err' : ''}>{WAREHOUSE_SHORT[from]} còn {left(product)}</small>}
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
  const [mode, setMode] = useState('pack');
  const countedUnits = (p) => toUnits(p, counted[p.id], mode);
  const changes = products
    .filter((p) => counted[p.id] !== undefined && counted[p.id] !== '' && countedUnits(p) !== stockOf(p, warehouse))
    .map((p) => ({ product_id: p.id, counted: countedUnits(p) }));

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
      <UnitToggle mode={mode} onChange={(value) => { setMode(value); setCounted({}); }} />
      <div className="table-scroll inv-count">
        <table className="data-table">
          <thead><tr><th>Loại hàng</th><th>Trên máy</th><th>Đếm được</th><th>Chênh lệch</th></tr></thead>
          <tbody>
            {shown.map((p) => {
              const current = stockOf(p, warehouse);
              const value = counted[p.id] ?? '';
              const diff = value === '' ? 0 : round3(countedUnits(p) - current);
              return (
                <tr key={p.id} className={diff ? 'row-changed' : ''}>
                  <td>{p.sku && <small className="inv-sku">{p.sku}</small>} {p.name} <small className="muted">{p.unit}</small></td>
                  <td className={current < 0 ? 'inv-neg' : ''}>{formatQty(current)}{mode === 'kg' && canKg(p) && <small className="muted"> ({kgText(p, current)})</small>}</td>
                  <td><input className="input inv-count-input" inputMode="decimal" value={value} placeholder={mode === 'kg' && canKg(p) ? 'kg' : formatQty(Math.max(current, 0))}
                             onChange={(e) => setCounted({ ...counted, [p.id]: qtyInput(e.target.value) })} aria-label={`Số đếm được: ${p.name}`} />
                    {mode === 'kg' && value !== '' && <QtyHint product={p} value={value} mode={mode} />}</td>
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
