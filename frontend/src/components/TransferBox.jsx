import { useEffect, useId, useState } from 'react';
import { api, formatVND } from '../api';
import { useI18n } from '../i18n/index.jsx';
import { shrink } from './ImagePicker.jsx';

const DEFAULT_QR = '/bank-qr.png';
let qrPromise = null;
/** Ảnh QR lấy từ cài đặt cửa hàng; tải một lần dù trang có nhiều đơn chuyển khoản. */
const loadQr = () => {
  qrPromise ||= api.storefront().then(({ settings }) => settings?.bank_qr_url || DEFAULT_QR).catch(() => DEFAULT_QR);
  return qrPromise;
};

/**
 * Khung chuyển khoản: mã QR tài khoản ngân hàng của cửa hàng và số tiền. Khi đã có đơn (`order`), hiện
 * mã đơn để ghi vào nội dung chuyển khoản và nút gửi ảnh đã chuyển khoản; cửa hàng kiểm tra rồi xác
 * nhận sau. Đơn mua nhanh gửi kèm `guestToken` nhận được lúc đặt.
 */
export default function TransferBox({ amount, order = null, guestToken = null }) {
  const { t } = useI18n();
  const inputId = useId();
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [reportedAt, setReportedAt] = useState(order?.transfer_reported_at || null);

  useEffect(() => {
    let alive = true;
    loadQr().then((url) => { if (alive) setQr(url); });
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

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(order.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* trình duyệt không cho chép: khách tự gõ mã */ }
  };

  return (
    <div className="transfer-box">
      <div className="transfer-qr">
        {qr && <img src={qr} alt={t('transfer.qrAlt')} width="168" height="168" decoding="async" />}
      </div>
      <div className="transfer-info">
        <strong>{t('transfer.title')}</strong>
        <p>{t('transfer.scan', { amount: formatVND(amount) })}</p>
        {order ? (
          <p className="transfer-content">
            {t('transfer.content')} <b>{order.code}</b>
            <button type="button" className="link-button" onClick={copy}>{copied ? t('transfer.copied') : t('transfer.copy')}</button>
          </p>
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
