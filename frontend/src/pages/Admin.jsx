import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatDateTime, formatVND, STATUS_LABEL, DELIVERY_SLOT_LABEL } from '../api';
import { useAuth } from '../context/AuthContext.jsx';

const EMPTY = { name: '', origin: '', price: '', unit: 'kg', stock: '', description: '', image_url: '' };
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
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const reload = async () => {
    setError('');
    try {
      const [statsResult, ordersResult, productsResult] = await Promise.all([
        api.adminStats(), api.adminOrders(), api.adminProducts(),
      ]);
      setStats(statsResult.stats);
      setOrders(ordersResult.orders);
      setProducts(productsResult.products);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const visibleOrders = useMemo(
    () => filter === 'all' ? orders : orders.filter((order) => order.status === filter),
    [filter, orders]
  );

  const pendingCount = orders.filter((order) => order.status === 'pending').length;

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
    if (window.confirm(`Bạn chắc chắn muốn huỷ đơn #${order.id}?`)) changeStatus(order.id, 'cancelled');
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
    if (!Number.isFinite(stock) || !Number.isInteger(stock) || stock < 0) {
      errors.stock = 'Tồn kho phải là số nguyên từ 0 trở lên.';
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
      const payload = {
        ...form,
        price: Number(form.price),
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
      name: product.name, origin: product.origin || '', price: product.price, unit: product.unit,
      stock: product.stock, description: product.description || '', image_url: product.image_url || '',
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
          <div className="admin-help"><strong>Cần làm gì trước?</strong><p>Ưu tiên các đơn “Chờ xác nhận”, gọi khách rồi bấm “Xác nhận đơn”.</p></div>
        </aside>

        <main className="admin-content">
          {loading ? <div className="loading-state page-loading"><span></span>Đang mở trang quản trị…</div> : (
            <>
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

              {stats && (
                <section className="stats" aria-label="Thống kê cửa hàng">
                  <div className="stat urgent"><span>Đơn cần xác nhận</span><strong>{pendingCount}</strong><small>Nên xử lý trước</small></div>
                  <div className="stat"><span>Tổng đơn hàng</span><strong>{stats.orders}</strong><small>Tất cả thời gian</small></div>
                  <div className="stat"><span>Sản phẩm đang bán</span><strong>{stats.products}</strong><small>{stats.lowStock > 0 ? `${stats.lowStock} loại sắp hết hàng` : 'Loại gạo'}</small></div>
                  <div className="stat"><span>Doanh thu hoàn thành</span><strong>{formatVND(stats.revenue)}</strong><small>Chỉ tính đơn đã giao xong</small></div>
                </section>
              )}

              {stats?.missingPrice > 0 && (
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

              {tab === 'orders' ? (
                <section>
                  <div className="filter-bar" aria-label="Lọc đơn theo trạng thái">
                    {FILTERS.map(([value, label]) => {
                      const count = value === 'all' ? orders.length : orders.filter((order) => order.status === value).length;
                      return <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label} <span>{count}</span></button>;
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
                              <div><span className="order-number">Đơn #{order.id}</span><span className={`status ${order.status}`}>{STATUS_LABEL[order.status]}</span></div>
                              <time>{formatDateTime(order.created_at)}</time>
                            </header>
                            <div className="admin-order-grid">
                              <section>
                                <p className="detail-label">Khách nhận hàng</p>
                                <h2>{order.receiver_name}</h2>
                                <a href={`tel:${order.phone}`} className="phone-link">{order.phone}</a>
                                <p className="address-text">{order.address}</p>
                                {order.delivery_slot && (
                                  <p className="slot-text"><strong>Khung giờ giao:</strong> {DELIVERY_SLOT_LABEL[order.delivery_slot]}</p>
                                )}
                                {order.note && <p className="customer-note"><strong>Khách dặn:</strong> {order.note}</p>}
                              </section>
                              <section>
                                <p className="detail-label">Sản phẩm</p>
                                <ul className="admin-order-items">
                                  {order.items.map((item) => <li key={item.id}><span>{item.product_name}<small>{item.quantity} {item.unit}</small></span><strong>{formatVND(item.price * item.quantity)}</strong></li>)}
                                </ul>
                                <div className="admin-order-total"><span>Tổng tiền hàng</span><strong>{formatVND(order.total)}</strong></div>
                                <small className="payment-label">{order.payment_method === 'bank' ? 'Khách chọn chuyển khoản' : 'Thanh toán khi nhận hàng'}</small>
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
                </section>
              ) : (
                <section>
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
                        </div>
                        <div className="row">
                          <label>Giá bán (đồng) <b>*</b>
                            <input className="input" type="number" name="price" value={form.price} onChange={onChange} required min="1" step="1" inputMode="numeric" aria-invalid={!!formErrors.price} />
                            {formErrors.price && <small className="err">{formErrors.price}</small>}
                          </label>
                          <label>Đơn vị<input className="input" name="unit" value={form.unit} onChange={onChange} placeholder="kg hoặc bao 10kg" /></label>
                          <label>Số lượng còn lại
                            <input className="input" type="number" name="stock" value={form.stock} onChange={onChange} min="0" step="1" inputMode="numeric" aria-invalid={!!formErrors.stock} />
                            {formErrors.stock && <small className="err">{formErrors.stock}</small>}
                          </label>
                        </div>
                        <label>Mô tả ngắn<textarea className="input" name="description" rows={3} value={form.description} onChange={onChange} placeholder="Đặc điểm hạt gạo, độ dẻo, mùi thơm…" /></label>
                        <label>Đường dẫn ảnh <span className="optional">Không bắt buộc</span>
                          <input className="input" type="text" name="image_url" value={form.image_url} onChange={onChange} placeholder="/products/ten-anh.jpg hoặc https://…" aria-invalid={!!formErrors.image_url} />
                          {formErrors.image_url
                            ? <small className="err">{formErrors.image_url}</small>
                            : <small className="field-help">Nếu để trống, cửa hàng sẽ dùng ảnh gạo mặc định.</small>}
                        </label>
                        <div className="form-actions"><button className="btn btn-primary btn-large" disabled={busyId === (editingId || 'new-product')}>{busyId === (editingId || 'new-product') ? 'Đang lưu…' : editingId ? 'Lưu thay đổi' : 'Thêm vào cửa hàng'}</button><button type="button" className="btn btn-secondary" onClick={resetProductForm}>Bỏ qua</button></div>
                      </form>
                    </div>
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
                          <img src={product.image_url || '/logo-mark.png'} alt="" loading="lazy" />
                        </div>
                        <div className="admin-product-info">
                          <h2>{product.name}</h2>
                          <p>
                            {product.origin || 'Chưa có xuất xứ'} ·{' '}
                            {product.price > 0
                              ? `${formatVND(product.price)}/${product.unit}`
                              : <span className="price-pending">Chưa có giá</span>}
                          </p>
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
                          <button className="btn btn-secondary" onClick={() => editProduct(product)}>Sửa</button>
                          {product.is_active
                            ? <button className="btn btn-danger-ghost" disabled={busyId === product.id} onClick={() => hideProduct(product)}>Ẩn</button>
                            : <button className="btn btn-primary" disabled={busyId === product.id} onClick={() => restoreProduct(product)}>Bán lại</button>}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
