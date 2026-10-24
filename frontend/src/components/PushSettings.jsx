import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { connectPush, disconnectPush, localPushState, pushErrorMessage, sendTestPush } from '../push.js';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

/**
 * Nút "📲" cạnh chuông đơn: bật thông báo đẩy để điện thoại rung và báo đơn mới kể cả khi tắt màn
 * hình hoặc đã đóng app. Mở app mà máy đã cho phép thì tự đăng ký lại, không cần bấm.
 */
export default function PushSettings() {
  const [state, setState] = useState('checking');   // checking | unsupported | unconfigured | denied | off | on
  const [telegram, setTelegram] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);       // { type: 'ok' | 'error', text }
  const wrapper = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = await localPushState();
      if (cancelled) return;
      setState(local);
      if (local === 'unsupported' || local === 'denied' || Notification.permission !== 'granted') return;
      try {
        const result = await connectPush({ ask: false });
        if (!cancelled) { setState(result.state); setTelegram(result.telegram ?? null); }
      } catch { /* mất mạng: giữ trạng thái trên máy, lần mở app sau sẽ đăng ký lại */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Mở bảng thì hỏi máy chủ đã có khoá VAPID / Telegram chưa.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    api.pushConfig().then((config) => {
      if (cancelled) return;
      setTelegram(config.telegram);
      if (!config.publicKey) setState((current) => (current === 'unsupported' ? current : 'unconfigured'));
    }).catch(() => {});
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !wrapper.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      cancelled = true;
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const run = async (action) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setMessage({ type: 'error', text: pushErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const enable = () => run(async () => {
    const result = await connectPush({ ask: true });
    setState(result.state);
    if (result.telegram != null) setTelegram(result.telegram);
    if (result.state === 'on') setMessage({ type: 'ok', text: 'Đã bật. Bấm “Gửi thông báo thử nghiệm”, rồi tắt màn hình để xem.' });
  });

  const test = () => run(async () => {
    const result = await sendTestPush();
    setMessage(result.sent
      ? { type: 'ok', text: 'Đã gửi. Thông báo sẽ hiện sau vài giây — thử tắt màn hình để xem máy có rung không.' }
      : { type: 'error', text: 'Dịch vụ thông báo của trình duyệt chưa nhận. Bấm Tắt rồi Bật lại trên máy này.' });
  });

  const disable = () => run(async () => {
    await disconnectPush();
    setState('off');
    setMessage({ type: 'ok', text: 'Đã tắt thông báo đẩy trên máy này.' });
  });

  const on = state === 'on';
  const label = on ? 'Báo khi tắt màn hình: bật' : 'Bật báo khi tắt màn hình';

  return (
    <div className="push-settings" ref={wrapper}>
      <button type="button" className={`btn btn-secondary push-toggle${on ? ' on' : state === 'off' ? ' nudge' : ''}`}
              onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog"
              title="Thông báo đơn mới kể cả khi điện thoại tắt màn hình">
        <span aria-hidden="true">📲</span> <span className="push-label">{label}</span>
        {!on && <span className="push-short" aria-hidden="true">Bật báo đơn</span>}
      </button>
      {open && (
        <div className="push-panel" role="dialog" aria-label="Thông báo khi tắt màn hình">
          <div className="push-panel-head">
            <strong>Thông báo khi tắt màn hình</strong>
            <button type="button" className="icon-close" onClick={() => setOpen(false)} aria-label="Đóng">×</button>
          </div>

          {state === 'checking' && <p className="push-note">Đang kiểm tra máy này…</p>}
          {state === 'unsupported' && (
            <p className="push-note warn">
              {isIOS() && !standalone()
                ? 'Trên iPhone: bấm Chia sẻ → “Thêm vào MH chính”, rồi mở Gạo Kinh Bắc từ biểu tượng ngoài màn hình để bật thông báo.'
                : 'Trình duyệt này chưa nhận được thông báo đẩy. Trên Android hãy mở bằng Chrome và cài ứng dụng ra màn hình chính.'}
            </p>
          )}
          {state === 'unconfigured' && (
            <p className="push-note warn">
              Máy chủ chưa có khoá thông báo (VAPID). Cần thêm VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY và VAPID_SUBJECT
              trong Vercel → Settings → Environment Variables, rồi Redeploy.
            </p>
          )}
          {state === 'denied' && (
            <p className="push-note warn">
              Máy này đang chặn thông báo của Gạo Kinh Bắc. Mở cài đặt trang (biểu tượng ổ khoá cạnh địa chỉ, hoặc
              Cài đặt → Ứng dụng → Gạo Kinh Bắc → Thông báo) → Cho phép, rồi mở lại app.
            </p>
          )}
          {state === 'off' && (
            <>
              <p className="push-note">Điện thoại sẽ rung và hiện đơn mới ngay cả khi tắt màn hình hoặc đã đóng app.</p>
              <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={enable}>
                {busy ? 'Đang bật…' : '🔔 Bật thông báo khi tắt màn hình'}
              </button>
            </>
          )}
          {on && (
            <>
              <p className="push-connected">✅ Đã kết nối thông báo đẩy trên thiết bị này</p>
              <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={test}>
                {busy ? 'Đang gửi…' : '🔔 Gửi thông báo thử nghiệm'}
              </button>
              <button type="button" className="link-button push-off" disabled={busy} onClick={disable}>Tắt trên máy này</button>
            </>
          )}

          {message && <p className={`push-message ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>}

          {telegram != null && (
            <p className="push-telegram">Telegram dự phòng: {telegram ? <strong>đang bật</strong> : 'chưa cấu hình'}</p>
          )}
          {(on || state === 'off') && (
            <p className="push-tip">
              Android: vào Cài đặt → Ứng dụng → Gạo Kinh Bắc (hoặc Chrome) → Pin → <strong>Không hạn chế</strong>, để
              máy không chặn thông báo khi ngủ.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
