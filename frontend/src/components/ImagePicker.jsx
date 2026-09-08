import { useEffect, useRef, useState } from 'react';
import { api, formatDateTime } from '../api';

/** Cạnh dài nhất sau khi thu nhỏ. Đủ nét cho thẻ sản phẩm và trang chi tiết. */
const MAX_EDGE = 1200;
const JPEG_QUALITY = 0.82;

/**
 * Thu nhỏ ảnh ngay trên máy trước khi gửi đi.
 * Ảnh chụp bằng điện thoại thường 4–8MB; sau bước này chỉ còn khoảng 150–300KB
 * nên tải nhanh và không làm phình cơ sở dữ liệu của cửa hàng.
 */
function shrink(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      // Ảnh gạo hay có nền trắng; PNG trong suốt chuyển sang JPG mà không tô nền
      // sẽ ra nền đen, nên tô trắng trước.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Không xử lý được ảnh này.'))),
        'image/jpeg',
        JPEG_QUALITY
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không mở được tệp này. Vui lòng chọn ảnh JPG, PNG hoặc WEBP.'));
    };
    img.src = url;
  });
}

/**
 * Ô chọn ảnh sản phẩm. Có bốn cách đưa ảnh vào, dùng cách nào cũng được:
 * chọn tệp, kéo thả, dán bằng Ctrl+V, hoặc lấy lại ảnh đã có trong thư viện.
 */
export default function ImagePicker({ value, onChange, error }) {
  const inputRef = useRef(null);
  const zoneRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragging, setDragging] = useState(false);

  const [libraryOpen, setLibraryOpen] = useState(false);
  const [library, setLibrary] = useState(null);
  const [libraryError, setLibraryError] = useState('');

  const send = async (file) => {
    if (!file) return;
    setUploadError('');
    setBusy(true);
    try {
      const blob = await shrink(file);
      const { url } = await api.adminUploadImage(blob);
      onChange(url);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const pick = (e) => {
    const file = e.target.files?.[0];
    // Cho phép chọn lại đúng tệp vừa chọn nếu lần trước lỗi.
    e.target.value = '';
    send(file);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    send(e.dataTransfer.files?.[0]);
  };

  // Dán ảnh bằng Ctrl+V khi con trỏ đang ở trong ô ảnh.
  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return undefined;
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (!item) return;
      e.preventDefault();
      send(item.getAsFile());
    };
    zone.addEventListener('paste', onPaste);
    return () => zone.removeEventListener('paste', onPaste);
  });

  const openLibrary = async () => {
    const next = !libraryOpen;
    setLibraryOpen(next);
    if (!next || library) return;
    setLibraryError('');
    try {
      setLibrary(await api.adminImageLibrary());
    } catch (err) {
      setLibraryError(err.message);
    }
  };

  const choose = (url) => {
    setUploadError('');
    onChange(url);
    setLibraryOpen(false);
  };

  const libraryItems = library
    ? [
        ...library.uploaded.map((i) => ({ url: i.url, label: formatDateTime(i.created_at) })),
        ...library.inUse.map((i) => ({ url: i.url, label: i.product_name })),
      ]
    : [];

  return (
    <div className="image-picker">
      <span className="image-picker-label">
        Ảnh sản phẩm <span className="optional">Không bắt buộc</span>
      </span>

      <div className="image-picker-row">
        {/* Ô này vừa xem trước, vừa nhận ảnh kéo thả và ảnh dán bằng Ctrl+V. */}
        <div
          ref={zoneRef}
          className={`image-drop${dragging ? ' dragging' : ''}${busy ? ' busy' : ''}`}
          tabIndex={0}
          role="button"
          aria-label="Thả ảnh vào đây, dán bằng Ctrl V, hoặc bấm để chọn tệp"
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); }
          }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {value && !busy
            ? <img src={value} alt="" onError={(e) => { e.currentTarget.src = '/logo-mark.png'; }} />
            : <span className="image-drop-hint">{busy ? 'Đang tải ảnh…' : 'Thả ảnh vào đây'}</span>}
        </div>

        <div className="image-picker-actions">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={pick}
          />
          <button type="button" className="btn btn-primary" disabled={busy}
                  onClick={() => inputRef.current?.click()}>
            {busy ? 'Đang tải ảnh…' : value ? 'Đổi ảnh khác' : 'Chọn ảnh từ máy'}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={openLibrary}>
            {libraryOpen ? 'Đóng thư viện' : 'Chọn từ ảnh đã có'}
          </button>
          {value && (
            <button type="button" className="link-button danger" disabled={busy}
                    onClick={() => { setUploadError(''); onChange(''); }}>
              Bỏ ảnh
            </button>
          )}
          <small className="field-help">
            Ba cách đều được: bấm nút để chọn tệp, kéo ảnh thả vào ô bên trái,
            hoặc bấm vào ô rồi nhấn <b>Ctrl + V</b> để dán ảnh vừa sao chép.
            Chụp bằng điện thoại cũng được — ảnh sẽ tự thu nhỏ.
          </small>
        </div>
      </div>

      {(uploadError || error) && <small className="err">{uploadError || error}</small>}

      {libraryOpen && (
        <div className="image-library">
          {libraryError && <small className="err">{libraryError}</small>}
          {!library && !libraryError && <p className="pos-hint">Đang mở thư viện ảnh…</p>}
          {library && libraryItems.length === 0 && (
            <p className="pos-hint">Chưa có ảnh nào để chọn lại. Hãy tải ảnh đầu tiên lên.</p>
          )}
          {libraryItems.length > 0 && (
            <>
              <p className="pos-hint">Bấm vào một ảnh để dùng cho loại gạo này.</p>
              <div className="image-library-grid">
                {libraryItems.map((item) => (
                  <button
                    key={item.url}
                    type="button"
                    className={`image-library-item${item.url === value ? ' selected' : ''}`}
                    onClick={() => choose(item.url)}
                    title={item.label}
                  >
                    <img src={item.url} alt="" loading="lazy" />
                    <small>{item.label}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <details className="image-picker-manual">
        <summary>Hoặc dán đường dẫn ảnh có sẵn</summary>
        <input
          className="input"
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/products/ten-anh.jpg hoặc https://…"
        />
      </details>
    </div>
  );
}
