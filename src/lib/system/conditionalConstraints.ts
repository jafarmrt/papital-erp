import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v9.0.396 (TD-589، B01-09، تصمیم ت۵ الف): قرارداد فهرست و ساختن قیدهای شرطی جاافتاده مهاجرت‌ها، مشترک سرور
 * (`src/services/system/conditionalConstraints.ts`) و کارت «قیدهای جاافتاده پایگاه‌داده» در «عملیات سامانه».
 */
export type ConditionalConstraintKind = 'foreign_key' | 'unique_index';

export type ConditionalConstraintState = 'ready' | 'blocked';

export interface ConditionalConstraintEntry {
  name: string;
  kind: ConditionalConstraintKind;
  table: string;
  migration: string;
  label: string;
  state: ConditionalConstraintState;
  /** شمار ردیف‌های یتیم یا گروه‌های تکراری که ساختن را ناممکن می‌کنند */
  blockers: number;
  blockerUnit: string;
}

export interface ConditionalConstraintBuildResult {
  applied: boolean;
  /** قیدهای جاافتاده پیش از اجرا */
  missing: ConditionalConstraintEntry[];
  /** پیش‌نمایش: آنچه ساخته می‌شد؛ اجرا: آنچه ساخته شد */
  built: string[];
  blocked: string[];
  failed: Array<{ name: string; error: string }>;
}

export const CONDITIONAL_CONSTRAINTS_BUSY_MESSAGE = 'ساختن قیدهای جاافتاده هم‌اکنون از جای دیگری در جریان است. چند لحظه بعد دوباره تلاش کنید.';

/** چرا قید ساخته نشده و چه باید کرد */
export function conditionalConstraintCause(entry: ConditionalConstraintEntry): string {
  return entry.state === 'blocked'
    ? `${toPersianDigits(entry.blockers, 0)} ${entry.blockerUnit}؛ پس از اصلاح داده با «ساختن قیدهای جاافتاده» ساخته می‌شود.`
    : 'داده پاک است؛ با «ساختن قیدهای جاافتاده» در «عملیات سامانه» ساخته می‌شود.';
}

/** پیام نتیجه پیش‌نمایش یا اجرا برای مدیر سامانه */
export function conditionalConstraintsResultMessage(result: ConditionalConstraintBuildResult): string {
  if (result.missing.length === 0) return 'همه قیدها و ایندکس‌های یکتای شرطی مهاجرت‌ها برقرارند.';
  const parts: string[] = [];
  if (result.built.length > 0) {
    parts.push(result.applied
      ? `${toPersianDigits(result.built.length, 0)} قید ساخته شد`
      : `${toPersianDigits(result.built.length, 0)} قید آماده ساختن است`);
  }
  if (result.blocked.length > 0) parts.push(`${toPersianDigits(result.blocked.length, 0)} قید پیش از اصلاح داده ساخته نمی‌شود`);
  if (result.failed.length > 0) parts.push(`ساختن ${toPersianDigits(result.failed.length, 0)} قید شکست خورد`);
  return `${parts.join('؛ ')}.`;
}
