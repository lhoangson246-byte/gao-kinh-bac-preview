import { useEffect, useState } from 'react';
import { api, DELIVERY_AREA_LABEL, isPhone, mentionsOtherProvince } from '../api';
import { useAuth } from '../context/AuthContext.jsx';

const blankAddress = (user) => ({
  label: 'Nhà riêng',
  receiver_name: user?.full_name || '',
  phone: user?.phone || '',
  address: '',
  is_default: false,
});

const detailOnly = (address) => String(address || '').replace(/,?\s*Bắc Ninh\s*$/i, '');

export default function AddressBook({ selectable = false, selectedId = null, onSelect }) {
  const { user } = useAuth();
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(blankAddress(user));

  const chooseFrom = (list, preferredId = selectedId) => {
    if (!selectable || !onSelect) return;
    const next = list.find((item) => item.id === preferredId)
      || list.find((item) => item.is_default)
      || list[0]
      || null;
    onSelect(next);
  };

  useEffect(() => {
    let active = true;
    api.addresses()
      .then(({ addresses: list }) => {
        if (!active) return;
        setAddresses(list);
        chooseFrom(list);
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
    // Chỉ tải một lần khi mở sổ địa chỉ; lựa chọn sau đó được quản lý tại chỗ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...blankAddress(user), is_default: addresses.length === 0 });
    setFieldErrors({});
    setError('');
    setFormOpen(true);
  };

  const openEdit = (item) => {
    setEditingId(item.id);
    setForm({
      label: item.label || 'Nhà riêng',
      receiver_name: item.receiver_name,
      phone: item.phone,
      address: detailOnly(item.address),
      is_default: !!item.is_default,
    });
    setFieldErrors({});
    setError('');
    setFormOpen(true);
  };

  const closeForm = () => {
    if (busy) return;
    setFormOpen(false);
    setFieldErrors({});
  };

  const validate = () => {
    const errors = {};
    if (form.receiver_name.trim().length < 2) errors.receiver_name = 'Nhập tên người nhận.';
    if (!isPhone(form.phone)) errors.phone = 'Số điện thoại không hợp lệ (ví dụ 0912345678).';
    if (form.address.trim().length < 8) {
      errors.address = 'Nhập số nhà, đường/thôn và phường/xã.';
    } else if (mentionsOtherProvince(form.address)) {
      errors.address = `Cửa hàng chỉ giao trong tỉnh ${DELIVERY_AREA_LABEL}.`;
    }
    return errors;
  };

  const save = async (event) => {
    event.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length) return setFieldErrors(errors);

    setBusy(true);
    setError('');
    setFieldErrors({});
    try {
      const result = editingId
        ? await api.updateAddress(editingId, form)
        : await api.createAddress(form);
      setAddresses(result.addresses);
      chooseFrom(result.addresses, selectable ? result.address.id : selectedId);
      setFormOpen(false);
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.errors || {});
    } finally {
      setBusy(false);
    }
  };

  const setDefault = async (item) => {
    setBusy(true);
    setError('');
    try {
      const result = await api.setDefaultAddress(item.id);
      setAddresses(result.addresses);
      chooseFrom(result.addresses, selectable ? item.id : selectedId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`Xoá địa chỉ “${item.label}”?`)) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.deleteAddress(item.id);
      setAddresses(result.addresses);
      chooseFrom(result.addresses, selectedId === item.id ? null : selectedId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="loading-state address-loading"><span></span>Đang tải sổ địa chỉ…</div>;
  }

  return (
    <div className="address-book">
      <div className="address-toolbar">
        <div>
          <strong>{selectable ? 'Chọn địa chỉ nhận hàng' : 'Địa chỉ của tôi'}</strong>
          <small>{addresses.length}/10 địa chỉ đã lưu</small>
        </div>
        <button type="button" className="btn btn-secondary" onClick={openCreate} disabled={busy || addresses.length >= 10}>
          + Thêm địa chỉ
        </button>
      </div>

      {error && !formOpen && <p className="alert error" role="alert">{error}</p>}

      {addresses.length === 0 ? (
        <button type="button" className="address-empty" onClick={openCreate}>
          <span aria-hidden="true">⌖</span>
          <strong>Thêm địa chỉ giao hàng đầu tiên</strong>
          <small>Địa chỉ sẽ được lưu cho những lần mua sau.</small>
        </button>
      ) : (
        <div className="address-list">
          {addresses.map((item) => {
            const selected = selectable && item.id === selectedId;
            return (
              <article className={`address-card${selectable ? ' selectable' : ''}${selected ? ' selected' : ''}`} key={item.id}>
                {selectable && (
                  <button type="button" className="address-select" onClick={() => onSelect?.(item)} aria-label={`Chọn địa chỉ ${item.label}`}>
                    <span className="address-radio" aria-hidden="true">{selected ? '●' : ''}</span>
                  </button>
                )}
                <div className="address-content" onClick={selectable ? () => onSelect?.(item) : undefined}>
                  <div className="address-name-line">
                    <strong>{item.receiver_name}</strong><span>{item.phone}</span>
                  </div>
                  <p>{item.address}</p>
                  <div className="address-badges">
                    <span>{item.label}</span>
                    {!!item.is_default && <span className="default-badge">Mặc định</span>}
                  </div>
                </div>
                <div className="address-actions">
                  <button type="button" onClick={() => openEdit(item)} disabled={busy}>Sửa</button>
                  {!item.is_default && <button type="button" onClick={() => setDefault(item)} disabled={busy}>Đặt mặc định</button>}
                  <button type="button" className="danger-link" onClick={() => remove(item)} disabled={busy}>Xoá</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {formOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeForm()}>
          <section className="address-modal" role="dialog" aria-modal="true" aria-labelledby="address-modal-title">
            <div className="form-header">
              <div>
                <h2 id="address-modal-title">{editingId ? 'Cập nhật địa chỉ' : 'Địa chỉ mới'}</h2>
                <p>Thông tin này chỉ dùng để giao hàng, không nằm trong form đăng ký.</p>
              </div>
              <button type="button" className="icon-close" onClick={closeForm} aria-label="Đóng">×</button>
            </div>

            {error && <p className="alert error" role="alert">{error}</p>}
            <form onSubmit={save} noValidate>
              <div className="row">
                <label>Họ và tên <b>*</b>
                  <input className="input" value={form.receiver_name}
                         onChange={(e) => setForm({ ...form, receiver_name: e.target.value })}
                         autoComplete="name" autoFocus aria-invalid={!!fieldErrors.receiver_name} />
                  {fieldErrors.receiver_name && <small className="err">{fieldErrors.receiver_name}</small>}
                </label>
                <label>Số điện thoại <b>*</b>
                  <input className="input" value={form.phone} inputMode="tel" autoComplete="tel"
                         onChange={(e) => setForm({ ...form, phone: e.target.value })}
                         aria-invalid={!!fieldErrors.phone} />
                  {fieldErrors.phone && <small className="err">{fieldErrors.phone}</small>}
                </label>
              </div>

              <label>Địa chỉ chi tiết <b>*</b>
                <textarea className="input" rows={3} value={form.address} autoComplete="street-address"
                          onChange={(e) => setForm({ ...form, address: e.target.value })}
                          placeholder="Số nhà, đường/thôn, phường/xã" aria-invalid={!!fieldErrors.address} />
                {fieldErrors.address
                  ? <small className="err">{fieldErrors.address}</small>
                  : <small className="field-help">Khu vực giao hàng: tỉnh {DELIVERY_AREA_LABEL}.</small>}
              </label>

              <label>Loại địa chỉ
                <select className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}>
                  <option>Nhà riêng</option>
                  <option>Văn phòng</option>
                  <option>Nhà người thân</option>
                  <option>Khác</option>
                </select>
              </label>

              <label className="checkbox-label">
                <input type="checkbox" checked={form.is_default}
                       onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
                Đặt làm địa chỉ mặc định
              </label>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={busy}>Trở lại</button>
                <button className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Hoàn thành'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
