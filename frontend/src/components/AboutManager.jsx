import { lazy, Suspense, useEffect, useState } from 'react';
import { api, vietnamDate } from '../api';
const ImagePicker = lazy(() => import('./ImagePicker.jsx'));

const CATEGORIES = [['attp', 'An toàn thực phẩm'], ['cong-bo', 'Công bố sản phẩm'], ['khac', 'Giấy tờ khác']];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);
const MAX_SCORE = 6;
const EMPTY_DOC = { title: '', category: 'attp', image_url: '', note: '' };
const emptyReview = () => ({ customer_name: '', content: '', score: '', review_date: vietnamDate(), is_visible: true });
const formatDay = (value) => (value ? value.split('-').reverse().join('/') : '');

/**
 * Quản trị trang "Về chúng tôi": lời giới thiệu, giấy tờ (ảnh chụp) và đánh giá dịch vụ giao hàng
 * gom từ nhóm Zalo. Khách xem ở /ve-chung-toi và /ve-chung-toi/danh-gia.
 */
export default function AboutManager() {
  const [data, setData] = useState(null);
  const [intro, setIntro] = useState('');
  const [doc, setDoc] = useState(EMPTY_DOC);
  const [editingDoc, setEditingDoc] = useState(null);
  const [review, setReview] = useState(emptyReview);
  const [editingReview, setEditingReview] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');

  const apply = (next) => { setData(next); setIntro(next.intro); };
  useEffect(() => { api.adminAbout().then(apply).catch((err) => setLoadError(err.message)); }, []);

  const run = async (action, done, scope) => {
    setBusy(true);
    setErrors({});
    setMessage('');
    try {
      apply(await action());
      if (done) setMessage(done);
      return true;
    } catch (err) {
      setErrors({ [scope]: err.message, ...(err.errors || {}) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveDoc = async (event) => {
    event.preventDefault();
    const body = { ...doc, note: doc.note || null };
    const ok = await run(() => (editingDoc ? api.adminAboutUpdateDocument(editingDoc, body) : api.adminAboutCreateDocument(body)),
      editingDoc ? 'Đã lưu giấy tờ.' : 'Đã thêm giấy tờ. Khách thấy ngay ở trang Về chúng tôi.', 'doc');
    if (ok) { setDoc(EMPTY_DOC); setEditingDoc(null); }
  };
  const moveDoc = (index, step) => {
    const ids = data.documents.map((d) => d.id);
    [ids[index], ids[index + step]] = [ids[index + step], ids[index]];
    run(() => api.adminAboutReorderDocuments(ids), '', 'doc');
  };

  const saveReview = async (event) => {
    event.preventDefault();
    const body = { ...review, customer_name: review.customer_name || null, score: review.score === '' ? null : Number(review.score), review_date: review.review_date || null };
    const ok = await run(() => (editingReview ? api.adminAboutUpdateReview(editingReview, body) : api.adminAboutCreateReview(body)),
      editingReview ? 'Đã lưu đánh giá.' : 'Đã thêm đánh giá.', 'review');
    if (ok) { setReview(emptyReview()); setEditingReview(null); }
  };

  if (loadError) return <p className="alert error">{loadError}</p>;
  if (!data) return <div className="loading-state" role="status"><span></span>Đang mở…</div>;

  return (
    <div className="about-manager">
      {message && <p className="alert success" role="status">{message}</p>}

      <section className="form-card flat">
        <h2>Lời giới thiệu cửa hàng</h2>
        <p className="field-help">Hiện đầu trang “Về chúng tôi”. Để trống thì khách không thấy phần này. Cách một dòng trống để chia đoạn.</p>
        <textarea className="input" rows={6} maxLength={3000} value={intro} onChange={(e) => setIntro(e.target.value)}
                  placeholder="Ví dụ: Gạo Kinh Bắc bán lẻ gạo cho gia đình và bếp ăn tại Bắc Ninh từ năm…" />
        {errors.intro_scope && <p className="alert error">{errors.intro_scope}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-primary" disabled={busy || intro === data.intro}
                  onClick={() => run(() => api.adminAboutIntro(intro), 'Đã lưu lời giới thiệu.', 'intro_scope')}>Lưu lời giới thiệu</button>
          <a className="btn btn-secondary" href="/ve-chung-toi" target="_blank" rel="noopener">Xem trang khách ↗</a>
        </div>
      </section>

      <section className="form-card flat">
        <h2>Giấy tờ: an toàn thực phẩm, công bố sản phẩm…</h2>
        <p className="field-help">Chụp rõ cả tờ giấy, thẳng góc. Khách bấm vào ảnh để xem lớn.</p>
        {data.documents.length > 0 && (
          <ul className="about-admin-docs">
            {data.documents.map((d, index) => (
              <li key={d.id} className={d.is_visible ? '' : 'hidden-group'}>
                <img src={d.image_url} alt="" width="64" height="64" />
                <span className="about-admin-doc-text">
                  <strong>{d.title}</strong>
                  <small>{CATEGORY_LABEL[d.category]}{d.note ? ` · ${d.note}` : ''}{d.is_visible ? '' : ' · đang ẩn'}</small>
                </span>
                <span className="group-actions">
                  <button type="button" className="btn btn-secondary" disabled={busy || index === 0} onClick={() => moveDoc(index, -1)} aria-label={`Đưa ${d.title} lên`}>↑</button>
                  <button type="button" className="btn btn-secondary" disabled={busy || index === data.documents.length - 1} onClick={() => moveDoc(index, 1)} aria-label={`Đưa ${d.title} xuống`}>↓</button>
                  <button type="button" className="btn btn-secondary" disabled={busy}
                          onClick={() => { setEditingDoc(d.id); setDoc({ title: d.title, category: d.category, image_url: d.image_url, note: d.note || '' }); }}>Sửa</button>
                  <button type="button" className="btn btn-secondary" disabled={busy}
                          onClick={() => run(() => api.adminAboutUpdateDocument(d.id, { is_visible: !d.is_visible }), d.is_visible ? 'Đã ẩn giấy tờ.' : 'Đã hiện giấy tờ.', 'doc')}>
                    {d.is_visible ? 'Ẩn' : 'Hiện'}
                  </button>
                  <button type="button" className="btn btn-danger" disabled={busy}
                          onClick={() => window.confirm(`Xoá “${d.title}”?`) && run(() => api.adminAboutDeleteDocument(d.id), 'Đã xoá giấy tờ.', 'doc')}>Xoá</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form className="about-admin-form" onSubmit={saveDoc} noValidate>
          <h3>{editingDoc ? 'Sửa giấy tờ' : '+ Thêm giấy tờ'}</h3>
          <label>Tên giấy tờ
            <input className="input" value={doc.title} maxLength={120} onChange={(e) => setDoc({ ...doc, title: e.target.value })}
                   placeholder="Ví dụ: Giấy chứng nhận cơ sở đủ điều kiện ATTP" aria-invalid={!!errors.title} />
            {errors.title && <small className="err">{errors.title}</small>}
          </label>
          <label>Loại
            <select className="input" value={doc.category} onChange={(e) => setDoc({ ...doc, category: e.target.value })}>
              {CATEGORIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </label>
          <Suspense fallback={<div className="loading-state"><span></span>Đang mở…</div>}>
            <ImagePicker value={doc.image_url} onChange={(url) => setDoc((cur) => ({ ...cur, image_url: url }))}
                         error={errors.image_url} label="Ảnh chụp giấy tờ" subject="giấy tờ này" maxEdge={1800} optional={false} />
          </Suspense>
          <label>Ghi chú (không bắt buộc)
            <input className="input" value={doc.note} maxLength={300} onChange={(e) => setDoc({ ...doc, note: e.target.value })}
                   placeholder="Ví dụ: Số 123/2026, cấp ngày 01/03/2026" />
          </label>
          {errors.doc && <p className="alert error">{errors.doc}</p>}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>{editingDoc ? 'Lưu giấy tờ' : 'Thêm giấy tờ'}</button>
            {editingDoc && <button type="button" className="btn btn-secondary" onClick={() => { setEditingDoc(null); setDoc(EMPTY_DOC); setErrors({}); }}>Huỷ</button>}
          </div>
        </form>
      </section>

      <section className="form-card flat">
        <h2>Đánh giá dịch vụ giao hàng</h2>
        <p className="field-help">
          Chép ý kiến khách trong nhóm Zalo vào đây (viết tự do). Điểm từ 1 đến {MAX_SCORE}, có thể bỏ trống.
          Hiện ở trang “Về chúng tôi → Khách đánh giá”, mới nhất trước.
        </p>
        <form className="about-admin-form" onSubmit={saveReview} noValidate>
          <h3>{editingReview ? 'Sửa đánh giá' : '+ Thêm đánh giá'}</h3>
          <div className="about-admin-row">
            <label>Tên khách (không bắt buộc)
              <input className="input" value={review.customer_name} maxLength={80}
                     onChange={(e) => setReview({ ...review, customer_name: e.target.value })} placeholder="Ví dụ: Chị Hà (Võ Cường)" />
            </label>
            <label>Ngày khách viết
              <input className="input" type="date" value={review.review_date} onChange={(e) => setReview({ ...review, review_date: e.target.value })} />
              {errors.review_date && <small className="err">{errors.review_date}</small>}
            </label>
            <label>Điểm (1 – {MAX_SCORE})
              <select className="input" value={review.score} onChange={(e) => setReview({ ...review, score: e.target.value })}>
                <option value="">Không chấm điểm</option>
                {Array.from({ length: MAX_SCORE }, (_, i) => MAX_SCORE - i).map((n) => <option key={n} value={n}>{n} điểm</option>)}
              </select>
              {errors.score && <small className="err">{errors.score}</small>}
            </label>
          </div>
          <label>Nội dung khách viết
            <textarea className="input" rows={4} maxLength={2000} value={review.content}
                      onChange={(e) => setReview({ ...review, content: e.target.value })} aria-invalid={!!errors.content}
                      placeholder="Chép nguyên văn ý kiến của khách" />
            {errors.content && <small className="err">{errors.content}</small>}
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={review.is_visible} onChange={(e) => setReview({ ...review, is_visible: e.target.checked })} />
            Hiện cho khách xem
          </label>
          {errors.review && <p className="alert error">{errors.review}</p>}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>{editingReview ? 'Lưu đánh giá' : 'Thêm đánh giá'}</button>
            {editingReview && <button type="button" className="btn btn-secondary" onClick={() => { setEditingReview(null); setReview(emptyReview()); setErrors({}); }}>Huỷ</button>}
          </div>
        </form>

        {data.reviews.length > 0 && (
          <ul className="about-admin-reviews">
            {data.reviews.map((r) => (
              <li key={r.id} className={r.is_visible ? '' : 'hidden-group'}>
                <div>
                  <strong>{r.customer_name || 'Khách (không ghi tên)'}</strong>
                  <small>{formatDay(r.review_date)}{r.score ? ` · ${r.score}/${MAX_SCORE} điểm` : ''}{r.is_visible ? '' : ' · đang ẩn'}</small>
                  <p>{r.content}</p>
                </div>
                <span className="group-actions">
                  <button type="button" className="btn btn-secondary" disabled={busy}
                          onClick={() => { setEditingReview(r.id); setReview({ customer_name: r.customer_name || '', content: r.content, score: r.score ?? '', review_date: r.review_date || '', is_visible: !!r.is_visible }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Sửa</button>
                  <button type="button" className="btn btn-secondary" disabled={busy}
                          onClick={() => run(() => api.adminAboutUpdateReview(r.id, { is_visible: !r.is_visible }), r.is_visible ? 'Đã ẩn đánh giá.' : 'Đã hiện đánh giá.', 'review')}>
                    {r.is_visible ? 'Ẩn' : 'Hiện'}
                  </button>
                  <button type="button" className="btn btn-danger" disabled={busy}
                          onClick={() => window.confirm('Xoá đánh giá này?') && run(() => api.adminAboutDeleteReview(r.id), 'Đã xoá đánh giá.', 'review')}>Xoá</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
