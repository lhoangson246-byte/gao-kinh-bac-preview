import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import PageLoadBoundary from './components/PageLoadBoundary.jsx';
import { useI18n } from './i18n/index.jsx';

import Home from './pages/Home.jsx';
const Login = lazy(() => import('./pages/Login.jsx'));
const Register = lazy(() => import('./pages/Register.jsx'));
const Cart = lazy(() => import('./pages/Cart.jsx'));
const Checkout = lazy(() => import('./pages/Checkout.jsx'));
const Orders = lazy(() => import('./pages/Orders.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const Retail = lazy(() => import('./pages/Retail.jsx'));
import NotFound from './pages/NotFound.jsx';

// Khoá dịch cho tiêu đề tab của từng trang khách; trang quản trị giữ tiếng Việt.
const PAGE_TITLES = {
  '/': 'title.home',
  '/gio-hang': 'title.cart',
  '/dat-hang': 'title.checkout',
  '/don-hang': 'title.orders',
  '/tai-khoan': 'title.account',
  '/dang-nhap': 'title.login',
  '/dang-ky': 'title.register',
};
const ADMIN_TITLES = {
  '/quan-tri': 'Quản trị cửa hàng',
  '/quan-tri/ban-hang': 'Bán hàng tại quầy',
};

export default function App() {
  const location = useLocation();
  const { t } = useI18n();
  const isAdminArea = location.pathname.startsWith('/quan-tri');

  // Cuộn lên đầu khi chuyển trang — giống trải nghiệm ứng dụng.
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  // Tiêu đề tab đổi theo trang và theo ngôn ngữ đang chọn.
  useEffect(() => {
    const key = PAGE_TITLES[location.pathname];
    const page = ADMIN_TITLES[location.pathname] || (key && t(key));
    document.title = page ? `${page} · Gạo Kinh Bắc` : t('title.default');
  }, [location.pathname, t]);

  if (isAdminArea) {
    return (
      <main className="admin-main">
        <PageLoadBoundary key={location.pathname}>
        <Suspense fallback={<div className="loading-state" role="status"><span></span>{t('common.adminLoading')}</div>}>
        <Routes>
          <Route
            path="/quan-tri"
            element={<ProtectedRoute adminOnly><Admin /></ProtectedRoute>}
          />
          <Route
            path="/quan-tri/ban-hang"
            element={<ProtectedRoute adminOnly><Retail /></ProtectedRoute>}
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
        </PageLoadBoundary>
      </main>
    );
  }

  return (
    <>
      <a className="skip-link" href="#noi-dung">{t('nav.skip')}</a>
      <Navbar />
      <main className="container" id="noi-dung">
        <PageLoadBoundary key={location.pathname}>
        <Suspense fallback={<div className="loading-state" role="status"><span></span>{t('common.loading')}</div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/dang-nhap" element={<Login />} />
          <Route path="/dang-ky" element={<Register />} />
          <Route path="/gio-hang" element={<Cart />} />
          <Route
            path="/dat-hang"
            element={<ProtectedRoute><Checkout /></ProtectedRoute>}
          />
          <Route
            path="/don-hang"
            element={<ProtectedRoute><Orders /></ProtectedRoute>}
          />
          <Route
            path="/tai-khoan"
            element={<ProtectedRoute><Profile /></ProtectedRoute>}
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
        </PageLoadBoundary>
      </main>
      <footer className="footer">
        <div className="container footer-inner">
          <strong>Gạo Kinh Bắc</strong>
          <span>{t('footer.tagline')}</span>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </>
  );
}
