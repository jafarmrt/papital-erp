/**
 * v10.1.22 (N-02 بخش ۳، TD-1272، تصمیم‌های ت۹ و ت۱۰ طرح ارتباط با مشتری): قاعده‌های قیف فروش، جدا از نمایش. ستون‌ها پهنای
 * ثابت دارند و جمع نمی‌شوند؛ اگر پنج ستون جا نشوند قیف افقی پیمایش می‌شود. پیش‌تر ستون‌ها در شبکه پنج‌ستونی بودند و خانه هر
 * ستون از کمینه ۲۶۰ پیکسلی آن باریک‌تر بود، پس هر ستون روی ستون کناری می‌افتاد.
 */

/** پهنای هر ستون قیف (پیکسل) */
export const PIPELINE_COLUMN_WIDTH_PX = 280;

/** نوع داده کشیدن کارت؛ کارت فقط روی ستون قیف رها می‌شود */
export const PIPELINE_DRAG_TYPE = 'application/x-papital-crm-lead';

/** پرونده‌های یک مرحله، به همان ترتیب فهرست */
export function leadsOfStage<T extends { stage?: string | null }>(leads: ReadonlyArray<T>, stage: string): T[] {
  return leads.filter((lead) => (lead.stage || 'lead') === stage);
}

/**
 * مرحله تازه پس از رها کردن کارت: رها کردن در همان ستون، یا کارتی که دیگر نیست، کاری نمی‌کند. قاعده‌های کارساز
 * (فروش موفق فقط با پیش‌فاکتور زنده، ناموفق فقط با دلیل) در همان مسیر تغییر مرحله فهرست کشویی سنجیده می‌شوند.
 */
export function stageAfterDrop(
  leads: ReadonlyArray<{ id: number; stage?: string | null }>,
  leadId: number,
  targetStage: string,
): string | null {
  const lead = leads.find((l) => l.id === leadId);
  if (!lead) return null;
  return (lead.stage || 'lead') === targetStage ? null : targetStage;
}

/** شناسه پرونده از داده کشیدن؛ هر چیز دیگر (متن کشیده‌شده از جای دیگر) هیچ */
export function draggedLeadId(raw: string | null | undefined): number | null {
  const id = Number(String(raw ?? '').trim());
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** پیگیری بعدی گذشته است اگر تاریخ میلادی ISO آن پیش از امروز کسب‌وکار باشد */
export function isFollowupOverdue(nextFollowUpDate: string | null | undefined, todayIso: string): boolean {
  const date = String(nextFollowUpDate ?? '').trim();
  return date !== '' && date < todayIso;
}
