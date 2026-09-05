import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="empty empty-page">
      <span className="empty-icon" aria-hidden="true">🌾</span>
      <h1>Không tìm thấy trang</h1>
      <p>Đường dẫn bạn mở không tồn tại hoặc đã được đổi.</p>
      <Link className="btn btn-primary btn-large" to="/">Về trang mua gạo</Link>
    </div>
  );
}
