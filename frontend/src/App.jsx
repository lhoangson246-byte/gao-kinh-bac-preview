import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Cart from './pages/Cart.jsx';
import Checkout from './pages/Checkout.jsx';
import Orders from './pages/Orders.jsx';
import Profile from './pages/Profile.jsx';
import Admin from './pages/Admin.jsx';
import NotFound from './pages/NotFound.jsx';

const PAGE_TITLES = {
  '/': 'Chọn gạo',
  '/gio-hang': 'Giỏ hàng',
  '/dat-hang': 'Đặt hàng',
  '/don-hang': 'Đơn hàng của tôi',
  '/tai-khoan': 'Tài khoản',
  '/dang-nhap': 'Đăng nhập',
  '/dang-ky': 'Đăng ký',
  '/quan-tri': 'Quản trị cửa hàng',
};

export default function App() {
  const location = useLocation();
  const isAdminArea = location.pathname.startsWith('/quan-tri');

  // Cuộn lên đầu và đổi tiêu đề tab khi chuyển trang — giống trải nghiệm ứng dụng.
  useEffect(() => {
    window.scrollTo(0, 0);
    const page = PAGE_TITLES[location.pathname];
    document.title = page ? `${page} · Gạo Kinh Bắc` : 'Gạo Kinh Bắc — Gạo ngon giao tận nhà tại Bắc Ninh';
  }, [location.pathname]);

  if (isAdminArea) {
    return (
      <main className="admin-main">
        <Routes>
          <Route
            path="/quan-tri"
            element={<ProtectedRoute adminOnly><Admin /></ProtectedRoute>}
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    );
  }

  return (
    <>
      <a className="skip-link" href="#noi-dung">Bỏ qua phần điều hướng</a>
      <Navbar />
      <main className="container" id="noi-dung">
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
      </main>
      <footer className="footer">
        <div className="container footer-inner">
          <strong>Gạo Kinh Bắc</strong>
          <span>Gạo ngon chọn kỹ · Giao tận nhà tại Bắc Ninh</span>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </>
  );
}
