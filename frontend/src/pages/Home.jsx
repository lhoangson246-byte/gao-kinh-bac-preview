import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatVND } from '../api';
import { useCart } from '../context/CartContext.jsx';

// Ảnh dự phòng nằm trong thư mục public, không phụ thuộc dịch vụ bên ngoài.
const FALLBACK_IMAGE = '/logo-mark.png';
const QUICK_FILTERS = [
  ['', 'Tất cả'], ['ST25', 'Gạo ST25'], ['nếp', 'Gạo nếp'], ['lứt', 'Gạo lứt'],
  ['G9', 'Gạo G9'], ['Cỏ May', 'Cỏ May'],
];

export default function Home() {
  const [products, setProducts] = useState([]);
  const [q, setQ] = useState('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [added, setAdded] = useState(null);
  const { add, count, total, syncWithProducts } = useCart();

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      api.products(q, { inStockOnly })
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
  }, [q, inStockOnly, syncWithProducts]);

  const handleAdd = (product) => {
    if (!add(product, 1)) return;
    setAdded(product.id);
    window.setTimeout(() => setAdded(null), 1400);
  };

  return (
    <div className="store-app">
      <header className="store-toolbar">
        <div>
          <p className="delivery-chip"><span aria-hidden="true">⌖</span> Giao hàng tại <strong>Bắc Ninh</strong></p>
          <h1>Chọn gạo cho nhà mình</h1>
          <p className="toolbar-note">Gạo bán lẻ cho gia đình · Cửa hàng gọi xác nhận trước khi giao</p>
        </div>
        <div className="toolbar-art" aria-hidden="true"><span>🌾</span></div>
      </header>

      <section className="catalog-controls" aria-label="Tìm và lọc sản phẩm">
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Tìm loại gạo</span>
          <input
            className="input search"
            type="search"
            placeholder="Tìm loại gạo…"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
          {q && <button type="button" onClick={() => setQ('')} aria-label="Xoá từ khoá">×</button>}
        </label>
        <div className="quick-filters" role="group" aria-label="Nhóm gạo">
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
      </section>

      <section className="catalog-section">
        <div className="catalog-heading">
          <h2>Các loại gạo</h2>
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
            <p>Không tìm thấy loại gạo phù hợp.</p>
            <button className="link-button" onClick={() => { setQ(''); setInStockOnly(false); }}>
              Xem tất cả
            </button>
          </div>
        )}

        <div className="product-grid">
          {products.map((product) => {
            const unpriced = product.price <= 0;          // cửa hàng chưa nhập giá
            const soldOut = product.stock <= 0;
            const canBuy = !unpriced && !soldOut;
            return (
              <article key={product.id} className="product-card">
                <div className="product-image">
                  <img src={product.image_url || FALLBACK_IMAGE} alt={product.name} loading="lazy" />
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
                        : <strong>{formatVND(product.price)}</strong>}
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
