import { orm } from '../../db/drizzle.js';
import { webhookSubscriptions, webhookDeliveries, users } from '../../db/schema.js';
import { eq, and, sql, desc, count } from 'drizzle-orm';
import { logger } from '../../middleware/logger.js';
import { BaseDomainEvent } from './domainEvents.js';
import { assertSafeExternalUrl } from '../../lib/ssrfGuard.js';
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
}

export class WebhookSubscriptionService {
  /**
   * Alias method for backwards compatibility
   */
  static async dispatchToSubscribers(event: BaseDomainEvent): Promise<void> {
    return this.dispatchDomainEventToSubscribers(event);
  }

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
  static async getSubscriptions() {
    try {
      return await orm
        .select()
        .from(webhookSubscriptions)
        .orderBy(desc(webhookSubscriptions.id));
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[Webhook Get Subscriptions Error] ${errMsg}`);
      return [];
    }
  }

  /**
   * Get single subscription by ID.
   */
  static async getSubscriptionById(id: number) {
    const records = await orm
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, id))
      .limit(1);

    return records[0] || null;
  }

  /**
   * Create a new webhook subscription.
   */
  static async createSubscription(data: CreateWebhookSubDTO, userId?: number) {
    const targetUrl = data.targetUrl.trim();
    // Validate target URL against SSRF (SEC-010)
    await assertSafeExternalUrl(targetUrl, { allowLocalEcho: true });

    const secretKey = data.secretKey?.trim() || this.generateSecretKey();
    const eventPatterns = data.eventPatterns && data.eventPatterns.length > 0 ? data.eventPatterns : ['*'];

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
        secretKey: secretKey,
        eventPatterns: eventPatterns,
        customHeaders: data.customHeaders || {},
        isActive: data.isActive !== undefined ? data.isActive : 1,
        retryLimit: data.retryLimit || 3,
        timeoutMs: data.timeoutMs || 5000,
        totalDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        lastStatus: 'idle',
        createdBy: validUserId
      })
      .returning();

    logger.info(`[Webhook Subscriptions] Created subscription #${inserted.id} "${inserted.name}" for URL: ${inserted.targetUrl}`);
    return inserted;
  }

  /**
   * Update an existing webhook subscription.
   */
  static async updateSubscription(id: number, data: Partial<CreateWebhookSubDTO>) {
    const current = await this.getSubscriptionById(id);
    if (!current) {
      throw new Error(`اشتراک وب‌هوک با شناسه ${id} یافت نشد.`);
    }

    const updateFields: Partial<typeof webhookSubscriptions.$inferInsert> = {
      updatedAt: new Date().toISOString()
    };

    if (data.name !== undefined) updateFields.name = data.name.trim();
    if (data.targetUrl !== undefined) {
      const targetUrl = data.targetUrl.trim();
      await assertSafeExternalUrl(targetUrl, { allowLocalEcho: true });
      updateFields.targetUrl = targetUrl;
    }
    if (data.secretKey !== undefined && data.secretKey.trim() !== '') updateFields.secretKey = data.secretKey.trim();
    if (data.eventPatterns !== undefined) updateFields.eventPatterns = data.eventPatterns;
    if (data.customHeaders !== undefined) updateFields.customHeaders = data.customHeaders;
    if (data.isActive !== undefined) updateFields.isActive = data.isActive;
    if (data.retryLimit !== undefined) updateFields.retryLimit = data.retryLimit;
    if (data.timeoutMs !== undefined) updateFields.timeoutMs = data.timeoutMs;

    const [updated] = await orm
      .update(webhookSubscriptions)
      .set(updateFields)
      .where(eq(webhookSubscriptions.id, id))
      .returning();

    logger.info(`[Webhook Subscriptions] Updated subscription #${id} "${updated.name}"`);
    return updated;
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
    const [updated] = await orm
      .update(webhookSubscriptions)
      .set({
        isActive: newActiveState,
        updatedAt: new Date().toISOString()
      })
      .where(eq(webhookSubscriptions.id, id))
      .returning();

    return updated;
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
   * Dispatches a domain event to all matching active webhook subscriptions.
   */
  static async dispatchDomainEventToSubscribers(event: BaseDomainEvent) {
    try {
      // Find all active subscriptions
      const subs = await orm
        .select()
        .from(webhookSubscriptions)
        .where(eq(webhookSubscriptions.isActive, 1));

      if (subs.length === 0) return;

      for (const sub of subs) {
        if (!this.matchesPattern(event.eventType, sub.eventPatterns as string[])) {
          continue;
        }

        // Asynchronously deliver webhook
        this.deliverToSubscriber(sub, event).catch(err => {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[Webhook Dispatcher Error] Failed delivery to #${sub.id}: ${errMsg}`);
        });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[Webhook Dispatcher Global Error] ${errMsg}`);
    }
  }

  /**
   * Delivers single event to subscriber with retry and signature calculation.
   */
  private static async deliverToSubscriber(
    sub: typeof webhookSubscriptions.$inferSelect,
    event: BaseDomainEvent,
    attempt: number = 1
  ): Promise<void> {
    const startTime = Date.now();
    const deliveryId = `deliv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
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

    // Log delivery
    await orm.insert(webhookDeliveries).values({
      subscriptionId: sub.id,
      subscriptionName: sub.name,
      eventId: event.eventId,
      eventType: event.eventType,
      targetUrl: sub.targetUrl,
      statusCode: statusCode,
      status: status,
      responseBody: responseText,
      errorMessage: errorMessage,
      signature: signature,
      attempt: attempt,
      durationMs: durationMs,
      createdAt: nowIso
    });

    // Update Subscription counters
    const isSuccess = status === 'success';
    await orm
      .update(webhookSubscriptions)
      .set({
        totalDeliveries: (sub.totalDeliveries || 0) + 1,
        successfulDeliveries: isSuccess ? (sub.successfulDeliveries || 0) + 1 : (sub.successfulDeliveries || 0),
        failedDeliveries: !isSuccess ? (sub.failedDeliveries || 0) + 1 : (sub.failedDeliveries || 0),
        lastDeliveryAt: nowIso,
        lastStatus: status,
        lastError: isSuccess ? '' : errorMessage
      })
      .where(eq(webhookSubscriptions.id, sub.id));

    if (!isSuccess && attempt < (sub.retryLimit || 3)) {
      // Exponential retry: 2s, 4s, 8s
      const delay = Math.pow(2, attempt) * 1000;
      setTimeout(() => {
        this.deliverToSubscriber(sub, event, attempt + 1).catch(() => {});
      }, delay);
    }
  }

  /**
   * Pattern matcher for event subscriptions (supports wildcard '*', 'document.*', exact 'document.invoiced').
   */
  private static matchesPattern(eventType: string, patterns: string[] = ['*']): boolean {
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
        signal: controller.signal
      });

      const responseText = await response.text();
      const durationMs = Date.now() - startTime;

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

  /**
   * Seed default subscriptions if none exist.
   */
  static async seedDefaultSubscriptions() {
    try {
      const countRes = await orm.select({ count: count() }).from(webhookSubscriptions);
      if (Number(countRes[0]?.count) > 0) return;

      const defaults: CreateWebhookSubDTO[] = [
        {
          name: 'سامانه فروشگاه آنلاین ووکامرس (WooCommerce Webhook Bridge)',
          targetUrl: 'https://shop.example.com/wp-json/erp/v1/webhook',
          secretKey: this.generateSecretKey(),
          eventPatterns: ['document.invoiced', 'inventory.stock_in', 'inventory.stock_out', 'inventory.stock_alert'],
          isActive: 1,
          retryLimit: 3,
          timeoutMs: 5000
        },
        {
          name: 'پورتال ارسال و لجستیک همکار (Logistics & Delivery Hub)',
          targetUrl: 'https://logistics.example.com/api/v1/shipments/events',
          secretKey: this.generateSecretKey(),
          eventPatterns: ['document.settled', 'inventory.stock_out'],
          isActive: 0,
          retryLimit: 3,
          timeoutMs: 5000
        }
      ];

      for (const d of defaults) {
        await this.createSubscription(d);
      }

      logger.info(`[Webhook Subscriptions] Seeded ${defaults.length} default webhook subscriptions.`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[Webhook Seed Error] ${errMsg}`);
    }
  }
}
