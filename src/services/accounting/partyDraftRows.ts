import { and, asc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, journalVoucherItems, journalVouchers } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import type { PartyDraftRows } from '../../lib/accounting/partyDraftRows.js';
import { foreignOrigin, permanentAccountCondition } from './partyTemporaryRows.js';
import { voucherItemCurrencySql } from './voucherItemAmount.js';

/**
 * v11 phase 6.1t (U1): the party's rows of draft vouchers, by the rules of its card and statement (the party's rows, the
 * report currency and amounts, permanent accounts only). The listed rows are those in the range; the balance with drafts
 * adds every draft row up to the end of the range, since the approved balance counts every approved row up to it.
 */
export async function readPartyDraftRows(input: {
  partyRowsCondition: SQL;
  currencyCondition: SQL | undefined;
  startDate?: string;
  endDate?: string;
  debitAmount: SQL;
  creditAmount: SQL;
  reportCurrency: string;
  allCurrencies: boolean;
  approvedBalance: number;
}): Promise<PartyDraftRows> {
  const upToEnd = [
    eq(journalVouchers.isDeleted, 0),
    eq(journalVoucherItems.isDeleted, 0),
    eq(journalVouchers.status, 'draft'),
    input.partyRowsCondition,
    permanentAccountCondition(),
    input.currencyCondition,
    input.endDate ? lte(journalVouchers.date, input.endDate) : undefined,
  ].filter((c): c is SQL => c !== undefined);
  const inRange = input.startDate ? [...upToEnd, gte(journalVouchers.date, input.startDate)] : upToEnd;

  const rows = await orm.select({
    voucherId: journalVouchers.id,
    voucherNumber: journalVouchers.voucherNumber,
    date: journalVouchers.date,
    itemDescription: journalVoucherItems.description,
    voucherDescription: journalVouchers.description,
    accountName: accounts.name,
    accountCode: accounts.code,
    rowCurrency: voucherItemCurrencySql,
    debit: sql<string>`${input.debitAmount}::text`,
    credit: sql<string>`${input.creditAmount}::text`,
    originalDebit: journalVoucherItems.debit,
    originalCredit: journalVoucherItems.credit,
    exchangeRate: journalVoucherItems.exchangeRate,
  })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .innerJoin(accounts, eq(accounts.id, journalVoucherItems.accountId))
    .where(and(...inRange))
    .orderBy(asc(journalVouchers.date), asc(journalVouchers.voucherNumber), asc(journalVoucherItems.rowOrder));

  const [sum] = await orm.select({
    net: sql<string>`COALESCE(SUM(${input.debitAmount} - ${input.creditAmount}), 0)::text`,
  })
    .from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
    .innerJoin(accounts, eq(accounts.id, journalVoucherItems.accountId))
    .where(and(...upToEnd));

  let totalDebit = fin(0);
  let totalCredit = fin(0);
  const items = rows.map(r => {
    const debit = fin(r.debit);
    const credit = fin(r.credit);
    totalDebit = totalDebit.add(debit);
    totalCredit = totalCredit.add(credit);
    return {
      voucherId: r.voucherId,
      voucherNumber: r.voucherNumber,
      date: r.date,
      description: r.itemDescription || r.voucherDescription || 'ثبت سند حسابداری',
      accountCode: r.accountCode,
      accountName: r.accountName,
      currency: input.reportCurrency,
      debit: debit.toNumber(),
      credit: credit.toNumber(),
      ...foreignOrigin(input.allCurrencies, r),
    };
  });
  return {
    items,
    totalDebit: totalDebit.round(4).toNumber(),
    totalCredit: totalCredit.round(4).toNumber(),
    voucherCount: new Set(items.map(i => i.voucherId)).size,
    balanceWithDrafts: fin(input.approvedBalance).add(fin(sum?.net ?? 0)).round(4).toNumber(),
  };
}
