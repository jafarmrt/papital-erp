// @vitest-environment node
/**
 * v10.2.0: the WooCommerce order webhook answers the shop, outside the application. When the database could not be
 * reached, or an order failed on a database error, its 200 answer carried the error text itself (SQL, constraint
 * names). A failure now answers only the general message with its status; a success is unchanged.
 */
import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SQL_TEXT = 'Failed query: select "key", "value" from "app_settings" where "app_settings"."key" = $1 -- connection refused';
const CONSTRAINT_TEXT = 'duplicate key value violates unique constraint "uq_documents_ref_type_year"';
const SECRET = 'wc-secret-v1020';

const state = vi.hoisted(() => ({ settingsFail: true, secret: 'wc-secret-v1020', handleOrder: vi.fn() }));

vi.mock('../../db/drizzle.js', () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => (state.settingsFail ? Promise.reject(new Error(SQL_TEXT)) : Promise.resolve(state.secret ? [{ key: 'wc_webhook_secret', value: state.secret }] : [])),
  };
  return { orm: { select: () => chain } };
});
vi.mock('../../services/settings/settingSecrets.js', () => ({ openSettingSecret: (_key: string, value?: string) => value ?? '' }));
vi.mock('../../services/woocommerce/wooOrderSync.service.js', () => ({ WooOrderSyncService: { handleOrder: state.handleOrder } }));

import express from 'express';
import request from 'supertest';
import wooRouter from '../../routes/woocommerce.routes';
import { WOO_WEBHOOK_FAILED_MESSAGE } from '../../lib/woocommerce/wooWebhookAnswer';
import { errorHandler } from '../../middleware/logger';

function app() {
  const server = express();
  server.use(express.json({ verify: (req, _res, buf) => { (req as unknown as { rawBody: Buffer }).rawBody = buf; } }));
  server.use('/api/woocommerce', wooRouter);
  server.use(errorHandler);
  return server;
}

const order = { id: 501, number: '501', status: 'processing', line_items: [] };

async function postOrder(signature: string | null = 'valid') {
  const raw = JSON.stringify(order);
  const sent = request(app()).post('/api/woocommerce/webhook/order')
    .set('Content-Type', 'application/json')
    .set('X-WC-Webhook-Topic', 'order.updated');
  if (signature !== null) sent.set('X-WC-Webhook-Signature', signature === 'valid' ? crypto.createHmac('sha256', SECRET).update(raw).digest('base64') : signature);
  return sent.send(raw);
}

describe('woo_webhook_answer_v10_2_0', () => {
  beforeEach(() => { state.handleOrder.mockReset(); state.secret = SECRET; });

  it('a database that cannot be reached answers 200 with the general message, never the SQL text', async () => {
    state.settingsFail = true;
    const res = await postOrder();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, status: 'failed', message: WOO_WEBHOOK_FAILED_MESSAGE, error: WOO_WEBHOOK_FAILED_MESSAGE });
    expect(JSON.stringify(res.body)).not.toContain('app_settings');
  });

  it('a failed order answers only the general message and its status', async () => {
    state.settingsFail = false;
    state.handleOrder.mockResolvedValue({ success: false, status: 'failed', message: `failed: ${CONSTRAINT_TEXT}`, error: `failed: ${CONSTRAINT_TEXT}` });
    const res = await postOrder();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, status: 'failed', message: WOO_WEBHOOK_FAILED_MESSAGE, error: WOO_WEBHOOK_FAILED_MESSAGE });
    expect(JSON.stringify(res.body)).not.toContain('uq_documents');
  });

  it('a processed order keeps its answer', async () => {
    state.settingsFail = false;
    const processed = { success: true, status: 'processed', docId: 77, refNumber: '1405-77', message: 'ok' };
    state.handleOrder.mockResolvedValue(processed);
    const res = await postOrder();
    expect(res.status).toBe(200);
    expect(res.body).toEqual(processed);
  });

  it('a missing or wrong signature and a shop without a secret keep their 401 / 403, never the 200 of a failure (10.3 package 3)', async () => {
    state.settingsFail = false;
    const missing = await postOrder(null);
    expect([missing.status, missing.body.code, missing.body.success]).toEqual([401, 'WC_WEBHOOK_SIGNATURE_MISSING', false]);
    const wrong = await postOrder('bm90LXRoZS1zaWduYXR1cmU=');
    expect([wrong.status, wrong.body.code]).toEqual([401, 'WC_WEBHOOK_SIGNATURE_INVALID']);
    state.secret = '';
    const unset = await postOrder(null);
    expect([unset.status, unset.body.code]).toEqual([403, 'WC_WEBHOOK_SECRET_NOT_SET']);
    expect(state.handleOrder).not.toHaveBeenCalled();
  });
});
