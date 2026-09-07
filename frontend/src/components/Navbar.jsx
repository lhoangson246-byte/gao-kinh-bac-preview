import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import InstallButton from './InstallButton.jsx';

export default function Navbar() {
  const { user, isAdmin, logout } = useAuth();
  const { count } = useCart();
  const navigate = useNavigate();

  return (
    <>
      <header className="navbar">
        <div className="container nav-inner">
          <Link to="/" className="brand" aria-label="Gạo Kinh Bắc">
            <img src="/logo-mark.png" alt="Logo Gạo Kinh Bắc" className="brand-logo"
                 width="40" height="40" />
            <span>Gạo Kinh Bắc<small>Giao hàng tại Bắc Ninh</small></span>
          </Link>

          <div className="nav-panel">
            <nav className="nav-links" aria-label="Điều hướng chính">
              <NavLink to="/">Mua gạo</NavLink>
              <NavLink to="/gio-hang">
                Giỏ hàng {count > 0 && <span className="badge">{count}</span>}
              </NavLink>
              {user && <NavLink to="/don-hang">Đơn của tôi</NavLink>}
            </nav>

            <div className="nav-auth">
              <InstallButton />
              {user ? (
                <>
                  {isAdmin && <Link className="btn btn-admin" to="/quan-tri">Mở trang quản trị</Link>}
                  <Link to="/tai-khoan" className="hello">
                    {user.full_name.split(' ').pop()}
                  </Link>
                  <button className="btn btn-ghost" onClick={async () => { try { await logout(); navigate('/'); } catch (err) { window.alert(err.message); } }}>
                    Đăng xuất
                  </button>
                </>
              ) : (
                <>
                  <Link className="btn btn-ghost" to="/dang-nhap">Đăng nhập</Link>
                  <Link className="btn btn-primary" to="/dang-ky">Đăng ký</Link>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Phải nằm NGOÀI .navbar: .navbar có backdrop-filter, mà thuộc tính đó biến nó
          thành khối chứa cho mọi con position:fixed — khiến thanh điều hướng dưới
          bị neo vào header thay vì đáy màn hình điện thoại. */}
      <nav className="mobile-nav" aria-label="Điều hướng ứng dụng">
        <NavLink to="/" end><span aria-hidden="true">⌂</span><small>Cửa hàng</small></NavLink>
        <NavLink to="/gio-hang"><span aria-hidden="true">⌑</span><small>Giỏ hàng</small>{count > 0 && <b>{count}</b>}</NavLink>
        <NavLink to="/don-hang"><span aria-hidden="true">▤</span><small>Đơn hàng</small></NavLink>
        {isAdmin ? (
          <NavLink to="/quan-tri"><span aria-hidden="true">⚙</span><small>Quản trị</small></NavLink>
        ) : (
          <NavLink to={user ? '/tai-khoan' : '/dang-nhap'}><span aria-hidden="true">○</span><small>Tài khoản</small></NavLink>
        )}
      </nav>
    </>
  );
}
