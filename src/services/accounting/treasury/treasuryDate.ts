import { ValidationError } from '../../../errors/customErrors.js';
import { businessTodayIsoDate } from '../../../lib/businessClock.js';
import { requireStorageDate } from '../../../lib/storageDate.js';
import { isoToJalaliDate } from '../../../utils/calendarDate.js';
import { toPersianDigits } from '../../../utils/persianNumber.js';

/**
 * v9.0.87 (TD-506 / TD-669، B04-10 / B16-05، تصمیم مالک محصول ت۶ الف): تاریخ نوشتن خزانه و چک — دریافت، پرداخت،
 * انتقال بانکی، صدور چک و هر اقدام روی چک. خالی ← امروز کسب‌وکار؛ ورودی با همان مبدل یگانه ذخیره خوانده می‌شود
 * (`requireStorageDate`: روز ناموجود مانند ۱۴۰۴/۱۲/۳۰ یا ۱۴۰۴/۰۷/۳۱ و متن غیرتاریخ ← 422) و پس از امروز کسب‌وکار
 * پذیرفته نیست (422 `TREASURY_DATE_IN_FUTURE`). پیش‌تر خزانه با `jalaliToIsoDate` روز ناموجود را به روز بعد، گاهی در
 * سال مالی بعد، می‌برد و چک تاریخ آینده را بی‌سقف می‌پذیرفت.
 */
export async function resolveTreasuryWriteDate(raw: unknown, label: string): Promise<string> {
  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  const today = await businessTodayIsoDate();
  if (!text) return today;
  const iso = requireStorageDate(text, label);
  if (iso > today) {
    throw new ValidationError(
      `${label} (${toPersianDigits(isoToJalaliDate(iso))}) نمی‌تواند پس از امروز (${toPersianDigits(isoToJalaliDate(today))}) باشد.`,
      { field: label, value: raw },
      'TREASURY_DATE_IN_FUTURE',
    );
  }
  return iso;
}
