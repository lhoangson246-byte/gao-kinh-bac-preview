import { Router } from 'express';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateRoutes } from '../schemas.js';
import { HttpError } from '../validate.js';
import {
  MAX_DEVICES_PER_ADMIN, pushEndpointAllowed, pushKeysValid, sendPushToAdmins, telegramConfigured, vapidConfig,
} from '../push.js';

/**
 * /api/push — thông báo đẩy báo đơn mới cho máy của chủ cửa hàng. Chỉ quản trị viên, kiểm tra ở
 * máy chủ cho mọi tuyến.
 */
const router = Router();
router.use(requireAuth, requireAdmin);
router.use(validateRoutes('push'));

/** GET /api/push/config — khoá VAPID công khai (để trình duyệt đăng ký) và Telegram đã bật chưa. */
router.get('/config', (req, res) => {
  res.json({ publicKey: vapidConfig()?.publicKey || null, telegram: telegramConfigured() });
});

/**
 * POST /api/push/subscribe — lưu (hoặc cập nhật theo endpoint) máy này.
 *  body: { endpoint, keys: { p256dh, auth }, old_endpoint? }
 */
router.post('/subscribe', (req, res, next) => {
  try {
    const { endpoint, keys, old_endpoint: oldEndpoint } = req.body;
    if (!vapidConfig()) throw new HttpError(503, 'Máy chủ chưa cấu hình khoá thông báo đẩy (VAPID).');
    if (!pushEndpointAllowed(endpoint)) throw new HttpError(400, 'Địa chỉ nhận thông báo không hợp lệ.');
    if (!pushKeysValid(keys.p256dh, keys.auth)) throw new HttpError(400, 'Khoá thông báo của trình duyệt không hợp lệ.');
    const userAgent = String(req.get('user-agent') || '').slice(0, 200) || null;
    db.transaction(() => {
      if (oldEndpoint && oldEndpoint !== endpoint) {
        db.prepare('DELETE FROM admin_push_subscriptions WHERE endpoint = ?').run(oldEndpoint);
      }
      db.prepare(`
        INSERT INTO admin_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET
          user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
          user_agent = excluded.user_agent, updated_at = datetime('now')
      `).run(req.user.id, endpoint, keys.p256dh, keys.auth, userAgent);
      // Giữ danh sách gọn: bỏ máy lâu không mở nhất khi một tài khoản có quá nhiều máy.
      db.prepare(`
        DELETE FROM admin_push_subscriptions WHERE user_id = ? AND id NOT IN (
          SELECT id FROM admin_push_subscriptions WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?
        )
      `).run(req.user.id, req.user.id, MAX_DEVICES_PER_ADMIN);
    })();
    const devices = db.prepare('SELECT COUNT(*) c FROM admin_push_subscriptions WHERE user_id = ?').get(req.user.id).c;
    res.json({ ok: true, devices });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/push/unsubscribe — ngừng gửi tới máy này. body: { endpoint } */
router.delete('/unsubscribe', (req, res) => {
  const removed = db.prepare('DELETE FROM admin_push_subscriptions WHERE endpoint = ?').run(req.body.endpoint).changes;
  res.json({ ok: true, removed });
});

/**
 * POST /api/push/test — gửi thông báo thử. body: { endpoint? } — có endpoint thì chỉ gửi tới máy
 * đó, không thì tới mọi máy của tài khoản đang đăng nhập.
 */
router.post('/test', async (req, res, next) => {
  try {
    if (!vapidConfig()) throw new HttpError(503, 'Máy chủ chưa cấu hình khoá thông báo đẩy (VAPID).');
    const endpoint = req.body?.endpoint || null;
    const result = await sendPushToAdmins({
      kind: 'test',
      title: '🔔 Thử thông báo Gạo Kinh Bắc',
      body: 'Thông báo đẩy đã hoạt động. Khi có đơn mới, máy sẽ rung và báo ngay cả lúc tắt màn hình.',
      tag: 'test-push',
      url: '/quan-tri',
    }, endpoint ? { endpoint } : { userId: req.user.id });
    if (!result.sent && !result.failed && !result.removed) {
      throw new HttpError(404, 'Máy này chưa bật thông báo đẩy. Bấm “Bật thông báo khi tắt màn hình” trước.');
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
