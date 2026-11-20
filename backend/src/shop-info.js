import { HttpError, cleanText } from './validate.js';

/**
 * Thông tin in trên hoá đơn và hiện ở khung chuyển khoản, cùng các thông báo trên banner (20/11/2026).
 * Chủ cửa hàng sửa ở Quản trị → CẬP NHẬT; lưu trong app_settings (khoá invoice_info, shop_notices).
 * Chưa lưu thì dùng thông tin dưới đây (chép theo hoá đơn giấy cửa hàng đang dùng).
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
const INVOICE_LIMITS = { company: 120, company_short: 120, address1: 200, address2: 200, phones: 120, bank_name: 60, bank_number: 30, bank_holder: 120 };
const REQUIRED = ['company', 'address1', 'phones', 'bank_name', 'bank_number', 'bank_holder'];
const LABELS = {
  company: 'Tên công ty', company_short: 'Tên viết tắt', address1: 'Địa chỉ cơ sở 1', address2: 'Địa chỉ cơ sở 2', phones: 'Điện thoại',
  bank_name: 'Ngân hàng', bank_number: 'Số tài khoản', bank_holder: 'Chủ tài khoản',
};

export function parseInvoice(raw) {
  let stored = {};
  try { stored = JSON.parse(raw || '{}') || {}; } catch { stored = {}; }
  const out = { ...DEFAULT_INVOICE };
  for (const key of Object.keys(INVOICE_LIMITS)) {
    if (typeof stored[key] === 'string' && (stored[key].trim() || !REQUIRED.includes(key))) out[key] = stored[key].slice(0, INVOICE_LIMITS[key]);
  }
  return out;
}

export function readInvoiceInput(body) {
  const errors = {};
  const out = {};
  for (const [key, max] of Object.entries(INVOICE_LIMITS)) {
    const value = cleanText(body?.[key], max) || '';
    if (REQUIRED.includes(key) && !value) errors[key] = `Nhập ${LABELS[key].toLowerCase()}.`;
    out[key] = value;
  }
  if (out.bank_number && !/^[0-9 .-]{6,30}$/.test(out.bank_number)) errors.bank_number = 'Số tài khoản chỉ gồm chữ số (có thể có dấu cách).';
  if (Object.keys(errors).length) throw new HttpError(400, 'Thông tin hoá đơn chưa hợp lệ.', errors);
  return out;
}

/* ---------- Thông báo trên banner: nghỉ lễ / Tết, cập nhật trang web ---------- */
export const MAX_NOTICES = 20;
export const NOTICE_LEAD_DAYS = 7;   // hiện trước ngày bắt đầu bao nhiêu ngày (khi không chọn ngày hiện)
const isDay = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const todayVN = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

export function parseNotices(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((n) => n && ['holiday', 'maintenance'].includes(n.kind) && isDay(n.start) && isDay(n.end)).slice(0, MAX_NOTICES) : [];
  } catch { return []; }
}

/** Khoảng ngày hiện thông báo: từ ngày chọn (mặc định 7 ngày trước) tới hết ngày nghỉ / ngày cuối cập nhật. */
export const noticeWindow = (n) => ({
  from: n.show_from || addDays(n.start, -NOTICE_LEAD_DAYS),
  to: n.kind === 'holiday' && n.reopen ? addDays(n.reopen, -1) : n.end,
});

/** Thông báo đang hiện hôm nay (theo giờ Việt Nam), cho trang khách. */
export function activeNotices(list, today = todayVN()) {
  return list.filter((n) => { const w = noticeWindow(n); return today >= w.from && today <= w.to; })
    .map(({ kind, title, start, end, reopen, note }) => ({ kind, title: title || '', start, end, reopen: reopen || null, note: note || '' }));
}

export function readNoticesInput(list) {
  if (!Array.isArray(list)) throw new HttpError(400, 'Danh sách thông báo không hợp lệ.', { notices: 'Danh sách thông báo không hợp lệ.' });
  if (list.length > MAX_NOTICES) throw new HttpError(400, `Tối đa ${MAX_NOTICES} thông báo.`, { notices: `Tối đa ${MAX_NOTICES} thông báo.` });
  return list.map((raw, index) => {
    const n = index + 1;
    const kind = raw?.kind;
    if (!['holiday', 'maintenance'].includes(kind)) throw new HttpError(400, `Thông báo ${n}: loại không hợp lệ.`, { notices: 'Loại thông báo không hợp lệ.' });
    const title = cleanText(raw?.title, 120) || '';
    const note = cleanText(raw?.note, 300) || '';
    const { start, end } = raw || {};
    const reopen = raw?.reopen || null;
    const showFrom = raw?.show_from || null;
    const label = kind === 'holiday' ? `Nghỉ lễ ${n}` : `Cập nhật web ${n}`;
    if (kind === 'holiday' && !title) throw new HttpError(400, `${label}: nhập tên dịp nghỉ (ví dụ Nghỉ Tết Nguyên Đán).`, { notices: 'Nhập tên dịp nghỉ.' });
    if (!isDay(start) || !isDay(end)) throw new HttpError(400, `${label}: chọn ngày bắt đầu và ngày kết thúc.`, { notices: 'Chọn đủ ngày.' });
    if (end < start) throw new HttpError(400, `${label}: ngày kết thúc phải sau hoặc bằng ngày bắt đầu.`, { notices: 'Ngày kết thúc trước ngày bắt đầu.' });
    if (reopen && (!isDay(reopen) || reopen <= end)) throw new HttpError(400, `${label}: ngày mở lại phải sau ngày nghỉ cuối cùng.`, { notices: 'Ngày mở lại chưa đúng.' });
    if (showFrom && (!isDay(showFrom) || showFrom > start)) throw new HttpError(400, `${label}: ngày bắt đầu hiện thông báo phải trước hoặc bằng ngày bắt đầu.`, { notices: 'Ngày hiện thông báo chưa đúng.' });
    return { kind, title, start, end, reopen: kind === 'holiday' ? reopen : null, show_from: showFrom, note };
  });
}
