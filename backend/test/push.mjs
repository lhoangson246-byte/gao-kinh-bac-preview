// Thông báo đẩy báo đơn mới (Web Push VAPID) và tin Telegram dự phòng.
// Cách chạy: node test/push.mjs — tự dựng máy chủ, cơ sở dữ liệu, dịch vụ push và Telegram giả.
// Máy chủ push giả nhận đúng gói tin trình duyệt sẽ nhận; bài kiểm tra giải mã (aes128gcm,
// RFC 8291) bằng khoá riêng của "trình duyệt" để chắc nội dung thông báo đúng như cửa hàng cần.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createECDH, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { fixture } from './fixture.mjs';

const results = [];
const check = (name, ok, extra = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? `  — ${extra}` : ''}`);
};

/* --- Dịch vụ push và Telegram giả: ghi lại mọi yêu cầu, trả mã theo đường dẫn --- */
const received = [];
const fake = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
  const status = req.url.startsWith('/gone/') ? 410 : req.url.startsWith('/fail/') ? 500 : req.url.startsWith('/bot') ? 200 : 201;
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(req.url.startsWith('/bot') ? '{"ok":true}' : '');
});
fake.listen(0, '127.0.0.1');
await once(fake, 'listening');
const origin = `http://127.0.0.1:${fake.address().port}`;
const takeFor = async (prefix, timeout = 4000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const index = received.findIndex((r) => r.path.startsWith(prefix));
    if (index >= 0) return received.splice(index, 1)[0];
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
};

/* --- Một "trình duyệt": cặp khoá ECDH P-256 và auth secret như PushManager cấp --- */
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function browser(path) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, sub: { endpoint: `${origin}${path}`, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } } };
}
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
/** Giải mã nội dung Web Push aes128gcm (RFC 8188 + RFC 8291). */
function decrypt(device, body) {
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const serverPublic = body.subarray(21, 21 + idLength);
  const cipher = body.subarray(21 + idLength);
  const shared = device.ecdh.computeSecret(serverPublic);
  const prkKey = hmac(device.auth, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), device.ecdh.getPublicKey(), serverPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([decipher.update(cipher.subarray(0, cipher.length - 16)), decipher.final()]);
  let end = plain.length - 1;
  while (end > 0 && plain[end] === 0) end -= 1;   // bỏ đệm, rồi bỏ ký tự kết thúc bản ghi (0x02)
  return JSON.parse(plain.subarray(0, end).toString('utf8'));
}

const vapid = webpush.generateVAPIDKeys();
const telegramToken = `123456789:${'A'.repeat(35)}`;
const app = await fixture({
  VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:admin@gaokinhbac.vn',
  PUSH_TEST_ORIGIN: origin, TELEGRAM_TEST_ORIGIN: origin,
  TELEGRAM_BOT_TOKEN: telegramToken, TELEGRAM_CHAT_ID: '-1001234567890',
  PUBLIC_SITE_URL: 'https://shop.example',
});
const { call } = app;
try {
  const login = await call('/auth/login', { method: 'POST', body: { identifier: app.env.ADMIN_EMAIL, password: app.env.ADMIN_PASSWORD } });
  const admin = login.data.token;
  const suffix = Date.now() % 1e8;
  const customer = await call('/auth/register', {
    method: 'POST', body: { full_name: 'Khách Thử Push', phone: `09${String(suffix).padStart(8, '0')}`, password: 'matkhau123!test' },
  });
  const customerToken = customer.data.token;

  /* Phân quyền: chỉ quản trị viên */
  check('Chưa đăng nhập không đọc được cấu hình push (401)', (await call('/push/config')).status === 401);
  check('Khách thường không đăng ký nhận báo đơn (403)',
    (await call('/push/subscribe', { method: 'POST', token: customerToken, body: browser('/ok/x').sub })).status === 403);
  const config = await call('/push/config', { token: admin });
  check('Quản trị đọc được khoá VAPID công khai và trạng thái Telegram',
    config.data.publicKey === vapid.publicKey && config.data.telegram === true, JSON.stringify(config.data));
  check('Không bao giờ trả khoá VAPID riêng', !JSON.stringify(config.data).includes(vapid.privateKey));

  /* Chặn địa chỉ lạ (SSRF) và khoá hỏng */
  const phone = browser('/ok/phone-1');
  for (const [label, endpoint] of [
    ['máy chủ nội bộ', 'http://169.254.169.254/latest/meta-data'],
    ['tên miền lạ', 'https://evil.example.com/push'],
    ['giả dạng FCM', 'https://fcm.googleapis.com.evil.example/push'],
    ['FCM qua cổng lạ', 'https://fcm.googleapis.com:8443/push'],
  ]) {
    const bad = await call('/push/subscribe', { method: 'POST', token: admin, body: { ...phone.sub, endpoint } });
    check(`Từ chối endpoint ${label} (400)`, bad.status === 400, `status=${bad.status}`);
  }
  const badKey = await call('/push/subscribe', {
    method: 'POST', token: admin, body: { ...phone.sub, keys: { p256dh: b64u(randomBytes(65)), auth: phone.sub.keys.auth } },
  });
  check('Từ chối khoá trình duyệt không phải điểm P-256 (400)', badKey.status === 400, `status=${badKey.status}`);

  /* Đăng ký + đăng ký lại (upsert theo endpoint) */
  const sub1 = await call('/push/subscribe', { method: 'POST', token: admin, body: { ...phone.sub, expirationTime: null } });
  check('Quản trị bật thông báo trên máy này', sub1.status === 200 && sub1.data.devices === 1, JSON.stringify(sub1.data));
  const sub2 = await call('/push/subscribe', { method: 'POST', token: admin, body: phone.sub });
  check('Mở lại app đăng ký lại không tạo bản trùng', sub2.status === 200 && sub2.data.devices === 1, JSON.stringify(sub2.data));

  /* Nút gửi thử */
  const test = await call('/push/test', { method: 'POST', token: admin, body: { endpoint: phone.sub.endpoint } });
  const testPush = await takeFor('/ok/phone-1');
  check('Gửi thông báo thử tới đúng máy', test.status === 200 && test.data.sent === 1 && !!testPush, JSON.stringify(test.data));
  if (testPush) {
    check('Push gửi kèm TTL 86400 và Urgency high', testPush.headers.ttl === '86400' && testPush.headers.urgency === 'high',
      `ttl=${testPush.headers.ttl} urgency=${testPush.headers.urgency}`);
    check('Push ký VAPID bằng khoá của cửa hàng và mã hoá aes128gcm',
      testPush.headers['content-encoding'] === 'aes128gcm'
      && new RegExp(`^vapid t=[^,]+, k=${vapid.publicKey}$`).test(testPush.headers.authorization || ''));
    const payload = decrypt(phone, testPush.body);
    check('Giải mã được nội dung thông báo thử', payload.kind === 'test' && payload.url === '/quan-tri', JSON.stringify(payload));
  }

  /* Đơn mua nhanh (không tài khoản) → push + Telegram */
  const product = (await call('/admin/products', {
    method: 'POST', token: admin,
    body: { name: `Gạo <b>thử</b> push ${suffix}`, price: 125000, cost_price: 90000, unit: 'túi 5kg', stock: 50 },
  })).data.product;
  received.length = 0;
  const guestPhone = `07${String(suffix).padStart(8, '0')}`;
  const guest = await call('/orders/guest', {
    method: 'POST',
    body: {
      receiver_name: 'Cô Hoa & con', phone: guestPhone, address: 'Số 8 đường Lê Văn Thịnh, phường Suối Hoa',
      delivery_area: 'bac-ninh', delivery_slot: 'sang', payment_method: 'cod', note: 'Gọi trước <15 phút>',
      items: [{ product_id: product.id, quantity: 2 }], latitude: 21.18, longitude: 106.07, location_accuracy: 20,
    },
  });
  const order = guest.data.order;
  check('Đặt hàng nhanh vẫn thành công (201)', guest.status === 201 && /^DH\d{6}$/.test(order?.code || ''), `status=${guest.status}`);
  const orderPush = await takeFor('/ok/phone-1');
  check('Đơn mua nhanh: máy quản trị nhận push', !!orderPush);
  if (orderPush) {
    const p = decrypt(phone, orderPush.body);
    const money = order.total.toLocaleString('vi-VN').replace(/,/g, '.');
    check('Tiêu đề push: 🌾 ĐƠN HÀNG MỚI #mã - tổng tiền', p.title === `🌾 ĐƠN HÀNG MỚI #${order.code} - ${money}đ`, p.title);
    check('Nội dung push: khách, SĐT, giờ giao, địa chỉ',
      p.body === `Khách: Cô Hoa & con (${guestPhone})\nGiờ giao: Sáng: 07h00 – 11h30 | Đ/c: ${order.address}`, JSON.stringify(p.body));
    check('Push mở đúng đơn trong trang quản trị, kèm SĐT và link GPS',
      p.tag === `order-${order.id}` && p.url === `/quan-tri?orderId=${order.id}` && p.phone === guestPhone
      && p.gpsUrl === 'https://www.google.com/maps?q=21.18,106.07', JSON.stringify(p));
    check('Push không chứa giá nhập hay mã bí mật của đơn', !/cost_price|guest_token/.test(JSON.stringify(p)));
  }
  const tg = await takeFor('/bot');
  check('Đơn mua nhanh: gửi tin Telegram dự phòng', !!tg && tg.path === `/bot${telegramToken}/sendMessage`, tg?.path);
  if (tg) {
    const message = JSON.parse(tg.body.toString('utf8'));
    check('Tin Telegram dạng HTML, đúng nhóm chat', message.parse_mode === 'HTML' && message.chat_id === '-1001234567890');
    const text = message.text;
    check('Telegram: mã đơn, tên khách đã thoát ký tự HTML', text.includes(`#${order.code}`) && text.includes('Cô Hoa &amp; con'), text);
    check('Telegram: số gọi được dạng +84', text.includes(`+84${guestPhone.slice(1)}`));
    check('Telegram: link Google Maps từ vị trí khách ghim', text.includes('href="https://www.google.com/maps?q=21.18,106.07"'));
    check('Telegram: giờ giao, thanh toán, hàng và tổng tiền',
      text.includes('Sáng: 07h00 – 11h30') && text.includes('Tiền mặt khi nhận hàng')
      && text.includes(`Gạo &lt;b&gt;thử&lt;/b&gt; push ${suffix}`) && text.includes('× 2 túi 5kg')
      && text.includes(`Tổng: ${order.total.toLocaleString('vi-VN').replace(/,/g, '.')}đ`), text);
    check('Telegram: ghi chú của khách được thoát ký tự', text.includes('Gọi trước &lt;15 phút&gt;'));
    check('Telegram: link mở đơn trên trang quản trị', text.includes(`https://shop.example/quan-tri?orderId=${order.id}`));
  }

  /* Đơn của khách có tài khoản → cũng báo */
  received.length = 0;
  const account = await call('/orders', {
    method: 'POST', token: customerToken,
    body: {
      receiver_name: 'Khách Thử Push', phone: customer.data.user.phone, address: 'Số 9, đường Ngô Gia Tự, phường Tiền An',
      delivery_area: 'bac-ninh', delivery_slot: 'chieu', payment_method: 'bank', items: [{ product_id: product.id, quantity: 1 }],
    },
  });
  check('Đặt hàng có tài khoản vẫn thành công (201)', account.status === 201, `status=${account.status} ${JSON.stringify(account.data).slice(0, 120)}`);
  const accountPush = await takeFor('/ok/phone-1');
  const accountPayload = accountPush ? decrypt(phone, accountPush.body) : null;
  check('Đơn có tài khoản: máy quản trị nhận push', accountPayload?.orderId === account.data.order?.id
    && accountPayload?.body.includes('Giờ giao: Chiều: 13h30 – 18h00') && accountPayload?.gpsUrl === null, JSON.stringify(accountPayload));
  const tg2 = await takeFor('/bot');
  check('Đơn có tài khoản: Telegram ghi chuyển khoản, không bịa số tài khoản',
    !!tg2 && JSON.parse(tg2.body).text.includes('Chuyển khoản (cửa hàng gửi thông tin sau khi xác nhận)'));

  /* Máy đã gỡ app (dịch vụ push trả 410) → tự xoá; máy lỗi tạm thời không làm hỏng đơn */
  const gone = browser('/gone/old-phone');
  const broken = browser('/fail/flaky-phone');
  await call('/push/subscribe', { method: 'POST', token: admin, body: gone.sub });
  const three = await call('/push/subscribe', { method: 'POST', token: admin, body: broken.sub });
  check('Một quản trị có nhiều máy', three.data.devices === 3, JSON.stringify(three.data));
  received.length = 0;
  const again = await call('/orders/guest', {
    method: 'POST',
    body: {
      receiver_name: 'Chú Nam', phone: `03${String(suffix).padStart(8, '0')}`, address: 'Số 1 đường Kinh Dương Vương, phường Vũ Ninh',
      delivery_area: 'bac-ninh', payment_method: 'cod', items: [{ product_id: product.id, quantity: 1 }],
    },
  });
  check('Dịch vụ push lỗi 500/410 không làm hỏng việc đặt hàng (201)', again.status === 201, `status=${again.status}`);
  check('Máy còn dùng vẫn nhận được, chưa chọn giờ thì ghi rõ', !!(await takeFor('/ok/phone-1'))
    && !!(await takeFor('/gone/old-phone')) && !!(await takeFor('/fail/flaky-phone')));
  const afterGone = await call('/push/test', { method: 'POST', token: admin, body: { endpoint: gone.sub.endpoint } });
  check('Máy trả 410 đã bị xoá khỏi danh sách (gửi thử báo chưa bật)', afterGone.status === 404, `status=${afterGone.status}`);
  const allDevices = await call('/push/test', { method: 'POST', token: admin, body: {} });
  check('Gửi thử không chỉ định máy: gửi tới mọi máy của tài khoản', allDevices.status === 200
    && allDevices.data.sent === 1 && allDevices.data.failed === 1, JSON.stringify(allDevices.data));

  /* Tắt trên máy này */
  const off = await call('/push/unsubscribe', { method: 'DELETE', token: admin, body: { endpoint: phone.sub.endpoint } });
  check('Tắt thông báo trên máy này', off.status === 200 && off.data.removed === 1, JSON.stringify(off.data));
  check('Đã tắt thì gửi thử báo chưa bật (404)',
    (await call('/push/test', { method: 'POST', token: admin, body: { endpoint: phone.sub.endpoint } })).status === 404);
  check('Dữ liệu lạ trong yêu cầu bị từ chối (400)',
    (await call('/push/subscribe', { method: 'POST', token: admin, body: { ...phone.sub, role: 'admin' } })).status === 400);
} finally {
  await app.close();
}

/* Máy chủ chưa cấu hình VAPID: giao diện báo rõ, đặt hàng vẫn chạy */
const bare = await fixture({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' });
try {
  const login = await bare.call('/auth/login', { method: 'POST', body: { identifier: bare.env.ADMIN_EMAIL, password: bare.env.ADMIN_PASSWORD } });
  const config = await bare.call('/push/config', { token: login.data.token });
  check('Chưa cấu hình VAPID: trả publicKey rỗng', config.status === 200 && config.data.publicKey === null && config.data.telegram === false);
  const subscribe = await bare.call('/push/subscribe', { method: 'POST', token: login.data.token, body: browser('/ok/x').sub });
  check('Chưa cấu hình VAPID: đăng ký báo lỗi 503 rõ ràng', subscribe.status === 503, `status=${subscribe.status}`);
} finally {
  await bare.close();
  fake.close();
}

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
assert.equal(failed, 0);
