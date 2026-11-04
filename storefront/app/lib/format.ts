/**
 * Display helpers of the storefront: Persian digits, «٬» grouping and toman. The API sends rial as a decimal string
 * (`storefrontContracts.ts`); the arithmetic stays on BigInt so a price is never rounded through a JS number.
 */
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function faDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, d => FA_DIGITS[Number(d)]);
}

function grouped(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
}

export function faNumber(value: number): string {
  return faDigits(grouped(String(Math.trunc(value))));
}

/** A rial string as the price a buyer reads: «۱٬۴۵۰٬۰۰۰ تومان»; a rial amount that is not whole toman stays in rial */
export function formatPrice(rial: string): string {
  if (!/^\d+$/.test(rial)) return '';
  const amount = BigInt(rial);
  if (amount % 10n !== 0n) return `${faDigits(grouped(amount.toString()))} ریال`;
  return `${faDigits(grouped((amount / 10n).toString()))} تومان`;
}

/** The toman number alone, for a price whose unit is set apart */
export function tomanDigits(rial: string): string {
  if (!/^\d+$/.test(rial)) return '';
  const amount = BigInt(rial);
  return faDigits(grouped((amount % 10n === 0n ? amount / 10n : amount).toString()));
}

export function priceUnit(rial: string): string {
  return /^\d+0$/.test(rial) || rial === '0' ? 'تومان' : 'ریال';
}

const DATE_TIME = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', weekday: 'long', month: 'long', day: 'numeric' });

/** v11 phase 8.2: a moment on the Persian calendar and Tehran's clock («۱۲ آبان ۱۴۰۵، ساعت ۱۴:۳۰»); '' for none */
export function faDateTime(iso: string | null | undefined): string {
  const ms = Date.parse(String(iso ?? ''));
  return Number.isFinite(ms) ? DATE_TIME.format(ms) : '';
}

/** The days a receipt may be from, newest first: «امروز»، «دیروز»، then the weekday and date */
export function recentDays(count: number, now = Date.now()): Array<{ value: number; label: string }> {
  return Array.from({ length: count }, (_, i) => ({ value: i, label: i === 0 ? 'امروز' : i === 1 ? 'دیروز' : DAY.format(now - i * 86_400_000) }));
}

/** A card number or IBAN in groups of four, for reading aloud from the screen */
export function grouped4(value: string): string {
  return value.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

const LONG_DAY = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', month: 'long', day: 'numeric' });

/** v11 phase 8.5b: a day of Tehran (YYYY-MM-DD) on the Persian calendar («۳۰ آذر»); '' for none */
export function faDay(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const ms = Date.parse(`${day}T12:00:00+03:30`);
  return Number.isFinite(ms) ? LONG_DAY.format(ms) : '';
}
