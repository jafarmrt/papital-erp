import crypto from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { appSettings, documents, woocommerceOrderLogs } from '../../db/schema.js';
import { WooOrderSyncService, type WcOrderPayload } from '../../services/woocommerce/wooOrderSync.service.js';
import { createTestItem } from '../fixtures/factories.js';
import { wooOrder, wooOrderId } from './wooScenarios.js';

async function logOf(wcOrderId: string) {
  const [log] = await orm.select().from(woocommerceOrderLogs).where(eq(woocommerceOrderLogs.wcOrderId, wcOrderId));
  return log;
}

async function invoiceActive(docId: number | undefined): Promise<boolean> {
  if (!docId) return false;
  const [doc] = await orm.select({ isDeleted: documents.isDeleted }).from(documents).where(eq(documents.id, docId));
  return doc?.isDeleted === 0;
}

/** وب‌هوک امضاشده با موضوع order.deleted، همان مسیری که ووکامرس صدا می‌زند */
async function sendDeletedWebhook(wcOrderId: string): Promise<{ status: number; body: { status?: string } }> {
  const secret = `wc_secret_${wcOrderId}`;
  const previous = await orm.select().from(appSettings).where(eq(appSettings.key, 'wc_webhook_secret'));
  await orm.insert(appSettings).values({ key: 'wc_webhook_secret', value: secret })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: secret } });
  try {
    const request = (await import('supertest')).default;
    const { getTestApp } = await import('../fixtures/httpTestHelper.js');
    const body = JSON.stringify({ id: Number(wcOrderId) });
    const signature = crypto.createHmac('sha256', secret).update(body).digest('base64');
    const res = await request(await getTestApp()).post('/api/woocommerce/webhook/order')
      .set('Content-Type', 'application/json').set('x-wc-webhook-topic', 'order.deleted').set('x-wc-webhook-signature', signature).send(body);
    return { status: res.status, body: res.body as { status?: string } };
  } finally {
    await orm.delete(appSettings).where(inArray(appSettings.key, ['wc_webhook_secret']));
    for (const row of previous) await orm.insert(appSettings).values({ key: row.key, value: row.value });
  }
}

/**
 * TD-407: سفارش فاکتورشده‌ای که در ووکامرس به سطل زباله برود (وب‌هوک order.deleted با بدنه { id }، یا همگام‌سازی دستی با وضعیت
 * trash) «نیازمند بررسی» می‌شود، فاکتور فعال می‌ماند و بدنه کامل پیشین سفارش بازنویسی نمی‌شود؛ سفارش بی‌فاکتور «لغوشده» می‌شود.
 */
export async function checkWooDeletedOrderFlagged(): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ code: `WC_TRASH_${wooOrderId()}`, stocks: { '': 10 } });

  const viaWebhook = wooOrderId();
  const first = await WooOrderSyncService.handleOrder(wooOrder(viaWebhook, 'processing', item.code, 2, 2000));
  if (first.status !== 'processed') problems.push(`the first invoice was not issued: ${first.status} ${first.message.slice(0, 120)}`);
  const hook = await sendDeletedWebhook(viaWebhook);
  const hookLog = await logOf(viaWebhook);
  if (hook.status !== 200 || hook.body.status !== 'needs_review') problems.push(`order.deleted webhook: ${hook.status} / ${hook.body.status}, expected 200 / needs_review`);
  if (hookLog?.status !== 'needs_review' || !String(hookLog.errorMessage || '').includes('حذف شد')) {
    problems.push(`log after delete: ${hookLog?.status} / ${String(hookLog?.errorMessage || '').slice(0, 120)}`);
  }
  if (hookLog?.erpDocumentId !== first.docId || !(await invoiceActive(first.docId))) problems.push('the invoice of a deleted order must stay active and linked to the log');
  if (!Array.isArray((hookLog?.payload as WcOrderPayload | null)?.line_items)) problems.push('the full order payload was overwritten by the { id } body of the delete webhook');

  const viaSync = wooOrderId();
  const synced = await WooOrderSyncService.handleOrder(wooOrder(viaSync, 'completed', item.code, 1, 1000));
  const trashed = await WooOrderSyncService.handleOrder(wooOrder(viaSync, 'trash', item.code, 1, 1000));
  if (trashed.status !== 'needs_review' || trashed.docId !== synced.docId || !(await invoiceActive(synced.docId))) {
    problems.push(`trash status: ${trashed.status} / ${trashed.docId}, expected needs_review with the same active invoice`);
  }

  const unpaid = wooOrderId();
  await WooOrderSyncService.handleOrder(wooOrder(unpaid, 'pending', item.code, 1, 1000));
  const unpaidDeleted = await WooOrderSyncService.handleOrder({ id: unpaid }, 'order.deleted');
  const unpaidLog = await logOf(unpaid);
  if (unpaidDeleted.status !== 'cancelled' || unpaidLog?.status !== 'cancelled' || unpaidLog.erpDocumentId) {
    problems.push(`deleted unpaid order: ${unpaidDeleted.status} / log ${unpaidLog?.status}, expected cancelled with no invoice`);
  }
  return problems;
}

/** آزمون‌های سخت‌گیرانه TD-407 در جدول سوئیت business_invariants: [شناسه، نام، بررسی، شرح موفقیت] */
export const WOO_DELETED_ORDER_CHECKS: Array<[string, string, (wh: string) => Promise<string[]>, string]> = [
  ['inv_td_407_woo_deleted_order_flagged', 'v8.0.126: an invoiced order deleted in WooCommerce (order.deleted webhook or trash status) becomes "needs review" and the invoice stays active (TD-407)',
    () => checkWooDeletedOrderFlagged(), 'delete webhook and trash status both needs_review with an active invoice; the previous payload kept; the unpaid order became cancelled'],
];
