import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/drizzle.js';
import { appSettings, documents } from '../../../db/schema.js';
import { fin, type DecimalValue, type FinancialDecimal } from '../../../lib/financialDecimal.js';
import { ValidationError } from '../../../errors/customErrors.js';

/**
 * v8.0.20 (TD-274): نرخ تسعیر تراکنش ارزی خزانه (دریافت، پرداخت، انتقال) — همان قاعده سند ارزی (TD-198):
 *   ۱) نرخ صریح تراکنش؛
 *   ۲) نرخ فاکتوری که این تراکنش تسویه می‌کند (documentId، با همان ارز) — تسویه فاکتور ارزی بدون نرخ صریح حساب مشتری
 *      یا تأمین‌کننده را به همان ارزش ریالی فاکتور می‌بندد؛
 *   ۳) کلید تنظیمات exchange_rate_<ارز>.
 * بدون نرخ، تراکنش ارزی ثبت نمی‌شود (هرگز نرخ ۱). پیش‌تر ردیف‌های سند تراکنش ارزی نرخ ۱ داشتند و در گزارش‌های ریالی
 * ۱۰۰ دلار ۱۰۰ ریال شمرده می‌شد. تراکنش ریالی نرخ ۱ دارد.
 */
export async function resolveTreasuryExchangeRate(
  executor: DbExecutor,
  currency: string | null | undefined,
  explicitRate?: DecimalValue | null,
  documentId?: number | null,
): Promise<FinancialDecimal> {
  const cur = (currency || 'IRR').toUpperCase();
  if (cur === 'IRR') return fin(1);
  if (explicitRate !== undefined && explicitRate !== null && fin(explicitRate).isPositive()) return fin(explicitRate);
  if (documentId) {
    const [doc] = await executor.select({ currency: documents.currency, exchangeRate: documents.exchangeRate })
      .from(documents).where(eq(documents.id, Number(documentId)));
    if (doc && (doc.currency || 'IRR').toUpperCase() === cur && fin(doc.exchangeRate).isPositive()) return fin(doc.exchangeRate);
  }
  const [setting] = await executor.select({ value: appSettings.value }).from(appSettings)
    .where(eq(appSettings.key, `exchange_rate_${cur.toLowerCase()}`));
  if (setting && fin(setting.value as DecimalValue).isPositive()) return fin(setting.value as DecimalValue);
  throw new ValidationError(
    `نرخ تسعیر ${cur} برای این تراکنش خزانه وارد نشده است؛ تراکنش ارزی بدون نرخ (ریال برای هر واحد) ثبت نمی‌شود.`
  );
}
