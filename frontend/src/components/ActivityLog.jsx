import { useEffect, useState } from 'react';
import { api, formatDateTime } from '../api';

const ACTION_LABEL = {
  create: 'Tạo mới', update: 'Cập nhật', update_status: 'Đổi trạng thái',
  receive_stock: 'Nhập kho', hide: 'Ẩn sản phẩm', rename: 'Sửa tên',
  reset_password: 'Đặt lại mật khẩu', lock: 'Khoá tài khoản', unlock: 'Mở khoá tài khoản',
};
const ENTITY_LABEL = {
  order: 'đơn hàng', product: 'sản phẩm', customer_account: 'tài khoản khách',
  retail_customer: 'khách tại quầy', retail_invoice: 'hoá đơn', retail_return: 'phiếu đổi/trả',
};

export default function ActivityLog() {
  const [data, setData] = useState({ audit: [], logins: [] });
  const [view, setView] = useState('changes');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try { setData(await api.adminActivity()); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  return (
    <>
      <div className="admin-page-heading">
        <div><p className="eyebrow dark"><span></span>An toàn dữ liệu</p><h1>Nhật ký hệ thống</h1>
          <p>Theo dõi thay đổi của quản trị viên và những lần đăng nhập thành công.</p></div>
        <button className="btn btn-secondary" onClick={load}>Tải lại</button>
      </div>
      <div className="filter-bar">
        <button className={view === 'changes' ? 'active' : ''} onClick={() => setView('changes')}>
          Thay đổi dữ liệu <span>{data.audit.length}</span>
        </button>
        <button className={view === 'logins' ? 'active' : ''} onClick={() => setView('logins')}>
          Lịch sử đăng nhập <span>{data.logins.length}</span>
        </button>
      </div>
      {error && <div className="alert error">{error}</div>}
      {loading ? <div className="loading-state"><span></span>Đang tải nhật ký…</div>
        : view === 'changes' ? (
          <div className="activity-list">
            {data.audit.length === 0 ? <Empty /> : data.audit.map((row) => (
              <article key={row.id}>
                <span className="activity-icon">↺</span>
                <div><strong>{row.actor_name || 'Quản trị viên'} · {ACTION_LABEL[row.action] || row.action}</strong>
                  <p>{ENTITY_LABEL[row.entity_type] || row.entity_type}{row.entity_id ? ` #${row.entity_id}` : ''}</p></div>
                <div className="activity-meta"><time>{formatDateTime(row.created_at)}</time><small>{row.ip_address || 'Không rõ IP'}</small></div>
              </article>
            ))}
          </div>
        ) : (
          <div className="activity-list">
            {data.logins.length === 0 ? <Empty /> : data.logins.map((row) => (
              <article key={row.id}>
                <span className="activity-icon">✓</span>
                <div><strong>{row.full_name || 'Tài khoản đã xoá'}</strong>
                  <p>{row.email || row.phone || `Tài khoản #${row.user_id}`} · đăng nhập bằng {row.login_method === 'phone' ? 'số điện thoại' : 'email'}</p></div>
                <div className="activity-meta"><time>{formatDateTime(row.created_at)}</time><small>{row.ip_address || 'Không rõ IP'}</small></div>
              </article>
            ))}
          </div>
        )}
      <p className="security-note">Nhật ký không lưu mật khẩu hoặc mã phiên đăng nhập. Mật khẩu trong cơ sở dữ liệu luôn ở dạng băm.</p>
    </>
  );
}

function Empty() {
  return <div className="admin-empty"><span>✓</span><h2>Chưa có hoạt động</h2><p>Hoạt động mới sẽ được lưu tại đây.</p></div>;
}
