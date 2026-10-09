import { and, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../../db/drizzle.js';
import { documents, treasuryTransactions } from '../../../db/schema.js';
import { NotFoundError } from '../../../errors/customErrors.js';
import { PAYMENT_DOCUMENT_TYPES, RECEIPT_DOCUMENT_TYPES, resolveTreasuryPartyName } from './treasuryLinks.js';
import type { TreasuryRelinkOption } from '../../../lib/treasury/treasuryRelink.js';

/**
 * v10.0.48 (TD-1122): سندهایی که یک دریافت یا پرداخت ثبت‌شده به آن‌ها منتقل می‌شود، با همان قاعده
 * `assertTreasuryDocumentLink` (TD-501 / TD-778 / TD-908): سند فعال هم‌سو (دریافت ← فروش، پرداخت ← خرید)، همان ارز و همان
 * طرف حساب (شناسه طرف، سند پیشین بی شناسه با نام دقیق)؛ سند فعلی ردیف بیرون است. فقط خواندن است و سرور هنگام انتقال
 * همه را دوباره زیر قفل می‌سنجد.
 */
export const RELINK_OPTIONS_LIMIT = 50;

export async function listTreasuryRelinkOptions(id: number): Promise<TreasuryRelinkOption[]> {
  const [row] = await orm.select().from(treasuryTransactions)
    .where(and(eq(treasuryTransactions.id, id), eq(treasuryTransactions.isDeleted, 0)));
  if (!row) throw new NotFoundError('تراکنش خزانه یافت نشد');
  const isReceipt = row.type === 'receipt';
  if (row.type !== 'receipt' && row.type !== 'payment') return [];
  if (row.status !== 'completed' || row.reversalOfId !== null || row.payrollId) return [];
  if (row.partyType !== (isReceipt ? 'customer' : 'supplier')) return [];

  const name = ((await resolveTreasuryPartyName(orm, row.partyType, row.partyId)) ?? row.partyName ?? '').trim();
  const byName: SQL | undefined = name ? and(isNull(documents.partyId), sql`btrim(${documents.buyerName}) = ${name}::text`) : undefined;
  const party = row.partyId
    ? (byName ? or(eq(documents.partyId, row.partyId), byName) : eq(documents.partyId, row.partyId))
    : (byName ?? (name ? sql`btrim(${documents.buyerName}) = ${name}::text` : undefined));
  if (!party) return [];

  const currency = (row.currency || 'IRR').toUpperCase();
  const types: string[] = [...(isReceipt ? RECEIPT_DOCUMENT_TYPES : PAYMENT_DOCUMENT_TYPES)];
  const rows = await orm.select({
    id: documents.id, refNumber: documents.refNumber, type: documents.type, status: documents.status,
    date: documents.date, buyerName: documents.buyerName,
  }).from(documents).where(and(
    eq(documents.isDeleted, 0),
    inArray(documents.type, types),
    sql`upper(coalesce(nullif(btrim(${documents.currency}), ''), 'IRR')) = ${currency}::text`,
    party,
    row.documentId ? ne(documents.id, row.documentId) : undefined,
  )).orderBy(desc(documents.date), desc(documents.id)).limit(RELINK_OPTIONS_LIMIT);

  return rows.map(d => ({
    id: d.id, refNumber: String(d.refNumber ?? d.id), type: d.type, status: d.status ?? '',
    date: d.date ? String(d.date).slice(0, 10) : '', buyerName: (d.buyerName ?? '').trim(),
  }));
}
