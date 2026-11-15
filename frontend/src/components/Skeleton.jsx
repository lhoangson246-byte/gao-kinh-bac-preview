/**
 * Khung xương hiện trong lúc tải dữ liệu: chiếm đúng chỗ của nội dung thật để trang không giật khi dữ
 * liệu về. `label` là câu đọc cho người dùng trình đọc màn hình.
 */
const range = (n) => Array.from({ length: n }, (_, i) => i);

/** Lưới thẻ sản phẩm (trang chủ). */
export function ProductGridSkeleton({ count = 6, label }) {
  return (
    <div className="product-grid" role="status" aria-label={label}>
      {range(count).map((i) => (
        <div key={i} className="skeleton-card" aria-hidden="true">
          <div className="skeleton skeleton-image" />
          <div className="skeleton-body">
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line short" />
            <div className="skeleton skeleton-line tall" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Danh sách thẻ (đơn hàng, công nợ…). */
export function ListSkeleton({ rows = 4, label }) {
  return (
    <div className="skeleton-list" role="status" aria-label={label}>
      {range(rows).map((i) => (
        <div key={i} className="skeleton-row" aria-hidden="true">
          <div className="skeleton skeleton-line short" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
        </div>
      ))}
    </div>
  );
}

/** Ba khối số tổng quan + danh sách (trang kho). */
export function DashboardSkeleton({ label }) {
  return (
    <div role="status" aria-label={label}>
      <div className="skeleton-kpis" aria-hidden="true">{range(3).map((i) => <div key={i} className="skeleton" />)}</div>
      <ListSkeleton rows={5} />
    </div>
  );
}
