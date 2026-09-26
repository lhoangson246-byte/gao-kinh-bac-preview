import { useI18n } from '../i18n/index.jsx';

/** Ba nút VI · EN · 中, luôn hiện ở thanh trên cùng, kể cả trên điện thoại. */
export default function LanguageSwitcher() {
  const { chosen, setLang, t, languages, locked } = useI18n();
  // Trang quản trị luôn tiếng Việt, nên không hiện nút đổi ngôn ngữ vô tác dụng.
  if (locked) return null;
  return (
    <div className="lang-switch" role="group" aria-label={t('lang.label')}>
      {languages.map((language) => (
        <button
          key={language.code}
          type="button"
          lang={language.code === 'zh' ? 'zh-Hans' : language.code}
          className={chosen === language.code ? 'active' : ''}
          aria-pressed={chosen === language.code}
          title={language.name}
          aria-label={language.name}
          onClick={() => setLang(language.code)}
        >
          {language.short}
        </button>
      ))}
    </div>
  );
}
