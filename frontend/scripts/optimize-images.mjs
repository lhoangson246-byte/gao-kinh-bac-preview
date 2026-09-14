// Chạy thủ công rồi commit ảnh tạo ra; không xử lý ảnh trong Vercel build.
import sharp from 'sharp';
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../public/products/', import.meta.url));
let jpegBytes = 0, webpBytes = 0, count = 0;
const sources = [];
for (const file of (await readdir(directory)).filter(f => /\.jpe?g$/i.test(f)).sort()) {
  const source = path.join(directory, file);
  const variants = [];
  jpegBytes += (await stat(source)).size;
  for (const width of [480, 960]) {
    const destination = path.join(directory, file.replace(/\.jpe?g$/i, `-v1-${width}.webp`));
    const output = await sharp(source).rotate().resize(width, width, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(destination);
    variants.push({ src: '/products/' + path.basename(destination), width: output.width });
    webpBytes += (await stat(destination)).size;
  }
  sources.push({ src: '/products/' + file, variants });
  count++;
}
await writeFile(new URL('../src/product-images.json', import.meta.url), JSON.stringify(sources, null, 2) + '\n');
console.log(JSON.stringify({ images: count, jpegBytes, webpBytes }));
