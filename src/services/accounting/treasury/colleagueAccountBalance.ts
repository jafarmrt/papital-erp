import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/drizzle.js';
import { journalVoucherItems, journalVouchers } from '../../../db/schema.js';
import { fin, type FinancialDecimal } from '../../../lib/financialDecimal.js';

/**
 * v11 (the 1405 replay, tool 4): a colleague's running account balance — credit minus debit of the colleague current
 * account (mapped, 3208) on that colleague's detail, over every live voucher line (draft or approved). Above zero the
 * company owes the colleague (expenses they paid); below zero the colleague holds the company's money (petty cash given).
 * The caller passes the mapped account, so this core file imports no other core (package boundary).
 */
export async function colleagueAccountBalance(tx: DbExecutor, accountId: number, personnelId: number): Promise<FinancialDecimal> {
  const rows = await tx.select({ debit: journalVoucherItems.debit, credit: journalVoucherItems.credit })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVoucherItems.voucherId, journalVouchers.id))
    .where(and(
      eq(journalVoucherItems.accountId, accountId),
      eq(journalVoucherItems.detailedType, 'personnel'),
      eq(journalVoucherItems.detailedId, personnelId),
      eq(journalVouchers.isDeleted, 0),
      eq(journalVoucherItems.isDeleted, 0),
    ));
  return rows.reduce((sum, r) => sum.add(r.credit).subtract(r.debit), fin(0));
}
