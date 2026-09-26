/**
 * Ngôn ngữ đang hiển thị, đọc được cả ở những chỗ không phải React như api.js
 * (định dạng tiền, ngày giờ, dịch lỗi máy chủ). LanguageProvider cập nhật giá trị này.
 */

export const LANGUAGES = [
  { code: 'vi', short: 'VI', name: 'Tiếng Việt', locale: 'vi-VN' },
  { code: 'en', short: 'EN', name: 'English', locale: 'en-US' },
  { code: 'zh', short: '中', name: '中文', locale: 'zh-CN' },
];
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

let active = 'vi';

export const getActiveLang = () => active;
export const setActiveLang = (code) => { active = LANGUAGE_CODES.includes(code) ? code : 'vi'; };
export const getLocale = () => LANGUAGES.find((l) => l.code === active)?.locale || 'vi-VN';

/**
 * Quy cách sản phẩm do cửa hàng nhập bằng tiếng Việt ("túi 5kg", "bao 25kg").
 * Dịch phần danh từ, giữ nguyên khối lượng.
 */
const UNIT_NOUNS = {
  en: { 'túi': 'bag', bao: 'sack', 'gói': 'pack', hộp: 'box', chai: 'bottle' },
  zh: { 'túi': '袋', bao: '包', 'gói': '包', hộp: '盒', chai: '瓶' },
};

export function translateUnit(unit, lang = active) {
  const text = String(unit || '').trim();
  if (lang === 'vi' || !text) return text;
  if (/^kg$/i.test(text)) return lang === 'zh' ? '公斤' : 'kg';
  const match = text.match(/^(\S+)\s+(.+)$/);
  const noun = match && UNIT_NOUNS[lang]?.[match[1].toLowerCase()];
  if (!noun) return text;
  return lang === 'zh' ? `${noun}（${match[2]}）` : `${match[2]} ${noun}`;
}
