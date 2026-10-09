import { and, eq, inArray, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { documents } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import type { FinancialDecimal } from '../../lib/financialDecimal.js';

/**
 * v10.0.36 (TD-909، P5-S-02، تصمیم ت۶ الف): مبلغ مرجوعی‌های قطعی هر فاکتور — جمع خالص سطرهای زنده
 * (مقدار × قیمت − تخفیف) به‌علاوه مالیات و هزینه خدمات هر مرجوعی قطعی و ابطال‌نشده‌ای که به فاکتور وصل است؛
 * همان مبلغی که سند مرجوعی از حساب مشتری کم می‌کند. مرجوعی پیش‌نویس یا باطل‌شده شمرده نمی‌شود.
 * ارز مرجوعی همان ارز فاکتور است (TD-788)، پس جمع در ارز فاکتور است.
 */
export async function fetchReturnCredits(docIds: number[]): Promise<Map<number, FinancialDecimal>> {
  const credits = new Map<number, FinancialDecimal>();
  if (docIds.length === 0) return credits;
  // ستون‌ها با نام جدول نوشته می‌شوند: Drizzle در select تک‌جدولی نام جدول را نمی‌نویسد و «id» زیرپرسش به سطر می‌خورد
  const lineNet = sql<string>`COALESCE((
    SELECT SUM(di.quantity * di.unit_price - COALESCE(di.discount, 0))
      FROM document_items di
     WHERE di.document_id = documents.id AND di.is_deleted = 0
  ), 0)::text`;
  const rows = await orm.select({
    invoiceId: documents.returnOfDocumentId,
    lineNet,
    vatAmount: documents.vatAmount,
    serviceChargeAmount: documents.serviceChargeAmount,
  })
  .from(documents)
  .where(and(
    inArray(documents.returnOfDocumentId, docIds),
    eq(documents.type, 'return'),
    eq(documents.status, 'final'),
    eq(documents.isDeleted, 0),
  ));
  for (const row of rows) {
    if (row.invoiceId === null) continue;
    const credit = fin(row.lineNet).add(row.vatAmount ?? 0).add(row.serviceChargeAmount ?? 0);
    credits.set(row.invoiceId, (credits.get(row.invoiceId) ?? fin(0)).add(credit));
  }
  return credits;
}
