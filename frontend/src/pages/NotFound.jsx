import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/index.jsx';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="empty empty-page">
      <span className="empty-icon" aria-hidden="true">🌾</span>
      <h1>{t('notFound.title')}</h1>
      <p>{t('notFound.body')}</p>
      <Link className="btn btn-primary btn-large" to="/">{t('common.backToShop')}</Link>
    </div>
  );
}
