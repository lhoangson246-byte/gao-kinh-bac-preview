import { useEffect, useState } from 'react';
import { api, isPhone, normalizePhone } from '../api';
import ImagePicker from './ImagePicker.jsx';

const MAX_BANNERS = 6;

const sameList = (a, b) => a.length === b.length && a.every((item, i) => item === b[i]);
const MAX_BRANCHES = 5;
const blankBranch = () => ({ name: '', address: '', phone: '' });
/** So sánh danh sách cơ sở sau khi bỏ dòng trống. */
const cleanBranches = (list) => list
  .map((b) => ({ name: b.name.trim(), address: b.address.trim(), phone: normalizePhone(b.phone) || b.phone.trim() }))
  .filter((b) => b.name || b.address || b.phone);

/**
 * Trang chủ: các ảnh banner chạy vòng (mỗi 2,5 giây) và số điện thoại tư vấn.
 * Chỉ đổi trên trang khi bấm "Lưu", nên cửa hàng có thể thử trước khi chốt.
 */
export default function BannerSettings({ notify }) {
  const [saved, setSaved] = useState(null);     // null = đang tải
  const [images, setImages] = useState([]);
  const [phone, setPhone] = useState('');
  const [branches, setBranches] = useState([]);
  const [editing, setEditing] = useState(null); // vị trí ảnh đang mở ô chọn ảnh
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const load = (settings) => {
    const list = settings?.banner_images || (settings?.banner_image_url ? [settings.banner_image_url] : []);
    const next = {
      images: list,
      phone: settings?.contact_phone || '',
      branches: (settings?.branches || []).map((b) => ({ name: b.name || '', address: b.address || '', phone: b.phone || '' })),
    };
    setSaved(next);
    setImages(next.images);
    setPhone(next.phone);
    setBranches(next.branches);
    setEditing(null);
  };

  useEffect(() => {
    let cancelled = false;
    api.storefront()
      .then(({ settings }) => { if (!cancelled) load(settings); })
      .catch((err) => { if (!cancelled) { load({}); setError(err.message); } });
    return () => { cancelled = true; };
  }, []);

  const cleanImages = images.filter(Boolean);
  const dirty = saved !== null && (!sameList(cleanImages, saved.images) || normalizePhone(phone) !== saved.phone
    || (phone.trim() !== '' && !isPhone(phone))
    || JSON.stringify(cleanBranches(branches)) !== JSON.stringify(cleanBranches(saved.branches)));
  const setBranch = (index, field, value) => {
    setBranches((list) => list.map((b, i) => (i === index ? { ...b, [field]: value } : b)));
    setFieldErrors((current) => ({ ...current, branches: undefined }));
  };

  const setImage = (index, url) => setImages((list) => list.map((item, i) => (i === index ? url : item)));
  const removeImage = (index) => {
    setImages((list) => list.filter((_, i) => i !== index));
    setEditing(null);
  };
  const move = (index, step) => {
    setImages((list) => {
      const next = [...list];
      const target = index + step;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setEditing(null);
  };
  const addSlot = () => {
    setImages((list) => [...list.filter(Boolean), '']);
    setEditing(cleanImages.length);
  };

  const save = async () => {
    setError('');
    setFieldErrors({});
    if (phone.trim() && !isPhone(phone)) {
      setFieldErrors({ contact_phone: 'Số điện thoại không hợp lệ (10 số, ví dụ 0912345678).' });
      return;
    }
    const branchList = cleanBranches(branches);
    const badBranch = branchList.findIndex((b) => b.address.length < 8 || (b.phone && !isPhone(b.phone)));
    if (badBranch !== -1) {
      const b = branchList[badBranch];
      setFieldErrors({
        branches: b.address.length < 8
          ? `Cơ sở ${badBranch + 1}: nhập địa chỉ đầy đủ (số nhà, đường, phường/xã).`
          : `Cơ sở ${badBranch + 1}: số điện thoại không hợp lệ.`,
      });
      return;
    }
    setBusy(true);
    try {
      const { settings } = await api.adminUpdateStorefront({
        banner_images: cleanImages,
        contact_phone: normalizePhone(phone),
        branches: branchList.map((b) => ({ name: b.name, address: b.address, phone: normalizePhone(b.phone) })),
      });
      load(settings);
      notify('Đã lưu banner, số tư vấn và các cơ sở cửa hàng.');
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.errors || {});
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setImages(saved.images);
    setPhone(saved.phone);
    setBranches(saved.branches);
    setEditing(null);
    setError('');
    setFieldErrors({});
  };

  const state = saved === null ? 'Đang tải…'
    : saved.images.length ? `${saved.images.length} ảnh đang chạy` : 'Đang dùng banner màu';

  return (
    <section className="banner-settings form-card flat" aria-labelledby="banner-settings-title">
      <div className="banner-settings-head">
        <div>
          <h2 id="banner-settings-title">Trang chủ: banner và liên hệ</h2>
          <p>
            Banner chạy vòng mỗi 2,5 giây: slide đầu là lời chào “Chọn gạo cho nhà mình”, sau đó
            lần lượt các ảnh dưới đây theo đúng thứ tự. Tối đa {MAX_BANNERS} ảnh.
          </p>
        </div>
        <span className={`banner-state${saved?.images.length ? ' on' : ''}`}>{state}</span>
      </div>

      {error && <p className="alert error" role="alert">{error}</p>}

      {cleanImages.length > 0 || editing !== null ? (
        <ol className="banner-list">
          {images.map((url, index) => (
            <li key={index} className={editing === index ? 'editing' : ''}>
              <div className="banner-row">
                <span className="banner-order">{index + 1}</span>
                {url
                  ? <img src={url} alt="" className="banner-thumb" />
                  : <span className="banner-thumb empty">Chưa chọn ảnh</span>}
                <div className="banner-row-actions">
                  <button type="button" className="btn btn-secondary" disabled={busy || index === 0}
                          onClick={() => move(index, -1)} aria-label={`Đưa ảnh ${index + 1} lên trước`}>↑</button>
                  <button type="button" className="btn btn-secondary" disabled={busy || index === images.length - 1}
                          onClick={() => move(index, 1)} aria-label={`Đưa ảnh ${index + 1} ra sau`}>↓</button>
                  <button type="button" className="btn btn-secondary" disabled={busy}
                          onClick={() => setEditing(editing === index ? null : index)}>
                    {editing === index ? 'Đóng' : 'Đổi ảnh'}
                  </button>
                  <button type="button" className="btn btn-danger" disabled={busy}
                          onClick={() => removeImage(index)}>Bỏ</button>
                </div>
              </div>
              {editing === index && (
                <ImagePicker
                  wide
                  optional={false}
                  label={`Ảnh banner ${index + 1}`}
                  subject="banner"
                  maxEdge={1920}
                  value={url}
                  error={fieldErrors.banner_images}
                  onChange={(next) => setImage(index, next)}
                />
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted banner-empty">Chưa có ảnh nào — trang chủ chỉ hiện slide lời chào màu xanh.</p>
      )}

      <button type="button" className="btn btn-secondary" onClick={addSlot}
              disabled={busy || cleanImages.length >= MAX_BANNERS}>
        + Thêm ảnh banner
      </button>
      <p className="field-help banner-tip">
        Ảnh luôn hiện <b>trọn vẹn</b>, không bị chữ che, nên ảnh có sẵn chữ khuyến mãi vẫn đọc rõ.
        Nên dùng ảnh ngang tỉ lệ khoảng 3 : 1 (ví dụ 1500 × 500 px) để ảnh lấp kín khung; ảnh
        tỉ lệ khác sẽ có viền mờ hai bên.
      </p>

      <label className="contact-phone-field">Số điện thoại tư vấn (hiện dưới banner)
        <input className="input" value={phone} inputMode="tel" autoComplete="off" placeholder="Ví dụ 0912345678"
               onChange={(e) => { setPhone(e.target.value); setFieldErrors((current) => ({ ...current, contact_phone: undefined })); }}
               aria-invalid={!!fieldErrors.contact_phone} />
        {fieldErrors.contact_phone
          ? <small className="err">{fieldErrors.contact_phone}</small>
          : <small className="field-help">
              Khách thấy khung “Bạn cần tìm gạo chất lượng cho nhà hàng, khách sạn? Liên hệ để được tư vấn
              ngay hôm nay” kèm nút gọi số này. Để trống thì khung liên hệ được ẩn.
            </small>}
      </label>

      <fieldset className="branches-field">
        <legend>Các cơ sở cửa hàng (hiện ở chân trang)</legend>
        <p className="field-help">
          Khách thấy tên, địa chỉ, nút chỉ đường Google Maps và số điện thoại của từng cơ sở ở cuối mọi
          trang. Chưa nhập cơ sở nào thì phần này được ẩn. Tối đa {MAX_BRANCHES} cơ sở.
        </p>
        {branches.map((branch, index) => (
          <div className="branch-row" key={index}>
            <span className="banner-order">{index + 1}</span>
            <input className="input" value={branch.name} placeholder="Tên, ví dụ: Cơ sở chính"
                   aria-label={`Tên cơ sở ${index + 1}`} onChange={(e) => setBranch(index, 'name', e.target.value)} />
            <input className="input branch-address" value={branch.address} placeholder="Số nhà, đường, phường/xã, tỉnh"
                   aria-label={`Địa chỉ cơ sở ${index + 1}`} onChange={(e) => setBranch(index, 'address', e.target.value)} />
            <input className="input" value={branch.phone} inputMode="tel" placeholder="SĐT (không bắt buộc)"
                   aria-label={`Số điện thoại cơ sở ${index + 1}`} onChange={(e) => setBranch(index, 'phone', e.target.value)} />
            <button type="button" className="btn btn-danger" disabled={busy}
                    onClick={() => setBranches((list) => list.filter((_, i) => i !== index))}>Bỏ</button>
          </div>
        ))}
        {fieldErrors.branches && <small className="err">{fieldErrors.branches}</small>}
        <button type="button" className="btn btn-secondary" disabled={busy || branches.length >= MAX_BRANCHES}
                onClick={() => setBranches((list) => [...list, blankBranch()])}>+ Thêm cơ sở</button>
      </fieldset>

      <div className="form-actions">
        <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={save}>
          {busy ? 'Đang lưu…' : 'Lưu trang chủ'}
        </button>
        {dirty && (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={reset}>
            Huỷ thay đổi
          </button>
        )}
      </div>
    </section>
  );
}
