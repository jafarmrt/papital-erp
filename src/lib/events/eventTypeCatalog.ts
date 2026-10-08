/**
 * v9.0.405 (TD-707، B15-05، تصمیم ت۳ الف): فهرست یگانه نوع رویدادهایی که سرور واقعاً منتشر می‌کند، با برچسب فارسی.
 * فرم اشتراک وب‌هوک و ویرایشگر قانون فقط همین‌ها و «همه رویدادها» را پیشنهاد می‌کنند و سرور الگوی دیگری را نمی‌پذیرد.
 * پیش‌تر رابط الگوهای نقطه‌دار (`document.invoiced`، `inventory.*` …) پیشنهاد می‌کرد که با هیچ رویدادی جور نمی‌شدند.
 * آزمون Vitest `eventTypeCatalog.test.ts` می‌سنجد که هر نوع این فهرست جایی در کد سرور منتشر می‌شود و هر نوعی که منتشر
 * می‌شود در این فهرست است.
 */
export const ALL_EVENTS_PATTERN = '*';

export interface EventTypeOption {
  value: string;
  label: string;
  category: string;
}

export const PUBLISHED_EVENT_TYPES: readonly EventTypeOption[] = [
  { value: 'InvoiceCreated', label: 'ثبت پیش‌نویس یا پیش‌فاکتور فروش', category: 'فروش' },
  { value: 'InvoiceApproved', label: 'صدور قطعی فاکتور فروش', category: 'فروش' },
  { value: 'PurchaseCreated', label: 'ثبت پیش‌نویس سند خرید یا رسید', category: 'خرید' },
  { value: 'PurchaseApproved', label: 'قطعی شدن سند خرید یا رسید', category: 'خرید' },
  { value: 'StockReceived', label: 'ورود کالا به انبار', category: 'انبار' },
  { value: 'StockIssued', label: 'خروج کالا از انبار', category: 'انبار' },
  { value: 'StockAdjusted', label: 'اصلاح موجودی یا میانگین موزون بها', category: 'انبار' },
  { value: 'InventoryReorderAlert', label: 'هشدار رسیدن به نقطه سفارش', category: 'انبار' },
  { value: 'TreasuryTransactionApproved', label: 'ثبت یا ابطال تراکنش خزانه', category: 'خزانه' },
  { value: 'WorkflowTransitioned', label: 'گذر از گام گردش کار', category: 'گردش کار' },
  { value: 'WorkflowCompleted', label: 'پایان گردش کار با تأیید', category: 'گردش کار' },
  { value: 'WorkflowRejected', label: 'رد شدن در گردش کار', category: 'گردش کار' },
  { value: 'woocommerce.order.synced', label: 'صدور فاکتور سفارش ووکامرس', category: 'ووکامرس' },
  { value: 'woocommerce.order.voided', label: 'ابطال فاکتور سفارش ووکامرس', category: 'ووکامرس' },
];

export const ALL_EVENTS_LABEL = 'همه رویدادها';

const PUBLISHED_VALUES = new Set(PUBLISHED_EVENT_TYPES.map(t => t.value));

export function isPublishedEventType(value: unknown): value is string {
  return typeof value === 'string' && PUBLISHED_VALUES.has(value);
}

/** نوع رویداد قانون یا الگوی اشتراک پذیرفتنی است: «همه رویدادها» یا یکی از نوع‌های منتشرشونده */
export function isSubscribableEventPattern(value: unknown): value is string {
  return value === ALL_EVENTS_PATTERN || isPublishedEventType(value);
}

/** برچسب فارسی یک نوع یا الگو؛ مقدار ناشناخته خودش نشان داده می‌شود */
export function eventTypeLabel(value: string): string {
  if (value === ALL_EVENTS_PATTERN) return ALL_EVENTS_LABEL;
  return PUBLISHED_EVENT_TYPES.find(t => t.value === value)?.label ?? value;
}

/** نوع‌های منتشرشونده به ترتیب دسته، برای گروه‌های فهرست انتخاب (v9.0.406، TD-726) */
export function publishedEventTypesByCategory(): { category: string; types: EventTypeOption[] }[] {
  const groups: { category: string; types: EventTypeOption[] }[] = [];
  for (const t of PUBLISHED_EVENT_TYPES) {
    const group = groups.find(g => g.category === t.category);
    if (group) group.types.push(t); else groups.push({ category: t.category, types: [t] });
  }
  return groups;
}

/** الگوهای نادرست یک فهرست (نه «*» و نه نوع منتشرشونده) */
export function unknownEventPatterns(patterns: readonly unknown[]): string[] {
  return patterns.filter(p => !isSubscribableEventPattern(p)).map(p => String(p));
}
