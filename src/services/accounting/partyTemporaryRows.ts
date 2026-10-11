import { and, asc, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, journalVoucherItems, journalVouchers } from '../../db/schema.js';
import { fin, type DecimalValue } from '../../lib/financialDecimal.js';
import { TEMPORARY_ACCOUNT_TYPES, type PartyTemporaryRows } from '../../lib/accounting/partyTemporaryRows.js';
import type { ForeignAmountOrigin } from '../../types.js';
import { voucherItemCurrencySql } from './voucherItemAmount.js';

/**
 * v10.0.255 (TD-915 / TD-924، تصمیم ت۵ الف): شرط حساب دائم و موقت روی ردیف سند (پرس‌وجو باید `accounts` را join کرده
 * باشد)، و ردیف‌های موقت طرف حساب که صورت‌حساب و کارت حساب او جدا و بیرون از مانده نشان می‌دهند.
 */
export function permanentAccountCondition(): SQL {
  return notInArray(accounts.accountType, [...TEMPORARY_ACCOUNT_TYPES]);
}

export function temporaryAccountCondition(): SQL {
  return inArray(accounts.accountType, [...TEMPORARY_ACCOUNT_TYPES]);
}

/** v8.0.16 (TD-260): ارز، مبلغ و نرخ اصلی ردیف ارزی که در نمای همه ارزها به ریال تبدیل شده است */
export function foreignOrigin(allCurrencies: boolean, row: {
  rowCurrency: string;
  originalDebit: DecimalValue | null;
  originalCredit: DecimalValue | null;
  exchangeRate: DecimalValue | null;
}): ForeignAmountOrigin {
  if (!allCurrencies || row.rowCurrency === 'IRR') return {};
  return {
    originalCurrency: row.rowCurrency,
    originalDebit: fin(row.originalDebit).toNumber(),
    originalCredit: fin(row.originalCredit).toNumber(),
    exchangeRate: fin(row.exchangeRate ?? 1).toNumber(),
  };
}

/**
 * ردیف‌های حساب موقت در همان بازه و شرط‌های گزارش (`periodConditions` بی شرط نوع حساب)، با همان مبلغ گزارش
 * (`debitAmount` / `creditAmount` با قاعده ارز TD-260).
 */
export async function readPartyTemporaryRows(input: {
  periodConditions: SQL[];
  debitAmount: SQL;
  creditAmount: SQL;
  reportCurrency: string;
  allCurrencies: boolean;
}): Promise<PartyTemporaryRows> {
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
    .where(and(...input.periodConditions, temporaryAccountCondition()))
    .orderBy(asc(journalVouchers.date), asc(journalVouchers.voucherNumber), asc(journalVoucherItems.rowOrder));

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
  return { items, totalDebit: totalDebit.round(4).toNumber(), totalCredit: totalCredit.round(4).toNumber() };
}
