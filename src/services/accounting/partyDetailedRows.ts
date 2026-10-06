import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { journalVoucherItems } from '../../db/schema.js';

/**
 * v9.0.4 (TD-416، تصمیم مالک محصول ت۱ الف): ردیف‌های سند حسابداری یک طرف حساب (رکورد customers) با شناسه او.
 * ردیف «مشتری» و «تأمین‌کننده» هر دو به همان رکورد customers اشاره می‌کنند، پس هر دو نوع از آن اوست.
 * ردیف قدیمیِ بی‌شناسه فقط با برابری دقیق نام کنونی او شمرده می‌شود؛ نام «شامل» (طرف حساب دیگری که نامش این نام را
 * دارد) هرگز.
 */
export const PARTY_DETAILED_TYPES = ['customer', 'supplier'];

export interface PartyDetailedFilter {
  id: number;
  /** نام کنونی طرف حساب، فقط برای ردیف‌های قدیمیِ بی‌شناسه */
  legacyName: string;
}

export function partyDetailedRowsCondition(party: PartyDetailedFilter): SQL {
  const legacyName = party.legacyName.trim();
  const byId = eq(journalVoucherItems.detailedId, party.id);
  const owned = legacyName
    ? or(byId, and(isNull(journalVoucherItems.detailedId), sql`btrim(${journalVoucherItems.detailedName}) = ${legacyName}::text`))
    : byId;
  return and(inArray(journalVoucherItems.detailedType, PARTY_DETAILED_TYPES), owned) as SQL;
}
