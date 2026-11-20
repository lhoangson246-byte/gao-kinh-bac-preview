import { useEffect, useId, useState } from 'react';
import { api, formatVND } from '../api';
import { useI18n } from '../i18n/index.jsx';
import { shrink } from './ImagePicker.jsx';
import { BANK_ACCOUNT, DEFAULT_QR, loadShopSettings } from '../shopInfo.js';
import { CheckIcon, CopyIcon } from './Icons.jsx';

/** Ảnh QR và tài khoản ngân hàng lấy từ cài đặt cửa hàng (Quản trị → CẬP NHẬT); tải một lần mỗi lần mở trang. */
const loadBank = () => loadShopSettings().then((s) => ({
  qr: s.bank_qr_url || DEFAULT_QR,
  bank: s.invoice ? { bank: s.invoice.bank_name, number: s.invoice.bank_number, holder: s.invoice.bank_holder } : BANK_ACCOUNT,
}));

/**
 * Khung chuyển khoản: mã QR tài khoản ngân hàng của cửa hàng và số tiền. Khi đã có đơn (`order`), hiện
 * mã đơn để ghi vào nội dung chuyển khoản và nút gửi ảnh đã chuyển khoản; cửa hàng kiểm tra rồi xác
 * nhận sau. Đơn mua nhanh gửi kèm `guestToken` nhận được lúc đặt.
 */
export default function TransferBox({ amount, order = null, guestToken = null }) {
  const { t } = useI18n();
  const inputId = useId();
  const [qr, setQr] = useState(null);
  const [account, setAccount] = useState(BANK_ACCOUNT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');   // 'account' | 'content' vừa được chép
  const [reportedAt, setReportedAt] = useState(order?.transfer_reported_at || null);

  useEffect(() => {
    let alive = true;
    loadBank().then(({ qr: url, bank }) => { if (alive) { setQr(url); setAccount(bank); } });
    return () => { alive = false; };
  }, []);

  if (order?.transfer_confirmed_at) {
    return <p className="transfer-ok transfer-done">✓ {t('transfer.confirmed')}</p>;
  }

  const pick = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const blob = await shrink(file, 1600);
      const result = await api.uploadTransferProof(order.id, blob, guestToken);
      setReportedAt(result.order?.transfer_reported_at || new Date().toISOString());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /** Chép vào bộ nhớ tạm rồi báo "Đã chép!" ngay trên nút vừa bấm. */
  const copy = async (what, text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Trình duyệt cũ / không có quyền: chép qua một ô nhập tạm.
      const field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      try { document.execCommand('copy'); } catch { /* khách tự gõ */ }
      field.remove();
    }
    setCopied(what);
    setTimeout(() => setCopied((cur) => (cur === what ? '' : cur)), 2000);
  };
  const CopyButton = ({ what, text, label }) => (
    <button type="button" className={`copy-button${copied === what ? ' done' : ''}`} onClick={() => copy(what, text)} aria-live="polite">
      {copied === what ? <><CheckIcon size={18} /> {t('transfer.copied')}</> : <><CopyIcon size={18} /> {label}</>}
    </button>
  );

  return (
    <div className="transfer-box">
      <div className="transfer-qr">
        {qr && <img src={qr} alt={t('transfer.qrAlt')} width="168" height="168" decoding="async" />}
      </div>
      <div className="transfer-info">
        <strong>{t('transfer.title')}</strong>
        <p>{t('transfer.scan', { amount: formatVND(amount) })}</p>
        <div className="transfer-row">
          <span>{t('transfer.account', { bank: account.bank })} <b>{account.number}</b></span>
          <CopyButton what="account" text={account.number.replace(/\s/g, '')} label={t('transfer.copyAccount')} />
          <span className="transfer-holder">{t('transfer.holder')} <b>{account.holder}</b></span>
        </div>
        {order ? (
          <div className="transfer-row">
            <span>{t('transfer.content')} <b>{order.code}</b></span>
            <CopyButton what="content" text={order.code} label={t('transfer.copyContent')} />
          </div>
        ) : (
          <p className="muted">{t('transfer.later')}</p>
        )}
        {order && (
          <>
            {reportedAt && <p className="transfer-ok" role="status">✓ {t('transfer.sent')}</p>}
            <label className={`btn ${reportedAt ? 'btn-secondary' : 'btn-primary'} transfer-upload${busy ? ' disabled' : ''}`} htmlFor={inputId}>
              📷 {busy ? t('transfer.sending') : reportedAt ? t('transfer.resend') : t('transfer.upload')}
            </label>
            <input id={inputId} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={pick} />
            {!reportedAt && <small className="field-help">{t('transfer.uploadHint')}</small>}
            {error && <small className="err" role="alert">{error}</small>}
          </>
        )}
      </div>
    </div>
  );
}
