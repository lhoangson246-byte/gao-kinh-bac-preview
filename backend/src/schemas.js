import { z } from 'zod';
import { HttpError, cleanImageUrl } from './validate.js';
import { LIMITS, ORDER_STATUSES, RETAIL_DISCOUNT_MAX_PERCENT } from './constants.js';

const obj = (shape) => z.strictObject(shape);
const text = (max) => z.string().max(max).refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v));
const optionalText = (max) => text(max).nullable().optional();
const integer = (min, max = Number.MAX_SAFE_INTEGER) => z.union([
  z.number().int().min(min).max(max),
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max)),
]);
const id = integer(1);
// Số có thể lẻ (phần trăm giảm, khối lượng kg). Nhận cả chuỗi từ ô nhập.
const decimal = (min, max) => z.union([
  z.number().min(min).max(max),
  z.string().regex(/^\d+(?:[.,]\d+)?$/).transform((v) => Number(v.replace(',', '.'))).pipe(z.number().min(min).max(max)),
]);
const flag = z.union([z.boolean(), z.literal(0), z.literal(1)]);
export const newPassword = z.string().min(12, 'Mật khẩu tối thiểu 12 ký tự.')
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Mật khẩu tối đa 72 byte UTF-8.');
const loginPassword = z.string().min(1).refine((v) => Buffer.byteLength(v, 'utf8') <= 72);
const name = text(LIMITS.name);
const phone = optionalText(LIMITS.phone);
const note = optionalText(LIMITS.note);
const line = obj({ product_id: id, quantity: integer(1, LIMITS.quantityPerLine) });
const lines = z.array(line).max(LIMITS.linesPerOrder);
const retailLines = z.array(obj({ product_id: id, quantity: integer(1, 500) })).max(60);
const address = {
  label: optionalText(40), receiver_name: name, phone: text(LIMITS.phone),
  address: text(LIMITS.address), is_default: flag.optional(),
};
const product = {
  name, price: integer(1, LIMITS.price), stock: integer(0, LIMITS.stock).or(z.literal('')).nullable().optional(),
  unit: optionalText(LIMITS.unit), origin: optionalText(LIMITS.origin), description: optionalText(LIMITS.description),
  image_url: optionalText(LIMITS.imageUrl).refine((v) => !v || cleanImageUrl(v) !== null),
  cost_price: integer(0, LIMITS.price).or(z.literal('')).nullable().optional(), is_active: flag.optional(),
  weight_kg: decimal(0, 1000).or(z.literal('')).nullable().optional(),
};
const day = text(10).regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
});
const page = { limit: integer(1, 100).optional(), offset: integer(0, 100000).optional() };
const empty = obj({});
const routes = [];
const add = (group, method, path, body = empty, query = empty) => routes.push({ group, method, path, body, query });
add('auth', 'POST', /^\/register\/?$/, obj({ full_name: name, email: optionalText(LIMITS.email), phone, password: newPassword }));
add('auth', 'POST', /^\/login\/?$/, obj({ identifier: optionalText(LIMITS.email), email: optionalText(LIMITS.email), phone, password: loginPassword }));
add('auth', 'GET', /^\/me\/?$/);
add('auth', 'PUT', /^\/me\/?$/, obj({ full_name: name.optional(), phone, address: optionalText(LIMITS.address) }));
add('auth', 'POST', /^\/logout\/?$/);
add('auth', 'PUT', /^\/password\/?$/, obj({ current_password: loginPassword, password: newPassword }));
add('products', 'GET', /^\/?$/, empty, obj({ q: text(LIMITS.name).optional(), in_stock: z.enum(['0', '1']).optional() }));
add('products', 'GET', /^\/[^/]+\/?$/);
add('addresses', 'GET', /^\/?$/);
add('addresses', 'POST', /^\/?$/, obj(address));
add('addresses', 'PUT', /^\/[^/]+\/?$/, obj(address));
add('addresses', 'PATCH', /^\/[^/]+\/default\/?$/);
add('addresses', 'DELETE', /^\/[^/]+\/?$/);
add('orders', 'POST', /^\/?$/, obj({
  address_id: id.nullable().optional(), receiver_name: name.optional(), phone,
  address: optionalText(LIMITS.address), delivery_area: z.literal('bac-ninh'),
  delivery_slot: z.enum(['sang', 'chieu', '']).nullable().optional(), note,
  payment_method: z.enum(['cod', 'bank']).optional(), items: lines.min(1),
}));
add('orders', 'GET', /^\/?$/);
add('orders', 'GET', /^\/[^/]+\/?$/);
add('orders', 'PATCH', /^\/[^/]+\/cancel\/?$/);
add('customers', 'GET', /^\/?$/, empty, obj({ ...page, q: text(60).optional(), locked: z.enum(['0', '1']).optional() }));
add('customers', 'GET', /^\/[^/]+\/?$/);
add('customers', 'POST', /^\/[^/]+\/reset-password\/?$/, obj({ password: newPassword }));
add('customers', 'PATCH', /^\/[^/]+\/lock\/?$/, obj({ is_locked: flag }));
add('customers', 'PUT', /^\/[^/]+\/?$/, obj({ full_name: name }));
add('admin', 'GET', /^\/orders\/?$/, empty, obj({ status: z.enum(ORDER_STATUSES).optional() }));
add('admin', 'PATCH', /^\/orders\/[^/]+\/status\/?$/, obj({ status: z.enum(ORDER_STATUSES) }));
add('admin', 'GET', /^\/(products|stats)\/?$/);
add('admin', 'POST', /^\/products\/?$/, obj(product));
add('admin', 'PUT', /^\/products\/[^/]+\/?$/, obj(product).partial());
add('admin', 'DELETE', /^\/products\/[^/]+\/?$/);
add('admin', 'POST', /^\/products\/[^/]+\/stock\/?$/, obj({ quantity: integer(1, 100000), cost_price: product.cost_price, note }));
add('admin', 'GET', /^\/products\/[^/]+\/stock\/?$/);
add('admin', 'GET', /^\/(stock-entries|activity)\/?$/, empty, obj({ limit: page.limit }));
add('admin', 'GET', /^\/revenue\/?$/, empty, obj({
  period: z.enum(['day', 'month', 'range']).optional(), date: day.optional(),
  month: text(7).regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), from: day.optional(), to: day.optional(),
}));
add('retail', 'GET', /^\/(policy|stats)\/?$/);
add('retail', 'GET', /^\/customers\/?$/, empty, obj({ phone: text(LIMITS.phone) }));
add('retail', 'POST', /^\/customers\/account\/?$/, obj({ phone: text(LIMITS.phone), full_name: name, password: newPassword }));
add('retail', 'PUT', /^\/customers\/[^/]+\/?$/, obj({ full_name: name.optional(), note }));
add('retail', 'POST', /^\/invoices\/?$/, obj({ phone, full_name: name.optional(), items: retailLines.optional(), rewards: retailLines.optional(), payment_method: z.enum(['cash', 'transfer']).optional(), note,
  discount_percent: decimal(0, RETAIL_DISCOUNT_MAX_PERCENT).or(z.literal('')).nullable().optional() }));
add('retail', 'GET', /^\/invoices\/?$/, empty, obj({ ...page, q: text(60).optional(), from: day.optional(), to: day.optional() }));
add('retail', 'GET', /^\/invoices\/[^/]+\/?$/);
add('retail', 'GET', /^\/returns\/?$/, empty, obj({ limit: page.limit }));
add('retail', 'POST', /^\/returns\/?$/, obj({
  invoice_id: id, return_type: z.enum(['return', 'exchange']), reason: text(LIMITS.note), note,
  refund_amount: integer(0).or(z.literal('')).nullable().optional(), refund_method: z.enum(['cash', 'transfer', 'none']).optional(),
  items: z.array(obj({ invoice_item_id: id, quantity: integer(1, 500) })).min(1).max(60),
}));

export function validateRoutes(group) {
  return (req, res, next) => {
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const route = routes.find((r) => r.group === group && r.method === method && r.path.test(req.path.toLowerCase()));
    if (!route) return next();
    if (!['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(req.method) && req.body !== undefined && !req.is('application/json')) {
      return next(new HttpError(415, 'Yêu cầu phải dùng application/json.'));
    }
    for (const [schema, value] of [[route.body, req.body ?? {}], [route.query, req.query]]) {
      const result = schema.safeParse(value);
      if (!result.success) {
        const errors = Object.fromEntries(result.error.issues.map((i) => [i.path[0] || 'request', i.message]));
        return next(new HttpError(400, 'Dữ liệu chưa hợp lệ.', errors));
      }
    }
    next();
  };
}
