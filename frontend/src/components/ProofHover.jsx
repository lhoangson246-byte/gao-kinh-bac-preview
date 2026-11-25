import { useRef, useState } from 'react';
import { formatDateTime } from '../api';

const CARD_W = 240;

/** Giờ dạng "14:05" nếu là hôm nay, còn lại "25/11 14:05". */
export function shortTime(value) {
  if (!value) return '';
  const date = new Date(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return formatDateTime(value);
  const time = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return date.toDateString() === new Date().toDateString() ? time
    : `${date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} ${time}`;
}

/**
 * Trạng thái "Đã giao" (25/11/2026): rê chuột (hoặc chạm trên điện thoại) vào trạng thái thì hiện ảnh gạo đã giao
 * shipper chụp, giờ chụp, giờ bắt đầu giao và giờ hoàn thành. Khung nổi đặt cố định theo màn hình nên không bị
 * danh sách cuộn cắt mất; ảnh chỉ tải khi mở khung.
 */
export default function ProofHover({ children, className = '', photo, photoAt, transferProof, transferProofAt, startedAt, completedAt, debt }) {
  const anchor = useRef(null);
  const [pos, setPos] = useState(null);
  const open = () => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - CARD_W - 8));
    const below = window.innerHeight - r.bottom > 300;
    setPos(below ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 });
  };
  const close = () => setPos(null);
  return (
    <span ref={anchor} className={`proof-hover ${className}`} tabIndex={0} role="button" aria-haspopup="dialog" aria-expanded={!!pos}
          onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close}
          onClick={(e) => { e.stopPropagation(); if (pos) close(); else open(); }}>
      {children}
      {pos && (
        <span className="proof-hover-card" role="tooltip" style={{ ...pos, width: CARD_W }}>
          {photo
            ? <a href={photo} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}><img src={photo} alt="Ảnh gạo đã giao tới nơi" /></a>
            : <span className="proof-hover-none">Chưa có ảnh gạo đã giao (đơn cũ, trước khi bắt buộc chụp)</span>}
          {photo && <small>📷 Ảnh gạo đã giao · chụp lúc <b>{shortTime(photoAt) || '—'}</b></small>}
          {transferProof && (
            <>
              <a href={transferProof} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}><img className="small" src={transferProof} alt="Ảnh chuyển khoản" /></a>
              <small>🏦 Ảnh chuyển khoản{transferProofAt ? <> · <b>{shortTime(transferProofAt)}</b></> : ''}</small>
            </>
          )}
          {startedAt && <small>🛵 Bắt đầu giao <b>{shortTime(startedAt)}</b></small>}
          {completedAt && <small>✓ {debt ? 'Giao xong (ghi nợ)' : 'Hoàn thành'} <b>{shortTime(completedAt)}</b></small>}
        </span>
      )}
    </span>
  );
}
