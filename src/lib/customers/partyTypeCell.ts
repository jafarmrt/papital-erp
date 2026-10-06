export type PartyType = 'customer' | 'supplier' | 'both';

/**
 * v9.0.9 (TD-421): ستون «نوع طرف حساب» درون‌ریزی اکسل، مشترک سرور و فرم پیش‌نمایش.
 * خانه خالی undefined است: رکورد موجود نوع خود را نگه می‌دارد و رکورد تازه «مشتری» می‌شود.
 * «تأمین» با همزه و بی همزه یکی است و «هر دو» / «مشتری و تأمین‌کننده» پیش از «تأمین» سنجیده می‌شود.
 */
export function parsePartyTypeCell(raw: unknown): PartyType | undefined {
  const text = String(raw ?? '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌\s]+/g, ' ')
    .trim()
    .toLowerCase();
  if (!text) return undefined;
  if (text.includes('هر دو') || text.includes('مشتری و تامین') || text === 'both') return 'both';
  if (text.includes('تامین') || text === 'supplier') return 'supplier';
  return 'customer';
}

const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  customer: 'مشتری',
  supplier: 'تامین‌کننده',
  both: 'هر دو (مشتری و تامین‌کننده)',
};

/** برچسب پیش‌نمایش: نوع خالی روی رکورد موجود «بدون تغییر» است و روی رکورد تازه «مشتری» */
export function partyTypeCellLabel(type: PartyType | undefined, isExistingMatch: boolean): string {
  if (type) return PARTY_TYPE_LABELS[type];
  return isExistingMatch ? 'بدون تغییر' : PARTY_TYPE_LABELS.customer;
}
