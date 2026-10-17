/**
 * v10.1.69 (TD-1287، قاعده عدد وایب فارسی): آنچه کادر عدد و کادر مبلغ هنگام تایپ نشان می‌دهند.
 * عدد با ارقام فارسی، ممیز «٫» و (در کادر گروه‌بندی‌شده) جداکنندهٔ «٬» میان دسته‌های سه‌رقمی دیده می‌شود، هر صفحه‌کلیدی که
 * کاربر داشته باشد. مقدار کادر همان متن لاتین پیشین است؛ این فایل فقط نمایش و جای مکان‌نما را می‌سازد.
 */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** جداکنندهٔ هزارگان فارسی (U+066C) که کادر میان دسته‌های سه‌رقمی می‌گذارد */
export const PERSIAN_GROUP_SEPARATOR = '٬';
/** ممیز فارسی (U+066B) */
export const PERSIAN_DECIMAL_SEPARATOR = '٫';

/** ارقام لاتین را فارسی می‌کند و بقیهٔ متن را دست نمی‌زند */
export function persianDigitsOf(text: string): string {
  return text.replace(/[0-9]/g, d => PERSIAN_DIGITS[Number(d)]);
}

/**
 * متن یکدست لاتین («-1234.5»، «12.»، «.»، «-» یا خالی) با ارقام فارسی و «٫»؛ با `grouped` بخش صحیح با «٬» دسته می‌شود.
 * هر نویسهٔ معنادار (رقم، ممیز، منفی) سر جای خود می‌ماند، پس جای مکان‌نما با `caretAfterSignificant` پیدا می‌شود.
 */
export function persianNumberText(text: string, grouped: boolean): string {
  const sign = text.startsWith('-') ? '-' : '';
  const [intPart, fraction] = text.slice(sign.length).split('.');
  const integer = grouped ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, PERSIAN_GROUP_SEPARATOR) : intPart;
  return persianDigitsOf(sign + integer + (fraction !== undefined ? PERSIAN_DECIMAL_SEPARATOR + fraction : ''));
}

/** رقم (هر خطی)، ممیز («.» «٫» «/») و منفی؛ جداکننده‌ها، فاصله و نویسه‌های نامرئی معنادار نیستند */
const SIGNIFICANT = /[0-9۰-۹٠-٩.٫/-]/;

/** شمار نویسه‌های معنادار پیش از مکان‌نما */
export function significantCharsBefore(text: string, caret: number): number {
  let count = 0;
  for (let i = 0; i < Math.min(caret, text.length); i++) if (SIGNIFICANT.test(text[i])) count++;
  return count;
}

/** جای مکان‌نما درست پس از `count` نویسهٔ معنادار متن تازه */
export function caretAfterSignificant(text: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (SIGNIFICANT.test(text[i]) && ++seen === count) return i + 1;
  }
  return text.length;
}

/**
 * Backspace درست پس از «٬» یا Delete درست پیش از آن: مکان‌نما از روی جداکننده می‌پرد تا کلید رقم کنار آن را پاک کند، نه
 * جداکننده‌ای را که کادر دوباره می‌گذارد. در رویداد keydown و پیش از کار پیش‌فرض کلید صدا زده می‌شود.
 */
export function stepOverGroupSeparator(input: HTMLInputElement, key: string): void {
  const start = input.selectionStart;
  if (start === null || start !== input.selectionEnd) return;
  if (key === 'Backspace' && start > 0 && input.value[start - 1] === PERSIAN_GROUP_SEPARATOR) {
    input.setSelectionRange(start - 1, start - 1);
  } else if (key === 'Delete' && input.value[start] === PERSIAN_GROUP_SEPARATOR) {
    input.setSelectionRange(start + 1, start + 1);
  }
}
