import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/index.jsx';

const EVENT = 'gao:toast';
let nextId = 1;

/**
 * Hiện một thông báo nổi ở mọi trang (thay window.alert). `action: { label, onClick }` thêm một nút,
 * ví dụ "Hoàn tác" sau khi xoá món khỏi giỏ. Tự ẩn sau `duration` mili giây.
 */
export function toast(message, { action = null, tone = 'info', duration = 5000 } = {}) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { id: nextId++, message, action, tone, duration } }));
}

/** Nơi hiện thông báo nổi; gắn một lần ở App. */
export default function Toasts() {
  const { t } = useI18n();
  const closeLabel = t('common.close');
  const [items, setItems] = useState([]);
  const dismiss = (id) => setItems((cur) => cur.filter((item) => item.id !== id));

  useEffect(() => {
    const timers = new Set();
    const onToast = (event) => {
      const item = event.detail;
      setItems((cur) => [...cur.slice(-2), item]);       // tối đa 3 thông báo cùng lúc
      const timer = window.setTimeout(() => { timers.delete(timer); dismiss(item.id); }, item.duration);
      timers.add(timer);
    };
    window.addEventListener(EVENT, onToast);
    return () => { window.removeEventListener(EVENT, onToast); timers.forEach((timer) => window.clearTimeout(timer)); };
  }, []);

  if (!items.length) return null;
  return (
    <div className="app-toasts" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`app-toast ${item.tone}`}>
          <p>{item.message}</p>
          {item.action && (
            <button type="button" onClick={() => { item.action.onClick(); dismiss(item.id); }}>{item.action.label}</button>
          )}
          <button type="button" className="app-toast-close" aria-label={closeLabel} onClick={() => dismiss(item.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
