import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const CartContext = createContext(null);
const STORAGE_KEY = 'gao_cart';

/** Chỉ giữ lại những dòng giỏ hàng có cấu trúc hợp lệ. */
function readStoredCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item) => Number.isInteger(item?.id) && Number.isFinite(item?.price))
      .map((item) => ({
        id: item.id,
        name: String(item.name || ''),
        price: Math.max(0, Math.round(item.price)),
        unit: String(item.unit || 'kg'),
        stock: Math.max(0, Math.round(Number(item.stock) || 0)),
        quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
      }));
  } catch {
    return [];
  }
}

const clampQuantity = (quantity, stock) =>
  stock > 0 ? Math.max(1, Math.min(Math.round(quantity), stock)) : 0;

export function CartProvider({ children }) {
  const [items, setItems] = useState(readStoredCart);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Trình duyệt chặn lưu trữ (chế độ ẩn danh) — giỏ hàng vẫn dùng được trong phiên này.
    }
  }, [items]);

  /**
   * Đồng bộ giỏ hàng với dữ liệu mới nhất từ máy chủ: cập nhật giá, tên,
   * tồn kho và bỏ những loại gạo cửa hàng đã ngừng bán.
   */
  const syncWithProducts = useCallback((products) => {
    if (!Array.isArray(products) || products.length === 0) return;
    const byId = new Map(products.map((p) => [p.id, p]));
    setItems((prev) => {
      let changed = false;
      const next = [];
      for (const item of prev) {
        const product = byId.get(item.id);
        if (!product) { next.push(item); continue; }   // không có trong kết quả lọc/tìm kiếm
        const quantity = clampQuantity(item.quantity, product.stock);
        const updated = {
          id: product.id,
          name: product.name,
          price: product.price,
          unit: product.unit,
          stock: product.stock,
          quantity,
        };
        if (
          updated.price !== item.price || updated.stock !== item.stock ||
          updated.quantity !== item.quantity || updated.name !== item.name ||
          updated.unit !== item.unit
        ) changed = true;
        next.push(updated);
      }
      return changed ? next : prev;
    });
  }, []);

  const value = useMemo(() => {
    const available = items.filter((item) => item.stock > 0 && item.quantity > 0);
    return {
      items,
      count: available.reduce((sum, item) => sum + item.quantity, 0),
      total: available.reduce((sum, item) => sum + item.price * item.quantity, 0),
      /** Có dòng nào đang hết hàng không — dùng để chặn bước đặt hàng. */
      hasUnavailable: items.some((item) => item.stock <= 0 || item.quantity <= 0),
      syncWithProducts,

      /** Thêm vào giỏ; trả về false nếu hết hàng hoặc cửa hàng chưa nhập giá. */
      add: (product, quantity = 1) => {
        if (!product || product.stock <= 0 || product.price <= 0) return false;
        setItems((prev) => {
          const found = prev.find((item) => item.id === product.id);
          const base = {
            id: product.id,
            name: product.name,
            price: product.price,
            unit: product.unit,
            stock: product.stock,
          };
          if (found) {
            return prev.map((item) => item.id === product.id
              ? { ...base, quantity: clampQuantity(found.quantity + quantity, product.stock) }
              : item);
          }
          return [...prev, { ...base, quantity: clampQuantity(quantity, product.stock) }];
        });
        return true;
      },

      setQuantity: (id, quantity) =>
        setItems((prev) => prev.map((item) => item.id === id
          ? { ...item, quantity: clampQuantity(quantity, item.stock) }
          : item)),

      remove: (id) => setItems((prev) => prev.filter((item) => item.id !== id)),
      clear: () => setItems([]),
    };
  }, [items, syncWithProducts]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
