import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/index.jsx';

const SHOW_AFTER_MS = 1200;
const HIDE_AFTER_MS = 12000;

/**
 * Lời của cô bé theo từng trang:
 *  - greet: chào khách (trang chủ và các trang khác)
 *  - cart: giỏ hàng — mỗi lần bấm là một bước đặt hàng, theo thứ tự
 *  - track: tra cứu đơn — nhắc nhập số điện thoại
 */
export const MASCOT_SCRIPTS = {
  greet: ['mascot.greeting'],
  cart: ['mascot.cart1', 'mascot.cart2', 'mascot.cart3', 'mascot.cart4'],
  track: ['mascot.track'],
};

const seenKey = (scene) => (scene === 'greet' ? 'gao_mascot_greeted' : `gao_mascot_seen_${scene}`);
const alreadySeen = (scene) => {
  try { return sessionStorage.getItem(seenKey(scene)) === '1'; } catch { return false; }
};
const rememberSeen = (scene) => {
  try { sessionStorage.setItem(seenKey(scene), '1'); } catch { /* trình duyệt chặn lưu thì chỉ nói lại */ }
};

/**
 * Cô bé ở góc màn hình. Mỗi trang tự nói câu đầu tiên một lần mỗi lượt vào; bấm vào cô để nghe tiếp
 * (trang có nhiều bước thì mỗi lần bấm là bước kế tiếp, hết thì quay lại bước 1).
 */
export default function Mascot({ scene = 'greet' }) {
  const { t } = useI18n();
  const lines = MASCOT_SCRIPTS[scene] || MASCOT_SCRIPTS.greet;
  const steps = lines.length > 1;
  const [step, setStep] = useState(-1);          // -1 = đang im

  useEffect(() => {
    // Giỏ hàng đã có nút "Đặt hàng" cố định ngay trước mắt: cô bé không tự bật lời nhắc lên che tổng tiền,
    // khách bấm vào cô mới nói.
    if (scene === 'cart' || alreadySeen(scene)) return undefined;
    const timer = setTimeout(() => { rememberSeen(scene); setStep(0); }, SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [scene]);

  useEffect(() => {
    if (step < 0) return undefined;
    const timer = setTimeout(() => setStep(-1), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [step]);

  // Khách cuộn xuống đọc hàng / điền form thì cô bé thu nhỏ vào góc cho khỏi che nội dung và nút mua;
  // cuộn lên đầu trang hoặc bấm vào cô thì hiện lại.
  const [scrolled, setScrolled] = useState(false);
  const [peek, setPeek] = useState(false);       // khách vừa bấm vào cô lúc đang thu nhỏ
  useEffect(() => {
    const onScroll = () => { setScrolled(window.scrollY > 140); setPeek(false); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const next = () => { setPeek(true); setStep((cur) => (steps ? (cur + 1) % lines.length : cur < 0 ? 0 : -1)); };
  const open = step >= 0;

  return (
    <aside className={`mascot${scrolled && !peek ? ' tucked' : ''}`} aria-label={t('mascot.aria')}>
      {open && (
        <div className="mascot-bubble" role="status">
          {steps && <small className="mascot-step">{t('mascot.step', { n: step + 1, total: lines.length })}</small>}
          <p>{t(lines[step])}</p>
          {steps && (
            <button type="button" className="mascot-next" onClick={next}>
              {step === lines.length - 1 ? t('mascot.restart') : t('mascot.next')}
            </button>
          )}
          <button type="button" className="mascot-close" aria-label={t('mascot.close')} onClick={() => setStep(-1)}>×</button>
        </div>
      )}
      <button type="button" className="mascot-figure" aria-label={steps ? t('mascot.help') : t(lines[0])} aria-expanded={open} onClick={next}>
        <img src="/mascot/body.webp" alt="" width="280" height="426" decoding="async" />
        <span className="mascot-head">
          <img src="/mascot/head.webp" alt="" width="280" height="426" decoding="async" />
          <img src="/mascot/blink.webp" alt="" className="mascot-blink" width="280" height="426" decoding="async" />
        </span>
      </button>
    </aside>
  );
}
