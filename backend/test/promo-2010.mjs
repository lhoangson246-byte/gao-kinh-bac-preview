// Khuyến mãi 20/10: 19–21/10, mỗi 15kg gạo tặng 1kg nếp cái hoa vàng, tối đa 3kg.
// Cách chạy: node test/promo-2010.mjs (tự dựng máy chủ riêng, ghim ngày bằng PROMO_TODAY).
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';

let phoneSeq = 0;
const nextPhone = () => `0961${String(Date.now()).slice(-4)}${String(phoneSeq++).padStart(2, '0')}`;

async function withDay(day, run) {
  const app = await fixture({ PROMO_TODAY: day });
  try { await run(app); } finally { await app.close(); }
}

async function setup(app) {
  const products = (await app.call('/products')).data.products;
  const pick = (test) => products.find((p) => p.price > 0 && p.stock >= 20 && test(p));
  const sack10 = pick((p) => p.category === 'gao' && /10kg/.test(p.unit));
  const bag5 = pick((p) => p.category === 'gao' && /5kg/.test(p.unit));
  const nep = products.find((p) => /nếp cái hoa vàng/.test(p.name) && /1kg/.test(p.unit));
  const dry = products.find((p) => p.category === 'do-kho' && p.price > 0);
  assert.ok(sack10 && bag5 && nep, 'có sản phẩm để thử');
  const guest = (items) => app.call('/orders/guest', {
    method: 'POST',
    body: { receiver_name: 'Chị Thử 20/10', phone: nextPhone(), address: 'Số 20 đường Thử Khuyến Mãi, phường Suối Hoa',
      delivery_area: 'bac-ninh', items },
  });
  const stockOf = async (id) => (await app.call(`/products/${id}`)).data.product.stock;
  return { sack10, bag5, nep, dry, guest, stockOf };
}

const giftOf = (order) => order.items.find((i) => i.promo === '2010-nep');

/* Trong đợt (20/10) */
await withDay('2026-10-20', async (app) => {
  const { sack10, bag5, nep, dry, guest, stockOf } = await setup(app);
  const promo = (await app.call('/settings/storefront')).data.settings.promotion;
  assert.equal(promo?.code, '2010-nep', 'trang chủ thấy đợt khuyến mãi');
  assert.equal(promo.min_kg, 15);
  assert.equal(promo.max_gift_kg, 3);

  const ten = await guest([{ product_id: sack10.id, quantity: 1 }]);
  assert.equal(ten.status, 201);
  assert.ok(!giftOf(ten.data.order), '10kg: chưa được quà');

  const nepBefore = await stockOf(nep.id);
  const fifteen = await guest([{ product_id: sack10.id, quantity: 1 }, { product_id: bag5.id, quantity: 1 }]);
  const g1 = giftOf(fifteen.data.order);
  assert.ok(g1, '15kg: được quà');
  assert.equal(g1.quantity, 1);
  assert.equal(g1.price, 0, 'quà 0đ');
  assert.equal(g1.product_id, nep.id, 'quà lấy từ túi nếp cái hoa vàng 1kg');
  assert.equal(fifteen.data.order.subtotal, sack10.price + bag5.price, 'quà không tính tiền');
  assert.equal(await stockOf(nep.id), nepBefore - 1, 'quà trừ kho');

  const fortyFive = await guest([{ product_id: sack10.id, quantity: 4 }, { product_id: bag5.id, quantity: 1 }]);
  assert.equal(giftOf(fortyFive.data.order).quantity, 3, '45kg: 3kg');
  const sixty = await guest([{ product_id: sack10.id, quantity: 6 }]);
  assert.equal(giftOf(sixty.data.order).quantity, 3, '60kg: vẫn chỉ 3kg');

  if (dry) {
    const withDry = await guest([{ product_id: sack10.id, quantity: 1 }, { product_id: dry.id, quantity: 10 }]);
    assert.ok(!giftOf(withDry.data.order), 'đồ khô không tính vào số kg gạo');
  }

  // Huỷ đơn: trả túi quà về kho.
  const login = await app.call('/auth/login', { method: 'POST', body: { identifier: app.env.ADMIN_EMAIL, password: app.env.ADMIN_PASSWORD } });
  const admin = login.data.token;
  const beforeCancel = await stockOf(nep.id);
  const cancel = await app.call(`/admin/orders/${fortyFive.data.order.id}/status`, { method: 'PATCH', token: admin, body: { status: 'cancelled' } });
  assert.equal(cancel.status, 200);
  assert.equal(await stockOf(nep.id), beforeCancel + 3, 'huỷ đơn hoàn 3 túi quà');

  // Giao xong: quà không sinh điểm (điểm chỉ theo hàng mua).
  for (const status of ['confirmed', 'shipping', 'completed']) {
    await app.call(`/admin/orders/${fifteen.data.order.id}/status`, { method: 'PATCH', token: admin, body: { status } });
  }
  const done = (await app.call('/admin/orders?status=completed&limit=100', { token: admin })).data.orders.find((o) => o.id === fifteen.data.order.id);
  const expected = Math.floor((sack10.price + bag5.price - fifteen.data.order.discount) / 1000);
  assert.equal(done.points_earned, expected, 'quà không cộng điểm');

  // Tại quầy: 30kg tặng 2kg, ghi trên hoá đơn.
  const invoice = await app.call('/retail/invoices', {
    method: 'POST', token: admin, body: { items: [{ product_id: sack10.id, quantity: 3 }] },
  });
  assert.equal(invoice.status, 201);
  const posGift = invoice.data.invoice.items.find((i) => i.promo === '2010-nep');
  assert.equal(posGift?.quantity, 2, 'quầy: 30kg tặng 2kg');
  assert.equal(posGift.price, 0);
  assert.equal(invoice.data.invoice.total, sack10.price * 3, 'quà không tính tiền ở quầy');
});

/* Sau đợt (22/10): không tặng, trang chủ không còn báo */
await withDay('2026-10-22', async (app) => {
  const { sack10, guest } = await setup(app);
  assert.equal((await app.call('/settings/storefront')).data.settings.promotion, null, 'hết đợt thì ẩn');
  const order = await guest([{ product_id: sack10.id, quantity: 5 }]);
  assert.ok(!giftOf(order.data.order), 'hết đợt: 50kg không được quà');
});

/* Trước đợt (18/10): trang chủ báo trước, chưa tặng */
await withDay('2026-10-18', async (app) => {
  const { sack10, guest } = await setup(app);
  assert.equal((await app.call('/settings/storefront')).data.settings.promotion?.code, '2010-nep', 'báo trước đợt');
  const order = await guest([{ product_id: sack10.id, quantity: 2 }]);
  assert.ok(!giftOf(order.data.order), 'trước đợt: chưa tặng');
});

console.log('Promo 20/10: 15kg -> 1kg, 45kg+ -> 3kg cap, dry goods excluded, stock and cancel, POS, date window all correct.');
