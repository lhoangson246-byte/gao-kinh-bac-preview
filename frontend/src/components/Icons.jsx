/**
 * Icon SVG dùng chung (nét 1.8, khung 24×24) thay cho ký tự Unicode vốn lệch nét giữa iOS / Android /
 * Windows. Icon chỉ để trang trí nên luôn aria-hidden; chữ bên cạnh mới là nhãn.
 */
function Icon({ children, size = 22 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const HomeIcon = (props) => <Icon {...props}><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></Icon>;
export const CartIcon = (props) => <Icon {...props}><path d="M5 8h14l-1.2 9.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></Icon>;
export const OrdersIcon = (props) => <Icon {...props}><path d="M7 3.5h10a1 1 0 0 1 1 1V20l-2.5-1.5L13 20l-2-1.5L8.5 20 6 18.5V4.5a1 1 0 0 1 1-1z" /><path d="M9 8h6M9 12h6" /></Icon>;
export const AboutIcon = (props) => <Icon {...props}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><path d="M12 7.6v.2" /></Icon>;
export const AccountIcon = (props) => <Icon {...props}><circle cx="12" cy="8.5" r="3.7" /><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" /></Icon>;
export const AdminIcon = (props) => <Icon {...props}><path d="M5 7h9M18 7h1M5 12h2M11 12h8M5 17h9M18 17h1" /><circle cx="16" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="16" cy="17" r="2" /></Icon>;
export const PhoneIcon = (props) => <Icon {...props}><path d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A15.5 15.5 0 0 1 5 5.6 1.5 1.5 0 0 1 6.5 4z" /></Icon>;
export const CopyIcon = (props) => <Icon {...props}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></Icon>;
export const CheckIcon = (props) => <Icon {...props}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;
