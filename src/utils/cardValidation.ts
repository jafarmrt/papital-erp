import { toEnglishDigits, toPersianDigits } from "./persianNumber.js";

/**
 * استانداردسازی شماره تلفن در ایران:
 * - ارقام انگلیسی می‌شوند و کاراکترهای غیرعددی پاک می‌شوند.
 * - پیشوندهای بین‌المللی (+98 یا 0098 یا 98) به 0 تبدیل می‌شوند.
 * - در صورتی که شماره ۱۰ رقمی باشد و بدون صفر شروع شده باشد (مانند 2122610001 یا 9123456789)، صفر پیشین اضافه می‌شود.
 */
export function normalizePhoneNumber(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  try {
    let str = toEnglishDigits(String(val)).trim();
    if (!str) return '';

    // تبدیل پیشوندهای +98 یا 0098 یا 98 کشوری به 0
    if (str.startsWith('+98')) {
      str = '0' + str.slice(3);
    } else if (str.startsWith('0098')) {
      str = '0' + str.slice(4);
    } else if (str.startsWith('98') && (str.length === 12 || str.length === 11)) {
      str = '0' + str.slice(2);
    }

    const digits = str.replace(/\D/g, '');
    if (!digits) return str;

    // شماره‌های ایران (تلفن همراه یا ثابت استانی) با پیش‌شماره معمولاً ۱۱ رقمی با ۰ هستند.
    // در اکسل یا هنگام تایپ اگر ۱۰ رقم بدون صفر وارد شود (مثلاً 2122610001 یا 9123456789)، با صفر پد می‌شود.
    if (digits.length === 10 && !digits.startsWith('0')) {
      return '0' + digits;
    }

    return digits;
  } catch {
    return '';
  }
}

/**
 * فرمت‌بندی شماره تلفن با ارقام فارسی و تضمین عدم حذف صفر اول
 */
export function formatPersianPhone(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  const normalized = normalizePhoneNumber(val);
  if (!normalized) return '';
  return toPersianDigits(normalized);
}

/**
 * استانداردسازی کد ملی ایران:
 * - ارقام انگلیسی شده و کاراکترهای غیرعددی پاک می‌شوند.
 * - کد ملی در ایران ۱۰ رقم است؛ در صورتی که به دلیل ورود در اکسل یا بدون صفر ۱ تا ۹ رقم باشد،
 *   با صفرهای پیشین به ۱۰ رقم کامل تبدیل می‌شود (مثلاً 87654321 -> 0087654321).
 */
export function normalizeNationalId(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  try {
    const rawStr = toEnglishDigits(String(val)).trim();
    const digits = rawStr.replace(/\D/g, '');
    if (!digits) return rawStr;
    if (digits.length > 0 && digits.length < 10) {
      return digits.padStart(10, '0');
    }
    return digits;
  } catch {
    return '';
  }
}

/**
 * فرمت‌بندی کد ملی با ارقام فارسی و تضمین نمایش کامل ۱۰ رقم با صفرهای پیشین
 */
export function formatPersianNationalId(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  const normalized = normalizeNationalId(val);
  if (!normalized) return '';
  return toPersianDigits(normalized);
}

/**
 * نقشه پیش‌شماره‌های ۶ رقمی (BIN/IIN) کارت‌های بانکی عضو شبکه شتاب ایران
 */
export const IRANIAN_BANKS_BIN: Record<string, { name: string; shortName: string; code: string; color: string }> = {
  '603799': { name: 'بانک ملی ایران', shortName: 'ملی', code: '017', color: 'text-amber-800 bg-amber-50 border-amber-300' },
  '589210': { name: 'بانک سپه', shortName: 'سپه', code: '015', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  '627648': { name: 'بانک توسعه صادرات ایران', shortName: 'توسعه صادرات', code: '020', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  '627961': { name: 'بانک صنعت و معدن', shortName: 'صنعت و معدن', code: '011', color: 'text-blue-700 bg-blue-50 border-blue-200' },
  '603770': { name: 'بانک کشاورزی', shortName: 'کشاورزی', code: '016', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  '639217': { name: 'بانک کشاورزی', shortName: 'کشاورزی', code: '016', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  '628023': { name: 'بانک مسکن', shortName: 'مسکن', code: '014', color: 'text-orange-700 bg-orange-50 border-orange-200' },
  '627760': { name: 'پست بانک ایران', shortName: 'پست بانک', code: '021', color: 'text-green-700 bg-green-50 border-green-200' },
  '502908': { name: 'بانک توسعه تعاون', shortName: 'توسعه تعاون', code: '022', color: 'text-blue-700 bg-blue-50 border-blue-200' },
  '627412': { name: 'بانک اقتصاد نوین', shortName: 'اقتصاد نوین', code: '055', color: 'text-purple-700 bg-purple-50 border-purple-200' },
  '622106': { name: 'بانک پارسیان', shortName: 'پارسیان', code: '054', color: 'text-red-700 bg-red-50 border-red-200' },
  '639194': { name: 'بانک پارسیان', shortName: 'پارسیان', code: '054', color: 'text-red-700 bg-red-50 border-red-200' },
  '627884': { name: 'بانک پارسیان', shortName: 'پارسیان', code: '054', color: 'text-red-700 bg-red-50 border-red-200' },
  '502229': { name: 'بانک پاسارگاد', shortName: 'پاسارگاد', code: '057', color: 'text-amber-800 bg-amber-50 border-amber-300' },
  '639347': { name: 'بانک پاسارگاد', shortName: 'پاسارگاد', code: '057', color: 'text-amber-800 bg-amber-50 border-amber-300' },
  '627488': { name: 'بانک کارآفرین', shortName: 'کارآفرین', code: '053', color: 'text-teal-700 bg-teal-50 border-teal-200' },
  '502910': { name: 'بانک کارآفرین', shortName: 'کارآفرین', code: '053', color: 'text-teal-700 bg-teal-50 border-teal-200' },
  '621986': { name: 'بانک سامان', shortName: 'سامان', code: '056', color: 'text-sky-700 bg-sky-50 border-sky-200' },
  '639346': { name: 'بانک سینا', shortName: 'سینا', code: '059', color: 'text-blue-800 bg-blue-50 border-blue-200' },
  '639607': { name: 'بانک سرمایه', shortName: 'سرمایه', code: '058', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  '636214': { name: 'بانک آینده', shortName: 'آینده', code: '062', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  '504706': { name: 'بانک شهر', shortName: 'شهر', code: '061', color: 'text-rose-700 bg-rose-50 border-rose-200' },
  '502806': { name: 'بانک شهر', shortName: 'شهر', code: '061', color: 'text-rose-700 bg-rose-50 border-rose-200' },
  '502938': { name: 'بانک دی', shortName: 'دی', code: '066', color: 'text-orange-700 bg-orange-50 border-orange-200' },
  '603769': { name: 'بانک صادرات ایران', shortName: 'صادرات', code: '019', color: 'text-indigo-700 bg-indigo-50 border-indigo-200' },
  '610433': { name: 'بانک ملت', shortName: 'ملت', code: '012', color: 'text-red-700 bg-red-50 border-red-200' },
  '991975': { name: 'بانک ملت', shortName: 'ملت', code: '012', color: 'text-red-700 bg-red-50 border-red-200' },
  '585983': { name: 'بانک تجارت', shortName: 'تجارت', code: '018', color: 'text-cyan-700 bg-cyan-50 border-cyan-200' },
  '627353': { name: 'بانک تجارت', shortName: 'تجارت', code: '018', color: 'text-cyan-700 bg-cyan-50 border-cyan-200' },
  '589463': { name: 'بانک رفاه کارگران', shortName: 'رفاه', code: '013', color: 'text-blue-700 bg-blue-50 border-blue-200' },
  '627381': { name: 'بانک انصار (سپه)', shortName: 'انصار', code: '015', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  '505785': { name: 'بانک ایران زمین', shortName: 'ایران زمین', code: '069', color: 'text-purple-700 bg-purple-50 border-purple-200' },
  '505416': { name: 'بانک گردشگری', shortName: 'گردشگری', code: '064', color: 'text-stone-700 bg-stone-100 border-stone-200' },
  '636795': { name: 'بانک مرکزی', shortName: 'مرکزی', code: '010', color: 'text-slate-700 bg-slate-100 border-slate-300' },
  '628157': { name: 'موسسه اعتباری توسعه', shortName: 'توسعه', code: '051', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  '505801': { name: 'موسسه اعتباری کوثر (سپه)', shortName: 'کوثر', code: '015', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  '606256': { name: 'موسسه اعتباری ملل', shortName: 'ملل', code: '075', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  '606373': { name: 'بانک قرض‌الحسنه مهر ایران', shortName: 'مهر ایران', code: '060', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  '504172': { name: 'بانک قرض‌الحسنه رسالت', shortName: 'رسالت', code: '070', color: 'text-blue-700 bg-blue-50 border-blue-200' },
  '505809': { name: 'بانک خاورمیانه', shortName: 'خاورمیانه', code: '078', color: 'text-sky-700 bg-sky-50 border-sky-200' },
  '581874': { name: 'بانک ایران و ونزوئلا', shortName: 'ایران ونزوئلا', code: '052', color: 'text-teal-700 bg-teal-50 border-teal-200' }
};

/**
 * نقشه شناسه ۳ رقمی بانک‌ها در شماره شبا (ارقام ۴ تا ۶ شماره شبا)
 */
export const SHEBA_BANKS_CODE: Record<string, { name: string; shortName: string }> = {
  '010': { name: 'بانک مرکزی جمهوری اسلامی ایران', shortName: 'بانک مرکزی' },
  '011': { name: 'بانک صنعت و معدن', shortName: 'صنعت و معدن' },
  '012': { name: 'بانک ملت', shortName: 'ملت' },
  '013': { name: 'بانک رفاه کارگران', shortName: 'رفاه' },
  '014': { name: 'بانک مسکن', shortName: 'مسکن' },
  '015': { name: 'بانک سپه', shortName: 'سپه' },
  '016': { name: 'بانک کشاورزی', shortName: 'کشاورزی' },
  '017': { name: 'بانک ملی ایران', shortName: 'ملی' },
  '018': { name: 'بانک تجارت', shortName: 'تجارت' },
  '019': { name: 'بانک صادرات ایران', shortName: 'صادرات' },
  '020': { name: 'بانک توسعه صادرات ایران', shortName: 'توسعه صادرات' },
  '021': { name: 'پست بانک ایران', shortName: 'پست بانک' },
  '022': { name: 'بانک توسعه تعاون', shortName: 'توسعه تعاون' },
  '051': { name: 'موسسه اعتباری توسعه', shortName: 'توسعه' },
  '052': { name: 'بانک مشترک ایران و ونزوئلا', shortName: 'ایران ونزوئلا' },
  '053': { name: 'بانک کارآفرین', shortName: 'کارآفرین' },
  '054': { name: 'بانک پارسیان', shortName: 'پارسیان' },
  '055': { name: 'بانک اقتصاد نوین', shortName: 'اقتصاد نوین' },
  '056': { name: 'بانک سامان', shortName: 'سامان' },
  '057': { name: 'بانک پاسارگاد', shortName: 'پاسارگاد' },
  '058': { name: 'بانک سرمایه', shortName: 'سرمایه' },
  '059': { name: 'بانک سینا', shortName: 'سینا' },
  '060': { name: 'بانک قرض‌الحسنه مهر ایران', shortName: 'مهر ایران' },
  '061': { name: 'بانک شهر', shortName: 'شهر' },
  '062': { name: 'بانک آینده', shortName: 'آینده' },
  '063': { name: 'بانک انصار (سپه)', shortName: 'انصار' },
  '064': { name: 'بانک گردشگری', shortName: 'گردشگری' },
  '065': { name: 'بانک حکمت ایرانیان (سپه)', shortName: 'حکمت ایرانیان' },
  '066': { name: 'بانک دی', shortName: 'دی' },
  '069': { name: 'بانک ایران زمین', shortName: 'ایران زمین' },
  '070': { name: 'بانک قرض‌الحسنه رسالت', shortName: 'رسالت' },
  '073': { name: 'موسسه اعتباری کوثر (سپه)', shortName: 'کوثر' },
  '075': { name: 'موسسه اعتباری ملل', shortName: 'ملل' },
  '078': { name: 'بانک خاورمیانه', shortName: 'خاورمیانه' },
  '079': { name: 'بانک مهر اقتصاد (سپه)', shortName: 'مهر اقتصاد' }
};

/**
 * پاکسازی و استانداردسازی شماره کارت به ۱۶ رقم خالص انگلیسی
 */
export function normalizeBankCard(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '' || typeof val === 'object') return '';
  try {
    const raw = toEnglishDigits(String(val)).trim();
    return raw.replace(/\D/g, '').slice(0, 16);
  } catch {
    return '';
  }
}

/**
 * فرمت‌بندی نمایشی شماره کارت به دسته‌های ۴ رقمی (مثال: ۶۰۳۷ - ۹۹۱۸ - ۱۲۳۴ - ۵۶۷۸)
 */
export function formatBankCard(val: string | number | null | undefined, separator: string = ' - '): string {
  const clean = normalizeBankCard(val);
  if (!clean) return '';
  const parts: string[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    parts.push(clean.substring(i, i + 4));
  }
  return parts.join(separator);
}

/**
 * استخراج اطلاعات بانک از ۶ رقم اول شماره کارت (BIN)
 */
export function getIranianBankFromCard(card: string | number | null | undefined): {
  name: string;
  shortName: string;
  code: string;
  color: string;
} | null {
  const clean = normalizeBankCard(card);
  if (clean.length < 6) return null;
  const bin = clean.substring(0, 6);
  return IRANIAN_BANKS_BIN[bin] || null;
}

/**
 * اعتبارسنجی الگوریتم لان (Luhn) و ساختار ۱۶ رقمی شماره کارت شتاب
 */
export function validateBankCardNumber(card: string | number | null | undefined): {
  isValid: boolean;
  error?: string;
  bankName?: string;
  shortName?: string;
  bankCode?: string;
  badgeColor?: string;
} {
  const clean = normalizeBankCard(card);
  if (!clean) {
    return { isValid: false, error: 'شماره کارت وارد نشده است' };
  }
  const bank = getIranianBankFromCard(clean);

  if (clean.length < 16) {
    return {
      isValid: false,
      error: `شماره کارت باید ۱۶ رقم باشد (در حال حاضر ${clean.length} رقم)`,
      bankName: bank?.name,
      shortName: bank?.shortName,
      bankCode: bank?.code,
      badgeColor: bank?.color
    };
  }

  // الگوریتم لان (Luhn Checksum):
  // در رشته ۱۶ رقمی، ارقام با اندیس‌های زوج (از چپ: ۰، ۲، ۴، ۶، ۸، ۱۰، ۱۲، ۱۴) در ۲ ضرب شده و در صورت > ۹، منهای ۹ می‌شوند.
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let digit = parseInt(clean[i], 10);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }

  if (sum % 10 !== 0) {
    return {
      isValid: false,
      error: 'رقم کنترلی شماره کارت نامعتبر است (خطای Luhn)',
      bankName: bank?.name,
      shortName: bank?.shortName,
      bankCode: bank?.code,
      badgeColor: bank?.color
    };
  }

  return {
    isValid: true,
    bankName: bank?.name,
    shortName: bank?.shortName,
    bankCode: bank?.code,
    badgeColor: bank?.color
  };
}

/**
 * استانداردسازی و یکدست‌سازی شماره شبا:
 * - تبدیل ارقام فارسی و حذف فاصله‌ها
 * - تبدیل به حروف بزرگ
 * - اضافه کردن پیشوند IR در صورت عدم وجود (اگر ۲۴ رقم وارد شده باشد)
 */
export function normalizeSheba(val: string | null | undefined): string {
  if (!val || typeof val !== 'string') return '';
  try {
    let clean = toEnglishDigits(val).replace(/[\s\-]/g, '').toUpperCase();
    if (!clean.startsWith('IR') && clean.length === 24 && /^\d+$/.test(clean)) {
      clean = 'IR' + clean;
    }
    return clean.slice(0, 26);
  } catch {
    return '';
  }
}

/**
 * فرمت‌بندی نمایشی شماره شبا به دسته‌های ۴ رقمی استاندارد
 * مثال: IR65 0120 0000 0000 1234 5678 90
 */
export function formatIranianSheba(val: string | null | undefined, separator: string = ' '): string {
  const clean = normalizeSheba(val);
  if (!clean) return '';
  // تفکیک دسته‌های ۴ رقمی بعد از IR یا از ابتدا
  const parts: string[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    parts.push(clean.substring(i, i + 4));
  }
  return parts.join(separator);
}

/**
 * استخراج نام بانک از روی کد ۳ رقمی شناسه بانک در شماره شبا (ارقام ۴ تا ۶)
 */
export function getIranianBankFromSheba(sheba: string | null | undefined): {
  name: string;
  shortName: string;
  code: string;
} | null {
  const clean = normalizeSheba(sheba);
  if (clean.length < 7 || !clean.startsWith('IR')) return null;
  const bankCode = clean.substring(4, 7);
  const info = SHEBA_BANKS_CODE[bankCode];
  if (!info) return null;
  return { ...info, code: bankCode };
}

/**
 * اعتبارسنجی رسمی شماره شبا بر اساس استاندارد ISO 7064 Mod 97-10
 */
export function validateIranianSheba(sheba: string | null | undefined): {
  isValid: boolean;
  error?: string;
  bankName?: string;
  shortName?: string;
  bankCode?: string;
} {
  const clean = normalizeSheba(sheba);
  if (!clean) {
    return { isValid: false, error: 'شماره شبا وارد نشده است' };
  }

  const bank = getIranianBankFromSheba(clean);

  if (!clean.startsWith('IR')) {
    return { isValid: false, error: 'شماره شبا باید با IR آغاز شود' };
  }

  if (clean.length !== 26) {
    return {
      isValid: false,
      error: `شماره شبا باید شامل ۲۶ کاراکتر (IR و ۲۴ رقم) باشد (در حال حاضر ${clean.length} کاراکتر)`,
      bankName: bank?.name,
      shortName: bank?.shortName,
      bankCode: bank?.code
    };
  }

  const digitsPart = clean.slice(2);
  if (!/^\d{24}$/.test(digitsPart)) {
    return {
      isValid: false,
      error: 'پس از پیشوند IR باید دقیقاً ۲۴ رقم عددی قرار گیرد',
      bankName: bank?.name,
      shortName: bank?.shortName,
      bankCode: bank?.code
    };
  }

  // الگوریتم رسمی ISO 7064 Mod 97-10:
  // ۱. چهار کاراکتر ابتدایی (IRxx) به انتهای رشته منتقل می‌شوند.
  // ۲. حرف I با عدد 18 و حرف R با عدد 27 جایگزین می‌شود (IR => 1827).
  // ۳. باقیمانده تقسیم عدد بزرگ حاصل بر ۹۷ باید برابر با ۱ باشد.
  try {
    const rearranged = clean.substring(4) + '1827' + clean.substring(2, 4);
    const remainder = BigInt(rearranged) % 97n;
    if (remainder !== 1n) {
      return {
        isValid: false,
        error: 'رقم‌های کنترلی شماره شبا نامعتبر است (خطای Mod 97-10)',
        bankName: bank?.name,
        shortName: bank?.shortName,
        bankCode: bank?.code
      };
    }

    return {
      isValid: true,
      bankName: bank?.name,
      shortName: bank?.shortName,
      bankCode: bank?.code
    };
  } catch {
    return { isValid: false, error: 'خطا در محاسبه کنترل‌رقم شبا' };
  }
}

/**
 * Validates Iranian 10-digit National ID (کد ملی)
 * Returns { isValid: boolean, error?: string }
 */
export function validateIranianNationalId(id: string | null | undefined): { isValid: boolean; error?: string } {
  if (!id || !String(id).trim()) {
    return { isValid: true }; // فیلد اختیاری است؛ اگر وارد نشده معتبر تلقی می‌شود
  }
  const cleanId = normalizeNationalId(id);
  if (!/^\d{10}$/.test(cleanId)) {
    return { isValid: false, error: 'کد ملی باید دقیقاً ۱۰ رقم عددی باشد' };
  }
  // جلوگیری از ارقام تکراری ساختگی نامعتبر مانند ۱۱۱۱۱۱۱۱۱۱
  const allSame = /^(\d)\1{9}$/.test(cleanId);
  if (allSame) {
    return { isValid: false, error: 'کد ملی وارد شده نامعتبر است' };
  }
  // محاسبه رقم کنترلی استاندارد ثبت‌احوال (Mod 11)
  const check = parseInt(cleanId[9], 10);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleanId[i], 10) * (10 - i);
  }
  const remainder = sum % 11;
  const isChecksumValid = (remainder < 2 && check === remainder) || (remainder >= 2 && check === 11 - remainder);
  if (!isChecksumValid) {
    return { isValid: false, error: 'رقم کنترلی کد ملی صحیح نمی‌باشد' };
  }
  return { isValid: true };
}

export type IranianPhoneOperatorKey = 'mci' | 'irancell' | 'rightel' | 'shatel' | 'samantel' | 'taliya' | 'landline' | 'unknown';

export interface IranianPhoneInfo {
  isValid: boolean;
  type: 'mobile' | 'landline' | 'unknown';
  operatorKey: IranianPhoneOperatorKey;
  operatorName: string;
  provinceName?: string;
  error?: string;
}

export const IRANIAN_LANDLINE_CODES: Record<string, string> = {
  '021': 'تهران',
  '026': 'البرز',
  '025': 'قم',
  '024': 'زنجان',
  '028': 'قزوین',
  '023': 'سمنان',
  '031': 'اصفهان',
  '034': 'کرمان',
  '035': 'یزد',
  '038': 'چهارمحال و بختیاری',
  '041': 'آذربایجان شرقی',
  '044': 'آذربایجان غربی',
  '045': 'اردبیل',
  '051': 'خراسان رضوی',
  '054': 'سیستان و بلوچستان',
  '056': 'خراسان جنوبی',
  '058': 'خراسان شمالی',
  '061': 'خوزستان',
  '066': 'لرستان',
  '071': 'فارس',
  '074': 'کهگیلویه و بویراحمد',
  '076': 'هرمزگان',
  '077': 'بوشهر',
  '081': 'همدان',
  '083': 'کرمانشاه',
  '084': 'ایلام',
  '086': 'مرکزی',
  '087': 'کردستان',
  '011': 'مازندران',
  '013': 'گیلان',
  '017': 'گلستان'
};

export const MCI_PREFIXES = new Set([
  '0910', '0911', '0912', '0913', '0914', '0915', '0916', '0917', '0918', '0919',
  '0990', '0991', '0992', '0993', '0994', '0996'
]);

export const IRANCELL_PREFIXES = new Set([
  '0930', '0933', '0935', '0936', '0937', '0938', '0939',
  '0901', '0902', '0903', '0904', '0905', '0941'
]);

export const RIGHTEL_PREFIXES = new Set(['0920', '0921', '0922', '0923']);
export const SHATEL_PREFIXES = new Set(['0998']);
export const SAMANTEL_PREFIXES = new Set(['0999']);
export const TALIYA_PREFIXES = new Set(['0932']);

/**
 * دریافت اطلاعات اپراتور و نوع شماره تلفن ایرانی (موبایل یا تلفن ثابت)
 */
export function getIranianPhoneOperatorInfo(phone: string | null | undefined): IranianPhoneInfo {
  if (!phone || !String(phone).trim()) {
    return { isValid: false, type: 'unknown', operatorKey: 'unknown', operatorName: '' };
  }
  const clean = normalizePhoneNumber(phone);
  if (!clean.startsWith('0')) {
    return { isValid: false, type: 'unknown', operatorKey: 'unknown', operatorName: '', error: 'شماره باید با صفر شروع شود' };
  }

  // اگر موبایل است (با 09 شروع می‌شود)
  if (clean.startsWith('09')) {
    const prefix4 = clean.slice(0, 4);
    let operatorKey: IranianPhoneOperatorKey = 'unknown';
    let operatorName = 'موبایل';

    if (MCI_PREFIXES.has(prefix4)) {
      operatorKey = 'mci';
      operatorName = 'همراه اول';
    } else if (IRANCELL_PREFIXES.has(prefix4)) {
      operatorKey = 'irancell';
      operatorName = 'ایرانسل';
    } else if (RIGHTEL_PREFIXES.has(prefix4)) {
      operatorKey = 'rightel';
      operatorName = 'رایتل';
    } else if (SHATEL_PREFIXES.has(prefix4)) {
      operatorKey = 'shatel';
      operatorName = 'شاتل موبایل';
    } else if (SAMANTEL_PREFIXES.has(prefix4)) {
      operatorKey = 'samantel';
      operatorName = 'سامان تل';
    } else if (TALIYA_PREFIXES.has(prefix4)) {
      operatorKey = 'taliya';
      operatorName = 'تالیا';
    }

    const isFullLength = clean.length === 11;
    const isValid = isFullLength && operatorKey !== 'unknown';
    return {
      isValid,
      type: 'mobile',
      operatorKey,
      operatorName,
      error: !isFullLength && clean.length > 4 ? `شماره باید ۱۱ رقمی باشد (${clean.length} رقم وارد شده)` : undefined
    };
  }

  // اگر تلفن ثابت است (با 01 تا 08 شروع می‌شود)
  const code3 = clean.slice(0, 3);
  if (IRANIAN_LANDLINE_CODES[code3]) {
    const provinceName = IRANIAN_LANDLINE_CODES[code3];
    const isFullLength = clean.length === 11;
    return {
      isValid: isFullLength,
      type: 'landline',
      operatorKey: 'landline',
      operatorName: `ثابت (${provinceName})`,
      provinceName,
      error: !isFullLength ? `شماره تلفن ثابت باید ۱۱ رقمی با پیش‌شماره استان باشد` : undefined
    };
  }

  // سایر شماره‌های شروع شده با 0
  const isFullLength = clean.length === 11;
  return {
    isValid: isFullLength,
    type: clean.length >= 3 && clean.startsWith('0') ? 'landline' : 'unknown',
    operatorKey: 'unknown',
    operatorName: 'تلفن',
    error: !isFullLength ? 'شماره باید ۱۱ رقمی باشد' : undefined
  };
}

/**
 * Validates Iranian Phone number (موبایل یا تلفن ثابت ۱۱ رقمی شروع با ۰)
 * Returns { isValid: boolean, error?: string }
 */
export function validateIranianPhoneNumber(phone: string | null | undefined): { isValid: boolean; error?: string } {
  if (!phone || !String(phone).trim()) {
    return { isValid: true }; // فیلد اختیاری است؛ در صورت خالی بودن خطا نمی‌دهد
  }
  const cleanPhone = normalizePhoneNumber(phone);
  if (!/^0\d{10}$/.test(cleanPhone)) {
    return { isValid: false, error: 'شماره تماس باید ۱۱ رقم بوده و با صفر (۰) شروع شود (مانند ۰۹۱۲۳۴۵۶۷۸۹ یا ۰۲۱۸۸۸۸۸۸۸۸)' };
  }
  const info = getIranianPhoneOperatorInfo(cleanPhone);
  if (!info.isValid && info.error) {
    return { isValid: false, error: info.error };
  }
  return { isValid: true };
}
