import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.jsx';

const INTERVAL_MS = 2500;
const SWIPE_PX = 40;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Banner đầu trang chủ chạy vòng: slide đầu là lời chào (children), tiếp theo là
 * từng ảnh banner cửa hàng tải lên, hiện trọn ảnh và không có chữ đè lên.
 *
 * Tự chuyển mỗi 2,5 giây; dừng khi rê chuột hoặc bấm phím vào banner, khi khách
 * chuyển tab, khi khách bấm nút tạm dừng, và không tự chạy nếu máy đặt "giảm
 * chuyển động". Trên điện thoại vuốt trái/phải để đổi slide.
 */
export default function HeroSlider({ images, children, onImageError }) {
  const { t } = useI18n();
  const slides = 1 + images.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(prefersReducedMotion);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const touchX = useRef(null);

  const go = useCallback((next) => setIndex(((next % slides) + slides) % slides), [slides]);

  // Ảnh bị xoá hoặc lỗi làm danh sách ngắn lại: không để chỉ số trỏ ra ngoài.
  useEffect(() => { if (index >= slides) setIndex(0); }, [index, slides]);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const running = slides > 1 && !paused && !hovered && !focused && !hidden;
  useEffect(() => {
    if (!running) return undefined;
    // Đặt lại đồng hồ sau mỗi lần đổi slide, kể cả khi khách tự bấm chấm.
    const timer = window.setTimeout(() => go(index + 1), INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [running, index, go]);

  const onKeyDown = (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1); }
  };

  const onTouchEnd = (event) => {
    if (touchX.current === null) return;
    const dx = event.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) >= SWIPE_PX) go(index + (dx < 0 ? 1 : -1));
  };

  return (
    <section
      className="hero-slider"
      aria-roledescription="carousel"
      aria-label={t('hero.label')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
      onKeyDown={onKeyDown}
      onTouchStart={(event) => { touchX.current = event.touches[0].clientX; }}
      onTouchEnd={onTouchEnd}
    >
      <div className="hero-track" style={{ transform: `translateX(-${index * 100}%)` }}
           aria-live={running ? 'off' : 'polite'}>
        <div className="hero-slide hero-intro" role="group" aria-roledescription="slide"
             aria-label={t('hero.slide', { n: 1, total: slides })}
             aria-hidden={index !== 0} inert={index !== 0 ? '' : undefined}>
          {children}
        </div>
        {images.map((url, i) => (
          <div key={url} className="hero-slide hero-image" role="group" aria-roledescription="slide"
               aria-label={t('hero.slide', { n: i + 2, total: slides })}
               aria-hidden={index !== i + 1} inert={index !== i + 1 ? '' : undefined}>
            {/* Lớp nền mờ lấp hai bên khi tỉ lệ ảnh khác khung; ảnh chính luôn hiện trọn. */}
            <img className="hero-image-fill" src={url} alt="" aria-hidden="true"
                 loading={i === 0 ? 'eager' : 'lazy'} decoding="async" />
            <img className="hero-image-main" src={url} alt={t('hero.imageAlt', { n: i + 1 })}
                 loading={i === 0 ? 'eager' : 'lazy'} decoding="async"
                 fetchpriority={i === 0 ? 'high' : undefined}
                 onError={() => onImageError?.(url)} />
          </div>
        ))}
      </div>

      {slides > 1 && (
        <div className="hero-controls">
          <div className="hero-dots">
            {Array.from({ length: slides }, (_, i) => (
              <button key={i} type="button" className={i === index ? 'active' : ''}
                      aria-label={t('hero.goTo', { n: i + 1 })} aria-current={i === index ? 'true' : undefined}
                      onClick={() => go(i)} />
            ))}
          </div>
          <button type="button" className="hero-pause" onClick={() => setPaused((value) => !value)}
                  aria-label={paused ? t('hero.play') : t('hero.pause')}
                  title={paused ? t('hero.play') : t('hero.pause')}>
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" fill="currentColor">
              {paused
                ? <path d="M3 1.5v9l7.5-4.5z" />
                : <><rect x="2" y="1.5" width="3" height="9" rx=".8" /><rect x="7" y="1.5" width="3" height="9" rx=".8" /></>}
            </svg>
          </button>
        </div>
      )}
    </section>
  );
}
