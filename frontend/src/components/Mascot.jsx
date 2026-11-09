import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/index.jsx';

const GREETED_KEY = 'gao_mascot_greeted';
const SHOW_AFTER_MS = 1200;
const HIDE_AFTER_MS = 9000;

const alreadyGreeted = () => {
  try { return sessionStorage.getItem(GREETED_KEY) === '1'; } catch { return false; }
};
const rememberGreeted = () => {
  try { sessionStorage.setItem(GREETED_KEY, '1'); } catch { /* trình duyệt chặn lưu thì chỉ chào lại */ }
};

/** Cô bé ở góc màn hình: chào khách một lần mỗi lượt vào, bấm vào cô để xem lại lời chào. */
export default function Mascot() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (alreadyGreeted()) return undefined;
    const timer = setTimeout(() => { rememberGreeted(); setOpen(true); }, SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => setOpen(false), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [open]);

  return (
    <aside className="mascot" aria-label={t('mascot.aria')}>
      {open && (
        <p className="mascot-bubble" role="status">
          {t('mascot.greeting')}
          <button type="button" aria-label={t('mascot.close')} onClick={() => setOpen(false)}>×</button>
        </p>
      )}
      <button type="button" className="mascot-figure" aria-label={t('mascot.greeting')} aria-expanded={open}
              onClick={() => setOpen((value) => !value)}>
        <img src="/mascot/body.webp" alt="" width="280" height="426" decoding="async" />
        <span className="mascot-head">
          <img src="/mascot/head.webp" alt="" width="280" height="426" decoding="async" />
          <img src="/mascot/blink.webp" alt="" className="mascot-blink" width="280" height="426" decoding="async" />
        </span>
      </button>
    </aside>
  );
}
