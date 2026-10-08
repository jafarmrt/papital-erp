import { orm } from '../../db/drizzle.js';
import { webhookSubscriptions, webhookDeliveries, users } from '../../db/schema.js';
import { eq, desc, count } from 'drizzle-orm';
import { logger } from '../../middleware/logger.js';
import { BaseDomainEvent } from './domainEvents.js';
import { assertSafeExternalUrl } from '../../lib/ssrfGuard.js';
import { isEnteredSecret } from '../../lib/secrets/maskedSecret.js';
import { resolveWebhookTimeoutMs, WEBHOOK_TIMEOUT_DEFAULT_MS } from '../../lib/events/webhookTimeout.js';
import { NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { assertHeadersReenteredForNewTarget, resolveMaskedHeaders } from './integrationSecrets.js';
import { encryptSecret } from '../../lib/secretBox.js';
import { openWebhookSubscription, sealHeaders, UNREADABLE_WEBHOOK_SECRET_MESSAGE, type OpenedWebhookSubscription } from './webhookSecretStorage.js';
import { assertActivatableEventPatterns, resolveEventPatterns } from './webhookEventPatterns.js';
import { IntegrationDeliveryService, webhookMaxAttempts, type DeliveryAttemptContext, type DeliveryAttemptOutcome } from './integrationDelivery.service.js';
import crypto from 'crypto';

export interface CreateWebhookSubDTO {
  name: string;
  targetUrl: string;
  secretKey?: string;
  eventPatterns?: string[];
  customHeaders?: Record<string, string>;
  isActive?: number;
  retryLimit?: number;
  timeoutMs?: number;
  /** legacy body field, read only when `timeoutMs` is missing */
  timeoutSeconds?: number;
}

/** v9.0.359 (TD-720): the entered timeout (`timeoutMs`, else legacy `timeoutSeconds`), refused outside 1-30 s */
function webhookTimeoutOf(data: Partial<CreateWebhookSubDTO>): number | undefined {
  const timeout = resolveWebhookTimeoutMs(data);
  if (!timeout.ok) throw new ValidationError(timeout.message, undefined, 'WEBHOOK_TIMEOUT_INVALID');
  return timeout.timeoutMs;
}

type WebhookSubscriptionRow = typeof webhookSubscriptions.$inferSelect;
/** v9.0.361 (TD-898): a subscription with its signing key and header values decrypted, for use inside the server only */
export type OpenWebhookSubscription = OpenedWebhookSubscription<WebhookSubscriptionRow>;

export class WebhookSubscriptionService {
  /**
   * Computes an HMAC-SHA256 hex digest signature for payload verification.
   */
  static calculateSignature(payloadString: string, secretKey: string): string {
    return crypto
      .createHmac('sha256', secretKey)
      .update(payloadString, 'utf8')
      .digest('hex');
  }

  /**
   * Generates a random cryptographic secret key (32 bytes hex).
   */
  static generateSecretKey(): string {
    return `whsec_${crypto.randomBytes(24).toString('hex')}`;
  }

  /**
   * Retrieves summary statistics for Webhook subscriptions and deliveries.
   */
  static async getStats() {
    try {
      const [subsCount] = await orm
        .select({ value: count() })
        .from(webhookSubscriptions);

      const [activeSubsCount] = await orm
        .select({ value: count() })
        .from(webhookSubscriptions)
        .where(eq(webhookSubscriptions.isActive, 1));

      const [delivCount] = await orm
        .select({ value: count() })
        .from(webhookDeliveries);

      const [successDelivCount] = await orm
        .select({ value: count() })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.status, 'success'));

      const totalSubs = Number(subsCount?.value) || 0;
      const activeSubs = Number(activeSubsCount?.value) || 0;
      const totalDeliveries = Number(delivCount?.value) || 0;
      const successfulDeliveries = Number(successDelivCount?.value) || 0;
      const successRate = totalDeliveries > 0 ? Math.round((successfulDeliveries / totalDeliveries) * 100) : 100;

      return {
        totalSubscriptions: totalSubs,
        activeSubscriptions: activeSubs,
        totalDeliveries,
        successfulDeliveries,
        failedDeliveries: totalDeliveries - successfulDeliveries,
        successRate
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[Webhook Stats Error] ${errMsg}`);
      return {
        totalSubscriptions: 0,
        activeSubscriptions: 0,
        totalDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        successRate: 100
      };
    }
  }

  /**
   * List all registered webhook subscriptions.
   */
  static async getSubscriptions(): Promise<OpenWebhookSubscription[]> {
    try {
      const rows = await orm
        .select()
        .from(webhookSubscriptions)
        .orderBy(desc(webhookSubscriptions.id));
      return rows.map(row => openWebhookSubscription(row));
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[Webhook Get Subscriptions Error] ${errMsg}`);
      return [];
    }
  }

  /**
   * Get single subscription by ID.
   */
  static async getSubscriptionById(id: number): Promise<OpenWebhookSubscription | null> {
    const records = await orm
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, id))
      .limit(1);

    return records[0] ? openWebhookSubscription(records[0]) : null;
  }

  /**
   * Create a new webhook subscription.
   */
  static async createSubscription(data: CreateWebhookSubDTO, userId?: number) {
    const targetUrl = data.targetUrl.trim();
    // Validate target URL against SSRF (SEC-010)
    await assertSafeExternalUrl(targetUrl, { allowLocalEcho: true });

    const timeoutMs = webhookTimeoutOf(data);
    const secretKey = isEnteredSecret(data.secretKey) ? data.secretKey.trim() : this.generateSecretKey();
    // v9.0.360 (TD-710): a masked header value of a new webhook has no stored value to stand for
    const customHeaders = resolveMaskedHeaders(data.customHeaders, {}, true);
    // v9.0.361 (TD-898, decision t7 a): the key and every header value are stored encrypted; without ERP_SECRETS_KEY 503
    const sealedKey = encryptSecret(secretKey);
    const sealedHeaders = sealHeaders(customHeaders);
    // v9.0.380 (TD-707): only «*» and the event types the server publishes; a dotted pattern used to match nothing
    const eventPatterns = resolveEventPatterns(data.eventPatterns);

    let validUserId: number | null = null;
    if (userId && typeof userId === 'number' && userId > 0) {
      try {
        const userExists = await orm.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
        if (userExists.length > 0) {
          validUserId = userId;
        }
      } catch {
        validUserId = null;
      }
    }

    const [inserted] = await orm
      .insert(webhookSubscriptions)
      .values({
        name: data.name.trim(),
        targetUrl: targetUrl,
        secretKey: sealedKey,
        eventPatterns: eventPatterns,
        customHeaders: sealedHeaders,
        isActive: data.isActive !== undefined ? data.isActive : 1,
        retryLimit: data.retryLimit || 3,
        timeoutMs: timeoutMs ?? WEBHOOK_TIMEOUT_DEFAULT_MS,
        totalDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        lastStatus: 'idle',
        createdBy: validUserId
      })
      .returning();

    logger.info(`[Webhook Subscriptions] Created subscription #${inserted.id} "${inserted.name}" for URL: ${inserted.targetUrl}`);
    return openWebhookSubscription(inserted);
  }

  /**
   * Update an existing webhook subscription.
   */
  static async updateSubscription(id: number, data: Partial<CreateWebhookSubDTO>) {
    const current = await this.getSubscriptionById(id);
    if (!current) {
      throw new Error(`اشتراک وب‌هوک با شناسه ${id} یافت نشد.`);
    }

    const timeoutMs = webhookTimeoutOf(data);
    const updateFields: Partial<typeof webhookSubscriptions.$inferInsert> = {
      updatedAt: new Date().toISOString()
    };

    if (data.name !== undefined) updateFields.name = data.name.trim();
    const sameTarget = data.targetUrl === undefined || data.targetUrl.trim() === current.targetUrl;
    if (data.targetUrl !== undefined) {
      const targetUrl = data.targetUrl.trim();
      await assertSafeExternalUrl(targetUrl, { allowLocalEcho: true });
      updateFields.targetUrl = targetUrl;
    }
    // v9.0.358 (TD-719): an empty or masked key («****…abcd», «********») keeps the stored key; the edit form used to send the
    // masked key back and every save replaced the real signing key with the mask
    if (isEnteredSecret(data.secretKey)) updateFields.secretKey = encryptSecret(data.secretKey.trim());
    if (data.eventPatterns !== undefined) updateFields.eventPatterns = resolveEventPatterns(data.eventPatterns);
    else if (data.isActive === 1 && current.isActive !== 1) assertActivatableEventPatterns(current.eventPatterns);
    // v9.0.360 (TD-710): responses mask header values, so «********» keeps the stored value, only for the stored address
    if (data.customHeaders !== undefined) updateFields.customHeaders = sealHeaders(resolveMaskedHeaders(data.customHeaders, current.customHeaders, sameTarget));
    else assertHeadersReenteredForNewTarget(current.customHeaders, sameTarget);
    if (data.isActive !== undefined) updateFields.isActive = data.isActive;
    if (data.retryLimit !== undefined) updateFields.retryLimit = data.retryLimit;
    if (timeoutMs !== undefined) updateFields.timeoutMs = timeoutMs;

    const [updated] = await orm
      .update(webhookSubscriptions)
      .set(updateFields)
      .where(eq(webhookSubscriptions.id, id))
      .returning();

    logger.info(`[Webhook Subscriptions] Updated subscription #${id} "${updated.name}"`);
    return openWebhookSubscription(updated);
  }

  /**
   * v9.0.360 (TD-710): a new server-made signing key; the route shows it once, every other answer masks it.
   */
  static async rotateSecret(id: number) {
    const [updated] = await orm
      .update(webhookSubscriptions)
      .set({ secretKey: encryptSecret(this.generateSecretKey()), updatedAt: new Date().toISOString() })
      .where(eq(webhookSubscriptions.id, id))
      .returning();
    if (!updated) throw new NotFoundError('اشتراک وب‌هوک یافت نشد.', undefined, 'WEBHOOK_NOT_FOUND');
    logger.info(`[Webhook Subscriptions] Rotated the signing key of subscription #${id}`);
    return openWebhookSubscription(updated);
  }

  /**
   * Toggle active state.
   */
  static async toggleSubscription(id: number) {
    const current = await this.getSubscriptionById(id);
    if (!current) {
      throw new Error(`اشتراک با شناسه ${id} یافت نشد.`);
    }

    const newActiveState = current.isActive === 1 ? 0 : 1;
    if (newActiveState === 1) assertActivatableEventPatterns(current.eventPatterns);
    const [updated] = await orm
      .update(webhookSubscriptions)
      .set({
        isActive: newActiveState,
        updatedAt: new Date().toISOString()
      })
      .where(eq(webhookSubscriptions.id, id))
      .returning();

    return openWebhookSubscription(updated);
  }

  /**
   * Delete subscription.
   */
  static async deleteSubscription(id: number) {
    await orm.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));
    logger.info(`[Webhook Subscriptions] Deleted subscription #${id}`);
    return { success: true };
  }

  /**
   * v9.0.378 (TD-705, decision t2 a): records one durable delivery row per matching active subscription and starts each
   * first attempt without waiting for it; the delivery worker retries a failed one and after the subscription's retry
   * limit moves it to the dead letter queue. An error here (reading subscriptions, writing rows) goes back to the outbox,
   * which runs this handler again; a row already recorded for the event is never sent twice. Before, deliveries were
   * fire-and-forget with in-memory timers and every error was swallowed, so the outbox always counted this handler done.
   */
  static async dispatchDomainEventToSubscribers(event: BaseDomainEvent): Promise<{ jobIds: number[]; attempts: Promise<unknown>[] }> {
    const subs = await orm
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.isActive, 1));

    const jobIds: number[] = [];
    const attempts: Promise<unknown>[] = [];
    for (const sub of subs) {
      if (!this.matchesPattern(event.eventType, sub.eventPatterns as string[])) continue;
      const job = await IntegrationDeliveryService.enqueue('webhook', sub.id, event, webhookMaxAttempts(sub.retryLimit));
      jobIds.push(job.id);
      attempts.push(IntegrationDeliveryService.runJob(job.id).catch(err => {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`[Webhook Dispatcher Error] First attempt of delivery job #${job.id} to subscription #${sub.id} failed to run: ${errMsg}`);
      }));
    }
    return { jobIds, attempts };
  }

  /**
   * v9.0.378 (TD-705): one attempt of a delivery row, with the subscription as it is now. Each attempt is one row in
   * `webhook_deliveries`; the delivery id (`X-ERP-Delivery-Id`) stays the same across the attempts of one row, so the
   * receiver can recognise a repeat. A deleted or inactive subscription closes the row; a key the server cannot decrypt
   * fails it at once.
   */
  static async deliverJobAttempt(subscriptionId: number, event: BaseDomainEvent, context: DeliveryAttemptContext): Promise<DeliveryAttemptOutcome> {
    const [row] = await orm.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, subscriptionId));
    if (!row) return { ok: false, cancelled: true, error: `اشتراک وب‌هوک #${subscriptionId} حذف شده است.` };
    if (row.isActive !== 1) return { ok: false, cancelled: true, error: `اشتراک وب‌هوک #${subscriptionId} غیرفعال است.` };
    return this.sendDelivery(openWebhookSubscription(row), event, context);
  }

  /** Sends one delivery to a subscriber with its signature and records the attempt */
  private static async sendDelivery(
    sub: OpenWebhookSubscription,
    event: BaseDomainEvent,
    context: DeliveryAttemptContext
  ): Promise<DeliveryAttemptOutcome> {
    const attempt = context.attempt;
    const startTime = Date.now();
    const deliveryId = `whd_${context.jobId}`;
    const nowIso = new Date().toISOString();

    const webhookBody = {
      deliveryId,
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt || nowIso,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload || {},
      metadata: event.metadata || {}
    };

    // v9.0.361 (TD-898): a key or header that the current ERP_SECRETS_KEY cannot decrypt is never sent (nor an empty-key
    // signature); the delivery is recorded as failed with the reason and not retried
    if (sub.unreadableSecrets.length > 0) {
      logger.error(`[Webhook Dispatcher] Subscription #${sub.id} skipped: ${sub.unreadableSecrets.join(', ')} cannot be decrypted with the current ERP_SECRETS_KEY`);
      await this.recordDelivery(sub, event, { nowIso, statusCode: 0, status: 'failed', responseText: '', errorMessage: UNREADABLE_WEBHOOK_SECRET_MESSAGE, signature: '', attempt, durationMs: 0 });
      return { ok: false, retryable: false, error: UNREADABLE_WEBHOOK_SECRET_MESSAGE };
    }

    const payloadString = JSON.stringify(webhookBody);
    const signature = this.calculateSignature(payloadString, sub.secretKey);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'ERP-Webhook-Dispatcher/7.0',
      'X-ERP-Delivery-Id': deliveryId,
      'X-ERP-Event-Type': event.eventType,
      'X-ERP-Signature-256': signature,
      'X-ERP-Timestamp': nowIso,
      ...(sub.customHeaders as Record<string, string> || {})
    };

    let statusCode = 0;
    let status: 'success' | 'failed' | 'timeout' = 'failed';
    let responseText = '';
    let errorMessage = '';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), sub.timeoutMs || 5000);

    try {
      // Validate target URL against SSRF before making network dispatch (SEC-010)
      await assertSafeExternalUrl(sub.targetUrl, { allowLocalEcho: true });

      // In development or preview, targetUrl might be local or mock endpoint
      // V3.0.7 (TD-057): redirect: 'manual' — دنبال‌کردن خودکار redirect می‌توانست
      // پس از تأیید URL عمومی، درخواست را به مقصد خصوصی (مثلاً 169.254.169.254)
      // بفرستد و گارد SSRF را دور بزند.
      const response = await fetch(sub.targetUrl, {
        method: 'POST',
        headers,
        body: payloadString,
        signal: controller.signal,
        redirect: 'manual'
      });

      statusCode = response.status;
      responseText = (await response.text()).substring(0, 500);

      if (response.status >= 300 && response.status < 400) {
        status = 'failed';
        errorMessage = `Redirect responses are not followed (SSRF protection) — HTTP ${statusCode}`;
      } else if (response.ok) {
        status = 'success';
      } else {
        status = 'failed';
        errorMessage = `HTTP Status: ${statusCode}`;
      }
    } catch (fetchErr: unknown) {
      const errObj = fetchErr as { name?: string; message?: string };
      if (errObj.name === 'AbortError') {
        status = 'timeout';
        errorMessage = `Timeout after ${sub.timeoutMs || 5000}ms`;
      } else {
        status = 'failed';
        errorMessage = errObj.message || 'خطا در برقراری ارتباط با وب‌هوک مقصد';
      }
    } finally {
      clearTimeout(timeout);
    }

    const durationMs = Date.now() - startTime;
    await this.recordDelivery(sub, event, { nowIso, statusCode, status, responseText, errorMessage, signature, attempt, durationMs });
    return status === 'success' ? { ok: true } : { ok: false, error: errorMessage || status };
  }

  /**
   * Delivery log row and the subscription's counters. v9.0.379 (TD-718): the counters are read under the subscription's
   * row lock, taken before the delivery row's foreign-key lock, and written in the transaction of the delivery row, so
   * concurrent deliveries are all counted (they were written from the row read before the request).
   */
  private static async recordDelivery(
    sub: OpenWebhookSubscription,
    event: BaseDomainEvent,
    d: {
      nowIso: string; statusCode: number; status: 'success' | 'failed' | 'timeout';
      responseText: string; errorMessage: string; signature: string; attempt: number; durationMs: number;
    }
  ): Promise<void> {
    await orm.transaction(async (tx) => {
      const [counters] = await tx
        .select({
          totalDeliveries: webhookSubscriptions.totalDeliveries,
          successfulDeliveries: webhookSubscriptions.successfulDeliveries,
          failedDeliveries: webhookSubscriptions.failedDeliveries,
        })
        .from(webhookSubscriptions)
        .where(eq(webhookSubscriptions.id, sub.id))
        .for('update');
      if (!counters) return; // deleted meanwhile: its delivery rows go with it

      await tx.insert(webhookDeliveries).values({
        subscriptionId: sub.id,
        subscriptionName: sub.name,
        eventId: event.eventId,
        eventType: event.eventType,
        targetUrl: sub.targetUrl,
        statusCode: d.statusCode,
        status: d.status,
        responseBody: d.responseText,
        errorMessage: d.errorMessage,
        signature: d.signature,
        attempt: d.attempt,
        durationMs: d.durationMs,
        createdAt: d.nowIso
      });

      const isSuccess = d.status === 'success';
      await tx
        .update(webhookSubscriptions)
        .set({
          totalDeliveries: (counters.totalDeliveries || 0) + 1,
          successfulDeliveries: (counters.successfulDeliveries || 0) + (isSuccess ? 1 : 0),
          failedDeliveries: (counters.failedDeliveries || 0) + (isSuccess ? 0 : 1),
          lastDeliveryAt: d.nowIso,
          lastStatus: d.status,
          lastError: isSuccess ? '' : d.errorMessage
        })
        .where(eq(webhookSubscriptions.id, sub.id));
    });
  }

  /**
   * Pattern matcher for event subscriptions: '*', an exact event type, or a dotted prefix ('woocommerce.*'). Stored patterns
   * are «*» or published event types since v9.0.380 (TD-707).
   */
  public static matchesPattern(eventType: string, patterns: string[] = ['*']): boolean {
    if (!patterns || patterns.length === 0 || patterns.includes('*')) return true;

    for (const pattern of patterns) {
      if (pattern === eventType) return true;
      if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2);
        if (eventType.startsWith(`${prefix}.`)) return true;
      }
    }

    return false;
  }

  /**
   * Immediate Ping Test of a webhook target URL.
   */
  static async pingTest(targetUrl: string, secretKey: string, customHeaders?: Record<string, string>) {
    const startTime = Date.now();
    const deliveryId = `ping_${Date.now()}`;
    const nowIso = new Date().toISOString();

    const pingPayload = {
      event: 'system.ping',
      deliveryId,
      timestamp: nowIso,
      message: 'تست اتصال و اعتبارسنجی امضای امنیتی وب‌هوک ERP سامانه کارگاهی'
    };

    const payloadString = JSON.stringify(pingPayload);
    const signature = this.calculateSignature(payloadString, secretKey);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'ERP-Webhook-Tester/7.0',
      'X-ERP-Delivery-Id': deliveryId,
      'X-ERP-Event-Type': 'system.ping',
      'X-ERP-Signature-256': signature,
      'X-ERP-Timestamp': nowIso,
      ...(customHeaders || {})
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      // Validate target URL against SSRF before making ping test (SEC-010)
      await assertSafeExternalUrl(targetUrl, { allowLocalEcho: true });

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: payloadString,
        signal: controller.signal,
        // v9.0.356 (TD-704): like a real delivery, a redirect is never followed, so the guard above cannot be bypassed by a 302
        redirect: 'manual'
      });

      const durationMs = Date.now() - startTime;
      if (response.status >= 300 && response.status < 400) {
        return {
          success: false,
          statusCode: response.status,
          durationMs,
          signature,
          responseBody: '',
          message: `نشانی مقصد با کد ${response.status} به نشانی دیگری ارجاع داد؛ ارجاع برای امنیت دنبال نمی‌شود و نشانی نهایی را مستقیم وارد کنید.`
        };
      }
      const responseText = await response.text();

      return {
        success: response.ok,
        statusCode: response.status,
        durationMs,
        signature,
        responseBody: responseText.substring(0, 500),
        message: response.ok
          ? `پاسخ دریافت شد (${response.status} OK) در ${durationMs} میلی‌ثانیه`
          : `خطای کد پاسخ سرور مقصد: ${response.status}`
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const errObj = err as { name?: string; message?: string };
      return {
        success: false,
        statusCode: 0,
        durationMs,
        signature,
        responseBody: '',
        message: errObj.name === 'AbortError' ? 'مهلت ارسال درخواست به پایان رسید (Timeout 6s)' : (errObj.message || String(err))
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fetch recent delivery logs.
   */
  static async getDeliveries(options: { subscriptionId?: number; limit?: number; offset?: number } = {}) {
    try {
      const limit = Math.min(options.limit || 50, 100);
      const offset = options.offset || 0;

      const whereClause = options.subscriptionId
        ? eq(webhookDeliveries.subscriptionId, options.subscriptionId)
        : undefined;

      const [totalCount] = await orm
        .select({ value: count() })
        .from(webhookDeliveries)
        .where(whereClause);

      const items = await orm
        .select()
        .from(webhookDeliveries)
        .where(whereClause)
        .orderBy(desc(webhookDeliveries.id))
        .limit(limit)
        .offset(offset);

      return {
        data: items,
        total: Number(totalCount?.value) || 0,
        limit,
        offset
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[Webhook Deliveries Get Error] ${errMsg}`);
      return { data: [], total: 0, limit: 50, offset: 0 };
    }
  }
}
