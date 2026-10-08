import { sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import {
  AUTOMATION_DOC_TYPES, AUTOMATION_VOUCHER_RULES, automationRow, summarizeAutomation,
  type AutomationDocType, type AutomationStatus,
} from '../../lib/accounting/automationStatus.js';

/**
 * v9.0.297 (TD-560، B03-18): شمارش «وضعیت صدور خودکار اسناد حسابداری» در سرویس (پیش‌تر SQL خام در مسیر). فقط اسناد
 * نهایی و حذف‌نشده؛ هر نوع با قاعده خودش (`AUTOMATION_VOUCHER_RULES`): انبارگردانی فقط وقتی سند می‌خواهد که ردیف کاردکس
 * فعال و غیربرگشتی با ارزش مثبت دارد، همان شرطی که `syncStockAdjustmentVoucher` با آن سند صادر می‌کند؛ انتقال هرگز.
 */
export async function getAutomationStatus(executor: DbExecutor = orm): Promise<AutomationStatus> {
  const always = AUTOMATION_DOC_TYPES.filter(t => AUTOMATION_VOUCHER_RULES[t] === 'always');
  const valued = AUTOMATION_DOC_TYPES.filter(t => AUTOMATION_VOUCHER_RULES[t] === 'valued_difference');
  const list = (types: readonly string[]) => (types.length ? sql.join(types.map(t => sql`${t}`), sql`, `) : sql`NULL`);
  const needs = sql`(d.type IN (${list(always)}) OR (d.type IN (${list(valued)}) AND EXISTS (
      SELECT 1 FROM transactions t
       WHERE t.document_id = d.id AND t.is_deleted = 0 AND t.reversal_of_id IS NULL
         AND t.type IN ('in', 'out') AND t.quantity * t.unit_price > 0)))`;
  const hasVoucher = sql`EXISTS (SELECT 1 FROM journal_vouchers v WHERE v.source_document_id = d.id AND v.is_deleted = 0)`;

  const result = await executor.execute(sql`
    SELECT d.type AS doc_type,
           COUNT(*)::int AS total_docs,
           COUNT(*) FILTER (WHERE ${needs})::int AS need_voucher,
           COUNT(*) FILTER (WHERE ${needs} AND ${hasVoucher})::int AS with_voucher
      FROM documents d
     WHERE d.is_deleted = 0 AND d.status = 'final' AND d.type IN (${list(AUTOMATION_DOC_TYPES)})
     GROUP BY d.type`);

  const byType = new Map((result.rows as Array<{ doc_type: string; total_docs: number; need_voucher: number; with_voucher: number }>)
    .map(r => [r.doc_type, r]));
  const report = AUTOMATION_DOC_TYPES.map((docType: AutomationDocType) => {
    const row = byType.get(docType);
    return automationRow(docType, {
      totalDocs: Number(row?.total_docs ?? 0),
      needVoucher: Number(row?.need_voucher ?? 0),
      withVoucher: Number(row?.with_voucher ?? 0),
    });
  });
  return { report, summary: summarizeAutomation(report) };
}
