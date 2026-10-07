import { toPersianDigits } from '../../utils/persianNumber';

/**
 * v9.0.280 (TD-556، B03-14): نتیجه «قطعی‌سازی گروهی» اسناد حسابداری، مشترک میان سرور و صفحه اسناد. شمار فقط اسنادی است
 * که واقعاً دائم شدند و هر شناسه ردشده دلیل خودش را دارد (ناموجود، حذف‌شده، پیش‌تر قطعی، سال مالی بسته، نامتراز).
 */
export interface BatchFinalizeRefusal {
  id: number;
  voucherNumber: number | null;
  reason: string;
}

export interface BatchFinalizeResult {
  finalizedCount: number;
  /** شناسه اسنادی که دائم شدند */
  ids: number[];
  refused: BatchFinalizeRefusal[];
}

const LISTED_REFUSALS = 5;

export function batchFinalizeMessage(result: Pick<BatchFinalizeResult, 'finalizedCount' | 'refused'>): string {
  const done = `${toPersianDigits(String(result.finalizedCount))} سند قطعی و دائم شد`;
  const refused = Array.isArray(result.refused) ? result.refused : [];
  if (refused.length === 0) return `${done}.`;
  const listed = refused.slice(0, LISTED_REFUSALS)
    .map(r => `سند ${toPersianDigits(String(r.voucherNumber ?? r.id))} (${r.reason})`)
    .join('، ');
  const more = refused.length > LISTED_REFUSALS ? ` و ${toPersianDigits(String(refused.length - LISTED_REFUSALS))} سند دیگر` : '';
  return `${done}؛ ${toPersianDigits(String(refused.length))} سند قطعی نشد: ${listed}${more}.`;
}
