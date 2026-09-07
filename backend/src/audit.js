import db from './db.js';

const redact = (value) => {
  if (value == null) return null;
  return JSON.stringify(value, (key, item) =>
    /password|token|authorization|cookie|secret/i.test(key) ? undefined : item);
};

/** Ghi thay đổi của quản trị viên. Không bao giờ truyền mật khẩu/token vào đây. */
export function writeAdminAudit(req, { action, entityType, entityId, before, after }) {
  db.prepare(`
    INSERT INTO admin_audit_logs
      (actor_id, actor_name, action, entity_type, entity_id, before_json, after_json, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user?.id ?? null,
    req.user?.full_name ?? null,
    action,
    entityType,
    entityId == null ? null : String(entityId),
    redact(before),
    redact(after),
    req.ip || req.socket?.remoteAddress || null,
  );
}

export function writeLoginHistory(req, userId, loginMethod) {
  db.prepare(`
    INSERT INTO login_history (user_id, login_method, ip_address, user_agent)
    VALUES (?, ?, ?, ?)
  `).run(
    userId,
    loginMethod,
    req.ip || req.socket?.remoteAddress || null,
    String(req.get('user-agent') || '').slice(0, 500) || null,
  );
}
