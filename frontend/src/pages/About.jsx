import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n/index.jsx';
import { useStorefront } from '../components/Footer.jsx';

const formatPhone = (phone) => phone.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
const formatDay = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : '');

/** Thang điểm của cửa hàng (1 – max): chấm tròn đầy / rỗng. */
function Score({ score, max }) {
  const { t } = useI18n();
  return (
    <span className="review-score" aria-label={t('about.score', { score, max })}>
      {Array.from({ length: max }, (_, i) => <i key={i} className={i < score ? 'on' : ''} aria-hidden="true" />)}
      <b>{score}/{max}</b>
    </span>
  );
}

/**
 * /ve-chung-toi — giới thiệu cửa hàng và giấy tờ (an toàn thực phẩm, công bố sản phẩm…).
 * /ve-chung-toi/danh-gia — đánh giá dịch vụ giao hàng cửa hàng gom từ nhóm Zalo.
 * Mọi nội dung do cửa hàng nhập trong trang quản trị; chưa có thì báo đang cập nhật.
 */
export default function About() {
  const { t } = useI18n();
  const reviewsTab = useLocation().pathname.startsWith('/ve-chung-toi/danh-gia');
  const settings = useStorefront();
  const [about, setAbout] = useState(null);
  const [reviews, setReviews] = useState(null);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState(null);   // giấy tờ đang xem ảnh lớn

  useEffect(() => {
    let active = true;
    const load = reviewsTab ? api.aboutReviews().then((data) => active && setReviews(data))
      : api.about().then((data) => active && setAbout(data));
    load.catch((err) => active && setError(err.message));
    return () => { active = false; };
  }, [reviewsTab]);

  useEffect(() => {
    if (!viewing) return undefined;
    const close = (event) => { if (event.key === 'Escape') setViewing(null); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [viewing]);

  const hotline = settings?.contact_phone || '';
  const zalo = settings?.zalo_phone || hotline;

  return (
    <div className="about-page">
      <header className="about-hero">
        <p className="eyebrow"><span></span>{t('about.eyebrow')}</p>
        <h1>{t('about.title')}</h1>
        <nav className="about-tabs" aria-label={t('about.title')}>
          <NavLink to="/ve-chung-toi" end>{t('about.tabInfo')}</NavLink>
          <NavLink to="/ve-chung-toi/danh-gia">{t('about.tabReviews')}</NavLink>
        </nav>
      </header>

      {error && <p className="alert error" role="alert">{error}</p>}

      {!reviewsTab && (
        <>
          {about?.intro && (
            <section className="about-card about-intro">
              {about.intro.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
            </section>
          )}

          <section className="about-card" aria-labelledby="about-docs-title">
            <h2 id="about-docs-title">{t('about.docsTitle')}</h2>
            {!about ? <div className="loading-state" role="status"><span></span>{t('common.loading')}</div>
              : about.documents.length === 0 ? <p className="muted">{t('about.docsEmpty')}</p>
              : (
                <ul className="about-docs">
                  {about.documents.map((doc) => (
                    <li key={doc.id}>
                      <button type="button" onClick={() => setViewing(doc)} title={t('about.viewFull')}>
                        <img src={doc.image_url} alt={doc.title} loading="lazy" decoding="async" />
                      </button>
                      <span className={`about-doc-tag ${doc.category}`}>{t(`about.cat.${doc.category}`)}</span>
                      <strong>{doc.title}</strong>
                      {doc.note && <small>{doc.note}</small>}
                    </li>
                  ))}
                </ul>
              )}
          </section>

          {(hotline || zalo) && (
            <section className="about-card about-contact" aria-labelledby="about-contact-title">
              <h2 id="about-contact-title">{t('about.contactTitle')}</h2>
              <div className="about-contact-actions">
                {hotline && <a className="btn btn-primary" href={`tel:${hotline}`}>☏ {t('about.call', { phone: formatPhone(hotline) })}</a>}
                {zalo && <a className="btn btn-secondary" href={`https://zalo.me/${zalo}`} target="_blank" rel="noopener noreferrer">Zalo {formatPhone(zalo)}</a>}
              </div>
            </section>
          )}
        </>
      )}

      {reviewsTab && (
        <section className="about-card" aria-labelledby="about-reviews-title">
          <h2 id="about-reviews-title">{t('about.reviewsTitle')}</h2>
          <p className="muted">{t('about.reviewsIntro')}</p>
          {!reviews ? <div className="loading-state" role="status"><span></span>{t('common.loading')}</div>
            : reviews.reviews.length === 0 ? <p className="muted">{t('about.reviewsEmpty')}</p>
            : (
              <>
                <p className="review-summary">
                  {reviews.summary.average != null
                    ? t('about.average', { avg: String(reviews.summary.average).replace('.', ','), max: reviews.summary.max_score, n: reviews.summary.count })
                    : t('about.count', { n: reviews.summary.count })}
                </p>
                <ul className="review-list">
                  {reviews.reviews.map((review) => (
                    <li key={review.id}>
                      <div className="review-head">
                        <strong>{review.customer_name || t('about.anonymous')}</strong>
                        {review.review_date && <time>{formatDay(review.review_date)}</time>}
                      </div>
                      {Number.isInteger(review.score) && <Score score={review.score} max={reviews.summary.max_score} />}
                      {review.content.split('\n').map((line, i) => <p key={i}>{line}</p>)}
                    </li>
                  ))}
                </ul>
              </>
            )}
        </section>
      )}

      {viewing && (
        <div className="doc-viewer" role="dialog" aria-modal="true" aria-label={viewing.title} onClick={() => setViewing(null)}>
          <figure onClick={(e) => e.stopPropagation()}>
            <img src={viewing.image_url} alt={viewing.title} />
            <figcaption>{viewing.title}{viewing.note ? ` · ${viewing.note}` : ''}</figcaption>
          </figure>
          <button type="button" className="icon-close" onClick={() => setViewing(null)} aria-label={t('about.close')}>×</button>
        </div>
      )}
    </div>
  );
}
