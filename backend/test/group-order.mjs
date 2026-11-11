// Thứ tự sản phẩm trong từng nhóm gạo (kéo thả ở trang quản trị) và trang chủ hiện đúng thứ tự đó.
// Cách chạy: node test/group-order.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng.
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);

const app = await fixture();
const { call } = app;
try {
  const owner = (await call('/auth/login', { method: 'POST', body: { identifier: app.env.ADMIN_EMAIL, password: app.env.ADMIN_PASSWORD } })).data.token;
  const suffix = Date.now() % 1e7;
  const make = async (name, stock = 50) => (await call('/admin/products', {
    method: 'POST', token: owner, body: { name: `${name} ${suffix}`, price: 100000, unit: 'túi 5kg', stock },
  })).data.product.id;
  const [a, b, c, d] = [await make('Gạo A'), await make('Gạo B'), await make('Gạo C'), await make('Gạo D')];
  const group = (await call('/admin/groups', { method: 'POST', token: owner, body: { name: `Nhóm thứ tự ${suffix}` } })).data.group;
  const members = async () => (await call('/admin/groups', { token: owner })).data.groups.find((g) => g.id === group.id).product_ids;
  const storefront = async () => (await call(`/products?group=${group.slug}`)).data.products.map((p) => p.id);
  const order = (ids, token = owner) => call(`/admin/groups/${group.id}/order`, { method: 'POST', token, body: { product_ids: ids } });

  await call(`/admin/groups/${group.id}`, { method: 'PUT', token: owner, body: { product_ids: [a, b, c] } });
  check('Chọn sản phẩm: xếp theo thứ tự đã chọn', JSON.stringify(await members()) === JSON.stringify([a, b, c]), JSON.stringify(await members()));

  const moved = await order([c, a, b]);
  check('Kéo thả: lưu thứ tự mới', moved.status === 200 && JSON.stringify(moved.data.groups.find((g) => g.id === group.id).product_ids) === JSON.stringify([c, a, b]));
  check('Trang chủ lọc nhóm hiện đúng thứ tự đã kéo', JSON.stringify(await storefront()) === JSON.stringify([c, a, b]), JSON.stringify(await storefront()));

  await call(`/admin/groups/${group.id}`, { method: 'PUT', token: owner, body: { product_ids: [a, b, c, d] } });
  check('Thêm sản phẩm vào nhóm: giữ thứ tự cũ, sản phẩm mới xếp cuối', JSON.stringify(await members()) === JSON.stringify([c, a, b, d]), JSON.stringify(await members()));
  await call(`/admin/groups/${group.id}`, { method: 'PUT', token: owner, body: { product_ids: [b, c, d] } });
  check('Bỏ sản phẩm khỏi nhóm: phần còn lại giữ thứ tự', JSON.stringify(await members()) === JSON.stringify([c, b, d]), JSON.stringify(await members()));

  // Sửa sản phẩm trong form (tick nhóm) không làm xáo thứ tự nhóm.
  await call(`/admin/products/${b}`, { method: 'PUT', token: owner, body: { name: `Gạo B đổi tên ${suffix}`, group_ids: [group.id] } });
  check('Sửa sản phẩm trong form không xáo thứ tự nhóm', JSON.stringify(await members()) === JSON.stringify([c, b, d]), JSON.stringify(await members()));
  await call(`/admin/products/${a}`, { method: 'PUT', token: owner, body: { group_ids: [group.id] } });
  check('Tick nhóm cho sản phẩm trong form: xếp cuối nhóm', JSON.stringify(await members()) === JSON.stringify([c, b, d, a]), JSON.stringify(await members()));

  check('Gửi một phần danh sách: phần còn lại xếp sau theo thứ tự cũ', (await order([a, d])).status === 200 && JSON.stringify(await members()) === JSON.stringify([a, d, c, b]), JSON.stringify(await members()));

  // Hết hàng vẫn xuống cuối trên trang chủ.
  await call(`/admin/products/${a}`, { method: 'PUT', token: owner, body: { stock: 0 } });
  check('Trang chủ: hàng hết vẫn xuống cuối', JSON.stringify(await storefront()) === JSON.stringify([d, c, b, a]), JSON.stringify(await storefront()));

  /* Dữ liệu sai và quyền */
  const outsider = await make('Gạo ngoài nhóm');
  check('Sản phẩm không thuộc nhóm bị từ chối (400)', (await order([outsider, a])).status === 400);
  check('Trùng sản phẩm bị từ chối (400)', (await order([a, a])).status === 400);
  check('Danh sách rỗng bị từ chối (400)', (await order([])).status === 400);
  check('Nhóm không có thật (404)', (await call('/admin/groups/999999/order', { method: 'POST', token: owner, body: { product_ids: [a] } })).status === 404);
  check('Chưa đăng nhập bị chặn (401)', (await call(`/admin/groups/${group.id}/order`, { method: 'POST', body: { product_ids: [a] } })).status === 401);
  const shipPhone = `03${String(suffix).padStart(7, '0')}5`;
  await call('/admin/staff', { method: 'POST', token: owner, body: { full_name: 'Shipper', phone: shipPhone, password: 'giaohang26', permissions: ['delivery'] } });
  const shipper = (await call('/auth/login', { method: 'POST', body: { identifier: shipPhone, password: 'giaohang26' } })).data.token;
  check('Nhân viên không có quyền sản phẩm bị chặn (403)', (await order([a], shipper)).status === 403);
} finally {
  await app.close();
}
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} đạt`);
process.exit(failed ? 1 : 0);
