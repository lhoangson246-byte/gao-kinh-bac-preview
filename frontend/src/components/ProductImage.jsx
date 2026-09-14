// Chỉ khai báo WebP cho các ảnh đã được tạo; ảnh tải lên vẫn dùng nguyên URL.
import sources from '../product-images.json';
const available = new Map(sources.map(source => [source.src, source.variants]));
export default function ProductImage({ src, alt = '', first = false, eager = false, sizes = '(max-width: 640px) calc((100vw - 44px) / 2), (max-width: 1024px) 30vw, 270px', ...props }) {
  const image = src || '/logo-mark.png';
  const variants = available.get(image);
  return <picture>
    {variants && <source type="image/webp" srcSet={variants.map(v => `${v.src} ${v.width}w`).join(', ')} sizes={sizes} />}
    <img {...props} src={image} alt={alt} width="900" height="900" loading={eager || first ? 'eager' : 'lazy'} fetchPriority={first ? 'high' : undefined} />
  </picture>;
}
