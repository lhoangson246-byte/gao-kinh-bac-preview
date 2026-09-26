import { Component } from 'react';
import { useI18n } from '../i18n/index.jsx';

// Giữ điều hướng hoạt động khi một trang/chức năng chưa tải được vì mất mạng.
class Boundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function PageLoadBoundary({ children }) {
  const { t } = useI18n();
  return (
    <Boundary fallback={
      <div className="alert error" role="alert">
        {t('common.pageLoadError')}{' '}
        <button type="button" className="link-button" onClick={() => window.location.reload()}>
          {t('common.retry')}
        </button>
      </div>
    }>
      {children}
    </Boundary>
  );
}
