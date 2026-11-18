import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/index.jsx';

/*
 * Trạng thái cài ứng dụng (PWA) dùng chung cho cả trang, khởi tạo ngay khi module được nạp
 * (Navbar → App → main.jsx nạp tĩnh, nên chạy trước lần render đầu tiên):
 *  - giữ sự kiện `beforeinstallprompt` ở cấp module để không bỏ lỡ khi nó đến sớm và không mất
 *    khi nút bị gỡ khỏi trang (đổi trang, ẩn chân trang...);
 *  - `installed`: đang chạy như ứng dụng đã cài (standalone) hoặc vừa cài xong → ẩn mọi nút cài.
 */
const STANDALONE_QUERY = '(display-mode: standalone)';
const hasWindow = typeof window !== 'undefined';

function runningStandalone() {
  if (!hasWindow) return false;
  return Boolean(window.matchMedia?.(STANDALONE_QUERY).matches) || window.navigator.standalone === true;
}

let snapshot = { prompt: null, installed: runningStandalone() };
const listeners = new Set();
function update(patch) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const getSnapshot = () => snapshot;

if (hasWindow) {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Chặn thanh gợi ý mặc định của trình duyệt; khách bấm nút "Cài ứng dụng" thì mới hỏi.
    event.preventDefault();
    update({ prompt: event });
  });
  window.addEventListener('appinstalled', () => update({ prompt: null, installed: true }));
  const media = window.matchMedia?.(STANDALONE_QUERY);
  const onModeChange = () => update({ installed: snapshot.installed || runningStandalone() });
  if (media?.addEventListener) media.addEventListener('change', onModeChange);
  else media?.addListener?.(onModeChange);
}

function useInstallState() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** iPhone/iPad (kể cả iPad đời mới tự nhận là Mac): đưa hướng dẫn Safari lên trước. */
function isAppleMobile() {
  if (!hasWindow) return false;
  const { userAgent = '', platform = '', maxTouchPoints = 0 } = window.navigator;
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

/* ---------- Icon (SVG thuần, không dùng style nội tuyến) ---------- */
const svgProps = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' };
function DownloadIcon() {
  return <svg {...svgProps}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>;
}
function ShareIcon() {
  return <svg {...svgProps}><path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" /></svg>;
}
function AddSquareIcon() {
  return <svg {...svgProps}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8" /><path d="M8 12h8" /></svg>;
}
function MenuDotsIcon() {
  return <svg {...svgProps}><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" /></svg>;
}
function PhoneIcon() {
  return <svg {...svgProps}><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M12 8v6" /><path d="m9.5 11.5 2.5 2.5 2.5-2.5" /></svg>;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Hướng dẫn cài thủ công cho trình duyệt không có `beforeinstallprompt`
 * (Safari trên iPhone/iPad, trình duyệt trong Zalo/Facebook...). Gắn thẳng vào <body>
 * vì .navbar có backdrop-filter, sẽ "nhốt" mọi con position:fixed vào trong header.
 */
function InstallGuide({ onClose }) {
  const { t } = useI18n();
  const id = useId();
  const dialog = useRef(null);
  const closeButton = useRef(null);

  useEffect(() => {
    closeButton.current?.focus();
    document.body.classList.add('install-guide-open');
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !dialog.current) return;
      // Giữ phím Tab vòng trong hộp thoại.
      const items = [...dialog.current.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('install-guide-open');
    };
  }, [onClose]);

  const ios = (
    <section className="install-platform" aria-labelledby={`${id}-ios`} key="ios">
      <h3 id={`${id}-ios`}>{t('install.iosTitle')}</h3>
      <ol>
        <li><span className="install-step-icon"><ShareIcon /></span><span>{t('install.iosStep1')}</span></li>
        <li><span className="install-step-icon"><AddSquareIcon /></span><span>{t('install.iosStep2')}</span></li>
      </ol>
    </section>
  );
  const android = (
    <section className="install-platform" aria-labelledby={`${id}-android`} key="android">
      <h3 id={`${id}-android`}>{t('install.androidTitle')}</h3>
      <ol>
        <li><span className="install-step-icon"><MenuDotsIcon /></span><span>{t('install.androidStep1')}</span></li>
        <li><span className="install-step-icon"><PhoneIcon /></span><span>{t('install.androidStep2')}</span></li>
      </ol>
    </section>
  );

  return createPortal(
    <div className="install-guide-backdrop" role="presentation"
         onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialog} className="install-guide" role="dialog" aria-modal="true"
               aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`}>
        <header className="install-guide-head">
          <img src="/icon-192.png" alt="" width="48" height="48" />
          <div>
            <h2 id={`${id}-title`}>{t('install.title')}</h2>
            <p id={`${id}-intro`}>{t('install.intro')}</p>
          </div>
          <button ref={closeButton} type="button" className="install-guide-close"
                  aria-label={t('install.close')} onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="install-guide-body">
          {isAppleMobile() ? [ios, android] : [android, ios]}
          <p className="install-guide-note">{t('install.inApp')}</p>
        </div>
        <button type="button" className="btn btn-primary btn-block install-guide-done" onClick={onClose}>
          {t('install.gotIt')}
        </button>
      </section>
    </div>,
    document.body,
  );
}

/**
 * Nút cài ứng dụng. Có `beforeinstallprompt` (Chrome/Edge trên Android, máy tính) thì mở hộp
 * cài của trình duyệt; không có thì mở hướng dẫn 2 bước. Đang chạy như app đã cài thì ẩn.
 *  - variant="header": nút gọn ở thanh trên cùng (hiện cả trên điện thoại).
 *  - variant="footer": nút to kèm một dòng giải thích ở chân trang.
 */
export default function InstallButton({ variant = 'header' }) {
  const { t } = useI18n();
  const { prompt, installed } = useInstallState();
  const [guideOpen, setGuideOpen] = useState(false);
  const trigger = useRef(null);

  const closeGuide = useCallback(() => {
    setGuideOpen(false);
    trigger.current?.focus();
  }, []);

  if (installed) return null;

  const install = async () => {
    if (!prompt) { setGuideOpen(true); return; }
    // Mỗi sự kiện chỉ gọi prompt() được một lần; trình duyệt sẽ phát sự kiện mới nếu khách còn cài được.
    update({ prompt: null });
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      setGuideOpen(true);
    }
  };

  const common = {
    ref: trigger,
    type: 'button',
    onClick: install,
    'aria-haspopup': prompt ? undefined : 'dialog',
    'aria-expanded': prompt ? undefined : guideOpen,
  };
  const guide = guideOpen && <InstallGuide onClose={closeGuide} />;

  if (variant === 'footer') {
    return (
      <div className="footer-install">
        <button {...common} className="btn footer-install-btn">
          <DownloadIcon /><span>{t('nav.install')}</span>
        </button>
        <small>{t('install.footerHint')}</small>
        {guide}
      </div>
    );
  }

  return (
    <>
      <button {...common} className="btn btn-install" title={t('nav.install')}>
        <DownloadIcon /><span className="install-label">{t('nav.installShort')}</span>
      </button>
      {guide}
    </>
  );
}
