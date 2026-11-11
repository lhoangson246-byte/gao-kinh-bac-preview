import { useMemo, useState } from 'react';
import { api } from '../api';
import useDragReorder from './useDragReorder.js';

/**
 * Danh sách sản phẩm trong trang quản trị, chia theo nhóm gạo. Mỗi nhóm gập lại, bấm vào mới mở ra các
 * sản phẩm của nhóm; trong nhóm kéo tay nắm ⠿ để xếp thứ tự (khách thấy đúng thứ tự này khi lọc nhóm).
 * Một sản phẩm thuộc nhiều nhóm thì hiện ở mỗi nhóm. Cuối danh sách có "Chưa thuộc nhóm nào" và "Tất cả
 * sản phẩm" (kéo thả ở đây là thứ tự khách thấy ở "Tất cả mặt hàng").
 *
 *   renderProduct(product) — dòng sản phẩm (ảnh, giá, tồn kho, nút Nhập kho / Sửa / Ẩn / Xoá) do trang
 *   quản trị dựng, để hai cách xem dùng chung một kiểu dòng.
 */
export default function ProductsByGroup({ groups, products, renderProduct, onReordered, onProductsReordered }) {
  const [open, setOpen] = useState(() => new Set());
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const ungrouped = useMemo(() => products.filter((p) => !p.group_ids?.length), [products]);
  const toggle = (key) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="group-sections">
      <div className="group-sections-head">
        <h2>Sản phẩm theo nhóm</h2>
        <small className="muted">Bấm vào nhóm để xem sản phẩm. Trong nhóm, nắm ⠿ rồi kéo lên, xuống để đổi thứ tự khách thấy.</small>
      </div>
      {groups.map((group) => (
        <GroupSection key={group.id} group={group} byId={byId} open={open.has(group.id)} onToggle={() => toggle(group.id)}
                      renderProduct={renderProduct} onReordered={onReordered} />
      ))}
      {ungrouped.length > 0 && (
        <PlainSection title="Chưa thuộc nhóm nào" note="Khách vẫn thấy ở “Tất cả mặt hàng”, nhưng không thấy khi lọc theo nhóm."
                      products={ungrouped} open={open.has('none')} onToggle={() => toggle('none')} renderProduct={renderProduct} />
      )}
      <AllSection products={products} open={open.has('all')} onToggle={() => toggle('all')} renderProduct={renderProduct} onReordered={onProductsReordered} />
    </div>
  );
}

/** Mọi sản phẩm, kéo thả để đổi thứ tự khách thấy ở "Tất cả mặt hàng" trên trang chủ. */
function AllSection({ products, open, onToggle, renderProduct, onReordered }) {
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const ids = useMemo(() => products.map((p) => p.id), [products]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sort = useDragReorder({
    ids,
    disabled: busy,
    onSave: async (next) => {
      setBusy(true);
      setError('');
      try {
        const result = await api.adminReorderProducts(next);
        onReordered(result.products);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
  });
  return (
    <section className={`group-section plain${open ? ' open' : ''}`}>
      <SectionHead title="Tất cả sản phẩm" count={products.length} open={open} onToggle={onToggle} />
      {open && (
        <div className="group-section-body">
          <p className="muted group-section-empty">Nắm ⠿ rồi kéo lên, xuống để đổi thứ tự khách thấy ở “Tất cả mặt hàng” trên trang chủ. Hàng hết vẫn tự xuống cuối.</p>
          {error && <p className="alert error" role="alert">{error}</p>}
          <div className={`group-product-list${sort.dragId ? ' sorting' : ''}`} ref={sort.listRef}>
            {sort.order.map((id) => {
              const product = byId.get(id);
              return (
                <div key={id} className={`group-product-row${sort.dragId === id ? ' dragging' : ''}`}>
                  <button type="button" className="group-grip" disabled={busy && !sort.dragId}
                          title="Kéo để đổi thứ tự" aria-label={`Kéo để đổi thứ tự “${product.name}” trên trang chủ. Hoặc bấm mũi tên lên, xuống.`}
                          onPointerDown={(event) => sort.start(event, id)} onKeyDown={(event) => sort.keyMove(event, id)}>⠿</button>
                  {renderProduct(product)}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function SectionHead({ title, count, open, onToggle, hidden }) {
  return (
    <button type="button" className="group-section-head" aria-expanded={open} onClick={onToggle}>
      <span className="group-section-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      <strong>{title}</strong>
      <span className="group-section-count">{count} sản phẩm</span>
      {hidden && <span className="group-section-hidden">đang ẩn trên trang chủ</span>}
    </button>
  );
}

function GroupSection({ group, byId, open, onToggle, renderProduct, onReordered }) {
  const ids = useMemo(() => group.product_ids.filter((id) => byId.has(id)), [group.product_ids, byId]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sort = useDragReorder({
    ids,
    disabled: busy,
    onSave: async (next) => {
      setBusy(true);
      setError('');
      try {
        const result = await api.adminReorderGroupProducts(group.id, next);
        onReordered(result.groups);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
  });

  return (
    <section className={`group-section${open ? ' open' : ''}${group.is_active ? '' : ' hidden-group'}`}>
      <SectionHead title={group.name} count={ids.length} open={open} onToggle={onToggle} hidden={!group.is_active} />
      {open && (
        <div className="group-section-body">
          {error && <p className="alert error" role="alert">{error}</p>}
          {ids.length === 0 ? (
            <p className="muted group-section-empty">Nhóm chưa có sản phẩm. Gắn bằng nút “Chọn sản phẩm” ở khung Nhóm gạo, hoặc trong form sửa sản phẩm.</p>
          ) : (
            <div className={`group-product-list${sort.dragId ? ' sorting' : ''}`} ref={sort.listRef}>
              {sort.order.map((id) => {
                const product = byId.get(id);
                return (
                  <div key={id} className={`group-product-row${sort.dragId === id ? ' dragging' : ''}`}>
                    <button type="button" className="group-grip" disabled={busy && !sort.dragId}
                            title="Kéo để đổi thứ tự" aria-label={`Kéo để đổi thứ tự “${product.name}” trong nhóm. Hoặc bấm mũi tên lên, xuống.`}
                            onPointerDown={(event) => sort.start(event, id)} onKeyDown={(event) => sort.keyMove(event, id)}>⠿</button>
                    {renderProduct(product)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PlainSection({ title, note, products, open, onToggle, renderProduct }) {
  return (
    <section className={`group-section plain${open ? ' open' : ''}`}>
      <SectionHead title={title} count={products.length} open={open} onToggle={onToggle} />
      {open && (
        <div className="group-section-body">
          {note && <p className="muted group-section-empty">{note}</p>}
          <div className="product-admin-list">{products.map((product) => <div key={product.id}>{renderProduct(product)}</div>)}</div>
        </div>
      )}
    </section>
  );
}
