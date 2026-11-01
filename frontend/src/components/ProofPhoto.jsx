import { useId, useState } from 'react';
import { api } from '../api';
import { shrink } from './ImagePicker.jsx';

/**
 * Nút chụp ảnh chứng từ trên điện thoại (mở thẳng camera sau). Ảnh được thu nhỏ trên máy rồi tải lên
 * kho ảnh riêng tư của cửa hàng; `value` = { id, url } sau khi tải xong.
 */
export default function ProofPhoto({ label, value, onChange, error }) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const pick = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setUploadError('');
    try {
      const blob = await shrink(file, 1600);
      const uploaded = await api.uploadProof(blob);
      onChange({ id: uploaded.id, url: uploaded.url });
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`proof-photo${value ? ' done' : ''}`}>
      <input id={inputId} type="file" accept="image/*" capture="environment" onChange={pick} className="sr-only" />
      {value ? (
        <div className="proof-photo-preview">
          <a href={value.url} target="_blank" rel="noopener noreferrer"><img src={value.url} alt={label} /></a>
          <span>✅ {label}</span>
          <label htmlFor={inputId} className="link-button">Chụp lại</label>
        </div>
      ) : (
        <label htmlFor={inputId} className={`btn btn-secondary btn-block proof-photo-button${busy ? ' busy' : ''}`}>
          {busy ? 'Đang tải ảnh…' : `📷 ${label}`}
        </label>
      )}
      {(uploadError || error) && <small className="err" role="alert">{uploadError || error}</small>}
    </div>
  );
}
