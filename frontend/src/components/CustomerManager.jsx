import { generatePassword, passwordError } from '../password';
import { useCallback, useEffect, useState } from 'react';
import { api, formatDateTime, formatVND } from '../api';

const LIMIT = 20;

export default function CustomerManager() {
  const [q, setQ] = useState('');
  const [locked, setLocked] = useState('');       // '' | '1' | '0'
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [opened, setOpened] = useState(null);     // id khách đang mở chi tiết
  const [detail, setDetail] = useState(null);
  const [resetFor, setResetFor] = useState(null); // khách đang đặt lại mật khẩu

  const notify = (text) => {
    setMsg(text);
    window.setTimeout(() => setMsg(''), 4000);
  };

  const load = useCallback(async (nextOffset = 0, filters) => {
    setLoading(true);
    setError('');
    const f = filters ?? { q, locked };
    try {
      const r = await api.adminCustomers({ ...f, limit: LIMIT, offset: nextOffset });
      setCustomers(r.customers);
      setTotal(r.total);
      setOffset(nextOffset);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [q, locked]);

  useEffect(() => { load(0, { q: '', locked: '' }); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const openDetail = async (customer) => {
    if (opened === customer.id) { setOpened(null); setDetail(null); return; }
    setOpened(customer.id);
    setDetail(null);
    try {
      setDetail(await api.adminCustomer(customer.id));
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleLock = async (customer) => {
    const lock = !customer.is_locked;
    const question = lock
      ? `Khoá tài khoản “${customer.full_name}”? Khách sẽ không đăng nhập và không đặt hàng được nữa.`
      : `Mở khoá tài khoản “${customer.full_name}”?`;
    if (!window.confirm(question)) return;

    setBusyId(customer.id);
    setError('');
    try {
      const r = await api.adminLockCustomer(customer.id, lock);
      setCustomers((cur) => cur.map((c) => (c.id === customer.id ? r.customer : c)));
      notify(r.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const rename = async (customer) => {
    const name = window.prompt('Tên khách hàng:', customer.full_name);
    if (name === null || name.trim() === customer.full_name) return;
    setBusyId(customer.id);
    try {
      const r = await api.adminRenameCustomer(customer.id, name.trim());
      setCustomers((cur) => cur.map((c) => (c.id === customer.id ? { ...c, ...r.customer } : c)));
      notify('Đã đổi tên khách hàng.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const submit = (e) => { e.preventDefault(); load(0); };

  return (
    <section aria-label="Quản lý tài khoản khách hàng">
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow dark"><span></span>Tài khoản</p>
          <h1>Khách hàng</h1>
          <p>Xem tài khoản khách, đặt lại mật khẩu khi khách quên và khoá tài khoản phá rối.</p>
        </div>
      </div>

      <div className="alert info" role="note">
        Mật khẩu của khách được <strong>băm một chiều</strong> nên không ai — kể cả cửa hàng —
        đọc lại được. Khi khách quên, cửa hàng đặt một mật khẩu mới rồi đọc cho khách.
      </div>

      <form className="pos-filter customer-filter" onSubmit={submit}>
        <label>Tìm khách
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Tên, số điện thoại hoặc email" />
        </label>
        <label>Trạng thái
          <select className="input" value={locked} onChange={(e) => setLocked(e.target.value)}>
            <option value="">Tất cả</option>
            <option value="0">Đang hoạt động</option>
            <option value="1">Đang bị khoá</option>
          </select>
        </label>
        <div className="pos-filter-actions">
          <button className="btn btn-primary">Tìm</button>
          <button type="button" className="btn btn-ghost"
                  onClick={() => { setQ(''); setLocked(''); load(0, { q: '', locked: '' }); }}>
            Xoá lọc
          </button>
        </div>
      </form>

      {error && <div className="alert error" role="alert">{error}</div>}
      {msg && <div className="toast success" role="status"><span>✓</span>{msg}</div>}

      {resetFor && (
        <ResetPasswordBox
          customer={resetFor}
          onClose={() => setResetFor(null)}
          onDone={(text) => { setResetFor(null); notify(text); }}
        />
      )}

      {loading ? (
        <div className="loading-state" role="status"><span></span>Đang tải danh sách khách…</div>
      ) : customers.length === 0 ? (
        <div className="admin-empty">
          <span>?</span><h2>Không tìm thấy khách hàng nào</h2>
          <p>Thử bỏ bớt điều kiện lọc, hoặc chưa có khách nào đăng ký.</p>
        </div>
      ) : (
        <>
          <p className="pos-result-count">
            Tìm thấy <strong>{total}</strong> khách
            {total > LIMIT && ` · đang xem ${offset + 1}–${Math.min(offset + LIMIT, total)}`}
          </p>

          <div className="customer-list">
            {customers.map((c) => (
              <article key={c.id} className={`customer-row${c.is_locked ? ' locked' : ''}`}>
                <div className="customer-main">
                  <h2>
                    {c.full_name}
                    {c.is_locked === 1 && <span className="lock-tag">Đang bị khoá</span>}
                  </h2>
                  <p>
                    <a href={`tel:${c.phone}`} className="phone-link">{c.phone || '—'}</a>
                    {c.email && <span className="customer-email"> · {c.email}</span>}
                  </p>
                  <small>Đăng ký {formatDateTime(c.created_at)}</small>
                </div>

                <div className="customer-figures">
                  <div><span>Đơn đã đặt</span><strong>{c.order_count}</strong></div>
                  <div><span>Đã mua</span><strong>{formatVND(c.spent)}</strong></div>
                </div>

                <div className="customer-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => openDetail(c)}
                          aria-expanded={opened === c.id}>
                    {opened === c.id ? 'Đóng' : 'Chi tiết'}
                  </button>
                  <button type="button" className="btn btn-secondary" disabled={busyId === c.id}
                          onClick={() => rename(c)}>Đổi tên</button>
                  <button type="button" className="btn btn-secondary"
                          onClick={() => setResetFor(c)}>Đặt lại mật khẩu</button>
                  <button type="button"
                          className={c.is_locked ? 'btn btn-primary' : 'btn btn-danger-ghost'}
                          disabled={busyId === c.id} onClick={() => toggleLock(c)}>
                    {c.is_locked ? 'Mở khoá' : 'Khoá'}
                  </button>
                </div>

                {opened === c.id && (
                  <div className="customer-detail">
                    {!detail ? (
                      <div className="loading-state" role="status"><span></span>Đang tải…</div>
                    ) : (
                      <>
                        <h3>Địa chỉ đã lưu ({detail.addresses.length})</h3>
                        {detail.addresses.length === 0 ? (
                          <p className="muted small">Khách chưa lưu địa chỉ nào.</p>
                        ) : (
                          <ul className="customer-sublist">
                            {detail.addresses.map((a) => (
                              <li key={a.id}>
                                <span>
                                  <strong>{a.label || 'Địa chỉ'}{a.is_default ? ' · mặc định' : ''}</strong>
                                  <small>{a.receiver_name} · {a.phone} — {a.address}</small>
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}

                        <h3>Đơn gần đây ({detail.orders.length})</h3>
                        {detail.orders.length === 0 ? (
                          <p className="muted small">Khách chưa đặt đơn nào.</p>
                        ) : (
                          <ul className="customer-sublist">
                            {detail.orders.map((o) => (
                              <li key={o.id}>
                                <span>
                                  <strong>Đơn #{o.id}</strong>
                                  <small>{formatDateTime(o.created_at)} · {o.status}</small>
                                </span>
                                <strong>{formatVND(o.total)}</strong>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>

          {total > LIMIT && (
            <div className="pos-pager">
              <button type="button" className="btn btn-secondary" disabled={offset === 0}
                      onClick={() => load(Math.max(0, offset - LIMIT))}>← Trang trước</button>
              <button type="button" className="btn btn-secondary" disabled={offset + LIMIT >= total}
                      onClick={() => load(offset + LIMIT)}>Trang sau →</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Hộp đặt lại mật khẩu
 * ------------------------------------------------------------------ */
function ResetPasswordBox({ customer, onClose, onDone }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** Mật khẩu gợi ý dễ đọc cho khách qua điện thoại. */
  const suggest = () => {
    setPassword(generatePassword());
    setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (passwordError(password)) { setError(passwordError(password)); return; }
    setBusy(true);
    try {
      await api.adminResetPassword(customer.id, password);
      onDone(`Đã đặt lại mật khẩu cho ${customer.full_name}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="reset-box" onSubmit={submit}>
      <div className="form-header">
        <div>
          <h2>Đặt lại mật khẩu</h2>
          <p>Cho tài khoản <strong>{customer.full_name}</strong> ({customer.phone})</p>
        </div>
        <button type="button" className="icon-close" onClick={onClose} aria-label="Đóng">×</button>
      </div>

      <label>Mật khẩu mới
        <div className="pos-phone-row">
          <input className="input" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                 minLength={12} placeholder="Tối thiểu 12 ký tự" autoComplete="new-password"
                 aria-invalid={!!error} />
          <button type="button" className="btn btn-secondary" onClick={suggest}>Gợi ý</button>
          <button type="button" className="btn btn-secondary" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Ẩn' : 'Hiện'}</button>
        </div>
        {error
          ? <small className="err">{error}</small>
          : <small className="field-help">Hiện mật khẩu để đọc cho khách trước khi lưu. Nhắc khách tự đổi lại sau khi đăng nhập.</small>}
      </label>

      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Đang lưu…' : 'Đặt lại mật khẩu'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Bỏ qua</button>
      </div>
    </form>
  );
}
