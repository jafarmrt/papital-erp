import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documents, journalVoucherItems, journalVouchers } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import { formatPersianPrice, toPersianDigits } from '../../utils/persianNumber.js';
import { assertNoOpenAllocations } from './projectOpenAllocations.js';
import { projectWipBalances } from '../accounting/projectWipBalance.js';
import { voucherItemReportAmountSql } from '../accounting/voucherItemAmount.js';
import { AccountMappingService } from '../accounting/accountMapping.service.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';

const LISTED = 5;

/**
 * v10.0.172 (TD-922، تصمیم ت۴ ب فاز ۵): پروژه‌ای که تخصیص باز (TD-412)، سند زنده (هر نوع و وضعیت) یا مانده کالای در
 * جریان ساخت (۱۴۰۲) دارد حذف نمی‌شود. پیش‌تر نگهبان فقط تخصیص باز را می‌دید و مانده ۱۴۰۲ روی پروژه حذف‌شده می‌ماند.
 * زیر قفل ردیف پروژه صدا زده می‌شود.
 */
/** The net of the project's live voucher lines on accounts other than WIP (`workInProgressCode`), or null when it is zero. */
async function projectExpenseBalance(tx: DbExecutor, projectId: number): Promise<string | null> {
  const wip = await AccountMappingService.resolveAccount('workInProgressCode', tx);
  const amount = sql<string>`COALESCE(SUM(${voucherItemReportAmountSql(journalVoucherItems.debit)} - ${voucherItemReportAmountSql(journalVoucherItems.credit)}), 0)::text`;
  const [row] = await tx.select({ balance: amount })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .where(and(
      eq(journalVouchers.isDeleted, 0), eq(journalVoucherItems.isDeleted, 0),
      eq(journalVoucherItems.detailedType, 'project'), eq(journalVoucherItems.detailedId, projectId),
      wip ? ne(journalVoucherItems.accountId, wip.id) : undefined,
    ));
  const balance = fin(row?.balance ?? '0');
  return balance.abs().lessThan(VOUCHER_BALANCE_TOLERANCE) ? null : balance.toString();
}

export async function assertProjectDeletable(tx: DbExecutor, project: { id: number; projectCode: string }): Promise<void> {
  await assertNoOpenAllocations(tx, project, 'حذف نمی‌شود');
  const live = await tx.select({ refNumber: documents.refNumber })
    .from(documents)
    .where(and(eq(documents.projectId, project.id), eq(documents.isDeleted, 0)))
    .orderBy(asc(documents.id));
  const wip = (await projectWipBalances(tx, [project.id])).get(project.id);
  const reasons: string[] = [];
  if (wip) {
    const side = fin(wip).isNegative() ? 'بستانکار' : 'بدهکار';
    reasons.push(`مانده کالای در جریان ساخت ${formatPersianPrice(fin(wip).abs().toString(), 'IRR', 0)} ${side}`);
  }
  if (live.length > 0) {
    const shown = live.slice(0, LISTED).map(d => String(d.refNumber ?? '')).join('، ');
    reasons.push(`سند انبار یا فروش ${shown}${live.length > LISTED ? ` و ${toPersianDigits(live.length - LISTED)} سند دیگر` : ''}`);
  }
  // v11 tool 5: an expense booked on the project (a treasury, petty cash or colleague expense line with the project as its
  // detail) keeps it, as the project summary reads it; a voided one nets to zero with its reversal
  const expense = await projectExpenseBalance(tx, project.id);
  if (expense) reasons.push(`هزینهٔ ثبت‌شده روی پروژه ${formatPersianPrice(fin(expense).abs().toString(), 'IRR', 0)}`);
  if (reasons.length === 0) return;
  throw new ConflictError(
    `پروژه «${project.projectCode}» حذف نمی‌شود: ${reasons.join('؛ ')}. سندها را باطل کنید و مانده را با سند اصلاحی ببندید، یا پروژه را «لغو» کنید.`,
    { wipBalance: wip ?? null, documentRefs: live.map(d => String(d.refNumber ?? '')) },
    'PROJECT_HAS_LEDGER_ITEMS',
  );
}
