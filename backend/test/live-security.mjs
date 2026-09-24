/**
 * Kiểm tra an toàn trang thật. Chỉ ĐỌC — không tạo tài khoản, không đặt đơn,
 * không sửa gì. Vài yêu cầu đăng nhập dùng số điện thoại không tồn tại.
 */
const U = (process.argv[2] || process.env.SITE_URL || 'https://gao-kinh-bac-preview.vercel.app').replace(/\/$/, '');
console.log(`Kiểm tra an toàn trang đang chạy: ${U}`);
let pass = 0; let fail = 0; let warn = 0;
const ok = (name, good, detail = '') => {
  if (good === true) { pass++; console.log(`  ĐẠT    ${name}${detail ? '  — ' + detail : ''}`); }
  else if (good === 'warn') { warn++; console.log(`  LƯU Ý  ${name}${detail ? '  — ' + detail : ''}`); }
  else { fail++; console.log(`  HỎNG   ${name}${detail ? '  — ' + detail : ''}`); }
};

console.log('\n### 1. Header bảo vệ trình duyệt');
const root = await fetch(U + '/');
const h = (k) => root.headers.get(k) || '';
ok('Chống nhúng vào trang khác (frame-ancestors)', /frame-ancestors 'none'/.test(h('content-security-policy')) || h('x-frame-options') === 'DENY');
ok('Chặn đoán kiểu tệp (nosniff)', h('x-content-type-options') === 'nosniff');
ok('Bắt buộc HTTPS lâu dài (HSTS)', /max-age=\d{7,}/.test(h('strict-transport-security')), h('strict-transport-security'));
ok('Không rò địa chỉ trang khi bấm link', /no-referrer|same-origin|strict-origin/.test(h('referrer-policy')), h('referrer-policy'));
ok('Khoá camera, micro, vị trí', /camera=\(\)/.test(h('permissions-policy')));
ok('Chỉ nạp mã từ chính trang (script-src self)', /script-src 'self'(;|$)/.test(h('content-security-policy')));
ok('Không cho nhúng plugin (object-src none)', /object-src 'none'/.test(h('content-security-policy')));

console.log('\n### 2. HTTPS');
const plain = await fetch('http://gao-kinh-bac-preview.vercel.app/', { redirect: 'manual' }).catch(() => null);
ok('Vào bằng http bị chuyển sang https', plain ? [301, 307, 308].includes(plain.status) : 'warn', plain ? `mã ${plain.status}` : 'không kiểm tra được');

console.log('\n### 3. Dữ liệu khách có bị lộ không');
const products = await (await fetch(U + '/api/products')).json();
const raw = JSON.stringify(products);
ok('Danh mục công khai KHÔNG lộ giá nhập', !raw.includes('cost_price'));
ok('Danh mục công khai KHÔNG lộ mật khẩu', !/password/i.test(raw));
const health = await (await fetch(U + '/api/health')).text();
ok('Trang health không lộ phiên bản/đường dẫn nội bộ', !/node|express|version|path|\/var\/|C:\\\\/i.test(health), health.slice(0, 60));

console.log('\n### 4. Khu vực quản trị có chặn người lạ không');
for (const path of ['/api/admin/customers', '/api/admin/orders', '/api/admin/products',
  '/api/admin/images', `/api/admin/revenue?period=day&date=${new Date().toISOString().slice(0, 10)}`,
  '/api/admin/activity', '/api/admin/stats', '/api/retail/invoices', '/api/retail/stats']) {
  const r = await fetch(U + path);
  ok(`Chưa đăng nhập không xem được ${path.replace('/api', '')}`, r.status === 401, `mã ${r.status}`);
}
for (const path of ['/api/orders', '/api/addresses', '/api/auth/me']) {
  const r = await fetch(U + path);
  ok(`Chưa đăng nhập không xem được ${path.replace('/api', '')}`, r.status === 401, `mã ${r.status}`);
}

console.log('\n### 5. Tệp bí mật có bị phục vụ ra ngoài không');
for (const path of ['/.env', '/backend/.env', '/.env.local', '/.git/config', '/backend/data/app.db',
  '/api/../backend/.env', '/package.json', '/backend/package.json', '/vercel.json']) {
  const r = await fetch(U + path);
  const body = await r.text();
  const leaked = r.status === 200 && !body.includes('<!doctype html') && !body.includes('<!DOCTYPE html');
  ok(`Không tải được ${path}`, !leaked, `mã ${r.status}`);
}

console.log('\n### 6. Chống giả mạo yêu cầu từ trang khác (CSRF)');
const evil = await fetch(U + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
  body: JSON.stringify({ identifier: '0900000001', password: 'x' }),
});
ok('Yêu cầu ghi từ tên miền lạ bị chặn', evil.status === 403, `mã ${evil.status}`);
const same = await fetch(U + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: U },
  body: JSON.stringify({ identifier: '0900000001', password: 'sai-mat-khau-khong-ton-tai' }),
});
const sameBody = await same.json().catch(() => ({}));
ok('Yêu cầu từ chính trang vẫn chạy', same.status === 401, `mã ${same.status}`);

console.log('\n### 7. Thông báo lỗi có kín không');
ok('Sai mật khẩu KHÔNG tiết lộ tài khoản có tồn tại hay không',
  /không đúng/i.test(sameBody.message || '') && !/không tồn tại|chưa đăng ký/i.test(sameBody.message || ''),
  sameBody.message);
const notFound = await fetch(U + '/api/khong-co-duong-nay');
const nfBody = await notFound.text();
ok('Đường dẫn lạ không lộ cấu trúc máy chủ', !/at \/|node_modules|Error:|stack/i.test(nfBody), nfBody.slice(0, 70));

console.log('\n### 8. Bộ nhớ đệm không giữ dữ liệu cá nhân');
const apiCache = (await fetch(U + '/api/auth/me')).headers.get('cache-control') || '';
ok('Dữ liệu tài khoản không được lưu đệm', /no-store/.test(apiCache), apiCache);

console.log(`\n=== ${pass} đạt · ${warn} lưu ý · ${fail} hỏng ===`);
if (fail === 0) {
  console.log('Không phát hiện vấn đề ở phần máy kiểm tra được.');
  console.log('Những việc chỉ chủ cửa hàng kiểm tra được — mật khẩu quản trị, ai có quyền vào');
  console.log('Vercel/GitHub/Turso, và bản sao lưu cơ sở dữ liệu — xem mục "Tự kiểm tra an toàn"');
  console.log('trong BAN_GIAO.md.');
}
process.exit(fail ? 1 : 0);
