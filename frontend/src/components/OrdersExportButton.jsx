import { useState } from 'react';
import { api } from '../api';
export default function OrdersExportButton({ filters, children = 'Tải Excel' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async () => {
    setBusy(true); setError('');
    try { await api.adminExportOrders(filters); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <div>
    <button className="btn btn-outline" type="button" disabled={busy} onClick={download}>
      {busy ? 'Đang tạo tệp…' : children}
    </button>
    {error && <p className="alert error" role="alert">{error}</p>}
  </div>;
}
