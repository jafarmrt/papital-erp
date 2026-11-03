import type { Request } from 'express';
import { and, asc, desc, eq, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { storefrontOrders, storefrontSmsMessages } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';
import { logger } from '../../middleware/logger.js';
import { normalizeMobile } from '../../lib/storefront/storefrontOrderRules.js';
import {
  SMS_KIND_PARAMS, SMS_KIND_TITLES, isSmsKind, maskedMobile, smsParamValue,
  type OrderSmsKind, type SmsKind, type SmsMessageStatus, type SmsParams,
} from '../../lib/storefront/storefrontSmsRules.js';
import type { SmsMessagePage, SmsTestResult } from '../../lib/storefront/storefrontSmsContracts.js';
import { sendTemplateSms, type SmsSendResult } from './storefrontSmsClient.js';
import { activeTemplate, smsRuntimeSettings, type SmsRuntimeSettings } from './storefrontSmsSettings.service.js';

/**
 * v11 phase 8.4a (start plan §3): the site's text messages to buyers.
 * - An order message is queued in the same transaction as the order's change (`queueOrderSms`), so a rolled-back change
 *   sends nothing and a committed one is never forgotten; nothing is queued while sending is off or the kind has no
 *   template. The minute sender (`StorefrontSmsWorker`) claims due rows with `FOR UPDATE SKIP LOCKED`, marks them
 *   `sending` and sends each after the claim committed, then records `sent` or the provider's error. A failure that may
 *   pass (no answer, 429, 5xx) is tried again later, at most `SMS_ATTEMPTS_MAX` times; any other is `failed` at once.
 *   A row left `sending` by a stopped server is closed as `failed` («نامعلوم») rather than sent twice.
 * - A message carries an order number and a tracking code only, never an amount or a name (AGENTS.md §3.11).
 * - Nothing runs at boot (§9.2); the sender does nothing while sending is off.
 */
export const SMS_ATTEMPTS_MAX = 5;
export const SMS_SEND_BATCH = 20;
export const SMS_SEND_INTERVAL_MS = 30_000;
const SMS_STALE_SENDING_MINUTES = 10;
const SMS_RETRY_MINUTES = [1, 5, 15, 60];

/** The values of an order message: the order number and, when it has one, the post's tracking code */
export function orderSmsParams(kind: OrderSmsKind, order: { orderNumber: string; trackingCode: string }): SmsParams {
  const params: SmsParams = { ORDER: order.orderNumber };
  if (SMS_KIND_PARAMS[kind].includes('TRACKING')) params.TRACKING = smsParamValue(order.trackingCode) || '-';
  return params;
}

/**
 * Queues one message to an order's buyer inside the order change's own transaction. Returns whether a row was written
 * (false while sending is off, or this kind has no template). A shipped order without a tracking code still gets its
 * message, with «-» in the template's place.
 */
export async function queueOrderSms(
  tx: DbExecutor,
  order: { id: number; orderNumber: string; phone: string; phoneKey: string; trackingCode: string },
  kind: OrderSmsKind,
): Promise<boolean> {
  const settings = await smsRuntimeSettings(tx);
  if (!activeTemplate(settings, kind)) return false;
  const phone = normalizeMobile(order.phone);
  if (!phone) return false;
  await tx.insert(storefrontSmsMessages).values({
    kind, phone, phoneKey: order.phoneKey || phoneMatchKey(phone), orderId: order.id, params: JSON.stringify(orderSmsParams(kind, order)),
    status: 'queued', provider: settings.provider,
  });
  return true;
}

/** Sends one message row now with the current settings and records the outcome on the row */
export async function deliverMessage(
  row: { id: number; kind: string; phone: string; params: string; attempts: number },
  settings: SmsRuntimeSettings,
  values?: SmsParams,
): Promise<SmsSendResult> {
  const kind = isSmsKind(row.kind) ? row.kind : null;
  const template = kind ? activeTemplate(settings, kind) : null;
  if (!kind || !template || !settings.apiKey) {
    const reason = !settings.enabled ? 'پیامک سایت خاموش شد' : !settings.apiKey ? 'کلید سرویس پیامک خوانده نمی‌شود' : 'الگوی این پیامک برداشته شد';
    await orm.update(storefrontSmsMessages).set({ status: 'skipped', error: reason, updatedAt: systemNowUtcIso() })
      .where(eq(storefrontSmsMessages.id, row.id));
    return { ok: false, status: 0, messageId: '', error: reason, retryable: false };
  }
  let params: SmsParams = values ?? {};
  if (!values) {
    try {
      params = JSON.parse(row.params) as SmsParams;
    } catch {
      params = {};
    }
  }
  const result = await sendTemplateSms({ provider: settings.provider, apiKey: settings.apiKey, template, kind, phone: row.phone, params });
  const now = systemNowUtcIso();
  if (result.ok) {
    await orm.update(storefrontSmsMessages).set({
      status: 'sent', sentAt: now, updatedAt: now, provider: settings.provider, providerMessageId: result.messageId.slice(0, 80), error: '',
    }).where(eq(storefrontSmsMessages.id, row.id));
  } else {
    const again = result.retryable && row.attempts < SMS_ATTEMPTS_MAX && kind !== 'otp';
    const waitMinutes = SMS_RETRY_MINUTES[Math.min(row.attempts, SMS_RETRY_MINUTES.length) - 1] ?? 60;
    await orm.update(storefrontSmsMessages).set({
      status: again ? 'queued' : 'failed', updatedAt: now, provider: settings.provider, error: result.error.slice(0, 300),
      ...(again ? { nextAttemptAt: sql`now() + make_interval(mins => ${waitMinutes})` } : {}),
    }).where(eq(storefrontSmsMessages.id, row.id));
  }
  return result;
}

/** One pass of the sender: close stale `sending` rows, claim due ones, send them */
export async function sendDueMessagesOnce(): Promise<{ sent: number; failed: number }> {
  const settings = await smsRuntimeSettings(orm);
  if (!settings.enabled) return { sent: 0, failed: 0 };
  // a row a stopped server left `sending` may or may not have reached the buyer; it is closed, never sent twice
  await orm.update(storefrontSmsMessages).set({ status: 'failed', error: 'وضعیت ارسال نامعلوم است (سرور میان ارسال بازایستاد)', updatedAt: systemNowUtcIso() })
    .where(and(eq(storefrontSmsMessages.status, 'sending'), sql`${storefrontSmsMessages.updatedAt} < now() - make_interval(mins => ${SMS_STALE_SENDING_MINUTES})`));
  const claimed = await orm.transaction(async (tx) => {
    const due = await tx.select({ id: storefrontSmsMessages.id }).from(storefrontSmsMessages)
      .where(and(eq(storefrontSmsMessages.status, 'queued'), lte(storefrontSmsMessages.nextAttemptAt, sql`now()`)))
      .orderBy(asc(storefrontSmsMessages.nextAttemptAt), asc(storefrontSmsMessages.id)).limit(SMS_SEND_BATCH).for('update', { skipLocked: true });
    if (due.length === 0) return [];
    return tx.update(storefrontSmsMessages).set({
      status: 'sending', attempts: sql`${storefrontSmsMessages.attempts} + 1`, updatedAt: systemNowUtcIso(),
    }).where(inArray(storefrontSmsMessages.id, due.map(d => d.id))).returning({
      id: storefrontSmsMessages.id, kind: storefrontSmsMessages.kind, phone: storefrontSmsMessages.phone,
      params: storefrontSmsMessages.params, attempts: storefrontSmsMessages.attempts,
    });
  });
  let sent = 0;
  let failed = 0;
  for (const row of claimed.sort((a, b) => a.id - b.id)) {
    try {
      const result = await deliverMessage(row, settings);
      if (result.ok) sent++;
      else failed++;
    } catch (err) {
      failed++;
      logger.warn({ message: `[Storefront] SMS ${row.id} could not be recorded`, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { sent, failed };
}

/** The sender `server.ts` starts and stops; a pass still running skips the next tick */
export class StorefrontSmsWorker {
  private static timer: ReturnType<typeof setInterval> | null = null;
  private static running = false;

  static start(intervalMs: number = SMS_SEND_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      void sendDueMessagesOnce()
        .then(({ sent, failed }) => {
          if (sent || failed) logger.info(`[Storefront] SMS sender: ${sent} sent, ${failed} not sent`);
        })
        .catch(err => logger.warn({ message: '[Storefront] SMS sender failed', error: err instanceof Error ? err.message : String(err) }))
        .finally(() => { this.running = false; });
    }, intervalMs);
    this.timer.unref?.();
  }

  static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

const SAMPLE_PARAMS: SmsParams = { CODE: '12345', ORDER: '100001', TRACKING: '123456789012345678' };

/**
 * A test of one kind's template to a number the colleague types, with sample values (code 12345, order 100001). It is a
 * real message, logged as a test with an audit row; it works while sending is still off, so the owner can check every
 * template before turning the site's messages on.
 */
export async function sendTestSms(req: Request, input: { phone: string; kind: SmsKind }): Promise<SmsTestResult> {
  const phone = normalizeMobile(input.phone);
  if (!phone) throw new ValidationError('شمارهٔ همراه را درست بنویسید (مانند ۰۹۱۲۱۲۳۴۵۶۷).', { field: 'phone' }, 'STOREFRONT_SMS_PHONE_INVALID');
  if (!isSmsKind(input.kind)) throw new ValidationError('نوع پیامک شناخته نیست.', { field: 'kind' }, 'STOREFRONT_SMS_KIND_INVALID');
  const stored = await smsRuntimeSettings(orm);
  if (!stored.apiKey) throw new ValidationError(stored.apiKey === null ? 'کلید ذخیره‌شدهٔ سرویس پیامک با کلید رمزنگاری کنونی سرور باز نمی‌شود؛ آن را دوباره وارد کنید.' : 'اول کلید سرویس پیامک را وارد و ذخیره کنید.', { field: 'apiKey' }, 'STOREFRONT_SMS_NEEDS_KEY');
  if (!stored.templates[input.kind]) throw new ValidationError(`برای «${SMS_KIND_TITLES[input.kind]}» الگویی ذخیره نشده است.`, { field: `templates.${input.kind}` }, 'STOREFRONT_SMS_NEEDS_TEMPLATE');
  // the test sends even while the site's messages are off
  const settings: SmsRuntimeSettings = { ...stored, enabled: true };
  const params = Object.fromEntries(SMS_KIND_PARAMS[input.kind].map(name => [name, SAMPLE_PARAMS[name]])) as SmsParams;
  const row = await orm.transaction(async (tx) => {
    const [created] = await tx.insert(storefrontSmsMessages).values({
      kind: input.kind, phone, phoneKey: phoneMatchKey(phone), params: input.kind === 'otp' ? '{}' : JSON.stringify(params),
      isTest: 1, status: 'sending', attempts: 1, provider: settings.provider,
    }).returning();
    await logActivity({
      req, tx, action: 'CREATE', entity: 'فروشگاه سایت', entityId: `sms-${created.id}`,
      description: `پیامک آزمایشی «${SMS_KIND_TITLES[input.kind]}» به ${maskedMobile(phone)} فرستاده شد`,
      details: { kind: input.kind, provider: settings.provider, phone: maskedMobile(phone) },
    });
    return created;
  });
  const result = await deliverMessage(row, settings, params);
  return { sent: result.ok, error: result.ok ? '' : result.error || 'سرویس پیامک پاسخ نداد.' };
}

export const SMS_LOG_PAGE_MAX = 100;

export async function listSmsMessages(query: { page: number; limit: number; status: SmsMessageStatus | ''; orderNumber: string }): Promise<SmsMessagePage> {
  const page = Math.max(1, query.page);
  const limit = Math.min(SMS_LOG_PAGE_MAX, Math.max(1, query.limit));
  const conditions: SQL[] = [];
  if (query.status) conditions.push(eq(storefrontSmsMessages.status, query.status));
  if (query.orderNumber) conditions.push(eq(storefrontOrders.orderNumber, query.orderNumber));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await orm.select({ total: sql<number>`count(*)::int` }).from(storefrontSmsMessages)
    .leftJoin(storefrontOrders, eq(storefrontOrders.id, storefrontSmsMessages.orderId)).where(where);
  const rows = await orm.select({
    id: storefrontSmsMessages.id, kind: storefrontSmsMessages.kind, phone: storefrontSmsMessages.phone, orderNumber: storefrontOrders.orderNumber,
    status: storefrontSmsMessages.status, attempts: storefrontSmsMessages.attempts, isTest: storefrontSmsMessages.isTest,
    error: storefrontSmsMessages.error, createdAt: storefrontSmsMessages.createdAt, sentAt: storefrontSmsMessages.sentAt,
  }).from(storefrontSmsMessages).leftJoin(storefrontOrders, eq(storefrontOrders.id, storefrontSmsMessages.orderId)).where(where)
    .orderBy(desc(storefrontSmsMessages.createdAt), desc(storefrontSmsMessages.id)).limit(limit).offset((page - 1) * limit);
  return {
    // kind and status are held to their lists by the table's CHECK constraints
    data: rows.map(r => ({
      id: r.id, kind: r.kind as SmsKind, phone: maskedMobile(r.phone), orderNumber: r.orderNumber ?? null, status: r.status as SmsMessageStatus,
      attempts: r.attempts, isTest: r.isTest === 1, error: r.error, createdAt: r.createdAt, sentAt: r.sentAt,
    })),
    total, page, limit,
  };
}
