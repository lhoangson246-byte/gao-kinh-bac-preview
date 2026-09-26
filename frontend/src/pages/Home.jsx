import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatVND, salePercent } from '../api';
import { useCart } from '../context/CartContext.jsx';
import ProductImage from '../components/ProductImage.jsx';

// Ảnh dự phòng nằm trong thư mục public, không phụ thuộc dịch vụ bên ngoài.
const FALLBACK_IMAGE = '/logo-mark.png';
const QUICK_FILTERS = [
  ['', 'Tất cả'], ['ST25', 'Gạo ST25'], ['nếp', 'Gạo nếp'], ['lứt', 'Gạo lứt'],
  ['G9', 'Gạo G9'], ['Cỏ May', 'Cỏ May'],
];

/**
 * Nhóm mặt hàng. Mã nhóm khớp CATALOG_GROUPS ở máy chủ; máy chủ tự lọc, trình
 * duyệt chỉ gửi mã nhóm đi.
 */
const GROUPS = [
  { code: '', label: 'Tất cả mặt hàng', heading: 'Tất cả sản phẩm', empty: 'Không tìm thấy sản phẩm phù hợp.' },
  { code: 'giam-gia', label: 'Đang giảm giá', heading: 'Đang ưu đãi, giảm giá', empty: 'Hiện chưa có sản phẩm nào đang giảm giá. Quay lại sau nhé!' },
  { code: 'nha-hang', label: 'Gạo nhà hàng · bao 25kg', heading: 'Gạo cho nhà hàng · bao 25kg', empty: 'Chưa có loại gạo bao 25kg phù hợp.' },
  { code: 'do-kho', label: 'Thực phẩm khô', heading: 'Thực phẩm khô, đồ khô', empty: 'Cửa hàng đang cập nhật mặt hàng đồ khô.' },
];

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
          <p className="delivery-chip"><span aria-hidden="true">⌖</span> Giao hàng tại <strong>Bắc Ninh</strong></p>
          <h1>Chọn gạo cho nhà mình</h1>
          <p className="toolbar-note">Gạo bán lẻ cho gia đình · Cửa hàng gọi xác nhận trước khi giao</p>
        </div>
        {!banner && <div className="toolbar-art" aria-hidden="true"><span>🌾</span></div>}
      </header>

      <section className="catalog-controls" aria-label="Tìm và lọc sản phẩm">
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Tìm sản phẩm</span>
          <input
            className="input search"
            type="search"
            placeholder="Tìm gạo, đồ khô…"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
          {q && <button type="button" onClick={() => setQ('')} aria-label="Xoá từ khoá">×</button>}
        </label>
        <div className="filter-rows">
        <div className="quick-filters group-filters" role="group" aria-label="Nhóm mặt hàng">
          {GROUPS.map((g) => (
            <button
              key={g.code || 'all'}
              type="button"
              className={`${group === g.code ? 'active' : ''}${g.code === 'giam-gia' ? ' sale-chip' : ''}`}
              aria-pressed={group === g.code}
              onClick={() => setGroup(g.code)}
            >{g.label}</button>
          ))}
        </div>
        <div className="quick-filters" role="group" aria-label="Loại gạo">
          {QUICK_FILTERS.map(([value, label]) => (
            <button
              key={label}
              type="button"
              className={q === value ? 'active' : ''}
              aria-pressed={q === value}
              onClick={() => setQ(value)}
            >{label}</button>
          ))}
          <button
            type="button"
            className={inStockOnly ? 'active' : ''}
            aria-pressed={inStockOnly}
            onClick={() => setInStockOnly((value) => !value)}
          >Chỉ hàng còn</button>
        </div>
        </div>
      </section>

      <section className="catalog-section" aria-busy={loading}>
        <div className="catalog-heading">
          <h2>{current.heading}</h2>
          {!loading && !error && <span>{products.length} sản phẩm</span>}
        </div>

        {error && (
          <div className="alert error" role="alert">
            {error}{' '}
            <button className="link-button" onClick={() => setQ((value) => value)}>Thử lại</button>
          </div>
        )}
        {loading && <div className="loading-state" role="status"><span></span>Đang tải sản phẩm…</div>}
        {!loading && !error && products.length === 0 && (
          <div className="empty compact">
            <p>{q || inStockOnly ? 'Không tìm thấy sản phẩm phù hợp.' : current.empty}</p>
            <button className="link-button" onClick={() => { setQ(''); setInStockOnly(false); setGroup(''); }}>
              Xem tất cả sản phẩm
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
                  {sale > 0 && <span className="sale-tag" aria-label={`Giảm ${sale}%`}>−{sale}%</span>}
                  {unpriced
                    ? <span className="stock-tag pending">Đang cập nhật giá</span>
                    : soldOut
                      ? <span className="stock-tag sold-out">Hết hàng</span>
                      : product.stock <= 10 && <span className="stock-tag">Sắp hết</span>}
                </div>
                <div className="product-body">
                  <div className="product-meta">
                    <span>{product.origin || 'Việt Nam'}</span>
                    <span>
                      {unpriced ? 'Liên hệ cửa hàng'
                        : soldOut ? 'Tạm hết hàng'
                        : `Còn ${product.stock} ${product.unit}`}
                    </span>
                  </div>
                  <h3>{product.name}</h3>
                  <p className="desc">{product.description || 'Hạt gạo được chọn kỹ cho bữa cơm gia đình.'}</p>
                  <div className="product-bottom">
                    <div className="product-price">
                      {unpriced
                        ? <strong className="price-pending">Chưa có giá</strong>
                        : <strong className={sale > 0 ? 'on-sale' : ''}>{formatVND(product.price)}</strong>}
                      {sale > 0 && <s className="was-price" aria-label={`Giá gốc ${formatVND(product.original_price)}`}>{formatVND(product.original_price)}</s>}
                      <span>/ {product.unit}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary add-button"
                      disabled={!canBuy}
                      onClick={() => handleAdd(product)}
                      aria-label={
                        unpriced ? `${product.name} chưa có giá bán`
                          : soldOut ? `${product.name} đã hết hàng`
                          : `Thêm ${product.name} vào giỏ hàng`
                      }
                    >
                      {unpriced ? 'Chưa bán' : soldOut ? 'Hết hàng' : added === product.id ? 'Đã thêm ✓' : '+ Thêm'}
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
          <span><b>{count}</b> sản phẩm</span><strong>{formatVND(total)} · Xem giỏ →</strong>
        </Link>
      )}
    </div>
  );
}
