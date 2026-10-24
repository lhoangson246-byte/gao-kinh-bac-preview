import { Router } from 'express';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateRoutes } from '../schemas.js';
import { HttpError, cleanImageUrl, cleanText, toInteger } from '../validate.js';
import { writeAdminAudit } from '../audit.js';
import {
  ABOUT_LIMITS, DOCUMENT_CATEGORY_CODES, REVIEW_MAX_SCORE, cleanLongText, listDocuments, listReviews, readIntro,
} from '../about.js';

/**
 * /api/admin/about — quản trị trang "Về chúng tôi": lời giới thiệu, giấy tờ, đánh giá khách.
 * Chỉ quản trị viên; mọi thay đổi ghi nhật ký.
 */
const router = Router();
router.use(requireAuth, requireAdmin);
router.use(validateRoutes('about-admin'));

const all = () => ({ intro: readIntro(), documents: listDocuments({ all: true }), reviews: listReviews({ all: true }) });
const idParam = (req) => {
  const id = toInteger(req.params.id, { min: 1 });
  if (!id) throw new HttpError(400, 'Mã không hợp lệ.');
  return id;
};
const day = (value) => {
  if (value == null || value === '') return null;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid) throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', { review_date: 'Ngày không hợp lệ.' });
  return value;
};

router.get('/', (req, res) => res.json(all()));

/** PUT /intro — lời giới thiệu cửa hàng (nhiều dòng; để trống thì trang khách ẩn phần này). */
router.put('/intro', (req, res, next) => {
  try {
    const before = readIntro();
    const intro = cleanLongText(req.body.intro ?? '', ABOUT_LIMITS.intro) || '';
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES ('about_intro', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(intro);
    writeAdminAudit(req, { action: 'about.intro', entityType: 'about', entityId: 'intro', before, after: intro });
    res.json(all());
  } catch (err) { next(err); }
});

/* --- Giấy tờ: an toàn thực phẩm, công bố sản phẩm, giấy tờ khác (ảnh chụp) --- */
function readDocument(body, current = {}) {
  const errors = {};
  const doc = { ...current };
  if (body.title !== undefined || !current.title) {
    doc.title = cleanText(body.title ?? '', ABOUT_LIMITS.title);
    if (!doc.title || doc.title.length < 2) errors.title = 'Nhập tên giấy tờ.';
  }
  if (body.category !== undefined) doc.category = body.category;
  doc.category ||= 'khac';
  if (!DOCUMENT_CATEGORY_CODES.includes(doc.category)) errors.category = 'Loại giấy tờ không hợp lệ.';
  if (body.image_url !== undefined || !current.image_url) {
    doc.image_url = cleanImageUrl(body.image_url ?? '');
    if (!doc.image_url) errors.image_url = 'Tải lên ảnh chụp giấy tờ.';
  }
  if (body.note !== undefined) doc.note = cleanText(body.note, ABOUT_LIMITS.note);
  if (body.is_visible !== undefined) doc.is_visible = body.is_visible ? 1 : 0;
  doc.is_visible ??= 1;
  if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors);
  return doc;
}

router.post('/documents', (req, res, next) => {
  try {
    const doc = readDocument(req.body);
    const id = db.transaction(() => {
      const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM about_documents').get().n;
      return db.prepare(`
        INSERT INTO about_documents (title, category, image_url, note, sort_order, is_visible) VALUES (?, ?, ?, ?, ?, ?)
      `).run(doc.title, doc.category, doc.image_url, doc.note ?? null, nextOrder, doc.is_visible).lastInsertRowid;
    })();
    writeAdminAudit(req, { action: 'about.document.create', entityType: 'about_document', entityId: id, after: doc });
    res.status(201).json(all());
  } catch (err) { next(err); }
});

router.post('/documents/reorder', (req, res, next) => {
  try {
    const { ids } = req.body;
    const existing = db.prepare('SELECT id FROM about_documents').all().map((row) => row.id);
    if (ids.length !== existing.length || new Set(ids).size !== ids.length || !ids.every((id) => existing.includes(id))) {
      throw new HttpError(400, 'Danh sách sắp xếp không khớp. Vui lòng tải lại trang.');
    }
    db.transaction(() => {
      const update = db.prepare('UPDATE about_documents SET sort_order = ? WHERE id = ?');
      ids.forEach((id, index) => update.run(index + 1, id));
    })();
    writeAdminAudit(req, { action: 'about.document.reorder', entityType: 'about_document', entityId: null, after: ids });
    res.json(all());
  } catch (err) { next(err); }
});

router.put('/documents/:id', (req, res, next) => {
  try {
    const id = idParam(req);
    const current = db.prepare('SELECT * FROM about_documents WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Không tìm thấy giấy tờ.');
    const doc = readDocument(req.body, current);
    db.prepare(`
      UPDATE about_documents SET title = ?, category = ?, image_url = ?, note = ?, is_visible = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(doc.title, doc.category, doc.image_url, doc.note ?? null, doc.is_visible, id);
    writeAdminAudit(req, { action: 'about.document.update', entityType: 'about_document', entityId: id, before: current, after: doc });
    res.json(all());
  } catch (err) { next(err); }
});

router.delete('/documents/:id', (req, res, next) => {
  try {
    const id = idParam(req);
    const current = db.prepare('SELECT * FROM about_documents WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Không tìm thấy giấy tờ.');
    db.prepare('DELETE FROM about_documents WHERE id = ?').run(id);
    writeAdminAudit(req, { action: 'about.document.delete', entityType: 'about_document', entityId: id, before: current });
    res.json(all());
  } catch (err) { next(err); }
});

/* --- Đánh giá dịch vụ giao hàng (cửa hàng gom từ nhóm Zalo, khách viết tự do) --- */
function readReview(body, current = {}) {
  const errors = {};
  const review = { ...current };
  if (body.content !== undefined || !current.content) {
    review.content = cleanLongText(body.content ?? '', ABOUT_LIMITS.reviewContent);
    if (!review.content) errors.content = 'Nhập nội dung đánh giá.';
  }
  if (body.customer_name !== undefined) review.customer_name = cleanText(body.customer_name, ABOUT_LIMITS.reviewName);
  if (body.score !== undefined) {
    const blank = body.score === null || body.score === '';
    review.score = blank ? null : toInteger(body.score, { min: 1, max: REVIEW_MAX_SCORE });
    if (!blank && review.score == null) errors.score = `Điểm từ 1 đến ${REVIEW_MAX_SCORE}.`;
  }
  if (body.review_date !== undefined) review.review_date = day(body.review_date);
  if (body.is_visible !== undefined) review.is_visible = body.is_visible ? 1 : 0;
  review.is_visible ??= 1;
  if (Object.keys(errors).length) throw new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors);
  return review;
}

router.post('/reviews', (req, res, next) => {
  try {
    const r = readReview(req.body);
    const id = db.prepare(`
      INSERT INTO service_reviews (customer_name, content, score, review_date, is_visible) VALUES (?, ?, ?, ?, ?)
    `).run(r.customer_name ?? null, r.content, r.score ?? null, r.review_date ?? null, r.is_visible).lastInsertRowid;
    writeAdminAudit(req, { action: 'about.review.create', entityType: 'service_review', entityId: id, after: r });
    res.status(201).json(all());
  } catch (err) { next(err); }
});

router.put('/reviews/:id', (req, res, next) => {
  try {
    const id = idParam(req);
    const current = db.prepare('SELECT * FROM service_reviews WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Không tìm thấy đánh giá.');
    const r = readReview(req.body, current);
    db.prepare(`
      UPDATE service_reviews SET customer_name = ?, content = ?, score = ?, review_date = ?, is_visible = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(r.customer_name ?? null, r.content, r.score ?? null, r.review_date ?? null, r.is_visible, id);
    writeAdminAudit(req, { action: 'about.review.update', entityType: 'service_review', entityId: id, before: current, after: r });
    res.json(all());
  } catch (err) { next(err); }
});

router.delete('/reviews/:id', (req, res, next) => {
  try {
    const id = idParam(req);
    const current = db.prepare('SELECT * FROM service_reviews WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Không tìm thấy đánh giá.');
    db.prepare('DELETE FROM service_reviews WHERE id = ?').run(id);
    writeAdminAudit(req, { action: 'about.review.delete', entityType: 'service_review', entityId: id, before: current });
    res.json(all());
  } catch (err) { next(err); }
});

export default router;
