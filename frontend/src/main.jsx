import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { CartProvider } from './context/CartContext.jsx';
import { LanguageProvider } from './i18n/index.jsx';
import Toasts from './components/Toasts.jsx';
// Thứ tự nạp: biến dùng chung → giao diện gốc → các module mới (dùng chung, trang khách, trang nội bộ).
import './styles/tokens.css';
import './styles.css';
import './styles/chrome.css';
import './styles/storefront.css';
import './styles/staff.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <AuthProvider>
          <CartProvider>
            <App />
            <Toasts />
          </CartProvider>
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
