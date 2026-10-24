// Tra cứu đơn bằng SĐT + mã đơn, và trang "Về chúng tôi" (giấy tờ, đánh giá giao hàng).
// Cách chạy: node test/about-track.mjs — tự dựng máy chủ và cơ sở dữ liệu riêng.
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);

const app = await fixture();
const { call } = app;
try {
  const admin = (await call('/auth/login', { method: 'POST', body: { identifier: app.env.ADMIN_EMAIL, password: app.env.ADMIN_PASSWORD } })).data.token;
  const suffix = Date.now() % 1e8;
  const customerPhone = `09${String(suffix).padStart(8, '0')}`;
  const customer = (await call('/auth/register', {
    method: 'POST', body: { full_name: 'Khách Tra Cứu', phone: customerPhone, password: 'gao2024!' },
  })).data.token;
  const product = (await call('/admin/products', {
    method: 'POST', token: admin, body: { name: `Gạo tra cứu ${suffix}`, price: 100000, cost_price: 70000, unit: 'túi 5kg', stock: 50 },
  })).data.product;

  /* ---------------- Tra cứu đơn ---------------- */
  const guestPhone = `07${String(suffix).padStart(8, '0')}`;
  const placed = (await call('/orders/guest', {
    method: 'POST',
    body: {
      receiver_name: 'Cô Mai', phone: guestPhone, address: 'Số 5 đường Lý Thái Tổ, phường Suối Hoa',
      delivery_area: 'bac-ninh', delivery_slot: 'sang', payment_method: 'cod', items: [{ product_id: product.id, quantity: 2 }],
    },
  })).data.order;
  const track = (phone, code) => call('/orders/track', { method: 'POST', body: { phone, code } });

  const found = await track(guestPhone, placed.code);
  check('Đúng SĐT + mã đơn: xem được tiến độ', found.status === 200 && found.data.order.code === placed.code
    && found.data.order.status === 'pending' && found.data.order.items[0]?.quantity === 2, JSON.stringify(found.data).slice(0, 200));
  check('Tra cứu không trả địa chỉ, SĐT, mã nội bộ hay giá nhập',
    !('address' in found.data.order) && !('phone' in found.data.order) && !('id' in found.data.order)
    && !/cost_price|guest_token|Lý Thái Tổ/.test(JSON.stringify(found.data)));
  const loose = await track(guestPhone.replace(/^0/, '+84'), placed.code.toLowerCase().replace('dh', 'dh '));
  check('Nhận SĐT dạng +84 và mã đơn viết thường/có dấu cách', loose.status === 200);
  check('Nhận mã đơn chỉ gõ số', (await track(guestPhone, String(placed.id))).status === 200);
  const wrongPhone = await track(customerPhone, placed.code);
  check('Sai SĐT (đúng mã): 404, không lộ đơn', wrongPhone.status === 404 && !wrongPhone.data.order);
  check('Sai mã đơn: 404', (await track(guestPhone, 'DH999999')).status === 404);
  check('Dữ liệu lạ bị từ chối (400)', (await call('/orders/track', { method: 'POST', body: { phone: guestPhone, code: placed.code, x: 1 } })).status === 400);

  for (const status of ['confirmed', 'shipping', 'completed']) {
    await call(`/admin/orders/${placed.id}/status`, { method: 'PATCH', token: admin, body: { status } });
  }
  const done = (await track(guestPhone, placed.code)).data.order;
  check('Mỗi bước admin bấm đều ghi giờ (xác nhận, đang giao, hoàn thành)',
    done.status === 'completed' && !!done.confirmed_at && !!done.shipping_at && !!done.completed_at && !done.cancelled_at, JSON.stringify(done));

  const mine = (await call('/orders', {
    method: 'POST', token: customer,
    body: {
      receiver_name: 'Khách Tra Cứu', phone: customerPhone, address: 'Số 9, đường Ngô Gia Tự, phường Tiền An',
      delivery_area: 'bac-ninh', payment_method: 'cod', items: [{ product_id: product.id, quantity: 1 }],
    },
  })).data.order;
  await call(`/orders/${mine.id}/cancel`, { method: 'PATCH', token: customer });
  const cancelled = (await track(customerPhone, mine.code)).data.order;
  check('Khách tự huỷ: tra cứu thấy "đã huỷ" kèm giờ huỷ', cancelled?.status === 'cancelled' && !!cancelled.cancelled_at);

  /* ---------------- Về chúng tôi ---------------- */
  const empty = await call('/about');
  check('Trang giới thiệu chưa nhập gì: không có dữ liệu mẫu', empty.status === 200 && empty.data.intro === '' && empty.data.documents.length === 0);
  check('Chưa đăng nhập không sửa được (401)', (await call('/admin/about/intro', { method: 'PUT', body: { intro: 'x' } })).status === 401);
  check('Khách thường không sửa được (403)', (await call('/admin/about/intro', { method: 'PUT', token: customer, body: { intro: 'x' } })).status === 403);

  const intro = await call('/admin/about/intro', { method: 'PUT', token: admin, body: { intro: '  Dòng một  \r\n\r\n\r\n\r\nDòng hai\u0007 ' } });
  check('Lưu lời giới thiệu, giữ xuống dòng, bỏ ký tự lạ', intro.status === 200 && intro.data.intro === 'Dòng một\n\nDòng hai', JSON.stringify(intro.data.intro));

  const image = '/api/images/0123456789abcdef0123456789abcdef.webp';
  check('Giấy tờ thiếu ảnh bị từ chối (400)', (await call('/admin/about/documents', { method: 'POST', token: admin, body: { title: 'Giấy ATTP' } })).status === 400);
  check('Ảnh "javascript:" bị từ chối (400)', (await call('/admin/about/documents', {
    method: 'POST', token: admin, body: { title: 'Giấy ATTP', image_url: 'javascript:alert(1)' },
  })).status === 400);
  const d1 = await call('/admin/about/documents', { method: 'POST', token: admin, body: { title: 'Giấy chứng nhận ATTP', category: 'attp', image_url: image, note: 'Cấp năm 2026' } });
  const d2 = await call('/admin/about/documents', { method: 'POST', token: admin, body: { title: 'Công bố gạo ST25', category: 'cong-bo', image_url: image } });
  check('Thêm hai giấy tờ', d1.status === 201 && d2.status === 201 && d2.data.documents.length === 2);
  const [doc1, doc2] = d2.data.documents;
  const reordered = await call('/admin/about/documents/reorder', { method: 'POST', token: admin, body: { ids: [doc2.id, doc1.id] } });
  check('Sắp xếp giấy tờ', reordered.data.documents[0].id === doc2.id);
  await call(`/admin/about/documents/${doc1.id}`, { method: 'PUT', token: admin, body: { is_visible: false } });
  const publicAbout = (await call('/about')).data;
  check('Khách chỉ thấy giấy tờ đang hiện', publicAbout.documents.length === 1 && publicAbout.documents[0].title === 'Công bố gạo ST25'
    && publicAbout.intro === 'Dòng một\n\nDòng hai');
  await call(`/admin/about/documents/${doc2.id}`, { method: 'DELETE', token: admin });
  check('Xoá giấy tờ', (await call('/about')).data.documents.length === 0);

  check('Điểm 7 (quá thang 6) bị từ chối (400)', (await call('/admin/about/reviews', { method: 'POST', token: admin, body: { content: 'Tốt', score: 7 } })).status === 400);
  check('Đánh giá thiếu nội dung bị từ chối (400)', (await call('/admin/about/reviews', { method: 'POST', token: admin, body: { score: 5 } })).status === 400);
  check('Ngày sai bị từ chối (400)', (await call('/admin/about/reviews', { method: 'POST', token: admin, body: { content: 'Ok', review_date: '2026-02-30' } })).status === 400);
  await call('/admin/about/reviews', { method: 'POST', token: admin, body: { customer_name: 'Chị Hà (Võ Cường)', content: 'Giao nhanh,\nshipper vui vẻ', score: 6, review_date: '2026-10-20' } });
  await call('/admin/about/reviews', { method: 'POST', token: admin, body: { content: 'Gạo ngon, giao đúng giờ', score: 5, review_date: '2026-10-22' } });
  await call('/admin/about/reviews', { method: 'POST', token: admin, body: { customer_name: 'Anh Tuấn', content: 'Lần sau gọi trước giúp em' } });
  const hidden = await call('/admin/about/reviews', { method: 'POST', token: admin, body: { content: 'Nội dung chưa duyệt', score: 1, is_visible: false } });
  check('Thêm đánh giá (có/không điểm, có thể ẩn)', hidden.status === 201 && hidden.data.reviews.length === 4);
  const reviews = (await call('/about/reviews')).data;
  check('Khách chỉ thấy đánh giá đang hiện, mới nhất trước', reviews.reviews.length === 3
    // Không ghi ngày thì tính theo ngày nhập (hôm nay) nên đứng đầu; còn lại theo ngày khách viết.
    && reviews.reviews.map((r) => r.content).join('|') === 'Lần sau gọi trước giúp em|Gạo ngon, giao đúng giờ|Giao nhanh,\nshipper vui vẻ'
    && !reviews.reviews.some((r) => r.content === 'Nội dung chưa duyệt'));
  check('Điểm trung bình chỉ tính đánh giá có chấm điểm, thang 6',
    reviews.summary.average === 5.5 && reviews.summary.scored === 2 && reviews.summary.count === 3 && reviews.summary.max_score === 6, JSON.stringify(reviews.summary));
  check('Giữ xuống dòng trong đánh giá', reviews.reviews.some((r) => r.content === 'Giao nhanh,\nshipper vui vẻ'));
  const firstId = hidden.data.reviews.find((r) => r.content === 'Lần sau gọi trước giúp em').id;
  const edited = await call(`/admin/about/reviews/${firstId}`, { method: 'PUT', token: admin, body: { score: 4 } });
  check('Sửa điểm một đánh giá', edited.status === 200 && edited.data.reviews.find((r) => r.id === firstId).score === 4);
  check('Trường lạ bị từ chối (400)', (await call('/admin/about/reviews', { method: 'POST', token: admin, body: { content: 'x', role: 'admin' } })).status === 400);
  const logged = (await call('/admin/activity', { token: admin })).data;
  check('Thay đổi được ghi nhật ký', JSON.stringify(logged || {}).includes('about.review.create'), Object.keys(logged || {}).join(','));
} finally {
  await app.close();
}

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
assert.equal(failed, 0);
