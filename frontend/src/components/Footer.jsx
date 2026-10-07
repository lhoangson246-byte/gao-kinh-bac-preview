import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/index.jsx';
import { api } from '../api';

/** Cài đặt cửa hàng đọc một lần cho cả trang (chân trang dùng chung với các trang khác). */
let storefrontRequest = null;
export function useStorefront() {
  const [settings, setSettings] = useState(null);
  useEffect(() => {
    let active = true;
    storefrontRequest ??= api.storefront().then((r) => r.settings || {}).catch(() => {
      storefrontRequest = null;
      return {};
    });
    storefrontRequest.then((value) => { if (active) setSettings(value); });
    return () => { active = false; };
  }, []);
  return settings;
}

const formatPhone = (phone) => phone.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
const mapSearch = (address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/**
 * Chân trang: giờ làm việc (cùng giờ với khung nhắc ở trang đặt hàng) và các cơ sở của cửa
 * hàng. Địa chỉ cơ sở do cửa hàng tự nhập trong trang quản trị; chưa nhập thì không hiện,
 * không dùng địa chỉ mẫu.
 */
export default function Footer() {
  const { t } = useI18n();
  const settings = useStorefront();
  const branches = settings?.branches || [];
  const hotline = settings?.contact_phone || '';

  return (
    <footer className="footer">
      <div className="container footer-grid">
        <section className="footer-brand">
          <strong>Gạo Kinh Bắc</strong>
          <span>{t('footer.tagline')}</span>
          {hotline && (
            <a className="footer-hotline" href={`tel:${hotline}`}>☏ {formatPhone(hotline)}</a>
          )}
        </section>

        <section className="footer-hours" aria-labelledby="footer-hours-title">
          <h2 id="footer-hours-title">{t('footer.hoursTitle')}</h2>
          <ul>
            <li><span>{t('footer.morning')}</span><b>07h00 – 11h30</b></li>
            <li className="muted-row"><span>{t('footer.lunch')}</span><b>11h30 – 13h30</b></li>
            <li><span>{t('footer.afternoon')}</span><b>13h30 – 18h00</b></li>
          </ul>
          <small>{t('footer.hoursNote')}</small>
        </section>

        {branches.length > 0 && (
          <section className="footer-branches" aria-labelledby="footer-branches-title">
            <h2 id="footer-branches-title">{t('footer.branchesTitle')}</h2>
            <ul>
              {branches.map((branch, index) => (
                <li key={`${index}-${branch.address}`}>
                  <strong>{branch.name || t('footer.branchN', { n: index + 1 })}</strong>
                  <span>{branch.address}</span>
                  <span className="footer-links">
                    <a href={mapSearch(branch.address)} target="_blank" rel="noopener noreferrer">{t('footer.directions')}</a>
                    {branch.phone && <a href={`tel:${branch.phone}`}>☏ {formatPhone(branch.phone)}</a>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <div className="container footer-bottom">© {new Date().getFullYear()} Gạo Kinh Bắc</div>
    </footer>
  );
}
