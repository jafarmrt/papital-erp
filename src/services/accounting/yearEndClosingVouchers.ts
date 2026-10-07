import { sql } from 'drizzle-orm';
import { journalVouchers } from '../../db/schema.js';

/**
 * v9.0.143 (TD-545، B03-03، تصمیم مالک محصول ت۳ الف): اسناد اختتامیه‌ای که «بستن سال مالی» صادر کرده است.
 *
 * سه سند اختتامیه هر سال (بستن حساب‌های موقت، انتقال سود، بستن حساب‌های دائمی) به آخرین روز همان سال‌اند، پس هر گزارشی
 * که تا آن روز را بخواهد پس از بستن سال صفر می‌شد. سند اختتامیه فقط همان است که بستن سال با پیوند `source_fiscal_year`
 * صادر کرده (و برگشت آن در بازگشایی سال)، نه هر سند با نوع `closing`: فرم سند دستی مانده‌های افتتاحیه را هم `closing`
 * ذخیره می‌کرد و آن‌ها در گزارش می‌مانند. سند افتتاحیه همیشه شمرده می‌شود.
 */
export const yearEndClosingVoucherSql = sql<boolean>`(${journalVouchers.voucherType} = 'closing' AND ${journalVouchers.sourceFiscalYear} IS NOT NULL)`;

/**
 * تاریخی که اسناد بستن سال از آن به بعد در گزارش شمرده نمی‌شوند. گزارش تجمعی (تراز آزمایشی، ترازنامه، نسبت‌ها) فقط سند
 * بستن روز پایان خودش را کنار می‌گذارد: سند بستن سال‌های پیش‌تر با سند افتتاحیه پس از آن جفت است و با هم شمرده می‌شوند
 * (کنار گذاشتن یکی بی دیگری مانده حساب‌های دائمی را دو برابر می‌کرد). صورت سود و زیان همه اسناد بستن درون دوره را کنار
 * می‌گذارد، چون سند افتتاحیه حساب موقت ندارد. «همراه اسناد اختتامیه» یا گزارش بی تاریخ پایان ← هیچ.
 */
export function yearEndClosingCutoff(includeClosing: boolean | undefined, from: string | undefined): string | undefined {
  if (includeClosing) return undefined;
  return from || undefined;
}
