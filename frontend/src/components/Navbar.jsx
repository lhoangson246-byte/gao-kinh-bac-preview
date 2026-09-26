import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import InstallButton from './InstallButton.jsx';
import LanguageSwitcher from './LanguageSwitcher.jsx';

export default function Navbar() {
  const { user, isAdmin, logout } = useAuth();
  const { count } = useCart();
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <>
      <header className="navbar">
        <div className="container nav-inner">
          <Link to="/" className="brand" aria-label="Gạo Kinh Bắc">
            <img src="/logo-mark.png" alt={t('brand.logoAlt')} className="brand-logo"
                 width="40" height="40" />
            <span>Gạo Kinh Bắc<small>{t('brand.tagline')}</small></span>
          </Link>

          <div className="nav-panel">
            <nav className="nav-links" aria-label={t('nav.main')}>
              <NavLink to="/">{t('nav.shop')}</NavLink>
              <NavLink to="/gio-hang">
                {t('nav.cart')} {count > 0 && <span className="badge">{count}</span>}
              </NavLink>
              {user && <NavLink to="/don-hang">{t('nav.orders')}</NavLink>}
            </nav>

            <div className="nav-auth">
              <InstallButton />
              {user ? (
                <>
                  {isAdmin && <Link className="btn btn-admin" to="/quan-tri">{t('nav.admin')}</Link>}
                  <Link to="/tai-khoan" className="hello">
                    {user.full_name.split(' ').pop()}
                  </Link>
                  <button className="btn btn-ghost" onClick={async () => { try { await logout(); navigate('/'); } catch (err) { window.alert(err.message); } }}>
                    {t('nav.logout')}
                  </button>
                </>
              ) : (
                <>
                  <Link className="btn btn-ghost" to="/dang-nhap">{t('nav.login')}</Link>
                  <Link className="btn btn-primary" to="/dang-ky">{t('nav.register')}</Link>
                </>
              )}
            </div>
          </div>

          <LanguageSwitcher />
        </div>
      </header>

      {/* Phải nằm NGOÀI .navbar: .navbar có backdrop-filter, mà thuộc tính đó biến nó
          thành khối chứa cho mọi con position:fixed — khiến thanh điều hướng dưới
          bị neo vào header thay vì đáy màn hình điện thoại. */}
      <nav className="mobile-nav" aria-label={t('nav.app')}>
        <NavLink to="/" end><span aria-hidden="true">⌂</span><small>{t('nav.tabStore')}</small></NavLink>
        <NavLink to="/gio-hang"><span aria-hidden="true">⌑</span><small>{t('nav.tabCart')}</small>{count > 0 && <b>{count}</b>}</NavLink>
        <NavLink to="/don-hang"><span aria-hidden="true">▤</span><small>{t('nav.tabOrders')}</small></NavLink>
        {isAdmin ? (
          <NavLink to="/quan-tri"><span aria-hidden="true">⚙</span><small>{t('nav.tabAdmin')}</small></NavLink>
        ) : (
          <NavLink to={user ? '/tai-khoan' : '/dang-nhap'}><span aria-hidden="true">○</span><small>{t('nav.tabAccount')}</small></NavLink>
        )}
      </nav>
    </>
  );
}
