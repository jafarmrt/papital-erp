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
