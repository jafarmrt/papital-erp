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
  return detailedRowsOwnedBy(PARTY_DETAILED_TYPES, party);
}

/**
 * v9.0.212 (TD-548، B03-06): ردیف‌های یک پرسنل — نوع تفصیلی `personnel` با شناسه او، و ردیف قدیمیِ بی‌شناسه فقط با
 * نام دقیق کنونی. شناسه پرسنل و شناسه طرف حساب از دو جدول جدا می‌آیند و هم‌پوشانی دارند، پس شناسه بی نوع هرگز.
 */
export const PERSONNEL_DETAILED_TYPES = ['personnel'];

export function personnelDetailedRowsCondition(person: PartyDetailedFilter): SQL {
  return detailedRowsOwnedBy(PERSONNEL_DETAILED_TYPES, person);
}

/** ردیف‌هایی که نام تفصیلی آن‌ها، بی فاصله دو سر، دقیقاً این نام است (طرف حسابی که در هیچ جدولی پیدا نشد) */
export function exactDetailedNameCondition(name: string): SQL {
  return sql`btrim(${journalVoucherItems.detailedName}) = ${name.trim()}::text`;
}

function detailedRowsOwnedBy(types: readonly string[], party: PartyDetailedFilter): SQL {
  const legacyName = party.legacyName.trim();
  const byId = eq(journalVoucherItems.detailedId, party.id);
  const owned = legacyName
    ? or(byId, and(isNull(journalVoucherItems.detailedId), exactDetailedNameCondition(legacyName)))
    : byId;
  return and(inArray(journalVoucherItems.detailedType, [...types]), owned) as SQL;
}
