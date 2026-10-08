import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { ConflictError } from '../../errors/customErrors.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { VOUCHER_SOURCE_KINDS, VOUCHER_SOURCE_LABELS, type VoucherSourceKind } from '../../lib/accounting/voucherSource.js';

/**
 * v9.0.294 (TD-552، B03-10، تصمیم ت۸ الف): منشأ هر سند حسابداری. پیوندها همان ستون‌هایی‌اند که ابطال منشأ با آن‌ها سند را
 * می‌یابد: `source_document_id` (سند انبار، فاکتور، انبارگردانی)، `source_payroll_id`، `source_cheque_id` یا `cheques.voucher_id`،
 * `source_bom_allocation_id` و `treasury_transactions.voucher_id` (دریافت، پرداخت، انتقال، پرداخت فیش). سند برگشت
 * (`REV-V…`، `VOID-REPOST-V…`، `RE-REV-V…`) منشأ سند اصلی‌اش را دارد. پیوند قدیمی (`reference_module`، `reference_id`)
 * شمرده نمی‌شود، چون `reference_id` سند اصلاحی شناسه سند حسابداری است، نه منشأ.
 */
export async function voucherSourceKinds(executor: DbExecutor, voucherIds: number[]): Promise<Map<number, VoucherSourceKind>> {
  const ids = Array.from(new Set(voucherIds.filter(id => Number.isInteger(id) && id > 0)));
  const kinds = new Map<number, VoucherSourceKind>();
  if (ids.length === 0) return kinds;
  const res = await executor.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT v.id AS voucher_id, v.id AS cur_id, v.reference_number, v.reference_id, 0 AS depth
        FROM journal_vouchers v
       WHERE v.id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
      UNION ALL
      SELECT c.voucher_id, o.id, o.reference_number, o.reference_id, c.depth + 1
        FROM chain c
        JOIN journal_vouchers o ON o.id = c.reference_id
       WHERE c.depth < 5 AND c.reference_number ~ '^(REV-V|VOID-REPOST-V|RE-REV-V)'
    )
    SELECT DISTINCT ON (c.voucher_id) c.voucher_id,
           CASE
             WHEN x.source_document_id IS NOT NULL THEN 'document'
             WHEN x.source_payroll_id IS NOT NULL THEN 'payroll'
             WHEN x.source_cheque_id IS NOT NULL OR EXISTS (SELECT 1 FROM cheques ch WHERE ch.voucher_id = x.id) THEN 'cheque'
             WHEN x.source_bom_allocation_id IS NOT NULL THEN 'bom_allocation'
             WHEN EXISTS (SELECT 1 FROM treasury_transactions t WHERE t.voucher_id = x.id) THEN 'treasury'
           END AS kind
      FROM chain c
      JOIN journal_vouchers x ON x.id = c.cur_id
     WHERE x.source_document_id IS NOT NULL OR x.source_payroll_id IS NOT NULL OR x.source_cheque_id IS NOT NULL
        OR x.source_bom_allocation_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM cheques ch WHERE ch.voucher_id = x.id)
        OR EXISTS (SELECT 1 FROM treasury_transactions t WHERE t.voucher_id = x.id)
     ORDER BY c.voucher_id, c.depth`);
  for (const row of res.rows as Array<{ voucher_id: number | string; kind: string | null }>) {
    if (row.kind && (VOUCHER_SOURCE_KINDS as readonly string[]).includes(row.kind)) kinds.set(Number(row.voucher_id), row.kind as VoucherSourceKind);
  }
  return kinds;
}

export async function voucherSourceKind(executor: DbExecutor, voucherId: number): Promise<VoucherSourceKind | null> {
  return (await voucherSourceKinds(executor, [voucherId])).get(voucherId) ?? null;
}

/**
 * سند منشأدار از صفحه اسناد حسابداری فقط تأیید و قطعی می‌شود؛ `action` کار ردشده است («حذف نمی‌شود»، «ویرایش نمی‌شود»، …).
 * فراخواننده سند را پیش‌تر در همان تراکنش قفل کرده است.
 */
export async function assertVoucherWithoutSource(
  tx: DbExecutor,
  voucher: { id: number; voucherNumber: string | number; referenceNumber?: string | null },
  action: string,
): Promise<void> {
  const kind = await voucherSourceKind(tx, voucher.id);
  if (!kind) return;
  const label = VOUCHER_SOURCE_LABELS[kind];
  const number = toPersianDigits(String(voucher.voucherNumber));
  const reversal = /^(REV-V|VOID-REPOST-V|RE-REV-V)/.test(voucher.referenceNumber ?? '');
  const message = reversal
    ? `سند شماره «${number}» برگشت سندی است که ${label} صادر کرده و از اسناد حسابداری ${action}؛ اثر ${label} فقط از خود آن تغییر می‌کند.`
    : `سند شماره «${number}» را ${label} صادر کرده است و از اسناد حسابداری ${action}؛ برای تغییر آن، ${label} را ابطال و در صورت نیاز دوباره ثبت کنید.`;
  throw new ConflictError(message, { voucherId: voucher.id, sourceKind: kind }, 'VOUCHER_HAS_SOURCE');
}
