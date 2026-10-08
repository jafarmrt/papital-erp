/**
 * v9.0.391 (TD-725، B15-23): کلیدهای زمان سرور (ستون‌های timestamp بی‌منطقه، ساعت UTC) در پاسخ‌های رویدادها، صندوق ارسال،
 * صف خطا، قانون‌ها و گزارش اجرا، خط زمان، وب‌هوک‌ها و اعلان‌ها و گزارش سفارش‌های ووکامرس؛ با `utcTimestampResponses` /
 * `withUtcTimestampKeys` با Z به مرورگر می‌روند.
 */
export const EVENT_TIMESTAMP_KEYS: ReadonlySet<string> = new Set([
  'occurredAt', 'processedAt', 'nextRetryAt', 'lockedAt', 'lastExecutedAt', 'executedAt', 'nextAttemptAt',
  'quarantinedAt', 'resolvedAt', 'lastDeliveryAt', 'createdAt', 'updatedAt', 'timestamp',
]);

/** داده رویداد و قانون همان‌طور که ذخیره شده می‌رود؛ payload صف خطا ویرایش و بازپخش می‌شود */
export const EVENT_OPAQUE_KEYS: ReadonlySet<string> = new Set([
  'payload', 'metadata', 'changes', 'result', 'conditionsJson', 'actionConfigJson', 'customHeaders', 'details',
]);

export const NOTIFICATION_TIMESTAMP_KEYS: ReadonlySet<string> = new Set(['created_at', 'createdAt']);

export const WOO_ORDER_LOG_TIMESTAMP_KEYS: ReadonlySet<string> = new Set(['createdAt', 'updatedAt']);
