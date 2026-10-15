/**
 * v10.1.15 (N-02 بخش ۱، طرح ارتباط با مشتری §۳.۱، تصمیم ت۲ و ت۳): راه‌های ارتباط طرف حساب (وب‌سایت، ایمیل، اینستاگرام،
 * ایمیل هر فرد رابط) و پیوندهای یک‌کلیکی کنار آن‌ها. یک قاعده برای کارساز، فرم طرف حساب، پرونده مشتری و ورود اکسل.
 *
 * - ایمیل: قالب `نام@دامنه.پسوند` بی فاصله؛ خالی یعنی ایمیلی نیست. نادرست در کارساز ۴۲۲ و در فرم و اکسل خطای همان فیلد است.
 * - وب‌سایت: بی `https://` هم پذیرفته می‌شود و `https://` جلوی آن می‌آید؛ نشانی باید دامنه نقطه‌دار داشته باشد.
 * - اینستاگرام: فقط نام کاربری بی «@» ذخیره می‌شود؛ `@papital`، `papital` و `instagram.com/papital` همه `papital` هستند.
 */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** بیشینه طول هر راه ارتباط (همان سقف طرح Zod) */
export const CONTACT_CHANNEL_MAX_LENGTH = 200;

function latinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, d => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, d => String(ARABIC_DIGITS.indexOf(d)));
}

const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:".]{2,}$/;

/** ایمیل پاک‌شده (فاصله دو سر حذف و دامنه کوچک)؛ خالی یعنی ایمیلی نیست */
export function normalizeEmail(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const at = text.lastIndexOf('@');
  return at < 0 ? text : `${text.slice(0, at)}@${text.slice(at + 1).toLowerCase()}`;
}

/** پیام خطای ایمیل، یا null وقتی خالی یا درست است */
export function emailError(value: unknown): string | null {
  const email = normalizeEmail(value);
  if (!email) return null;
  if (email.length > CONTACT_CHANNEL_MAX_LENGTH) return 'ایمیل بیش از اندازه بلند است.';
  return EMAIL_PATTERN.test(email) ? null : `ایمیل «${email}» قالب درستی ندارد؛ نمونه درست: name@example.com`;
}

/** وب‌سایت با `https://` جلوی آن؛ خالی یعنی وب‌سایتی نیست. نادرست بودن را `websiteError` می‌گوید. */
export function normalizeWebsite(value: unknown): string {
  const text = latinDigits(String(value ?? '').trim());
  if (!text) return '';
  return /^https?:\/\//i.test(text) ? text.replace(/^(https?):\/\//i, (_m, scheme: string) => `${scheme.toLowerCase()}://`) : `https://${text}`;
}

/** پیام خطای وب‌سایت، یا null وقتی خالی یا درست است */
export function websiteError(value: unknown): string | null {
  const url = normalizeWebsite(value);
  if (!url) return null;
  if (url.length > CONTACT_CHANNEL_MAX_LENGTH) return 'نشانی وب‌سایت بیش از اندازه بلند است.';
  try {
    const parsed = new URL(url);
    if (!/^[^.\s]+(\.[^.\s]+)+$/.test(parsed.hostname) || /\s/.test(url)) throw new Error('host');
    return null;
  } catch {
    return `نشانی وب‌سایت «${String(value ?? '').trim()}» درست نیست؛ نمونه درست: papital.ir`;
  }
}

const INSTAGRAM_USERNAME = /^[a-z0-9._]{1,30}$/;

/** نام کاربری اینستاگرام بی «@» و با حروف کوچک؛ نشانی کامل صفحه هم پذیرفته است */
export function normalizeInstagram(value: unknown): string {
  let text = latinDigits(String(value ?? '').trim());
  if (!text) return '';
  text = text.replace(/^https?:\/\//i, '').replace(/^(www\.)?(instagram\.com|instagr\.am)\//i, '');
  text = text.split(/[/?#]/)[0] ?? '';
  return text.replace(/^@+/, '').toLowerCase();
}

/** پیام خطای اینستاگرام، یا null وقتی خالی یا درست است */
export function instagramError(value: unknown): string | null {
  const username = normalizeInstagram(value);
  if (!username && !String(value ?? '').trim()) return null;
  return INSTAGRAM_USERNAME.test(username)
    ? null
    : `نام کاربری اینستاگرام «${String(value ?? '').trim()}» درست نیست؛ فقط حرف لاتین، رقم، نقطه و زیرخط، حداکثر ۳۰ نویسه.`;
}

/** نشانی صفحه اینستاگرام برای پیوند */
export function instagramUrl(username: string | null | undefined): string {
  const handle = normalizeInstagram(username);
  return handle ? `https://instagram.com/${handle}` : '';
}

/** ارقام تلفن به لاتین و بی نویسه دیگر (جز + آغاز) */
function phoneDigits(phone: string): string {
  return latinDigits(phone).replace(/\D/g, '');
}

/** پیوند تماس (`tel:`)؛ خالی اگر رقمی نباشد */
export function telLink(phone: string | null | undefined): string {
  const text = latinDigits(String(phone ?? '').trim());
  const digits = phoneDigits(text);
  if (!digits) return '';
  return `tel:${text.startsWith('+') ? '+' : ''}${digits}`;
}

/**
 * پیوند واتس‌اپ (`https://wa.me/<شماره بین‌المللی>`)، با کلید تطبیق تلفن TD-296: ده رقم آخر یک شماره ایرانی با پیش‌شماره
 * ۹۸. شماره‌ای که با + یا ۰۰ و پیش‌شماره کشور دیگر آمده همان رقم‌ها را نگه می‌دارد. شماره کوتاه‌تر از ده رقم پیوندی ندارد.
 */
export function whatsappLink(phone: string | null | undefined): string {
  const text = latinDigits(String(phone ?? '').trim());
  let digits = phoneDigits(text);
  if (digits.length < 10) return '';
  if (text.startsWith('+') || digits.startsWith('00')) {
    digits = digits.replace(/^00/, '');
    if (!digits.startsWith('98')) return `https://wa.me/${digits}`;
  }
  return `https://wa.me/98${digits.slice(-10)}`;
}

/** پیوند نامه (`mailto:`) */
export function mailtoLink(email: string | null | undefined): string {
  const value = normalizeEmail(email);
  return value && !emailError(value) ? `mailto:${value}` : '';
}

/** تلفن‌های یک رشته چندتایی («۰۹۱۲…، ۰۲۱…») */
export function splitPhones(phones: string | null | undefined): string[] {
  return String(phones ?? '').split(/[,،;]/).map(p => p.trim()).filter(Boolean);
}

export interface ContactChannelsInput {
  website?: unknown;
  email?: unknown;
  instagram?: unknown;
}

export interface ContactChannels {
  website: string;
  email: string;
  instagram: string;
}

/** خطای هر فیلد راه ارتباط طرف حساب؛ کلید فیلدی که نیامده خطا ندارد */
export function contactChannelErrors(input: ContactChannelsInput): Partial<Record<keyof ContactChannels, string>> {
  const errors: Partial<Record<keyof ContactChannels, string>> = {};
  const web = input.website === undefined ? null : websiteError(input.website);
  const mail = input.email === undefined ? null : emailError(input.email);
  const insta = input.instagram === undefined ? null : instagramError(input.instagram);
  if (web) errors.website = web;
  if (mail) errors.email = mail;
  if (insta) errors.instagram = insta;
  return errors;
}

/** مقدار ذخیره‌شدنی هر فیلد فرستاده؛ فیلد نفرستاده undefined می‌ماند (قاعده TD-975) */
export function normalizeContactChannels(input: ContactChannelsInput): Partial<ContactChannels> {
  const out: Partial<ContactChannels> = {};
  if (input.website !== undefined) out.website = normalizeWebsite(input.website);
  if (input.email !== undefined) out.email = normalizeEmail(input.email);
  if (input.instagram !== undefined) out.instagram = normalizeInstagram(input.instagram);
  return out;
}
