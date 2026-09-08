import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatDateTime, formatVND, isPhone, normalizePhone } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import ReturnManager from '../components/ReturnManager.jsx';
import AccountSignup from '../components/AccountSignup.jsx';

const PAYMENT_LABEL = { cash: 'Tiền mặt', transfer: 'Chuyển khoản' };
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Retail() {
  const [tab, setTab] = useState('sell');
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [products, setProducts] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const notify = (text) => {
    setMsg(text);
    window.setTimeout(() => setMsg(''), 3000);
  };

  const reload = useCallback(async () => {
    setError('');
    try {
      const [prod, pol, st] = await Promise.all([
        api.adminProducts(), api.retailPolicy(), api.retailStats(),
      ]);
      setProducts(prod.products.filter((p) => p.price > 0));
      setPolicy(pol.policy);
      setStats(st.stats);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  if (loading) {
    return <div className="loading-state page-loading" role="status"><span></span>Đang mở màn hình bán hàng…</div>;
  }

  return (
    <div className="admin-app">
      <header className="admin-topbar">
        <div className="admin-brand">
          <img src="/logo-mark.png" alt="" width="38" height="38" />
          <div><strong>Gạo Kinh Bắc</strong><small>Bán hàng tại quầy</small></div>
        </div>
        <div className="admin-account">
          <span>Xin chào, <strong>{user?.full_name}</strong></span>
          <Link to="/quan-tri" className="btn btn-secondary">Quản trị</Link>
          <button className="btn btn-ghost" onClick={() => { logout(); navigate('/'); }}>Đăng xuất</button>
        </div>
      </header>

      <div className="admin-layout">
        <aside className="admin-sidebar">
          <p className="admin-nav-label">Tại quầy</p>
          <button className={tab === 'sell' ? 'active' : ''} onClick={() => setTab('sell')}>
            <span aria-hidden="true">◧</span><span>Bán hàng<small>Tạo hoá đơn mới</small></span>
          </button>
          <button className={tab === 'invoices' ? 'active' : ''} onClick={() => setTab('invoices')}>
            <span aria-hidden="true">▤</span><span>Hoá đơn cũ<small>Tra cứu lại</small></span>
          </button>
          <button className={tab === 'returns' ? 'active' : ''} onClick={() => setTab('returns')}>
            <span aria-hidden="true">↺</span><span>Đổi trả hàng<small>Lập phiếu xử lý</small></span>
          </button>
          {policy && (
            <div className="admin-help">
              <strong>Chính sách tại quầy</strong>
              <p>Giảm giá: chỉ hoá đơn từ <b>{policy.minKgForDiscount}kg</b> trở lên,
                 mức % do cửa hàng tự nhập (tối đa {policy.maxDiscountPercent}%).</p>
              <p>Tích điểm: {formatVND(policy.vndPerPoint)} = 1 điểm</p>
              <p>Đổi quà: <b>{policy.pointsPerReward?.toLocaleString("vi-VN")} điểm</b> = 1 túi 1kg (nếp / lứt / kê)</p>
            </div>
          )}
        </aside>

        <main className="admin-content">
          {error && (
            <div className="alert error" role="alert">
              {error}{' '}
              <button type="button" className="link-button" onClick={reload}>Tải lại</button>
            </div>
          )}
          {msg && <div className="toast success" role="status"><span>✓</span>{msg}</div>}

          {stats && (
            <section className="stats" aria-label="Thống kê bán tại quầy">
              <div className="stat urgent">
                <span>Hoá đơn hôm nay</span><strong>{stats.todayInvoices}</strong><small>Tính từ đầu ngày</small>
              </div>
              <div className="stat">
                <span>Doanh thu hôm nay</span><strong>{formatVND(stats.todayRevenue)}</strong>
                <small>Đã trừ giảm giá</small>
              </div>
              <div className="stat">
                <span>Đã giảm cho khách</span><strong>{formatVND(stats.todayDiscount)}</strong><small>Hôm nay</small>
              </div>
              <div className="stat">
                <span>Khách quen</span><strong>{stats.customers}</strong><small>Có tích điểm</small>
              </div>
            </section>
          )}

          {tab === 'sell'
            ? <SellTab products={products} policy={policy} onDone={() => { reload(); }} notify={notify} />
            : tab === 'invoices' ? <InvoiceLookupTab />
            : <ReturnManager notify={notify} />}
        </main>
      </div>
    </div>
  );
}

/* ================================================================== *
 * Tab 1 — Bán hàng
 * ================================================================== */
/** Hiện khối lượng gọn: 50kg, 52,5kg. */
function formatKg(kg) {
  const n = Math.round((Number(kg) || 0) * 10) / 10;
  return `${n.toLocaleString('vi-VN')}kg`;
}

function SellTab({ products, policy, onDone, notify }) {
  const [phone, setPhone] = useState('');
  const [customer, setCustomer] = useState(null);
  const [customerHistory, setCustomerHistory] = useState([]);
  const [lookupState, setLookupState] = useState('idle');  // idle | loading | found | new
  const [lookupError, setLookupError] = useState('');
  const [guestName, setGuestName] = useState('');
  const [account, setAccount] = useState(null);        // tài khoản đặt hàng online
  const [onlineOrders, setOnlineOrders] = useState(0);
  const [rewardsAffordable, setRewardsAffordable] = useState(0);
  const [giftLines, setGiftLines] = useState([]);   // [{ product, quantity }] quà đổi điểm

  const [lines, setLines] = useState([]);       // [{ product, quantity }]
  const [search, setSearch] = useState('');
  const [payment, setPayment] = useState('cash');
  const [note, setNote] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [receipt, setReceipt] = useState(null);

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.product.price * l.quantity, 0),
    [lines]
  );
  // Quà đổi điểm tính 0đ và không tính vào khối lượng, giống hệt máy chủ.
  const totalKg = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.product.weight_kg) || 0) * l.quantity, 0),
    [lines]
  );
  const minKg = policy?.minKgForDiscount ?? 50;
  const maxPercent = policy?.maxDiscountPercent ?? 50;
  const canDiscount = totalKg >= minKg;

  // Tính giảm giá y hệt máy chủ để nhân viên thấy trước; máy chủ vẫn tính lại khi lưu.
  const percent = Number(String(discountPercent).replace(',', '.')) || 0;
  const discount = canDiscount && percent > 0
    ? Math.min(subtotal, Math.floor((subtotal * Math.min(percent, maxPercent)) / 100))
    : 0;
  const total = subtotal - discount;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => `${p.name} ${p.origin || ''}`.toLowerCase().includes(q));
  }, [products, search]);

  const lookup = async (value, { force = false } = {}) => {
    const raw = value ?? phone;
    // Số này vừa tra xong (onChange đưa về 'idle' khi khách sửa số) nên không tra lại:
    // tra lại sẽ đóng mất form đăng ký đang mở và xoá quà nhân viên đã chọn.
    if (!force && (lookupState === 'found' || lookupState === 'new')) return;
    setLookupError('');
    if (!raw.trim()) { setCustomer(null); setCustomerHistory([]); setLookupState('idle'); return; }
    if (!isPhone(raw)) {
      setLookupState('idle');
      setLookupError('Số điện thoại phải có 10 số, ví dụ 0912345678.');
      return;
    }
    setLookupState('loading');
    try {
      const r = await api.retailFindCustomer(raw);
      setCustomer(r.customer);
      setAccount(r.account || null);
      setOnlineOrders(r.onlineOrders || 0);
      setRewardsAffordable(r.rewardsAffordable || 0);
      setGiftLines([]);
      setCustomerHistory(r.invoices || []);
      setLookupState(r.customer ? 'found' : 'new');
    } catch (err) {
      setLookupState('idle');
      setLookupError(err.message);
    }
  };

  const addLine = (product) => {
    setLines((prev) => {
      const found = prev.find((l) => l.product.id === product.id);
      if (found) {
        return prev.map((l) => l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const setQty = (id, quantity) => {
    const q = Math.max(1, Math.min(Math.round(quantity) || 1, 500));
    setLines((prev) => prev.map((l) => l.product.id === id ? { ...l, quantity: q } : l));
  };

  const removeLine = (id) => setLines((prev) => prev.filter((l) => l.product.id !== id));

  const resetBill = () => {
    setLines([]); setNote(''); setPayment('cash'); setDiscountPercent('');
    setPhone(''); setCustomer(null); setCustomerHistory([]);
    setLookupState('idle'); setLookupError(''); setGuestName('');
    setGiftLines([]); setRewardsAffordable(0);
    setAccount(null); setOnlineOrders(0);
  };

  const save = async () => {
    setFormError('');
    if (!lines.length) { setFormError('Chưa chọn sản phẩm nào.'); return; }
    if (phone.trim() && !isPhone(phone)) {
      setFormError('Số điện thoại không hợp lệ. Bỏ trống nếu khách không cho số.');
      return;
    }
    setBusy(true);
    try {
      const r = await api.retailCreateInvoice({
        phone: phone.trim() || undefined,
        full_name: (customer?.full_name || guestName).trim() || undefined,
        items: lines.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
        rewards: giftLines.length
          ? giftLines.map((g) => ({ product_id: g.product.id, quantity: g.quantity }))
          : undefined,
        payment_method: payment,
        note: note.trim() || undefined,
        discount_percent: discount > 0 ? percent : undefined,
      });
      setReceipt(r);
      notify(`Đã lưu hoá đơn ${r.invoice.code}.`);
      resetBill();
      onDone();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow dark"><span></span>Tại quầy</p>
          <h1>Bán hàng</h1>
          <p>Nhập số điện thoại để tích điểm, chọn gạo rồi lưu hoá đơn.</p>
        </div>
        {lines.length > 0 && (
          <button type="button" className="btn btn-secondary" onClick={resetBill}>Huỷ hoá đơn</button>
        )}
      </div>

      {receipt && <Receipt data={receipt} onClose={() => setReceipt(null)} />}

      <div className="pos-layout">
        {/* --- Chọn sản phẩm --- */}
        <section className="pos-catalog" aria-label="Chọn sản phẩm">
          <label className="search-box pos-search">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">Tìm loại gạo</span>
            <input className="input search" type="search" placeholder="Tìm loại gạo…"
                   value={search} onChange={(e) => setSearch(e.target.value)} />
            {search && <button type="button" onClick={() => setSearch('')} aria-label="Xoá từ khoá">×</button>}
          </label>

          {visible.length === 0 ? (
            <div className="admin-empty"><span>?</span><h2>Không tìm thấy loại gạo</h2>
              <p>Chỉ những loại đã có giá mới bán được tại quầy.</p></div>
          ) : (
            <div className="pos-grid">
              {visible.map((p) => (
                <button key={p.id} type="button" className="pos-item" onClick={() => addLine(p)}>
                  <img src={p.image_url || '/logo-mark.png'} alt="" loading="lazy" />
                  <span className="pos-item-name">{p.name}</span>
                  <span className="pos-item-unit">{p.unit}</span>
                  <strong>{formatVND(p.price)}</strong>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* --- Hoá đơn đang lập --- */}
        <aside className="pos-bill">
          <div className="pos-customer">
            <label>Số điện thoại khách <span className="optional">Để trống nếu khách vãng lai</span>
              <div className="pos-phone-row">
                <input className="input" value={phone} inputMode="tel" placeholder="0912345678"
                       onChange={(e) => { setPhone(e.target.value); setLookupState('idle'); }}
                       onBlur={(e) => lookup(e.target.value)}
                       onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(undefined, { force: true }); } }}
                       aria-invalid={!!lookupError} />
                <button type="button" className="btn btn-secondary" onClick={() => lookup(undefined, { force: true })}
                        disabled={lookupState === 'loading'}>
                  {lookupState === 'loading' ? 'Đang tra…' : 'Tra cứu'}
                </button>
              </div>
              {lookupError && <small className="err">{lookupError}</small>}
            </label>

            {lookupState === 'found' && customer && (
              <div className="pos-customer-card">
                <div>
                  <strong>{customer.full_name || 'Khách quen'}</strong>
                  <small>{customer.phone} · đã mua {customer.visit_count} lần</small>
                </div>
                <div className="pos-points">
                  <span>Điểm tích luỹ</span><b>{customer.points.toLocaleString('vi-VN')}</b>
                </div>
              </div>
            )}

            {/* Đổi điểm lấy quà: đủ 1.000 điểm được 1 túi 1kg */}
            {lookupState === 'found' && policy?.rewards?.length > 0 && (
              <RewardPicker
                policy={policy}
                affordable={rewardsAffordable}
                giftLines={giftLines}
                setGiftLines={setGiftLines}
              />
            )}
            {lookupState === 'new' && (
              <div className="pos-customer-card new">
                <div>
                  <strong>Khách mới</strong>
                  <small>Số này chưa mua lần nào. Lưu hoá đơn sẽ tạo hồ sơ tích điểm.</small>
                </div>
              </div>
            )}
            {lookupState === 'new' && (
              <label>Tên khách <span className="optional">Không bắt buộc</span>
                <input className="input" value={guestName} onChange={(e) => setGuestName(e.target.value)}
                       placeholder="Ví dụ: Cô Lan" />
              </label>
            )}

            {/* Tài khoản đặt hàng online — cùng số điện thoại, cùng hồ sơ điểm */}
            {(lookupState === 'found' || lookupState === 'new') && (
              account ? (
                <p className="account-linked">
                  ✓ Đã có tài khoản đặt hàng online
                  {onlineOrders > 0 && <> · đã đặt <b>{onlineOrders}</b> đơn giao tận nhà</>}
                  {account.is_locked === 1 && <span className="lock-tag">Đang bị khoá</span>}
                </p>
              ) : (
                <AccountSignup
                  phone={normalizePhone(phone)}
                  defaultName={customer?.full_name || guestName}
                  onCreated={(created, text) => { setAccount(created); notify(text); }}
                />
              )
            )}


            {customerHistory.length > 0 && (
              <details className="pos-history">
                <summary>{customerHistory.length} hoá đơn gần đây</summary>
                <ul>
                  {customerHistory.slice(0, 5).map((inv) => (
                    <li key={inv.id}>
                      <span>{inv.code}<small>{formatDateTime(inv.created_at)}</small></span>
                      <strong>{formatVND(inv.total)}</strong>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="pos-lines">
            {lines.length === 0 ? (
              giftLines.length === 0 && <p className="pos-empty">Bấm vào loại gạo bên trái để thêm vào hoá đơn.</p>
            ) : lines.map((l) => (
              <div className="pos-line" key={l.product.id}>
                <div className="pos-line-main">
                  <strong>{l.product.name}</strong>
                  <small>{formatVND(l.product.price)} / {l.product.unit}</small>
                </div>
                <div className="qty-stepper">
                  <button type="button" onClick={() => setQty(l.product.id, l.quantity - 1)}
                          disabled={l.quantity <= 1} aria-label={`Giảm ${l.product.name}`}>−</button>
                  <input type="number" inputMode="numeric" min="1" max="500" value={l.quantity}
                         aria-label={`Số lượng ${l.product.name}`}
                         onChange={(e) => setQty(l.product.id, Number(e.target.value))} />
                  <button type="button" onClick={() => setQty(l.product.id, l.quantity + 1)}
                          aria-label={`Tăng ${l.product.name}`}>+</button>
                </div>
                <strong className="pos-line-total">{formatVND(l.product.price * l.quantity)}</strong>
                <button type="button" className="link-button danger" onClick={() => removeLine(l.product.id)}>
                  Xoá
                </button>
              </div>
            ))}
            {giftLines.map((g) => (
              <div className="pos-line gift" key={`gift-${g.product.id}`}>
                <div className="pos-line-main">
                  <strong>{g.product.name} <span className="gift-tag">Quà đổi điểm</span></strong>
                  <small>{g.quantity} × {policy.pointsPerReward.toLocaleString("vi-VN")} điểm</small>
                </div>
                <strong className="pos-line-total free-tag">0₫</strong>
              </div>
            ))}
          </div>

          <div className="pos-totals">
            <div className="summary-row"><span>Tiền hàng</span><strong>{formatVND(subtotal)}</strong></div>
            <div className="summary-row">
              <span>Khối lượng</span>
              <strong className={canDiscount ? 'free-tag' : ''}>{formatKg(totalKg)}</strong>
            </div>

            {/* Giảm giá tại quầy: cửa hàng tự nhập %, chỉ mở khi đủ khối lượng. */}
            <div className="pos-discount">
              <label>
                Giảm giá <span className="optional">%</span>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max={maxPercent}
                  step="1"
                  value={discountPercent}
                  disabled={!canDiscount}
                  placeholder={canDiscount ? `0 – ${maxPercent}` : `Cần ${minKg}kg`}
                  onChange={(e) => setDiscountPercent(e.target.value)}
                />
              </label>
              <strong className={discount > 0 ? 'free-tag' : ''}>
                {discount > 0 ? `− ${formatVND(discount)}` : '0₫'}
              </strong>
            </div>
            {lines.length > 0 && !canDiscount && (
              <p className="pos-hint">
                Hoá đơn phải từ <b>{minKg}kg</b> trở lên mới được giảm giá. Còn thiếu {formatKg(minKg - totalKg)}.
              </p>
            )}
            {percent > maxPercent && (
              <p className="pos-hint">Mức giảm tối đa là {maxPercent}%.</p>
            )}
            <div className="summary-row grand-total"><span>Khách trả</span><strong>{formatVND(total)}</strong></div>
            {phone.trim() && isPhone(phone) && policy && (
              <p className="pos-hint">
                Khách sẽ được cộng <b>{Math.floor(total / policy.vndPerPoint).toLocaleString('vi-VN')}</b> điểm.
                {giftLines.length > 0 && (
                  <> Trừ <b>{(giftLines.reduce((n, g) => n + g.quantity, 0) * policy.pointsPerReward).toLocaleString('vi-VN')}</b> điểm đổi quà.</>
                )}
              </p>
            )}
          </div>

          <div className="pos-pay">
            <div className="payment-options">
              {Object.entries(PAYMENT_LABEL).map(([code, label]) => (
                <label key={code} className={payment === code ? 'selected' : ''}>
                  <input type="radio" name="pos-payment" value={code}
                         checked={payment === code} onChange={(e) => setPayment(e.target.value)} />
                  <span aria-hidden="true">{code === 'cash' ? '◫' : '▤'}</span>
                  <div><strong>{label}</strong></div>
                </label>
              ))}
            </div>
            <label>Ghi chú <span className="optional">Không bắt buộc</span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)}
                     placeholder="Ví dụ: giao tận nhà chiều nay" />
            </label>
          </div>

          {formError && <div className="alert error" role="alert">{formError}</div>}

          <button type="button" className="btn btn-primary btn-block btn-large"
                  disabled={busy || (lines.length === 0 && giftLines.length === 0)} onClick={save}>
            {busy ? 'Đang lưu…' : `Lưu hoá đơn · ${formatVND(total)}`}
          </button>
        </aside>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Hoá đơn vừa lưu
 * ------------------------------------------------------------------ */
function Receipt({ data, onClose }) {
  const { invoice, customer } = data;
  return (
    <div className="receipt" role="status">
      <div className="receipt-head">
        <div>
          <p className="eyebrow dark"><span></span>Đã lưu</p>
          <h2>Hoá đơn {invoice.code}</h2>
          <small>{formatDateTime(invoice.created_at)}</small>
        </div>
        <button type="button" className="icon-close" onClick={onClose} aria-label="Đóng">×</button>
      </div>
      <ul className="receipt-items">
        {invoice.items.map((i) => (
          <li key={i.id}>
            <span>{i.product_name}<small>{i.quantity} {i.unit} × {formatVND(i.price)}</small></span>
            <strong>{formatVND(i.price * i.quantity)}</strong>
          </li>
        ))}
      </ul>
      <div className="summary-row"><span>Tiền hàng</span><strong>{formatVND(invoice.subtotal)}</strong></div>
      {invoice.discount > 0 && (
        <div className="summary-row"><span>Giảm giá</span>
          <strong className="free-tag">− {formatVND(invoice.discount)}</strong></div>
      )}
      <div className="summary-row grand-total"><span>Khách trả</span><strong>{formatVND(invoice.total)}</strong></div>
      {customer && (
        <p className="receipt-points">
          {customer.full_name || customer.phone} được cộng <b>{invoice.points_earned}</b> điểm
          {invoice.points_used > 0 && (
            <>, trừ <b>{invoice.points_used.toLocaleString('vi-VN')}</b> điểm đổi quà</>
          )}
          {' '}— tổng còn <b>{customer.points.toLocaleString('vi-VN')}</b> điểm.
        </p>
      )}
      <button type="button" className="btn btn-secondary btn-block" onClick={() => window.print()}>
        In hoá đơn
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Chọn quà đổi điểm — đủ 1.000 điểm được 1 túi 1kg
 * ------------------------------------------------------------------ */
function RewardPicker({ policy, affordable, giftLines, setGiftLines }) {
  const chosen = giftLines.reduce((sum, g) => sum + g.quantity, 0);
  const left = affordable - chosen;

  const add = (product) => {
    if (left <= 0) return;
    setGiftLines((prev) => {
      const found = prev.find((g) => g.product.id === product.id);
      return found
        ? prev.map((g) => (g.product.id === product.id ? { ...g, quantity: g.quantity + 1 } : g))
        : [...prev, { product, quantity: 1 }];
    });
  };

  const remove = (id) => {
    setGiftLines((prev) => prev
      .map((g) => (g.product.id === id ? { ...g, quantity: g.quantity - 1 } : g))
      .filter((g) => g.quantity > 0));
  };

  if (affordable <= 0) {
    return (
      <p className="reward-hint">
        Chưa đủ {policy.pointsPerReward.toLocaleString('vi-VN')} điểm để đổi quà.
      </p>
    );
  }

  return (
    <div className="reward-picker">
      <p className="reward-title">
        Đổi được <b>{affordable}</b> phần quà
        <small>{policy.pointsPerReward.toLocaleString('vi-VN')} điểm = 1 túi 1kg</small>
      </p>

      <div className="reward-options">
        {policy.rewards.map((g) => {
          const picked = giftLines.find((x) => x.product.id === g.id);
          return (
            <div key={g.id} className={`reward-option${picked ? ' picked' : ''}`}>
              <span className="reward-name">{g.name}<small>{g.unit}</small></span>
              {picked ? (
                <div className="qty-stepper">
                  <button type="button" onClick={() => remove(g.id)}
                          aria-label={`Bớt ${g.name}`}>−</button>
                  <input type="number" value={picked.quantity} readOnly
                         aria-label={`Số phần ${g.name}`} />
                  <button type="button" onClick={() => add(g)} disabled={left <= 0}
                          aria-label={`Thêm ${g.name}`}>+</button>
                </div>
              ) : (
                <button type="button" className="btn btn-secondary" disabled={left <= 0}
                        onClick={() => add(g)}>Chọn</button>
              )}
            </div>
          );
        })}
      </div>

      {chosen > 0 && (
        <p className="reward-summary">
          Đổi <b>{chosen}</b> phần quà · trừ{' '}
          <b>{(chosen * policy.pointsPerReward).toLocaleString('vi-VN')}</b> điểm
          {left > 0 && ` · còn đổi được ${left} phần nữa`}
        </p>
      )}
    </div>
  );
}

/* ================================================================== *
 * Tab 2 — Tra cứu hoá đơn cũ
 * ================================================================== */
function InvoiceLookupTab() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [invoices, setInvoices] = useState([]);
  const [totalFound, setTotalFound] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(null);
  const [printInvoice, setPrintInvoice] = useState(null);
  const LIMIT = 20;

  useEffect(() => {
    if (!printInvoice) return undefined;
    const clear = () => setPrintInvoice(null);
    window.addEventListener('afterprint', clear, { once: true });
    const timer = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', clear);
    };
  }, [printInvoice]);

  const run = useCallback(async (nextOffset = 0, filters) => {
    setLoading(true);
    setError('');
    const f = filters ?? { q, from, to };
    try {
      const r = await api.retailInvoices({ ...f, limit: LIMIT, offset: nextOffset });
      setInvoices(r.invoices);
      setTotalFound(r.total);
      setOffset(nextOffset);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [q, from, to]);

  useEffect(() => { run(0, { q: '', from: '', to: '' }); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e) => { e.preventDefault(); run(0); };

  const quickToday = () => {
    const d = todayISO();
    setFrom(d); setTo(d); setQ('');
    run(0, { q: '', from: d, to: d });
  };

  const clear = () => {
    setQ(''); setFrom(''); setTo('');
    run(0, { q: '', from: '', to: '' });
  };

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow dark"><span></span>Tại quầy</p>
          <h1>Hoá đơn cũ</h1>
          <p>Tra theo mã hoá đơn, số điện thoại, tên khách hoặc khoảng ngày.</p>
        </div>
      </div>

      <form className="pos-filter" onSubmit={submit}>
        <label>Tìm kiếm
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="HD000012, 0912345678 hoặc tên khách" />
        </label>
        <label>Từ ngày
          <input className="input" type="date" value={from} max={to || undefined}
                 onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>Đến ngày
          <input className="input" type="date" value={to} min={from || undefined}
                 onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="pos-filter-actions">
          <button className="btn btn-primary">Tra cứu</button>
          <button type="button" className="btn btn-secondary" onClick={quickToday}>Hôm nay</button>
          <button type="button" className="btn btn-ghost" onClick={clear}>Xoá lọc</button>
        </div>
      </form>

      {error && <div className="alert error" role="alert">{error}</div>}

      {loading ? (
        <div className="loading-state" role="status"><span></span>Đang tra cứu…</div>
      ) : invoices.length === 0 ? (
        <div className="admin-empty">
          <span>?</span><h2>Không tìm thấy hoá đơn nào</h2>
          <p>Thử bỏ bớt điều kiện lọc hoặc kiểm tra lại mã hoá đơn.</p>
        </div>
      ) : (
        <>
          <p className="pos-result-count">
            Tìm thấy <strong>{totalFound}</strong> hoá đơn
            {totalFound > LIMIT && ` · đang xem ${offset + 1}–${Math.min(offset + LIMIT, totalFound)}`}
          </p>
          <div className="pos-invoice-list">
            {invoices.map((inv) => (
              <article key={inv.id} className="pos-invoice">
                <div className="pos-invoice-row">
                  <button type="button" className="pos-invoice-head"
                          onClick={() => setOpened(opened === inv.id ? null : inv.id)}
                          aria-expanded={opened === inv.id}>
                    <span className="pos-invoice-code">{inv.code}</span>
                    <span className="pos-invoice-who">
                      {inv.customer_name || inv.customer_phone || 'Khách vãng lai'}
                      {inv.customer_phone && <small>{inv.customer_phone}</small>}
                    </span>
                    <time>{formatDateTime(inv.created_at)}</time>
                    {inv.discount > 0 && <span className="pos-tag">− {formatVND(inv.discount)}</span>}
                    <strong>{formatVND(inv.total)}</strong>
                  </button>
                  <button type="button" className="btn btn-secondary pos-print-button"
                          onClick={() => setPrintInvoice(inv)} aria-label={`In hoá đơn ${inv.code}`}>
                    <span aria-hidden="true">▤</span> In
                  </button>
                </div>

                {opened === inv.id && (
                  <div className="pos-invoice-detail">
                    <ul className="receipt-items">
                      {inv.items.map((i) => (
                        <li key={i.id}>
                          <span>{i.product_name}<small>{i.quantity} {i.unit} × {formatVND(i.price)}</small></span>
                          <strong>{formatVND(i.price * i.quantity)}</strong>
                        </li>
                      ))}
                    </ul>
                    <div className="summary-row"><span>Tiền hàng</span><strong>{formatVND(inv.subtotal)}</strong></div>
                    {inv.discount > 0 && (
                      <div className="summary-row"><span>Giảm giá</span>
                        <strong className="free-tag">− {formatVND(inv.discount)}</strong></div>
                    )}
                    <div className="summary-row grand-total"><span>Khách trả</span>
                      <strong>{formatVND(inv.total)}</strong></div>
                    <p className="pos-invoice-meta">
                      {PAYMENT_LABEL[inv.payment_method] || inv.payment_method}
                      {inv.points_earned > 0 && ` · cộng ${inv.points_earned} điểm`}
                      {inv.note && ` · ${inv.note}`}
                    </p>
                  </div>
                )}
              </article>
            ))}
          </div>

          {totalFound > LIMIT && (
            <div className="pos-pager">
              <button type="button" className="btn btn-secondary" disabled={offset === 0}
                      onClick={() => run(Math.max(0, offset - LIMIT))}>← Trang trước</button>
              <button type="button" className="btn btn-secondary" disabled={offset + LIMIT >= totalFound}
                      onClick={() => run(offset + LIMIT)}>Trang sau →</button>
            </div>
          )}
        </>
      )}
      {printInvoice && <PrintableInvoice invoice={printInvoice} />}
    </>
  );
}

function PrintableInvoice({ invoice }) {
  return (
    <section className="print-only-receipt" aria-label={`Hoá đơn ${invoice.code}`}>
      <header>
        <img src="/logo-mark.png" alt="" width="54" height="54" />
        <div><h1>Gạo Kinh Bắc</h1><p>HOÁ ĐƠN BÁN HÀNG</p></div>
      </header>
      <div className="print-meta">
        <p><span>Mã hoá đơn</span><strong>{invoice.code}</strong></p>
        <p><span>Ngày bán</span><strong>{formatDateTime(invoice.created_at)}</strong></p>
        <p><span>Khách hàng</span><strong>{invoice.customer_name || 'Khách vãng lai'}</strong></p>
        {invoice.customer_phone && <p><span>Số điện thoại</span><strong>{invoice.customer_phone}</strong></p>}
      </div>
      <table>
        <thead><tr><th>Sản phẩm</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id}>
              <td>{item.product_name}<small>{item.unit}</small></td>
              <td>{item.quantity}</td><td>{formatVND(item.price)}</td>
              <td>{formatVND(item.price * item.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="print-totals">
        <p><span>Tiền hàng</span><strong>{formatVND(invoice.subtotal)}</strong></p>
        {invoice.discount > 0 && <p><span>Giảm giá</span><strong>− {formatVND(invoice.discount)}</strong></p>}
        <p className="print-grand"><span>Khách trả</span><strong>{formatVND(invoice.total)}</strong></p>
        <p><span>Thanh toán</span><strong>{PAYMENT_LABEL[invoice.payment_method] || invoice.payment_method}</strong></p>
      </div>
      {invoice.note && <p className="print-note"><strong>Ghi chú:</strong> {invoice.note}</p>}
      <footer>Cảm ơn quý khách. Hẹn gặp lại!</footer>
    </section>
  );
}
