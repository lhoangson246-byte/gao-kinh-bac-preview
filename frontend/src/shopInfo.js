import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * Thông tin cửa hàng in trên hoá đơn và hiện ở khung chuyển khoản. Từ 20/11/2026 chủ cửa hàng tự sửa ở
 * Quản trị → CẬP NHẬT (máy chủ trả trong /api/settings/storefront → settings.invoice). Các giá trị dưới đây
 * chỉ dùng khi chưa tải được cài đặt — giống mặc định của máy chủ (backend/src/shop-info.js).
 */
export const DEFAULT_INVOICE = {
  company: 'Công Ty CP Lương Thực Lúa Vàng Châu Á',
  company_short: 'CTY CP LƯƠNG THỰC LÚA VÀNG CHÂU Á',
  address1: 'CS1: 51A Nguyễn Cao - Kinh Bắc - Bắc Ninh',
  address2: 'CS2: Đ.Triệu Việt Vương - Bồ Sơn 4 - Võ Cường - TP.BN',
  phones: '0986.407.975 - 0979.848.405',
  bank_name: 'Vietcombank',
  bank_number: '1204372888',
  bank_holder: 'CTY CP LƯƠNG THỰC LÚA VÀNG CHÂU Á',
};
export const DEFAULT_QR = '/bank-qr.png';

/** Tên công ty viết tắt (đầu báo cáo đóng ngày) và tài khoản ngân hàng theo thông tin mặc định. */
export const COMPANY_SHORT = DEFAULT_INVOICE.company_short;
export const BANK_ACCOUNT = { bank: DEFAULT_INVOICE.bank_name, number: DEFAULT_INVOICE.bank_number, holder: DEFAULT_INVOICE.bank_holder };

/** Đầu hoá đơn: tên công ty và các dòng địa chỉ / tài khoản / điện thoại. */
export function invoiceHeader(info = DEFAULT_INVOICE) {
  const i = { ...DEFAULT_INVOICE, ...info };
  return {
    company: i.company,
    lines: [
      [i.address1, `STK ${i.bank_name}: ${i.bank_number}`],
      ...(i.address2 ? [[i.address2]] : []),
      [`Điện thoại: ${i.phones}`],
    ],
  };
}
export const INVOICE_HEADER = invoiceHeader();

let storefrontPromise = null;
/** Cài đặt cửa hàng (một lần mỗi lần mở trang): { invoice, bank_qr_url, notices, … }. */
export function loadShopSettings({ fresh = false } = {}) {
  if (fresh) storefrontPromise = null;
  storefrontPromise ||= api.storefront().then((r) => r.settings || {}).catch(() => { storefrontPromise = null; return {}; });
  return storefrontPromise;
}

/** Hook: { invoice, qr, notices, ready } — luôn có giá trị mặc định khi chưa tải xong hoặc lỗi mạng. */
export function useShopInfo() {
  const [state, setState] = useState({ invoice: DEFAULT_INVOICE, qr: DEFAULT_QR, notices: [], ready: false });
  useEffect(() => {
    let alive = true;
    loadShopSettings().then((s) => alive && setState({
      invoice: { ...DEFAULT_INVOICE, ...(s.invoice || {}) }, qr: s.bank_qr_url || DEFAULT_QR, notices: s.notices || [], ready: true,
    }));
    return () => { alive = false; };
  }, []);
  return state;
}
