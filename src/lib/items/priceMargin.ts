/**
 * v9.0.182 (O10، بسته ۵): حاشیه سود قیمت فروش نسبت به میانگین موزون بها. میانگین موزون بها همیشه ریالی است (AGENTS §3)،
 * پس حاشیه فقط برای قیمت ریالی معنا دارد؛ پیش‌تر قیمت دلاری یا یورویی با بهای ریالی سنجیده می‌شد و دکمه‌های +۱۰٪ بهای
 * ریالی را در فیلد ارزی می‌نوشتند.
 */
export const COST_CURRENCY = 'IRR';

/** درصد حاشیه سود (گرد شده)، یا null وقتی قیمت ریالی مثبت یا بهای مثبت نیست */
export function priceMarginPercent(price: string, currency: string, averageCost: number | null | undefined): number | null {
  const cost = Number(averageCost);
  const amount = Number(price);
  if ((currency || COST_CURRENCY) !== COST_CURRENCY) return null;
  if (!Number.isFinite(cost) || cost <= 0 || price === '' || !Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(((amount - cost) / cost) * 100);
}

/** قیمت ریالی پیشنهادی با درصد سود روی میانگین موزون بها */
export function markupPrice(averageCost: number, percent: number): string {
  return Math.round(averageCost * (1 + percent / 100)).toString();
}
