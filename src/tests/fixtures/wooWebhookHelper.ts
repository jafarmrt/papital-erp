import request from 'supertest';
import crypto from 'crypto';
import type { TestApp } from './httpTestHelper.js';

/**
 * v7.0.30 (TD-190): ارسال وب‌هوک امضاشده ووکامرس از مسیر واقعی HTTP
 * (همان امضای HMAC-SHA256 بدنه خام که ووکامرس در هدر X-WC-Webhook-Signature می‌فرستد).
 */
export async function postSignedWooWebhook(
  app: TestApp,
  secret: string,
  payload: Record<string, unknown>,
  topic = 'order.updated'
): Promise<{ status: number; body: any }> {
  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  const res = await request(app)
    .post('/api/woocommerce/webhook/order')
    .set('Content-Type', 'application/json')
    .set('X-WC-Webhook-Signature', signature)
    .set('X-WC-Webhook-Topic', topic)
    .send(raw);
  return { status: res.status, body: res.body };
}

export function buildWooOrder(params: {
  id: string;
  status: string;
  lines: Array<{ sku: string; quantity: number; price: number; name?: string }>;
  phone?: string;
  firstName?: string;
  lastName?: string;
}): Record<string, unknown> {
  return {
    id: params.id,
    number: params.id,
    status: params.status,
    currency: 'IRR',
    total: params.lines.reduce((s, l) => s + l.quantity * l.price, 0),
    billing: {
      first_name: params.firstName ?? 'خریدار',
      last_name: params.lastName ?? `آزمون ${params.id}`,
      phone: params.phone ?? '',
      city: 'تهران',
      address_1: 'خیابان آزمون',
    },
    line_items: params.lines.map((l, idx) => ({
      id: idx + 1,
      name: l.name ?? `قلم ${l.sku}`,
      sku: l.sku,
      quantity: l.quantity,
      price: l.price,
      total: l.quantity * l.price,
    })),
  };
}
