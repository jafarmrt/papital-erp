import type { CrmLostReason } from './leadFields';

/**
 * v10.1.17 (N-02 بخش ۲، تصمیم ت۷ طرح ارتباط با مشتری): قرارداد گزارش قیف فروش، مشترک کارساز و مرورگر. از تاریخچه مرحله
 * (`crm_lead_stage_history`) ساخته می‌شود؛ تغییرهای پیش از این نسخه ثبت نشده‌اند و در گزارش نمی‌آیند.
 *
 * - ورود: پرونده‌هایی که در بازه به آن مرحله رفته‌اند (هر پرونده یک بار).
 * - پیشرفت: از همان پرونده‌ها، آن‌هایی که پس از ورودشان به مرحله‌ای جلوتر در قیف رفته‌اند (هر زمان، «از دست رفته» جلوتر نیست).
 * - میانگین روز: میانگین فاصله ورود تا تغییر مرحله بعدی همان پرونده؛ پرونده‌ای که هنوز در مرحله است شمرده نمی‌شود.
 * - فروشنده: فروشنده پرونده در لحظه تغییر مرحله.
 */
export const FUNNEL_STAGES = ['lead', 'qualified', 'proposal', 'won'] as const;
export type FunnelStage = typeof FUNNEL_STAGES[number];

export interface FunnelStageRow {
  stage: FunnelStage;
  entered: number;
  /** برای «فروش موفق» صفر است */
  advanced: number;
  /** درصد پیشرفت با دو رقم اعشار؛ null وقتی ورودی نیست یا مرحله آخر است */
  conversionPercent: number | null;
  /** میانگین روزهای ماندن با یک رقم اعشار؛ null وقتی هیچ پرونده‌ای از مرحله بیرون نرفته */
  avgDays: number | null;
  /** شمار پرونده‌هایی که میانگین روز از آن‌ها ساخته شده */
  measured: number;
}

export interface FunnelLostReasonRow {
  /** دلیل خالی برای پرونده‌ای است که بی دلیل از دست رفته (پیش از این قاعده نبوده) */
  reason: CrmLostReason | '';
  count: number;
}

export interface FunnelReport {
  /** ISO؛ null یعنی از نخستین تغییر */
  fromDate: string | null;
  /** ISO؛ null یعنی تا امروز */
  toDate: string | null;
  assignedPersonnelId: number | null;
  stages: FunnelStageRow[];
  lost: { count: number; reasons: FunnelLostReasonRow[] };
}

/** درصد پیشرفت مرحله */
export function conversionPercentOf(entered: number, advanced: number, stage: FunnelStage): number | null {
  if (stage === 'won' || entered <= 0) return null;
  return Math.round((advanced / entered) * 10000) / 100;
}
