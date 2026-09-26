import { useEffect, useState } from 'react';
import { api } from '../api';
import ImagePicker from './ImagePicker.jsx';

/**
 * Đổi ảnh banner đầu trang chủ. Ảnh chỉ đổi trên trang khi bấm "Lưu banner",
 * nên cửa hàng có thể thử vài ảnh trước khi chốt.
 */
export default function BannerSettings({ notify }) {
  const [saved, setSaved] = useState(null);     // null = đang tải
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.storefront()
      .then(({ settings }) => {
        if (cancelled) return;
        setSaved(settings?.banner_image_url || '');
        setDraft(settings?.banner_image_url || '');
      })
      .catch((err) => { if (!cancelled) { setSaved(''); setError(err.message); } });
    return () => { cancelled = true; };
  }, []);

  const dirty = saved !== null && draft !== saved;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const { settings } = await api.adminUpdateStorefront({ banner_image_url: draft });
      setSaved(settings.banner_image_url || '');
      setDraft(settings.banner_image_url || '');
      notify(settings.banner_image_url ? 'Đã đổi ảnh banner trang chủ.' : 'Đã bỏ ảnh banner, trang chủ dùng banner màu.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="banner-settings form-card flat" aria-labelledby="banner-settings-title">
      <div className="banner-settings-head">
        <div>
          <h2 id="banner-settings-title">Ảnh banner trang chủ</h2>
          <p>Ảnh nằm ở đầu trang khách thấy đầu tiên. Đổi khi có đợt khuyến mãi hay mùa vụ mới.</p>
        </div>
        <span className={`banner-state${saved ? ' on' : ''}`}>{saved === null ? 'Đang tải…' : saved ? 'Đang dùng ảnh' : 'Đang dùng banner màu'}</span>
      </div>

      <ImagePicker
        wide
        optional={false}
        label="Ảnh banner"
        subject="banner"
        maxEdge={1920}
        value={draft}
        error={error}
        onChange={(url) => { setDraft(url); setError(''); }}
      />
      <p className="field-help banner-tip">
        Nên dùng ảnh ngang khoảng 1600 × 500 px, và <b>không có chữ</b> trong ảnh vì tiêu đề
        trang chủ sẽ nằm đè lên. Phần giữa ảnh luôn được giữ, hai mép trên dưới có thể bị cắt
        trên điện thoại. Lớp phủ tối giúp tiêu đề luôn đọc rõ.
      </p>

      <div className="form-actions">
        <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={save}>
          {busy ? 'Đang lưu…' : 'Lưu banner'}
        </button>
        {dirty && (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setDraft(saved); setError(''); }}>
            Huỷ thay đổi
          </button>
        )}
      </div>
    </section>
  );
}
