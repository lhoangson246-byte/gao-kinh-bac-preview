/**
 * Thông tin cửa hàng in trên hoá đơn và hiện ở khung chuyển khoản, chép đúng theo hoá đơn giấy cửa hàng
 * đang dùng (ảnh mẫu chị Linh gửi 13/11/2026). Đổi tên công ty, địa chỉ, số tài khoản, số điện thoại thì
 * sửa ở đây — không gõ lại ở nơi khác.
 */
/** Tên công ty viết tắt, đúng như chị Linh gửi 19/11/2026: chủ tài khoản ngân hàng, đầu báo cáo đóng ngày. */
export const COMPANY_SHORT = 'CTY CP LƯƠNG THỰC LÚA VÀNG CHÂU Á';
export const BANK_ACCOUNT = { bank: 'Vietcombank', number: '1204372888', holder: COMPANY_SHORT };

export const INVOICE_HEADER = {
  company: 'Công Ty CP Lương Thực Lúa Vàng Châu Á',
  lines: [
    ['CS1: 51A Nguyễn Cao - Kinh Bắc - Bắc Ninh', `STK ${BANK_ACCOUNT.bank}: ${BANK_ACCOUNT.number}`],
    ['CS2: Đ.Triệu Việt Vương - Bồ Sơn 4 - Võ Cường - TP.BN'],
    ['Điện thoại: 02223.813.566 - 0979.848.405'],
  ],
};
