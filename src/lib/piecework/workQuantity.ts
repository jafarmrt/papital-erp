import { DECIMAL_PATTERN, normalizeDecimalString, toLatinDigits } from '../numericInput.js';

/**
 * v9.0.280 (TD-812، B12P-09): مقدار کارکرد عدد بزرگ‌تر از صفر یا زمان «ساعت:دقیقه» است. پیش‌تر «-5» با مبلغ منفی ذخیره و
 * «۰» نشان داده می‌شد (کسری پنهان در فیش) و «abc» صفر ذخیره می‌شد. خروجی عدد است (ساعت با کسر دقیقه، مانند ۱:۳۰ = ۱٫۵).
 */
export type WorkQuantityParse = { ok: true; value: number } | { ok: false; message: string };

const TIME_PATTERN = /^(\d+):([0-5]?\d)$/;

export function parseWorkQuantity(raw: unknown, label = 'مقدار کارکرد'): WorkQuantityParse {
  let value: number;
  if (typeof raw === 'number') {
    value = raw;
  } else if (typeof raw === 'string') {
    const latin = toLatinDigits(raw).trim();
    const time = TIME_PATTERN.exec(latin);
    if (time) {
      value = Number(time[1]) + Number(time[2]) / 60;
    } else {
      const clean = normalizeDecimalString(raw);
      if (!DECIMAL_PATTERN.test(clean)) return { ok: false, message: `${label} باید عدد یا زمان «ساعت:دقیقه» باشد (مقدار دریافتی: ${raw})` };
      value = Number(clean);
    }
  } else {
    return { ok: false, message: `${label} الزامی است` };
  }
  if (!Number.isFinite(value)) return { ok: false, message: `${label} باید عدد معتبر باشد` };
  if (value <= 0) return { ok: false, message: `${label} باید بزرگ‌تر از صفر باشد` };
  return { ok: true, value };
}
