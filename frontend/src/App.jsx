import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import Mascot from './components/Mascot.jsx';

// Không che form khi khách đang đặt hàng hoặc đăng nhập.
const MASCOT_HIDDEN = ['/gio-hang', '/dat-hang', '/dat-nhanh', '/dang-nhap', '/dang-ky'];
import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import PageLoadBoundary from './components/PageLoadBoundary.jsx';
import { useI18n } from './i18n/index.jsx';

import Home from './pages/Home.jsx';
const Login = lazy(() => import('./pages/Login.jsx'));
const Register = lazy(() => import('./pages/Register.jsx'));
const Cart = lazy(() => import('./pages/Cart.jsx'));
const Checkout = lazy(() => import('./pages/Checkout.jsx'));
const QuickCheckout = lazy(() => import('./pages/QuickCheckout.jsx'));
const Orders = lazy(() => import('./pages/Orders.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const Retail = lazy(() => import('./pages/Retail.jsx'));
const TrackOrder = lazy(() => import('./pages/TrackOrder.jsx'));
const About = lazy(() => import('./pages/About.jsx'));
const Delivery = lazy(() => import('./pages/Delivery.jsx'));
const Debts = lazy(() => import('./pages/Debts.jsx'));
const DayClosing = lazy(() => import('./pages/DayClosing.jsx'));
const Attendance = lazy(() => import('./pages/Attendance.jsx'));
import NotFound from './pages/NotFound.jsx';

// Khoá dịch cho tiêu đề tab của từng trang khách; trang quản trị giữ tiếng Việt.
const PAGE_TITLES = {
  '/': 'title.home',
  '/gio-hang': 'title.cart',
  '/dat-hang': 'title.checkout',
  '/dat-nhanh': 'title.quick',
  '/don-hang': 'title.orders',
  '/tai-khoan': 'title.account',
  '/dang-nhap': 'title.login',
  '/dang-ky': 'title.register',
  '/tra-cuu-don': 'nav.track',
  '/ve-chung-toi': 'nav.about',
  '/ve-chung-toi/danh-gia': 'about.tabReviews',
};
const ADMIN_TITLES = {
  '/quan-tri': 'Quản trị cửa hàng',
  '/quan-tri/ban-hang': 'Bán hàng tại quầy',
  '/quan-tri/giao-hang': 'Giao hàng',
  '/quan-tri/cong-no': 'Theo dõi công nợ',
  '/quan-tri/dong-ngay': 'Đóng ngày',
  '/quan-tri/cham-cong': 'Chấm công',
};

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();
  const isAdminArea = location.pathname.startsWith('/quan-tri');

  // Bấm vào thông báo đơn mới khi app đang mở: service worker nhờ app chuyển tới đúng đơn.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onMessage = (event) => {
      const url = event.data?.type === 'gao:open' ? event.data.url : null;
      if (typeof url === 'string' && /^\/(?!\/)/.test(url)) navigate(url);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    navigator.serviceWorker.startMessages?.();
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

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
            element={<ProtectedRoute staffOnly><Admin /></ProtectedRoute>}
          />
          <Route
            path="/quan-tri/ban-hang"
            element={<ProtectedRoute permission="retail.sell"><Retail /></ProtectedRoute>}
          />
          <Route
            path="/quan-tri/giao-hang"
            element={<ProtectedRoute permission="delivery"><Delivery /></ProtectedRoute>}
          />
          <Route
            path="/quan-tri/cong-no"
            element={<ProtectedRoute permission="debt.view"><Debts /></ProtectedRoute>}
          />
          <Route
            path="/quan-tri/dong-ngay"
            element={<ProtectedRoute permission="revenue.view"><DayClosing /></ProtectedRoute>}
          />
          <Route
            path="/quan-tri/cham-cong"
            element={<ProtectedRoute staffOnly><Attendance /></ProtectedRoute>}
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
          <Route path="/dat-nhanh" element={<QuickCheckout />} />
          <Route path="/tra-cuu-don" element={<TrackOrder />} />
          <Route path="/ve-chung-toi" element={<About />} />
          <Route path="/ve-chung-toi/danh-gia" element={<About />} />
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
      <Footer />
      {!MASCOT_HIDDEN.includes(location.pathname) && <Mascot />}
    </>
  );
}
