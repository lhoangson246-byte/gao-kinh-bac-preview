// Chỉ khai báo WebP cho các ảnh đã được tạo; ảnh tải lên vẫn dùng nguyên URL.
import sources from '../product-images.json';
const available = new Map(sources.map(source => [source.src, source.variants]));

// Khớp lưới danh mục: 3 cột ở mọi cỡ màn hình, khung trang tối đa 1180px.
const GRID_SIZES = '(max-width: 560px) calc((100vw - 40px) / 3), (max-width: 1220px) calc((100vw - 80px) / 3), 370px';

export default function ProductImage({ src, alt = '', first = false, eager = false, sizes = GRID_SIZES, ...props }) {
  const image = src || '/logo-mark.png';
  const variants = available.get(image);
  // React 18 chỉ nhận thuộc tính này ở dạng chữ thường; viết fetchPriority thì
  // React bỏ qua kèm cảnh báo và ảnh đầu trang mất ưu tiên tải.
  const priority = first ? { fetchpriority: 'high' } : {};
  return <picture>
    {variants && <source type="image/webp" srcSet={variants.map(v => `${v.src} ${v.width}w`).join(', ')} sizes={sizes} />}
    <img {...props} {...priority} src={image} alt={alt} width="900" height="900" loading={eager || first ? 'eager' : 'lazy'} />
  </picture>;
}
