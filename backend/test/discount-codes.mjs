// Mã giảm giá (GAOKINHBAC11 tháng 11/2026) và quy tắc "mỗi đơn chỉ một khuyến mãi".
// Cách chạy: node test/discount-codes.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng, ghim ngày 10/11/2026.
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);

const app = await fixture({ PROMO_TODAY: '2026-11-10' });
const { call } = app;
try {
  const admin = (await call('/auth/login', { method: 'POST', body: { identifier: app.env.ADMIN_EMAIL, password: app.env.ADMIN_PASSWORD } })).data.token;
  const suffix = Date.now() % 1e7;
  const product = (await call('/admin/products', {
    method: 'POST', token: admin, body: { name: `Gạo mã giảm ${suffix}`, price: 100000, cost_price: 70000, unit: 'túi 5kg', stock: 500 },
  })).data.product;
  let n = 0;
  const phoneOf = (prefix) => `${prefix}${String(suffix).padStart(7, '0')}${n++ % 10}`;
  const guest = (phone, extra = {}) => call('/orders/guest', {
    method: 'POST',
    body: {
      receiver_name: 'Cô Thử Mã', phone, address: 'Số 3 đường Ngô Gia Tự, phường Tiền An', delivery_area: 'bac-ninh',
      payment_method: 'cod', items: [{ product_id: product.id, quantity: 1 }], ...extra,
    },
  });

  /* Mã tháng 11 được tạo sẵn */
  const preview = await call('/orders/discount-code', { method: 'POST', body: { code: ' gaokinhbac11 ' } });
  check('Mã GAOKINHBAC11 có sẵn, gõ thường/có dấu cách vẫn nhận', preview.status === 200
    && preview.data.code.code === 'GAOKINHBAC11' && preview.data.code.amount === 10000 && preview.data.code.ends_on === '2026-11-30',
  JSON.stringify(preview.data));
  check('Xem trước không lộ số lượt đã dùng', !('uses' in (preview.data.code || {})) && !('max_uses' in (preview.data.code || {})));
  const wrong = await call('/orders/discount-code', { method: 'POST', body: { code: 'SAIMA' } });
  check('Mã sai: báo rõ tại ô nhập mã (400)', wrong.status === 400 && /không đúng/.test(wrong.data.errors?.discount_code || ''));

  /* Mỗi đơn chỉ một khuyến mãi */
  const phone = phoneOf('07');
  const first = (await guest(phone, { discount_code: 'GAOKINHBAC11' })).data.order;
  check('Đơn đầu + mã: chỉ giảm 20.000đ đơn đầu, mã không cộng dồn', first?.discount === 20000 && first.total === 80000
    && first.discount_code === null && first.code_discount === 0, JSON.stringify(first && { d: first.discount, c: first.discount_code }));
  const second = (await guest(phone, { discount_code: 'gaokinhbac11' })).data.order;
  check('Đơn thứ hai + mã: giảm 10.000đ theo mã', second?.discount === 10000 && second.total === 90000
    && second.discount_code === 'GAOKINHBAC11' && second.code_discount === 10000, JSON.stringify(second && { d: second.discount, c: second.discount_code }));
  const third = (await guest(phone)).data.order;
  check('Đơn thứ ba không nhập mã: không giảm', third?.discount === 0 && third.total === 100000);

  /* Đơn có tài khoản */
  const accountPhone = phoneOf('09');
  const customer = (await call('/auth/register', { method: 'POST', body: { full_name: 'Khách Có Mã', phone: accountPhone, password: 'gao2024!' } })).data.token;
  const accountOrder = (body = {}) => call('/orders', {
    method: 'POST', token: customer,
    body: {
      receiver_name: 'Khách Có Mã', phone: accountPhone, address: 'Số 9, đường Ngô Gia Tự, phường Tiền An', delivery_area: 'bac-ninh',
      payment_method: 'cod', items: [{ product_id: product.id, quantity: 2 }], ...body,
    },
  });
  const a1 = (await accountOrder({ discount_code: 'GAOKINHBAC11' })).data.order;
  const a2 = (await accountOrder({ discount_code: 'GAOKINHBAC11' })).data.order;
  check('Tài khoản: đơn đầu giảm 20.000đ, đơn sau giảm 10.000đ bằng mã', a1?.discount === 20000 && a2?.discount === 10000
    && a2.discount_code === 'GAOKINHBAC11' && a2.total === 190000, JSON.stringify([a1?.discount, a2?.discount]));

  /* Mã lớn hơn ưu đãi đơn đầu thì dùng mã */
  const create = (body) => call('/admin/discount-codes', { method: 'POST', token: admin, body });
  check('Tạo mã mới', (await create({ code: 'big50', amount: 50000, starts_on: '2026-11-01', ends_on: '2026-11-30' })).status === 201);
  const big = (await guest(phoneOf('03'), { discount_code: 'BIG50' })).data.order;
  check('Đơn đầu + mã 50.000đ: dùng mã (có lợi hơn), không cộng thêm 20.000đ', big?.discount === 50000 && big.discount_code === 'BIG50');

  /* Điều kiện của mã */
  await create({ code: 'CU10', amount: 10000, starts_on: '2026-10-01', ends_on: '2026-10-31' });
  await create({ code: 'SAP12', amount: 10000, starts_on: '2026-12-01', ends_on: '2026-12-31' });
  await create({ code: 'TU500K', amount: 30000, min_subtotal: 500000 });
  await create({ code: 'MOTLAN', amount: 5000, per_phone_limit: 1 });
  await create({ code: 'HAILUOT', amount: 5000, max_uses: 2 });
  // Đơn có tài khoản (giới hạn tần suất rộng hơn đơn mua nhanh); đơn đầu đã dùng ưu đãi nên mã được áp dụng.
  const usedPhone = phoneOf('08');
  const usedToken = (await call('/auth/register', { method: 'POST', body: { full_name: 'Khách Điều Kiện', phone: usedPhone, password: 'gao2024!' } })).data.token;
  const order = (token, ph, code, qty = 1) => call('/orders', {
    method: 'POST', token,
    body: {
      receiver_name: 'Khách Điều Kiện', phone: ph, address: 'Số 9, đường Ngô Gia Tự, phường Tiền An', delivery_area: 'bac-ninh',
      payment_method: 'cod', items: [{ product_id: product.id, quantity: qty }], ...(code ? { discount_code: code } : {}),
    },
  });
  await order(usedToken, usedPhone);
  const err = async (code) => (await order(usedToken, usedPhone, code)).data.errors?.discount_code || '';
  check('Mã hết hạn bị từ chối', /hết hạn/.test(await err('CU10')));
  check('Mã chưa tới ngày bị từ chối', /áp dụng từ ngày 01\/12\/2026/.test(await err('SAP12')));
  check('Đơn chưa đủ tiền tối thiểu bị từ chối', /từ 500\.000đ/.test(await err('TU500K')));
  check('Đủ tiền tối thiểu thì được', (await order(usedToken, usedPhone, 'TU500K', 5)).data.order?.code_discount === 30000);
  const once = (await order(usedToken, usedPhone, 'MOTLAN')).data.order;
  check('Mã một lần mỗi SĐT: lần đầu được', once?.discount_code === 'MOTLAN');
  check('Mã một lần mỗi SĐT: lần hai bị từ chối', /hết lượt/.test(await err('MOTLAN')));
  // Huỷ đơn thì trả lại lượt dùng mã.
  await call(`/admin/orders/${once.id}/status`, { method: 'PATCH', token: admin, body: { status: 'cancelled' } });
  check('Huỷ đơn thì trả lại lượt dùng mã', (await order(usedToken, usedPhone, 'MOTLAN')).data.order?.discount_code === 'MOTLAN');
  check('Mã nhiều lượt: lượt 1', (await order(usedToken, usedPhone, 'HAILUOT')).data.order?.discount_code === 'HAILUOT');
  check('Mã nhiều lượt: lượt 2', (await order(usedToken, usedPhone, 'HAILUOT')).data.order?.discount_code === 'HAILUOT');
  check('Mã hết tổng số lượt bị từ chối', /hết lượt dùng/.test(await err('HAILUOT')));

  /* Quản trị mã */
  check('Mã trùng bị từ chối (409)', (await create({ code: 'GAOKINHBAC11', amount: 10000 })).status === 409);
  check('Mã có ký tự lạ bị từ chối (400)', (await create({ code: 'GIẢM 10K', amount: 10000 })).status === 400);
  check('Số tiền dưới 1.000đ bị từ chối (400)', (await create({ code: 'NHO', amount: 500 })).status === 400);
  check('Khách thường không tạo được mã (403)', (await call('/admin/discount-codes', { method: 'POST', token: customer, body: { code: 'X123', amount: 5000 } })).status === 403);
  check('Chưa đăng nhập không xem được danh sách mã (401)', (await call('/admin/discount-codes')).status === 401);
  const codes = (await call('/admin/discount-codes', { token: admin })).data.codes;
  const nov = codes.find((c) => c.code === 'GAOKINHBAC11');
  check('Danh sách mã có số lượt đã dùng và tổng tiền đã giảm', nov?.uses === 2 && nov.discounted === 20000, JSON.stringify(nov));
  check('Mã đã có đơn dùng thì không đổi chữ được', (await call(`/admin/discount-codes/${nov.id}`, { method: 'PUT', token: admin, body: { code: 'DOITEN' } })).status === 400);
  await call(`/admin/discount-codes/${nov.id}`, { method: 'PUT', token: admin, body: { is_active: false } });
  check('Tắt mã thì khách không dùng được nữa', (await call('/orders/discount-code', { method: 'POST', body: { code: 'GAOKINHBAC11' } })).status === 400);
  await call(`/admin/discount-codes/${nov.id}`, { method: 'PUT', token: admin, body: { is_active: true } });
  check('Mở lại mã', (await call('/orders/discount-code', { method: 'POST', body: { code: 'GAOKINHBAC11' } })).status === 200);
} finally {
  await app.close();
}

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
assert.equal(failed, 0);
