import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
const ImagePicker = lazy(() => import('../components/ImagePicker.jsx'));
const BannerSettings = lazy(() => import('../components/BannerSettings.jsx'));
import OrderAlerts from '../components/OrderAlerts.jsx';
import { api, salePercent, PRODUCT_CATEGORIES, formatDateTime, formatVND, pointsForLines, mapLink, STATUS_LABEL, DELIVERY_SLOT_LABEL, deliveryDateLabel } from '../api';
import { useAuth } from '../context/AuthContext.jsx';
const RevenueReport = lazy(() => import('../components/RevenueReport.jsx'));
const CustomerManager = lazy(() => import('../components/CustomerManager.jsx'));
const StockReceive = lazy(() => import('../components/StockReceive.jsx'));
const ActivityLog = lazy(() => import('../components/ActivityLog.jsx'));
import ProductImage from '../components/ProductImage.jsx';
import OrdersExportButton from '../components/OrdersExportButton.jsx';
import PageLoadBoundary from '../components/PageLoadBoundary.jsx';

const EMPTY = {
  name: '', origin: '', price: '', original_price: '', cost_price: '', category: 'gao', unit: 'kg', weight_kg: '',
  stock: '', description: '', image_url: '',
  // Tích điểm: tắt điểm riêng = theo tiền (1.000đ = 1 điểm); bật = số điểm cố định mỗi túi/bao.
  points_custom: false, points_per_unit: '', is_reward: false,
};
const FILTERS = [
  ['all', 'Tất cả'], ['pending', 'Chờ xác nhận'], ['confirmed', 'Đã xác nhận'],
  ['shipping', 'Đang giao'], ['completed', 'Hoàn thành'], ['cancelled', 'Đã huỷ'],
];
const NEXT_STEP = {
  pending: ['confirmed', 'Xác nhận đơn'],
  confirmed: ['shipping', 'Bắt đầu giao'],
  shipping: ['completed', 'Đánh dấu hoàn thành'],
};

export default function Admin() {
  const [tab, setTab] = useState('orders');
  const [filter, setFilter] = useState('pending');
  const [stats, setStats] = useState(null);
  const [orders, setOrders] = useState([]);
  const [offset, setOffset] = useState(0);
  const [orderTotal, setOrderTotal] = useState(0);
  const [counts, setCounts] = useState({});
  const requestId = useRef(0);
  const productsLoaded = useRef(false);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [receiving, setReceiving] = useState(null);   // loại gạo đang nhập kho
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const reload = useCallback(async ({ refreshProducts = true } = {}) => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const [statsResult, ordersResult, productsResult] = await Promise.all([
        api.adminStats(), api.adminOrders(filter, { offset }),
        refreshProducts || !productsLoaded.current ? api.adminProducts() : Promise.resolve(null),
      ]);
      if (id !== requestId.current) return;
      if (!ordersResult.orders.length && offset > 0) {
        setOffset(Math.max(0, offset - 30));
        return;
      }
      setStats(statsResult.stats);
      setOrders(ordersResult.orders);
      setCounts(ordersResult.counts);
      setOrderTotal(ordersResult.total);
      if (productsResult) {
        setProducts(productsResult.products);
        productsLoaded.current = true;
      }
    } catch (err) {
      if (id === requestId.current) setError(err.message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [filter, offset]);

  useEffect(() => {
    reload({ refreshProducts: false });
    return () => { requestId.current++; };
  }, [reload]);

  const visibleOrders = orders;

  const pendingCount = counts.pending || 0;

  const notify = (message) => {
    setMsg(message);
    window.setTimeout(() => setMsg(''), 2400);
  };

  const changeStatus = async (id, status) => {
    setBusyId(id);
    setError('');
    try {
      await api.adminSetOrderStatus(id, status);
      setOrders((current) => current.map((order) => order.id === id ? { ...order, status } : order));
      notify(`Đã chuyển đơn #${id} sang “${STATUS_LABEL[status]}”.`);
      // Huỷ đơn làm thay đổi tồn kho và doanh thu — lấy lại số liệu mới.
      await reload();
    } catch (err) {
      setError(err.message);
      await reload();   // đơn có thể vừa đổi ở nơi khác
    } finally {
      setBusyId(null);
    }
  };

  const cancelOrder = (order) => {
    if (window.confirm(`Bạn chắc chắn muốn huỷ đơn ${order.code || `#${order.id}`}?`)) changeStatus(order.id, 'cancelled');
  };

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const resetProductForm = () => {
    setForm(EMPTY);
    setFormErrors({});
    setEditingId(null);
    setShowForm(false);
  };

  /** Kiểm tra ngay tại trình duyệt; máy chủ vẫn kiểm tra lại lần nữa. */
  const validateProduct = () => {
    const errors = {};
    const price = Number(form.price);
    const stock = form.stock === '' ? 0 : Number(form.stock);

    if (form.name.trim().length < 2) errors.name = 'Nhập tên loại gạo.';
    if (!Number.isFinite(price) || !Number.isInteger(price) || price <= 0) {
      errors.price = 'Giá bán phải là số nguyên dương, đơn vị đồng (ví dụ 32000).';
    }
    const original = form.original_price === '' ? 0 : Number(form.original_price);
    if (!Number.isInteger(original) || original < 0) {
      errors.original_price = 'Giá gốc phải là số nguyên, đơn vị đồng.';
    } else if (original > 0 && original <= Number(form.price)) {
      errors.original_price = 'Giá gốc phải cao hơn giá bán. Để trống nếu không giảm giá.';
    }
    if (!Number.isFinite(stock) || !Number.isInteger(stock) || stock < 0) {
      errors.stock = 'Tồn kho phải là số nguyên từ 0 trở lên.';
    }
    if (form.points_custom) {
      const points = Number(form.points_per_unit);
      if (form.points_per_unit === '' || !Number.isInteger(points) || points < 0 || points > 10000) {
        errors.points_per_unit = 'Nhập số điểm nguyên từ 0 đến 10.000 (0 = không cộng điểm).';
      }
    }
    // Cho phép cả ảnh có sẵn trong ứng dụng ("/products/....jpg") lẫn ảnh trên mạng.
    const image = form.image_url.trim();
    const isInternal = image.startsWith('/') && !image.startsWith('//');
    if (image && !isInternal && !/^https?:\/\//i.test(image)) {
      errors.image_url = 'Đường dẫn ảnh phải bắt đầu bằng http://, https:// hoặc / (ảnh có sẵn trong ứng dụng).';
    }
    return errors;
  };

  const submitProduct = async (e) => {
    e.preventDefault();
    setError('');

    const errors = validateProduct();
    if (Object.keys(errors).length) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});
    setBusyId(editingId || 'new-product');
    try {
      const { points_custom: pointsCustom, ...fields } = form;
      const payload = {
        ...fields,
        points_per_unit: pointsCustom ? Number(form.points_per_unit) : null,
        is_reward: !!form.is_reward,
        price: Number(form.price),
        cost_price: form.cost_price === '' ? 0 : Number(form.cost_price),
        original_price: form.original_price === '' ? 0 : Number(form.original_price),
        stock: form.stock === '' ? 0 : Number(form.stock),
      };
      if (editingId) {
        await api.adminUpdateProduct(editingId, payload);
        notify('Đã lưu thay đổi sản phẩm.');
      } else {
        await api.adminCreateProduct(payload);
        notify('Đã thêm loại gạo mới.');
      }
      resetProductForm();
      await reload();
    } catch (err) {
      setError(err.message);
      setFormErrors(err.errors || {});
    } finally {
      setBusyId(null);
    }
  };

  const editProduct = (product) => {
    setEditingId(product.id);
    setFormErrors({});
    setForm({
      name: product.name, origin: product.origin || '', price: product.price,
      cost_price: product.cost_price || '', unit: product.unit,
      original_price: product.original_price || '', category: product.category || 'gao',
      weight_kg: product.weight_kg || '',
      stock: product.stock, description: product.description || '', image_url: product.image_url || '',
      points_custom: product.points_per_unit != null,
      points_per_unit: product.points_per_unit ?? '',
      is_reward: !!product.is_reward,
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const hideProduct = async (product) => {
    if (!window.confirm(`Ẩn “${product.name}” khỏi cửa hàng? Các đơn cũ vẫn được giữ nguyên.`)) return;
    setBusyId(product.id);
    try {
      await api.adminDeleteProduct(product.id);
      notify('Đã ẩn sản phẩm khỏi cửa hàng.');
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const destroyProduct = async (product) => {
    const warning = [
      `XOÁ HẲN “${product.name}” khỏi hệ thống?`,
      '',
      'Loại gạo này sẽ biến mất, không khôi phục lại được.',
      'Đơn hàng và hoá đơn cũ vẫn giữ nguyên tên và giá lúc bán.',
      '',
      'Chỉ muốn tạm ngừng bán thì bấm “Ẩn” thay vì xoá.',
    ].join('\n');
    if (!window.confirm(warning)) return;
    setBusyId(product.id);
    try {
      const r = await api.adminDestroyProduct(product.id);
      notify(r.message || 'Đã xoá hẳn loại gạo.');
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const restoreProduct = async (product) => {
    setBusyId(product.id);
    try {
      await api.adminUpdateProduct(product.id, { is_active: 1 });
      notify('Sản phẩm đã được bán trở lại.');
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-app">
      <header className="admin-topbar">
        <div className="admin-brand"><img src="/logo-mark.png" alt="" width="38" height="38" /><div><strong>Gạo Kinh Bắc</strong><small>Khu vực quản trị</small></div></div>
        <div className="admin-account">
          <OrderAlerts
            onNewOrder={() => reload({ refreshProducts: false })}
            onView={() => { setTab('orders'); setFilter('pending'); setOffset(0); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          />
          <span>Xin chào, <strong>{user?.full_name}</strong></span>
          <Link to="/" className="btn btn-secondary">Xem cửa hàng</Link>
          <button className="btn btn-ghost" onClick={() => { logout(); navigate('/'); }}>Đăng xuất</button>
        </div>
      </header>

      <div className="admin-layout">
        <aside className="admin-sidebar">
          <p className="admin-nav-label">Công việc</p>
          <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>
            <span aria-hidden="true">▤</span><span>Đơn hàng<small>Xác nhận và giao hàng</small></span>
            {pendingCount > 0 && <b>{pendingCount}</b>}
          </button>
          <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>
            <span aria-hidden="true">◇</span><span>Sản phẩm<small>Giá bán và tồn kho</small></span>
          </button>
          <button className={tab === 'customers' ? 'active' : ''} onClick={() => setTab('customers')}>
            <span aria-hidden="true">☺</span><span>Khách hàng<small>Tài khoản đăng nhập</small></span>
          </button>
          <button className={tab === 'revenue' ? 'active' : ''} onClick={() => setTab('revenue')}>
            <span aria-hidden="true">◱</span><span>Doanh thu<small>Lọc theo ngày, tháng</small></span>
          </button>
          <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
            <span aria-hidden="true">⌁</span><span>Nhật ký<small>Thay đổi và đăng nhập</small></span>
          </button>
          <Link to="/quan-tri/ban-hang" className="admin-sidebar-link">
            <span aria-hidden="true">◧</span>
            <span>Bán hàng tại quầy<small>Hoá đơn và tích điểm</small></span>
          </Link>
          <div className="admin-help"><strong>Cần làm gì trước?</strong><p>Ưu tiên các đơn “Chờ xác nhận”, gọi khách rồi bấm “Xác nhận đơn”.</p></div>
        </aside>

        <main className="admin-content">
          {loading ? <div className="loading-state page-loading"><span></span>Đang mở trang quản trị…</div> : (
            <PageLoadBoundary key={tab}>
            <Suspense fallback={<div className="loading-state" role="status"><span></span>Đang mở chức năng…</div>}>
            <>
              {!['revenue', 'customers', 'activity'].includes(tab) && (
              <div className="admin-page-heading">
                <div>
                  <p className="eyebrow dark"><span></span>{tab === 'orders' ? 'Công việc hôm nay' : 'Quản lý gian hàng'}</p>
                  <h1>{tab === 'orders' ? 'Đơn hàng' : 'Sản phẩm'}</h1>
                  <p>{tab === 'orders' ? 'Xem đơn mới và cập nhật từng bước giao hàng.' : 'Thêm loại gạo, sửa giá hoặc cập nhật số lượng còn lại.'}</p>
                </div>
                {tab === 'products' && (
                  <button className="btn btn-primary btn-large" onClick={() => { setEditingId(null); setForm(EMPTY); setShowForm(true); }}>
                    + Thêm loại gạo
                  </button>
                )}
              </div>
              )}

              {!['revenue', 'customers', 'activity'].includes(tab) && stats && (
                <section className="stats" aria-label="Thống kê cửa hàng">
                  <div className="stat urgent"><span>Đơn cần xác nhận</span><strong>{pendingCount}</strong><small>Nên xử lý trước</small></div>
                  <div className="stat"><span>Tổng đơn hàng</span><strong>{stats.orders}</strong><small>Tất cả thời gian</small></div>
                  <div className="stat"><span>Sản phẩm đang bán</span><strong>{stats.products}</strong><small>{stats.lowStock > 0 ? `${stats.lowStock} loại sắp hết hàng` : 'Loại gạo'}</small></div>
                  <div className="stat"><span>Doanh thu hoàn thành</span><strong>{formatVND(stats.revenue)}</strong><small>Chỉ tính đơn đã giao xong</small></div>
                </section>
              )}

              {!['revenue', 'customers', 'activity'].includes(tab) && stats?.missingPrice > 0 && (
                <div className="alert warning" role="status">
                  <strong>{stats.missingPrice} loại gạo chưa có giá bán.</strong>{' '}
                  Khách nhìn thấy sản phẩm nhưng chưa đặt mua được.{' '}
                  <button type="button" className="link-button" onClick={() => setTab('products')}>
                    Nhập giá và tồn kho ngay
                  </button>
                </div>
              )}

              {error && (
                <div className="alert error" role="alert">
                  {error}{' '}
                  <button type="button" className="link-button" onClick={reload}>Tải lại</button>
                </div>
              )}
              {msg && <div className="toast success" role="status"><span>✓</span>{msg}</div>}

              {tab === 'activity' ? <ActivityLog />
                : tab === 'revenue' ? <RevenueReport />
                : tab === 'customers' ? <CustomerManager />
                : tab === 'orders' ? (
                <section>
                  <OrdersExportButton>Xuất đơn hôm nay</OrdersExportButton>
                  <div className="filter-bar" aria-label="Lọc đơn theo trạng thái">
                    {FILTERS.map(([value, label]) => {
                      const count = counts[value] || 0;
                      return <button key={value} className={filter === value ? 'active' : ''} onClick={() => { setFilter(value); setOffset(0); }}>{label} <span>{count}</span></button>;
                    })}
                  </div>

                  {visibleOrders.length === 0 ? (
                    <div className="admin-empty"><span>✓</span><h2>Không có đơn nào ở mục này</h2><p>Bạn đã xử lý xong phần việc hiện tại.</p></div>
                  ) : (
                    <div className="admin-orders">
                      {visibleOrders.map((order) => {
                        const next = NEXT_STEP[order.status];
                        return (
                          <article key={order.id} className="admin-order-card">
                            <header>
                              <div><span className="order-number">Đơn {order.code || `#${order.id}`}</span><span className={`status ${order.status}`}>{STATUS_LABEL[order.status]}</span>{!!order.is_guest && <span className="guest-tag" title="Khách đặt không cần đăng nhập">Mua nhanh</span>}</div>
                              <time>{formatDateTime(order.created_at)}</time>
                            </header>
                            <div className="admin-order-grid">
                              <section>
                                <p className="detail-label">Khách nhận hàng</p>
                                <h2>{order.receiver_name}</h2>
                                <a href={`tel:${order.phone}`} className="phone-link">{order.phone}</a>
                                <p className="address-text">{order.address}</p>
                                {mapLink(order.delivery_lat, order.delivery_lng) && (
                                  <a className="map-link" href={mapLink(order.delivery_lat, order.delivery_lng)} target="_blank" rel="noopener noreferrer">
                                    📍 Mở vị trí khách ghim trên Google Maps
                                  </a>
                                )}
                                {order.delivery_slot && (
                                  <p className="slot-text"><strong>Khung giờ giao:</strong> {DELIVERY_SLOT_LABEL[order.delivery_slot]} · ngày {deliveryDateLabel(order.created_at, order.delivery_slot)}</p>
                                )}
                                {order.note && <p className="customer-note"><strong>Khách dặn:</strong> {order.note}</p>}
                              </section>
                              <section>
                                <p className="detail-label">Sản phẩm</p>
                                <ul className="admin-order-items">
                                  {order.items.map((item) => <li key={item.id}><span>{item.product_name}{!!item.is_reward && <span className="gift-tag">Quà đổi điểm</span>}<small>{item.quantity} {item.unit}</small></span><strong>{formatVND(item.price * item.quantity)}</strong></li>)}
                                </ul>
                                {order.discount > 0 && (
                                  <>
                                    <div className="admin-order-line"><span>Tiền hàng</span><span>{formatVND(order.subtotal || order.total + order.discount)}</span></div>
                                    {order.discount - (order.voucher_discount || 0) > 0 && (
                                      <div className="admin-order-line discount">
                                        <span>Giảm giá <small>đơn đầu tiên của khách</small></span>
                                        <span>− {formatVND(order.discount - (order.voucher_discount || 0))}</span>
                                      </div>
                                    )}
                                    {order.voucher_discount > 0 && (
                                      <div className="admin-order-line discount">
                                        <span>Voucher đổi điểm</span>
                                        <span>− {formatVND(order.voucher_discount)}</span>
                                      </div>
                                    )}
                                  </>
                                )}
                                {order.points_used > 0 && (
                                  <small className="payment-label points">
                                    Đã trừ {order.points_used.toLocaleString('vi-VN')} điểm đổi quà/voucher{order.status === 'cancelled' ? ' · đã hoàn lại khi huỷ' : ''}
                                  </small>
                                )}
                                <div className="admin-order-total"><span>Khách trả</span><strong>{formatVND(order.total)}</strong></div>
                                <small className="payment-label">{order.payment_method === 'bank' ? 'Khách chọn chuyển khoản' : 'Thanh toán khi nhận hàng'}</small>
                                {order.status === 'completed'
                                  ? <small className="payment-label points">Đã cộng {order.points_earned || 0} điểm cho {order.phone}</small>
                                  : order.status === 'cancelled'
                                    ? <small className="payment-label points muted">Đơn huỷ không được cộng điểm tích luỹ</small>
                                    : (
                                    <small className="payment-label points muted">Sẽ cộng {pointsForLines(order.items.filter((item) => !item.is_reward), order.total)} điểm khi bấm Hoàn thành</small>
                                  )}
                              </section>
                            </div>
                            <footer>
                              <span>{next ? 'Bước tiếp theo:' : `Đơn đã ${order.status === 'cancelled' ? 'huỷ' : 'kết thúc'}`}</span>
                              <div>
                                {next && <button className="btn btn-primary" disabled={busyId === order.id} onClick={() => changeStatus(order.id, next[0])}>{busyId === order.id ? 'Đang lưu…' : next[1]}</button>}
                                {!['completed', 'cancelled'].includes(order.status) && <button className="btn btn-danger-ghost" disabled={busyId === order.id} onClick={() => cancelOrder(order)}>Huỷ đơn</button>}
                              </div>
                            </footer>
                          </article>
                        );
                      })}
                    </div>
                  )}
                  {orderTotal > 30 && <nav className="filter-bar" aria-label="Phân trang đơn hàng">
                    <button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 30))}>Trang trước</button>
                    <span>{offset + 1}–{Math.min(offset + 30, orderTotal)} / {orderTotal} đơn</span>
                    <button disabled={offset + 30 >= orderTotal || loading} onClick={() => setOffset(offset + 30)}>Trang sau</button>
                  </nav>}
                </section>
              ) : (
                <section>
                  <BannerSettings notify={notify} />
                  {showForm && (
                    <div className="product-form-wrap">
                      <form className="form-card flat product-form" onSubmit={submitProduct}>
                        <div className="form-header"><div><h2>{editingId ? 'Sửa thông tin gạo' : 'Thêm loại gạo mới'}</h2><p>Điền các thông tin khách hàng sẽ nhìn thấy.</p></div><button type="button" className="icon-close" onClick={resetProductForm} aria-label="Đóng">×</button></div>
                        <div className="row">
                          <label>Tên loại gạo <b>*</b>
                            <input className="input" name="name" value={form.name} onChange={onChange} required placeholder="Ví dụ: Gạo ST25" aria-invalid={!!formErrors.name} />
                            {formErrors.name && <small className="err">{formErrors.name}</small>}
                          </label>
                          <label>Xuất xứ<input className="input" name="origin" value={form.origin} onChange={onChange} placeholder="Ví dụ: Sóc Trăng" /></label>
                          <label>Nhóm hàng
                            <select className="input" name="category" value={form.category} onChange={onChange} aria-invalid={!!formErrors.category}>
                              {PRODUCT_CATEGORIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                            </select>
                            {formErrors.category
                              ? <small className="err">{formErrors.category}</small>
                              : <small className="field-help">Chọn "Thực phẩm khô" để hiện trong bộ lọc đồ khô.</small>}
                          </label>
                        </div>
                        <div className="row">
                          <label>Giá bán (đồng) <b>*</b>
                            <input className="input" type="number" name="price" value={form.price} onChange={onChange} required min="1" step="1" inputMode="numeric" aria-invalid={!!formErrors.price} />
                            {formErrors.price && <small className="err">{formErrors.price}</small>}
                          </label>
                          <label>Giá gốc (đồng) <span className="optional">Khi giảm giá</span>
                            <input className="input" type="number" name="original_price" value={form.original_price} onChange={onChange} min="0" step="1" inputMode="numeric" placeholder="Để trống nếu không giảm" aria-invalid={!!formErrors.original_price} />
                            {formErrors.original_price
                              ? <small className="err">{formErrors.original_price}</small>
                              : salePercent({ price: form.price, original_price: form.original_price }) > 0
                                ? <small className="field-help sale-help">Khách thấy nhãn −{salePercent({ price: form.price, original_price: form.original_price })}% và giá gốc bị gạch.</small>
                                : <small className="field-help">Nhập cao hơn giá bán để hiện nhãn giảm giá. Khách vẫn trả đúng giá bán.</small>}
                          </label>
                          <label>Giá nhập (đồng) <span className="optional">Chỉ cửa hàng thấy</span>
                            <input className="input" type="number" name="cost_price" value={form.cost_price} onChange={onChange} min="0" step="1" inputMode="numeric" placeholder="Ví dụ: 120000" aria-invalid={!!formErrors.cost_price} />
                            {formErrors.cost_price
                              ? <small className="err">{formErrors.cost_price}</small>
                              : <small className="field-help">Dùng để tính lãi và giá trị hàng trong kho.</small>}
                          </label>
                          <label>Đơn vị<input className="input" name="unit" value={form.unit} onChange={onChange} placeholder="kg hoặc bao 10kg" /></label>
                          <label>Khối lượng (kg)
                            <input className="input" type="number" name="weight_kg" value={form.weight_kg} onChange={onChange} min="0" step="0.5" inputMode="decimal" placeholder="Tự suy từ đơn vị" aria-invalid={!!formErrors.weight_kg} />
                            {formErrors.weight_kg
                              ? <small className="err">{formErrors.weight_kg}</small>
                              : <small className="field-help">Dùng để tính mốc 50kg được giảm giá tại quầy.</small>}
                          </label>
                          <label>Số lượng còn lại
                            <input className="input" type="number" name="stock" value={form.stock} onChange={onChange} min="0" step="1" inputMode="numeric" aria-invalid={!!formErrors.stock} />
                            {formErrors.stock && <small className="err">{formErrors.stock}</small>}
                          </label>
                        </div>
                        <fieldset className="points-settings">
                          <legend>Tích điểm cho loại này</legend>
                          <div className="points-toggle" role="group" aria-label="Cách cộng điểm">
                            <button type="button" className={form.points_custom ? '' : 'active'} aria-pressed={!form.points_custom}
                                    onClick={() => setForm((current) => ({ ...current, points_custom: false }))}>
                              Theo tiền <small>1.000₫ = 1 điểm</small>
                            </button>
                            <button type="button" className={form.points_custom ? 'active' : ''} aria-pressed={form.points_custom}
                                    onClick={() => setForm((current) => ({ ...current, points_custom: true }))}>
                              Điểm riêng <small>tự nhập số điểm mỗi {form.unit || 'đơn vị'}</small>
                            </button>
                          </div>
                          {form.points_custom && (
                            <label>Số điểm mỗi {form.unit || 'đơn vị'}
                              <input className="input" type="number" name="points_per_unit" value={form.points_per_unit} onChange={onChange}
                                     min="0" max="10000" step="1" inputMode="numeric" placeholder="Ví dụ: 150" aria-invalid={!!formErrors.points_per_unit} />
                              {formErrors.points_per_unit
                                ? <small className="err">{formErrors.points_per_unit}</small>
                                : <small className="field-help">
                                    Khách mua 1 {form.unit || 'đơn vị'} được cộng đúng số điểm này, không phụ thuộc giảm giá. Đặt 0 nếu loại này không cộng điểm.
                                  </small>}
                            </label>
                          )}
                          <label className="checkbox-label">
                            <input type="checkbox" checked={!!form.is_reward}
                                   onChange={(e) => setForm((current) => ({ ...current, is_reward: e.target.checked }))} />
                            Làm quà đổi 1.000 điểm <small className="muted">(khách đổi lấy 1 {form.unit || 'đơn vị'} miễn phí, online hoặc tại quầy)</small>
                          </label>
                        </fieldset>
                        <label>Mô tả ngắn<textarea className="input" name="description" rows={3} value={form.description} onChange={onChange} placeholder="Đặc điểm hạt gạo, độ dẻo, mùi thơm…" /></label>
                        <ImagePicker
                          value={form.image_url}
                          error={formErrors.image_url}
                          onChange={(url) => {
                            setForm((current) => ({ ...current, image_url: url }));
                            setFormErrors((current) => ({ ...current, image_url: undefined }));
                          }}
                        />
                        <div className="form-actions"><button className="btn btn-primary btn-large" disabled={busyId === (editingId || 'new-product')}>{busyId === (editingId || 'new-product') ? 'Đang lưu…' : editingId ? 'Lưu thay đổi' : 'Thêm vào cửa hàng'}</button><button type="button" className="btn btn-secondary" onClick={resetProductForm}>Bỏ qua</button></div>
                      </form>
                    </div>
                  )}

                  {receiving && (
                    <StockReceive
                      product={receiving}
                      onClose={() => setReceiving(null)}
                      onDone={(updated, text) => {
                        setReceiving(null);
                        notify(text);
                        setProducts((cur) => cur.map((p) => (p.id === updated.id ? updated : p)));
                        reload();
                      }}
                    />
                  )}

                  {products.length === 0 && (
                    <div className="admin-empty">
                      <span>+</span>
                      <h2>Chưa có loại gạo nào</h2>
                      <p>Bấm “Thêm loại gạo” để khách hàng bắt đầu nhìn thấy sản phẩm.</p>
                    </div>
                  )}

                  <div className="product-admin-list">
                    {products.map((product) => (
                      <article key={product.id} className={`admin-product ${product.is_active ? '' : 'inactive'}`}>
                        <div className="admin-product-icon">
                          <ProductImage src={product.image_url} sizes="64px" />
                        </div>
                        <div className="admin-product-info">
                          <h2>{product.name}</h2>
                          <p>
                            {product.origin || 'Chưa có xuất xứ'} ·{' '}
                            {product.price > 0
                              ? `${formatVND(product.price)}/${product.unit}`
                              : <span className="price-pending">Chưa có giá</span>}
                            {product.cost_price > 0 && product.price > 0 && (
                              <span className="margin-tag"> · lãi {formatVND(product.price - product.cost_price)}</span>
                            )}
                          </p>
                          {(salePercent(product) > 0 || product.category === 'do-kho' || product.points_per_unit != null || !!product.is_reward) && (
                            <p className="product-tags">
                              {product.points_per_unit != null && (
                                <span className="admin-points-tag">
                                  {product.points_per_unit > 0 ? `★ ${product.points_per_unit} điểm/${product.unit}` : 'Không cộng điểm'}
                                </span>
                              )}
                              {!!product.is_reward && <span className="admin-reward-tag">Quà đổi điểm</span>}
                              {salePercent(product) > 0 && (
                                <span className="admin-sale-tag">Giảm {salePercent(product)}% · giá gốc {formatVND(product.original_price)}</span>
                              )}
                              {product.category === 'do-kho' && <span className="admin-category-tag">Thực phẩm khô</span>}
                            </p>
                          )}
                        </div>
                        <div className="inventory">
                          <span>Còn trong kho</span>
                          <strong className={product.is_active && product.stock <= 10 ? 'low-stock' : ''}>
                            {product.stock} {product.unit}
                            {product.is_active && product.stock <= 0 && ' · đã hết'}
                          </strong>
                        </div>
                        <span className={`visibility ${product.is_active ? 'shown' : ''}`}>{product.is_active ? 'Đang bán' : 'Đang ẩn'}</span>
                        <div className="product-actions">
                          <button className="btn btn-primary" onClick={() => setReceiving(product)}>Nhập kho</button>
                          <button className="btn btn-secondary" onClick={() => editProduct(product)}>Sửa</button>
                          {product.is_active
                            ? <button className="btn btn-danger-ghost" disabled={busyId === product.id} onClick={() => hideProduct(product)}>Ẩn</button>
                            : <button className="btn btn-primary" disabled={busyId === product.id} onClick={() => restoreProduct(product)}>Bán lại</button>}
                          <button className="btn btn-danger" disabled={busyId === product.id}
                                  onClick={() => destroyProduct(product)}>Xoá hẳn</button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </>
            </Suspense>
            </PageLoadBoundary>
          )}
        </main>
      </div>
    </div>
  );
}
