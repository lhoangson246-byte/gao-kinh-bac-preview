// Tự tìm định vị từ địa chỉ chữ (22/11/2026): chọn đúng kết quả bản đồ khớp địa chỉ nhất. Không gọi ra mạng.
// Cách chạy: node test/geocode.mjs
import { fold, pickBest, scoreCandidate, searchText, simplifiedText } from '../src/geocode.js';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);
const f = (name, street, housenumber, district, lat, lng) => ({ properties: { name, street, housenumber, district }, geometry: { coordinates: [lng, lat] } });

check('Bỏ dấu tiếng Việt khi so khớp', fold('Chung cư Cao Nguyên, Võ Cường - Đường') === 'chung cu cao nguyen vo cuong duong');
check('Chuỗi tìm luôn có "Bắc Ninh"', searchText('chung cư cao nguyên - võ cường') === 'chung cư cao nguyên - võ cường, Bắc Ninh'
  && searchText('48 Nguyễn Gia Thiều, Bắc Ninh') === '48 Nguyễn Gia Thiều, Bắc Ninh');
check('Bản rút gọn bỏ số nhà, "số / đường / phường"', simplifiedText('Số 1 đường Kinh Dương Vương, phường Vũ Ninh') === 'Kinh Dương Vương Vũ Ninh, Bắc Ninh');

// Kết quả thật của bản đồ cho "chung cư cao nguyên võ cường bắc ninh": cái đầu ở Từ Sơn, cái đúng ở Võ Cường.
const caoNguyen = [
  f('Chung cư Cao Nguyên', 'Đường Lý Thánh Tông', '', 'Từ Sơn', 21.1177953, 105.9764808),
  f('Chung cư Cao Nguyên 2', 'Đường Lê Thái Tổ', '', 'Võ Cường', 21.1675113, 106.048345),
  f('Chung cư Thanh Bình', 'Đường Nguyễn Cao', '', 'Kinh Bắc', 21.1737863, 106.0562273),
];
const cn = pickBest(caoNguyen, 'chung cư cao nguyên - võ cường - bắc ninh');
check('Chung cư Cao Nguyên – Võ Cường: chọn đúng toà ở Võ Cường (không lấy Từ Sơn)', cn?.lat === 21.1675113 && /Võ Cường/.test(cn.label), JSON.stringify(cn));

const nguyenGiaThieu = [
  f('Vua Gà Gia Anh', 'Đường Kinh Bắc', '48', 'Kinh Bắc', 21.1890906, 106.0644297),
  f('Khương Thi Quán', 'Đường Nguyễn Gia Thiều', '180', 'Kinh Bắc', 21.1839252, 106.0695926),
  f('', 'Đường Nguyễn Gia Thiều', '48', 'Kinh Bắc', 21.186125, 106.0724253),
];
const ngt = pickBest(nguyenGiaThieu, '48 nguyễn gia thiều, bắc ninh');
check('Số nhà + tên đường khớp được ưu tiên (48 Nguyễn Gia Thiều)', ngt?.lat === 21.186125, JSON.stringify(ngt));
check('Số nhà trùng nhưng khác đường thì không cộng điểm số nhà',
  scoreCandidate(nguyenGiaThieu[0].properties, '48 nguyễn gia thiều') < scoreCandidate(nguyenGiaThieu[2].properties, '48 nguyễn gia thiều'));

const vuNinh = [
  f('Trường Tiểu học Thuận Thành số 1', 'Đường Kinh Dương Vương', '', 'Thuận Thành', 21.0549, 106.0933),
  f('Mandala Hotel & Spa Bac Ninh', 'Đường Kinh Dương Vương', '', 'Vũ Ninh', 21.1887, 106.0767),
];
check('Cùng tên đường: chọn đúng phường ghi trong địa chỉ (Vũ Ninh, không phải Thuận Thành)',
  pickBest(vuNinh, 'Số 1 đường Kinh Dương Vương, phường Vũ Ninh')?.lat === 21.1887);
check('Kết quả ngoài tỉnh Bắc Ninh bị bỏ', pickBest([f('Chung cư Cao Nguyên', 'Đường Lý Thánh Tông', '', 'Hà Nội', 21.03, 105.5)], 'chung cư cao nguyên') === null);
check('Không đủ khớp thì không gán bừa', pickBest([f('Quán Phở Ngon', 'Đường Trần Phú', '', 'Từ Sơn', 21.12, 105.97)], 'chung cư cao nguyên - võ cường') === null);

process.env.GEO_RESOLVE = '0';
const { geocodeAddress } = await import('../src/geocode.js');
check('GEO_RESOLVE=0: không gọi ra mạng', (await geocodeAddress('chung cư cao nguyên')) === null);

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} đạt`);
process.exit(failed ? 1 : 0);
