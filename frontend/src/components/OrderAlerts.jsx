import { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatVND } from '../api';

const POLL_MS = 20_000;
const SOUND_KEY = 'gao_order_sound';

let audioContext = null;
function getAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audioContext ??= new Ctx();
  return audioContext;
}

/** Tiếng "xịch": một nhát nhiễu cao tần rất ngắn, như tiếng lắc. */
function shaker(ctx, at) {
  const length = Math.floor(ctx.sampleRate * 0.09);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 4500;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.5, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.09);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(at);
}

/** Tiếng "xing": chuông kim loại, một âm cơ bản với hai bồi âm tắt dần. */
function bell(ctx, at, frequency) {
  [[1, 0.32], [2.01, 0.11], [3.03, 0.05]].forEach(([multiple, peak]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency * multiple;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 1.2);
  });
}

/** "Xịch xing – xịch xing". */
export async function playChime() {
  const ctx = getAudio();
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch { return false; }
  }
  const t = ctx.currentTime + 0.02;
  shaker(ctx, t);
  bell(ctx, t + 0.06, 1318.5);
  shaker(ctx, t + 0.36);
  bell(ctx, t + 0.42, 1760);
  return ctx.state === 'running';
}

const readSoundPref = () => {
  try { return localStorage.getItem(SOUND_KEY) !== '0'; } catch { return true; }
};

/**
 * Báo đơn online mới ở trang quản trị và bán quầy: hỏi máy chủ khoảng 20 giây một lần, khi có
 * đơn mới thì kêu chuông "xịch xing", hiện thông báo, thêm dấu ở tiêu đề tab và (nếu được cho
 * phép) bật thông báo của máy khi đang mở tab khác.
 *
 * Trình duyệt chỉ cho phát âm thanh sau khi người dùng bấm vào trang ít nhất một lần, nên
 * nút "Âm báo" vừa bật/tắt vừa mở khoá âm thanh; trang cũng tự mở khoá ở lần bấm đầu tiên.
 */
export default function OrderAlerts({ onNewOrder, onView }) {
  const [soundOn, setSoundOn] = useState(readSoundPref);
  const [locked, setLocked] = useState(true);   // âm thanh chưa được trình duyệt cho phép
  const [alert, setAlert] = useState(null);     // { order, count }
  const lastId = useRef(null);
  const baseTitle = useRef(document.title);
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;
  // Trang cha truyền hàm mới mỗi lần vẽ lại; giữ trong ref để bộ hỏi đơn chỉ khởi động một lần.
  const onNewOrderRef = useRef(onNewOrder);
  onNewOrderRef.current = onNewOrder;

  // Mở khoá âm thanh ở lần bấm/chạm đầu tiên vào trang.
  useEffect(() => {
    const unlock = async () => {
      const ctx = getAudio();
      if (!ctx) return;
      try { await ctx.resume(); } catch { /* bỏ qua */ }
      if (ctx.state === 'running') setLocked(false);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    if (getAudio()?.state === 'running') setLocked(false);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const clearTitle = useCallback(() => { document.title = baseTitle.current; }, []);

  const check = useCallback(async () => {
    try {
      const { latest } = await api.adminLatestOrder();
      if (!latest) { lastId.current ??= 0; return; }
      if (lastId.current === null) { lastId.current = latest.id; return; }   // lần đầu: chỉ ghi nhớ
      if (latest.id <= lastId.current) return;
      const count = latest.id - lastId.current;
      lastId.current = latest.id;
      setAlert({ order: latest, count });
      if (!document.title.startsWith('🔔')) baseTitle.current = document.title;
      document.title = `🔔 ${count > 1 ? `${count} đơn mới` : 'Đơn mới'} · ${baseTitle.current}`;
      if (soundRef.current) playChime().then((ok) => setLocked(!ok));
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        const note = new Notification(`Đơn mới ${latest.code || ''}`, {
          body: `${latest.receiver_name} · ${formatVND(latest.total)}`,
          icon: '/icon-192.png',
          tag: 'gao-new-order',
        });
        note.onclick = () => { window.focus(); note.close(); };
      }
      onNewOrderRef.current?.();
    } catch {
      /* mất mạng hay hết phiên: thử lại ở lượt sau */
    }
  }, []);

  useEffect(() => {
    check();
    const timer = window.setInterval(check, POLL_MS);
    const onVisible = () => { if (!document.hidden) { check(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      clearTitle();
    };
  }, [check, clearTitle]);

  const toggleSound = async () => {
    const next = !soundOn || locked;
    setSoundOn(next);
    try { localStorage.setItem(SOUND_KEY, next ? '1' : '0'); } catch { /* bỏ qua */ }
    if (next) {
      // Phát thử để chủ cửa hàng nghe và để trình duyệt cho phép âm thanh từ giờ.
      const ok = await playChime();
      setLocked(!ok);
      if ('Notification' in window && Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch { /* bỏ qua */ }
      }
    }
  };

  const dismiss = () => { setAlert(null); clearTitle(); };

  const label = !soundOn ? 'Âm báo đơn: tắt' : locked ? 'Bấm để bật âm báo' : 'Âm báo đơn: bật';

  return (
    <>
      <button type="button" className={`btn btn-secondary order-sound${soundOn && !locked ? ' on' : ''}${soundOn && locked ? ' locked' : ''}`}
              onClick={toggleSound} aria-pressed={soundOn && !locked} title="Kêu “xịch xing” khi có đơn online mới">
        <span aria-hidden="true">{soundOn && !locked ? '🔔' : '🔕'}</span> {label}
      </button>
      {alert && (
        <div className="order-alert" role="alert">
          <span className="order-alert-bell" aria-hidden="true">🛎️</span>
          <div>
            <strong>{alert.count > 1 ? `${alert.count} đơn online mới` : 'Có đơn online mới!'}</strong>
            <span>
              {alert.order.code} · {alert.order.receiver_name} · {formatVND(alert.order.total)}
              {alert.order.is_guest ? ' · mua nhanh' : ''}
            </span>
          </div>
          {onView && (
            <button type="button" className="btn btn-primary" onClick={() => { onView(); dismiss(); }}>Xem đơn</button>
          )}
          <button type="button" className="icon-close" onClick={dismiss} aria-label="Đóng thông báo">×</button>
        </div>
      )}
    </>
  );
}
