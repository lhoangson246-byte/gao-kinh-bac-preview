import { useEffect, useState } from 'react';
import { api, isPhone, mentionsOtherProvince } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';

// Nhãn lưu trong cơ sở dữ liệu luôn là tiếng Việt; chỉ chữ hiển thị được dịch.
const ADDRESS_LABELS = ['Nhà riêng', 'Văn phòng', 'Nhà người thân', 'Khác'];

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
  const { t } = useI18n();
  const labelText = (label) => (ADDRESS_LABELS.includes(label) ? t(`addressLabel.${label}`) : label);
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
    if (form.receiver_name.trim().length < 2) errors.receiver_name = t('address.errName');
    if (!isPhone(form.phone)) errors.phone = t('address.errPhone');
    if (form.address.trim().length < 8) {
      errors.address = t('address.errDetail');
    } else if (mentionsOtherProvince(form.address)) {
      errors.address = t('address.errArea');
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
    if (!window.confirm(t('address.confirmDelete', { label: labelText(item.label) }))) return;
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
    return <div className="loading-state address-loading"><span></span>{t('address.loading')}</div>;
  }

  return (
    <div className="address-book">
      <div className="address-toolbar">
        <div>
          <strong>{selectable ? t('address.choose') : t('address.mine')}</strong>
          <small>{t('address.count', { n: addresses.length })}</small>
        </div>
        <button type="button" className="btn btn-secondary" onClick={openCreate} disabled={busy || addresses.length >= 10}>
          {t('address.add')}
        </button>
      </div>

      {error && !formOpen && <p className="alert error" role="alert">{error}</p>}

      {addresses.length === 0 ? (
        <button type="button" className="address-empty" onClick={openCreate}>
          <span aria-hidden="true">⌖</span>
          <strong>{t('address.firstTitle')}</strong>
          <small>{t('address.firstBody')}</small>
        </button>
      ) : (
        <div className="address-list">
          {addresses.map((item) => {
            const selected = selectable && item.id === selectedId;
            return (
              <article className={`address-card${selectable ? ' selectable' : ''}${selected ? ' selected' : ''}`} key={item.id}>
                {selectable && (
                  <button type="button" className="address-select" onClick={() => onSelect?.(item)} aria-label={t('address.selectAria', { label: labelText(item.label) })}>
                    <span className="address-radio" aria-hidden="true">{selected ? '●' : ''}</span>
                  </button>
                )}
                <div className="address-content" onClick={selectable ? () => onSelect?.(item) : undefined}>
                  <div className="address-name-line">
                    <strong>{item.receiver_name}</strong><span>{item.phone}</span>
                  </div>
                  <p>{item.address}</p>
                  <div className="address-badges">
                    <span>{labelText(item.label)}</span>
                    {!!item.is_default && <span className="default-badge">{t('address.default')}</span>}
                  </div>
                </div>
                <div className="address-actions">
                  <button type="button" onClick={() => openEdit(item)} disabled={busy}>{t('address.edit')}</button>
                  {!item.is_default && <button type="button" onClick={() => setDefault(item)} disabled={busy}>{t('address.makeDefault')}</button>}
                  <button type="button" className="danger-link" onClick={() => remove(item)} disabled={busy}>{t('address.delete')}</button>
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
                <h2 id="address-modal-title">{editingId ? t('address.updateTitle') : t('address.newTitle')}</h2>
                <p>{t('address.formHint')}</p>
              </div>
              <button type="button" className="icon-close" onClick={closeForm} aria-label={t('common.close')}>×</button>
            </div>

            {error && <p className="alert error" role="alert">{error}</p>}
            <form onSubmit={save} noValidate>
              <div className="row">
                <label>{t('address.fullName')} <b>*</b>
                  <input className="input" value={form.receiver_name}
                         onChange={(e) => setForm({ ...form, receiver_name: e.target.value })}
                         autoComplete="name" autoFocus aria-invalid={!!fieldErrors.receiver_name} />
                  {fieldErrors.receiver_name && <small className="err">{fieldErrors.receiver_name}</small>}
                </label>
                <label>{t('address.phone')} <b>*</b>
                  <input className="input" value={form.phone} inputMode="tel" autoComplete="tel"
                         onChange={(e) => setForm({ ...form, phone: e.target.value })}
                         aria-invalid={!!fieldErrors.phone} />
                  {fieldErrors.phone && <small className="err">{fieldErrors.phone}</small>}
                </label>
              </div>

              <label>{t('address.detail')} <b>*</b>
                <textarea className="input" rows={3} value={form.address} autoComplete="street-address"
                          onChange={(e) => setForm({ ...form, address: e.target.value })}
                          placeholder={t('address.detailPlaceholder')} aria-invalid={!!fieldErrors.address} />
                {fieldErrors.address
                  ? <small className="err">{fieldErrors.address}</small>
                  : <small className="field-help">{t('address.area')}</small>}
              </label>

              <label>{t('address.type')}
                <select className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}>
                  {ADDRESS_LABELS.map((label) => (
                    <option key={label} value={label}>{labelText(label)}</option>
                  ))}
                </select>
              </label>

              <label className="checkbox-label">
                <input type="checkbox" checked={form.is_default}
                       onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
                {t('address.setDefault')}
              </label>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={busy}>{t('address.back')}</button>
                <button className="btn btn-primary" disabled={busy}>{busy ? t('common.saving') : t('address.done')}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
