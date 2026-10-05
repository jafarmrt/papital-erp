import { eq } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { fiscalPeriods } from '../../db/schema.js';
import { resolveJalaliFiscalYear } from '../../lib/businessClock.js';
import { BusinessLogicError, ConflictError } from '../../errors/customErrors.js';

/**
 * v7.0.49 (audit P2-5): وضعیت باز/بسته سال‌های مالی در جدول fiscal_periods.
 *
 * پیش‌تر بسته‌بودن سال از متن شماره مرجع اسناد اختتامیه با LIKE استنباط می‌شد و بین «بستن سال» و «ثبت همزمان
 * سند در همان سال» قفلی نبود؛ سندی که در میانه بستن ثبت می‌شد در سال بسته‌شده می‌ماند و در اسناد اختتامیه
 * دیده نمی‌شد. اکنون:
 *   - ثبت یا تغییر هر سند، ردیف سال خود را FOR SHARE قفل می‌کند (اسناد همزمان مانع هم نیستند)؛
 *   - بستن سال همان ردیف را FOR UPDATE قفل می‌کند، پس منتظر اسناد در جریان می‌ماند و سند تازه‌ای تا پایان
 *     بستن وارد آن سال نمی‌شود؛ پس از بستن هر سندی در آن سال (از جمله سند از نوع اختتامیه) رد می‌شود.
 */
export class FiscalPeriodService {
  /** سال‌هایی که ردیفشان در این پردازه از وجود آن‌ها مطمئن هستیم (استقرار تک‌نمونه‌ای) */
  private static knownYears = new Set<number>();

  static yearOf(date: string): number {
    return resolveJalaliFiscalYear(date);
  }

  /**
   * ردیف سال را در صورت نبود در همان تراکنش می‌سازد. v8.0.57 (TD-324): پیش‌تر روی اتصال جدا (autocommit) ساخته می‌شد؛
   * تراکنشی که خودش یک اتصال استخر را نگه داشته بود اتصال دومی می‌خواست و ۲۰ سند هم‌زمان در اولین روز سال تازه (سقف
   * استخر) پشت مهلت اتصال می‌ماندند. اکنون اولین اسناد هم‌زمان یک سال تازه پشت کلید یکتای همان ردیف (فقط یک بار در سال)
   * منتظر هم می‌مانند. سال فقط وقتی در کش می‌رود که ردیفش پیش‌تر ثبت شده باشد (درج این تراکنش ممکن است برگردد).
   */
  private static async ensureRow(year: number, tx: DbExecutor): Promise<void> {
    if (this.knownYears.has(year)) return;
    const inserted = await tx.insert(fiscalPeriods).values({ fiscalYear: year, status: 'open' }).onConflictDoNothing()
      .returning({ fiscalYear: fiscalPeriods.fiscalYear });
    if (inserted.length === 0) this.knownYears.add(year);
  }

  /** برای آزمون‌ها: کش سال‌های شناخته‌شده را خالی می‌کند (مثلاً پس از ساخت اسکیمای ایزوله تازه) */
  static resetCache(): void {
    this.knownYears.clear();
  }

  /**
   * سال مالی تاریخ داده‌شده باید باز باشد. با tx، ردیف سال تا پایان تراکنش FOR SHARE قفل می‌ماند.
   */
  static async assertOpen(date: string, tx?: DbExecutor): Promise<void> {
    if (!date) return;
    const year = this.yearOf(date);
    let row: { status: string; closingVoucherId: number | null } | undefined;
    if (tx) {
      await this.ensureRow(year, tx);
      [row] = await tx
        .select({ status: fiscalPeriods.status, closingVoucherId: fiscalPeriods.closingVoucherId })
        .from(fiscalPeriods)
        .where(eq(fiscalPeriods.fiscalYear, year))
        .for('share');
    } else {
      [row] = await orm
        .select({ status: fiscalPeriods.status, closingVoucherId: fiscalPeriods.closingVoucherId })
        .from(fiscalPeriods)
        .where(eq(fiscalPeriods.fiscalYear, year));
    }
    if (row?.status === 'closed') {
      throw new BusinessLogicError(
        `سال مالی ${year} بسته شده است${row.closingVoucherId ? ` (سند اختتامیه شناسه ${row.closingVoucherId})` : ''} و امکان صدور یا ویرایش سند در این سال مالی وجود ندارد`
      );
    }
  }

  static async isClosed(date: string, tx?: DbExecutor): Promise<boolean> {
    if (!date) return false;
    const year = this.yearOf(date);
    const [row] = await (tx || orm)
      .select({ status: fiscalPeriods.status })
      .from(fiscalPeriods)
      .where(eq(fiscalPeriods.fiscalYear, year));
    return row?.status === 'closed';
  }

  /**
   * شروع بستن سال: ردیف سال را FOR UPDATE قفل می‌کند (منتظر اسناد در جریان همان سال می‌ماند) و اگر سال پیش‌تر
   * بسته شده باشد ConflictError می‌دهد. باید داخل تراکنش بستن سال و پیش از محاسبه مانده‌ها صدا زده شود.
   */
  static async lockForClosing(tx: DbExecutor, year: number): Promise<void> {
    await this.ensureRow(year, tx);
    const [row] = await tx
      .select({ status: fiscalPeriods.status, closingVoucherId: fiscalPeriods.closingVoucherId })
      .from(fiscalPeriods)
      .where(eq(fiscalPeriods.fiscalYear, year))
      .for('update');
    if (row?.status === 'closed') {
      throw new ConflictError(
        `سال مالی ${year} قبلاً بسته شده است${row.closingVoucherId ? ` (سند اختتامیه شناسه ${row.closingVoucherId})` : ''}. بستن مجدد سال مجاز نیست.`,
        'FISCAL_YEAR_ALREADY_CLOSED'
      );
    }
  }

  /** پایان بستن سال (در همان تراکنش lockForClosing) */
  static async markClosed(tx: DbExecutor, year: number, closingVoucherId: number | null, closedBy?: string): Promise<void> {
    const values = {
      status: 'closed',
      closedAt: new Date().toISOString(),
      closedBy: closedBy || 'سیستم',
      closingVoucherId,
    };
    await tx
      .insert(fiscalPeriods)
      .values({ fiscalYear: year, ...values })
      .onConflictDoUpdate({ target: fiscalPeriods.fiscalYear, set: values });
  }
}
