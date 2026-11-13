import { useState } from 'react';
import { api, formatVND } from '../api';

const MAX_UPSELL = 12;

/**
 * Sản phẩm mua kèm (upsale): hiện ở giỏ hàng của khách và gắn nhãn HOT trên trang chủ, theo thứ tự ở đây.
 * Mỗi lần thêm, bỏ, đổi thứ tự là lưu ngay.
 */
export default function UpsellManager({ products, onSaved, notify }) {
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(true);
  const chosen = products.filter((p) => p.upsell_rank != null).sort((a, b) => a.upsell_rank - b.upsell_rank);
  const others = products.filter((p) => p.upsell_rank == null)
    .sort((a, b) => (b.is_active - a.is_active) || ((b.stock > 0) - (a.stock > 0)) || a.name.localeCompare(b.name, 'vi'));

  const save = async (ids, message) => {
    setBusy(true);
    setError('');
    try {
      const result = await api.adminSetUpsell(ids);
      onSaved(result.products);
      notify(message);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const ids = chosen.map((p) => p.id);
  const add = async () => {
    const product = products.find((p) => String(p.id) === pick);
    if (!product) { setError('Chọn sản phẩm trong danh sách.'); return; }
    if (await save([...ids, product.id], `Đã thêm “${product.name}” vào mua kèm.`)) setPick('');
  };
  const move = (index, step) => {
    const next = [...ids];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    save(next, 'Đã đổi thứ tự mua kèm.');
  };
  const remove = (product) => save(ids.filter((id) => id !== product.id), `Đã bỏ “${product.name}” khỏi mua kèm.`);
  const problem = (p) => (!p.is_active ? 'đang ẩn, khách không thấy' : p.stock <= 0 ? 'hết hàng, khách không thấy' : p.price <= 0 ? 'chưa có giá' : '');

  return (
    <section className="upsell-manager form-card flat" aria-labelledby="upsell-manager-title">
      <div className="banner-settings-head">
        <div>
          <h2 id="upsell-manager-title"><i className="upsell-hot">HOT</i> Sản phẩm mua kèm (upsale)</h2>
          <p>
            Hiện ở <strong>giỏ hàng của khách</strong> để mời mua thêm, và gắn nhãn <strong>HOT</strong> trên trang chủ.
            Khách đã có sản phẩm đó trong giỏ thì không mời lại. Hàng hết hoặc đang ẩn thì khách không thấy.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Thu gọn' : `Mở (${chosen.length} sản phẩm)`}
        </button>
      </div>
      {error && <p className="alert error" role="alert">{error}</p>}
      {open && (
        <>
          {chosen.length ? (
            <ol className="upsell-list">
              {chosen.map((p, index) => (
                <li key={p.id} className={problem(p) ? 'upsell-off' : ''}>
                  <span className="banner-order">{index + 1}</span>
                  <span className="upsell-name">
                    <strong>{p.name}</strong>
                    <small>{formatVND(p.price)} / {p.unit} · còn {p.stock}{problem(p) ? ` · ⚠️ ${problem(p)}` : ''}</small>
                  </span>
                  <span className="upsell-actions">
                    <button type="button" className="btn btn-secondary" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`Đưa ${p.name} lên trên`}>↑</button>
                    <button type="button" className="btn btn-secondary" disabled={busy || index === chosen.length - 1} onClick={() => move(index, 1)} aria-label={`Đưa ${p.name} xuống dưới`}>↓</button>
                    <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={() => remove(p)}>Bỏ</button>
                  </span>
                </li>
              ))}
            </ol>
          ) : <p className="muted">Chưa có sản phẩm mua kèm nào. Giỏ hàng của khách sẽ không mời mua thêm.</p>}
          {chosen.length < MAX_UPSELL && (
            <div className="upsell-add">
              <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Chọn sản phẩm mua kèm">
                <option value="">— Chọn sản phẩm để thêm vào mua kèm —</option>
                {others.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {formatVND(p.price)} / {p.unit}{problem(p) ? ` (${problem(p)})` : ''}</option>
                ))}
              </select>
              <button type="button" className="btn btn-primary" disabled={busy || !pick} onClick={add}>+ Thêm vào mua kèm</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
