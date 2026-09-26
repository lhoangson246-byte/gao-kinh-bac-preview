import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatVND, salePercent } from '../api';
import { useCart } from '../context/CartContext.jsx';
import ProductImage from '../components/ProductImage.jsx';
import { useI18n } from '../i18n/index.jsx';

// Ảnh dự phòng nằm trong thư mục public, không phụ thuộc dịch vụ bên ngoài.
const FALLBACK_IMAGE = '/logo-mark.png';
// Từ khoá tìm luôn là tiếng Việt vì khớp với tên sản phẩm; chỉ nhãn nút được dịch.
const QUICK_FILTERS = [
  ['', 'filter.all'], ['ST25', 'filter.st25'], ['nếp', 'filter.nep'], ['lứt', 'filter.lut'],
  ['G9', 'filter.g9'], ['Cỏ May', 'filter.comay'],
];

/**
 * Nhóm mặt hàng. Mã nhóm khớp CATALOG_GROUPS ở máy chủ; máy chủ tự lọc, trình
 * duyệt chỉ gửi mã nhóm đi.
 */
const GROUPS = [
  { code: '', key: 'group.all' },
  { code: 'giam-gia', key: 'group.sale' },
  { code: 'nha-hang', key: 'group.restaurant' },
  { code: 'do-kho', key: 'group.dry' },
];

/** Chèn số in đậm vào câu đã dịch, đúng vị trí {n} của từng ngôn ngữ. */
function splitCount(template, count) {
  const [before, after = ''] = template.split('{n}');
  return <>{before}<b>{count}</b>{after}</>;
}

export default function Home() {
  const [products, setProducts] = useState([]);
  const [q, setQ] = useState('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [group, setGroup] = useState('');
  const [banner, setBanner] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [added, setAdded] = useState(null);
  const { add, count, total, syncWithProducts } = useCart();
  const { t, unit } = useI18n();

  // Ảnh banner do cửa hàng tự đổi trong trang quản trị. Lỗi thì giữ banner màu mặc định.
  useEffect(() => {
    let cancelled = false;
    api.storefront()
      .then(({ settings }) => { if (!cancelled) setBanner(settings?.banner_image_url || ''); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      api.products(q, { inStockOnly, group })
        .then(({ products }) => {
          if (cancelled) return;
          setProducts(products);
          // Cập nhật giá và tồn kho cho những gì đã nằm trong giỏ.
          syncWithProducts(products);
        })
        .catch((err) => { if (!cancelled) setError(err.message); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [q, inStockOnly, group, syncWithProducts]);

  const current = GROUPS.find((g) => g.code === group) || GROUPS[0];

  const handleAdd = (product) => {
    if (!add(product, 1)) return;
    setAdded(product.id);
    window.setTimeout(() => setAdded(null), 1400);
  };

  return (
    <div className="store-app">
      <header className={`store-toolbar${banner ? ' has-banner' : ''}`}>
        {banner && (
          <img className="store-banner" src={banner} alt="" fetchpriority="high"
               onError={() => setBanner('')} />
        )}
        <div className="store-toolbar-copy">
          <p className="delivery-chip"><span aria-hidden="true">⌖</span> {t('home.deliveryIn')} <strong>Bắc Ninh</strong></p>
          <h1>{t('home.title')}</h1>
          <p className="toolbar-note">{t('home.note')}</p>
        </div>
        {!banner && <div className="toolbar-art" aria-hidden="true"><span>🌾</span></div>}
      </header>

      <section className="catalog-controls" aria-label={t('home.controls')}>
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">{t('home.searchLabel')}</span>
          <input
            className="input search"
            type="search"
            placeholder={t('home.searchPlaceholder')}
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
          {q && <button type="button" onClick={() => setQ('')} aria-label={t('home.clearSearch')}>×</button>}
        </label>
        <div className="filter-rows">
        <div className="quick-filters group-filters" role="group" aria-label={t('home.groupsAria')}>
          {GROUPS.map((g) => (
            <button
              key={g.code || 'all'}
              type="button"
              className={`${group === g.code ? 'active' : ''}${g.code === 'giam-gia' ? ' sale-chip' : ''}`}
              aria-pressed={group === g.code}
              onClick={() => setGroup(g.code)}
            >{t(g.key)}</button>
          ))}
        </div>
        <div className="quick-filters" role="group" aria-label={t('home.typesAria')}>
          {QUICK_FILTERS.map(([value, label]) => (
            <button
              key={label}
              type="button"
              className={q === value ? 'active' : ''}
              aria-pressed={q === value}
              onClick={() => setQ(value)}
            >{t(label)}</button>
          ))}
          <button
            type="button"
            className={inStockOnly ? 'active' : ''}
            aria-pressed={inStockOnly}
            onClick={() => setInStockOnly((value) => !value)}
          >{t('filter.inStock')}</button>
        </div>
        </div>
      </section>

      <section className="catalog-section" aria-busy={loading}>
        <div className="catalog-heading">
          <h2>{t(`${current.key}.heading`)}</h2>
          {!loading && !error && <span>{t('home.count', { n: products.length })}</span>}
        </div>

        {error && (
          <div className="alert error" role="alert">
            {error}{' '}
            <button className="link-button" onClick={() => setQ((value) => value)}>{t('common.retry')}</button>
          </div>
        )}
        {loading && <div className="loading-state" role="status"><span></span>{t('home.loading')}</div>}
        {!loading && !error && products.length === 0 && (
          <div className="empty compact">
            <p>{q || inStockOnly ? t('home.noMatch') : t(`${current.key}.empty`)}</p>
            <button className="link-button" onClick={() => { setQ(''); setInStockOnly(false); setGroup(''); }}>
              {t('home.seeAll')}
            </button>
          </div>
        )}

        <div className="product-grid">
          {products.map((product, index) => {
            const unpriced = product.price <= 0;          // cửa hàng chưa nhập giá
            const soldOut = product.stock <= 0;
            const canBuy = !unpriced && !soldOut;
            const sale = unpriced ? 0 : salePercent(product);
            return (
              <article key={product.id} className="product-card">
                <div className="product-image">
                  <ProductImage src={product.image_url || FALLBACK_IMAGE} alt={product.name} first={index === 0} eager={index < 3} />
                  {sale > 0 && <span className="sale-tag" aria-label={t('card.saleAria', { n: sale })}>−{sale}%</span>}
                  {unpriced
                    ? <span className="stock-tag pending">{t('card.pricePending')}</span>
                    : soldOut
                      ? <span className="stock-tag sold-out">{t('card.soldOut')}</span>
                      : product.stock <= 10 && <span className="stock-tag">{t('card.lowStock')}</span>}
                </div>
                <div className="product-body">
                  <div className="product-meta">
                    <span>{product.origin || t('card.originFallback')}</span>
                    <span>
                      {unpriced ? t('card.contact')
                        : soldOut ? t('card.outOfStock')
                        : t('card.left', { n: product.stock, unit: unit(product.unit) })}
                    </span>
                  </div>
                  <h3>{product.name}</h3>
                  <p className="desc">{product.description || t('card.descFallback')}</p>
                  <div className="product-bottom">
                    <div className="product-price">
                      {unpriced
                        ? <strong className="price-pending">{t('card.noPrice')}</strong>
                        : <strong className={sale > 0 ? 'on-sale' : ''}>{formatVND(product.price)}</strong>}
                      {sale > 0 && <s className="was-price" aria-label={t('card.wasAria', { price: formatVND(product.original_price) })}>{formatVND(product.original_price)}</s>}
                      <span>/ {unit(product.unit)}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary add-button"
                      disabled={!canBuy}
                      onClick={() => handleAdd(product)}
                      aria-label={
                        unpriced ? t('card.noPriceAria', { name: product.name })
                          : soldOut ? t('card.soldOutAria', { name: product.name })
                          : t('card.addAria', { name: product.name })
                      }
                    >
                      {unpriced ? t('card.notSelling') : soldOut ? t('card.soldOut') : added === product.id ? t('card.added') : t('card.add')}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {count > 0 && (
        <Link className="floating-cart" to="/gio-hang">
          <span>{splitCount(t('home.floatingItems'), count)}</span>
          <strong>{t('home.floatingCart', { total: formatVND(total) })}</strong>
        </Link>
      )}
    </div>
  );
}
