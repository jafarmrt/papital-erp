/**
 * v10.1.72 (TD-1288، قاعده عدد وایب فارسی): آنچه کادر عدد و کادر مبلغ هنگام تایپ نشان می‌دهند.
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
  // صفرهای آغاز عدد («۰۰۱۲۵۰») دسته نمی‌شوند؛ فقط بقیهٔ رقم‌ها
  const zeros = /^0+(?=\d)/.exec(intPart)?.[0] ?? '';
  const rest = intPart.slice(zeros.length);
  const integer = grouped ? zeros + rest.replace(/\B(?=(\d{3})+(?!\d))/g, PERSIAN_GROUP_SEPARATOR) : intPart;
  return persianDigitsOf(sign + integer + (fraction !== undefined ? PERSIAN_DECIMAL_SEPARATOR + fraction : ''));
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

const withoutSeparators = (text: string) => text.split(PERSIAN_GROUP_SEPARATOR).join('');

/**
 * متن تازهٔ کادری که عدد را با «٬» خودش نشان می‌دهد، بی «٬»هایی که خود کادر گذاشته بود. `shown` متنی است که کادر پیش از این
 * ویرایش نشان می‌داد و `caret` جای مکان‌نما پس از آن (پایان متن درج‌شده). «٬» در بخشی از متن که ویرایش دست نزده، پیش و پس از
 * متن درج‌شده، از خود کادر است و برداشته می‌شود؛ «٬» در متن درج‌شده را کاربر زده (Shift+2، کنار «٫») یا چسبانده و می‌ماند، تا
 * خوانندهٔ کادر آن را جز میان دسته‌های سه‌رقمی نپذیرد: «۱۲٬۵» هرگز صد و بیست و پنج نمی‌شود.
 */
export function withoutFieldSeparators(shown: string, typed: string, caret: number): string {
  const end = Math.max(0, Math.min(caret, typed.length));
  const keptAfter = Math.min(typed.length - end, commonSuffixLength(shown, typed));
  const keptBefore = Math.min(commonPrefixLength(shown, typed), Math.min(shown.length, typed.length) - keptAfter);
  return withoutSeparators(typed.slice(0, keptBefore))
    + typed.slice(keptBefore, typed.length - keptAfter)
    + withoutSeparators(typed.slice(typed.length - keptAfter));
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
