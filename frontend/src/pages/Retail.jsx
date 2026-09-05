import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatDateTime, formatVND, isPhone, normalizePhone } from '../api';
import { useAuth } from '../context/AuthContext.jsx';

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
          {policy && (
            <div className="admin-help">
              <strong>Chính sách giảm giá</strong>
              {policy.tiers.map((t) => (
                <p key={t.minSubtotal}>
                  Hoá đơn từ {formatVND(t.minSubtotal)} → giảm <b>{formatVND(t.discount)}</b>
                </p>
              ))}
              <p>Tích điểm: {formatVND(policy.vndPerPoint)} = 1 điểm</p>
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
            : <InvoiceLookupTab />}
        </main>
      </div>
    </div>
  );
}

/* ================================================================== *
 * Tab 1 — Bán hàng
 * ================================================================== */
function SellTab({ products, policy, onDone, notify }) {
  const [phone, setPhone] = useState('');
  const [customer, setCustomer] = useState(null);
  const [customerHistory, setCustomerHistory] = useState([]);
  const [lookupState, setLookupState] = useState('idle');  // idle | loading | found | new
  const [lookupError, setLookupError] = useState('');
  const [guestName, setGuestName] = useState('');

  const [lines, setLines] = useState([]);       // [{ product, quantity }]
  const [search, setSearch] = useState('');
  const [payment, setPayment] = useState('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [receipt, setReceipt] = useState(null);

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.product.price * l.quantity, 0),
    [lines]
  );
  // Tính giảm giá y hệt máy chủ để nhân viên thấy trước; máy chủ vẫn tính lại khi lưu.
  const discount = useMemo(() => {
    if (!policy) return 0;
    const tier = policy.tiers.find((t) => subtotal >= t.minSubtotal);
    return tier ? tier.discount : 0;
  }, [policy, subtotal]);
  const total = subtotal - discount;

  const nextTier = useMemo(() => {
    if (!policy) return null;
    const better = [...policy.tiers].sort((a, b) => a.minSubtotal - b.minSubtotal)
      .find((t) => subtotal < t.minSubtotal);
    return better || null;
  }, [policy, subtotal]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => `${p.name} ${p.origin || ''}`.toLowerCase().includes(q));
  }, [products, search]);

  const lookup = async (value) => {
    const raw = value ?? phone;
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
    setLines([]); setNote(''); setPayment('cash');
    setPhone(''); setCustomer(null); setCustomerHistory([]);
    setLookupState('idle'); setLookupError(''); setGuestName('');
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
        payment_method: payment,
        note: note.trim() || undefined,
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
                       onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } }}
                       aria-invalid={!!lookupError} />
                <button type="button" className="btn btn-secondary" onClick={() => lookup()}
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
              <p className="pos-empty">Bấm vào loại gạo bên trái để thêm vào hoá đơn.</p>
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
          </div>

          <div className="pos-totals">
            <div className="summary-row"><span>Tiền hàng</span><strong>{formatVND(subtotal)}</strong></div>
            <div className="summary-row">
              <span>Giảm giá</span>
              <strong className={discount > 0 ? 'free-tag' : ''}>
                {discount > 0 ? `− ${formatVND(discount)}` : '0₫'}
              </strong>
            </div>
            {nextTier && lines.length > 0 && (
              <p className="pos-hint">
                Mua thêm {formatVND(nextTier.minSubtotal - subtotal)} nữa để được giảm {formatVND(nextTier.discount)}.
              </p>
            )}
            <div className="summary-row grand-total"><span>Khách trả</span><strong>{formatVND(total)}</strong></div>
            {phone.trim() && isPhone(phone) && policy && (
              <p className="pos-hint">
                Khách sẽ được cộng <b>{Math.floor(total / policy.vndPerPoint).toLocaleString('vi-VN')}</b> điểm.
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
                  disabled={busy || lines.length === 0} onClick={save}>
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
          {customer.full_name || customer.phone} được cộng <b>{invoice.points_earned}</b> điểm —
          tổng còn <b>{customer.points.toLocaleString('vi-VN')}</b> điểm.
        </p>
      )}
      <button type="button" className="btn btn-secondary btn-block" onClick={() => window.print()}>
        In hoá đơn
      </button>
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
  const LIMIT = 20;

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
    </>
  );
}
