import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { vi, en, zh } from './messages.js';
import { LANGUAGES, LANGUAGE_CODES, setActiveLang, translateUnit } from './state.js';

export { LANGUAGES } from './state.js';

const DICTIONARIES = { vi, en, zh };
const STORAGE_KEY = 'gao_lang';

/** Mặc định tiếng Việt; chỉ đổi khi khách tự chọn. Không đoán theo trình duyệt vì
 *  nhiều người Việt để điện thoại tiếng Anh. */
function readStored() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return LANGUAGE_CODES.includes(saved) ? saved : 'vi';
  } catch {
    return 'vi';
  }
}

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [chosen, setChosen] = useState(readStored);
  // Trang quản trị và bán quầy dành cho nhân viên, luôn hiển thị tiếng Việt.
  const adminArea = useLocation().pathname.startsWith('/quan-tri');
  const lang = adminArea ? 'vi' : chosen;

  // Cập nhật ngay trong lúc render để formatVND/formatDateTime của lượt render này
  // đã dùng đúng ngôn ngữ; gán lại cùng một giá trị nên không gây tác dụng phụ.
  setActiveLang(lang);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang;
  }, [lang]);

  const setLang = useCallback((code) => {
    if (!LANGUAGE_CODES.includes(code)) return;
    setChosen(code);
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* chế độ riêng tư: chỉ nhớ trong phiên */ }
  }, []);

  const value = useMemo(() => {
    const dictionary = DICTIONARIES[lang];
    const t = (key, vars) => {
      const template = dictionary[key] ?? vi[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
    };
    const unit = (text) => translateUnit(text, lang);
    return { lang, chosen, setLang, t, unit, languages: LANGUAGES, locked: adminArea };
  }, [lang, chosen, setLang, adminArea]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useI18n phải nằm trong LanguageProvider.');
  return context;
}
