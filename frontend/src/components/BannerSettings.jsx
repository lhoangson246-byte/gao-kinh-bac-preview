import { useEffect, useState } from 'react';
import { api, isPhone, normalizePhone } from '../api';
import ImagePicker from './ImagePicker.jsx';

const MAX_BANNERS = 6;

const sameList = (a, b) => a.length === b.length && a.every((item, i) => item === b[i]);

/**
 * Trang chủ: các ảnh banner chạy vòng (mỗi 2,5 giây) và số điện thoại tư vấn.
 * Chỉ đổi trên trang khi bấm "Lưu", nên cửa hàng có thể thử trước khi chốt.
 */
export default function BannerSettings({ notify }) {
  const [saved, setSaved] = useState(null);     // null = đang tải
  const [images, setImages] = useState([]);
  const [phone, setPhone] = useState('');
  const [editing, setEditing] = useState(null); // vị trí ảnh đang mở ô chọn ảnh
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const load = (settings) => {
    const list = settings?.banner_images || (settings?.banner_image_url ? [settings.banner_image_url] : []);
    const next = { images: list, phone: settings?.contact_phone || '' };
    setSaved(next);
    setImages(next.images);
    setPhone(next.phone);
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
    || (phone.trim() !== '' && !isPhone(phone)));

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
    setBusy(true);
    try {
      const { settings } = await api.adminUpdateStorefront({
        banner_images: cleanImages,
        contact_phone: normalizePhone(phone),
      });
      load(settings);
      notify('Đã lưu banner và số điện thoại tư vấn trang chủ.');
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
