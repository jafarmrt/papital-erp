import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/drizzle.js';
import { journalVoucherItems, journalVouchers } from '../../../db/schema.js';
import { ValidationError } from '../../../errors/customErrors.js';
import { fin, type FinancialDecimal } from '../../../lib/financialDecimal.js';
import { PARTNER_ACCOUNT_CURRENCY } from '../../../lib/accounting/runningAccount.js';

/**
 * v12 colleague sales part B2 (docs/roadmap/V12_COLLEAGUE_SALES_START_PLAN.md, owner's decisions of 7 Azar 1405): a
 * partner's debt on «حساب جاری شرکا» (mapped 4101, their personnel detail) is fixed in euros. A treasury receipt from the
 * partner (or a payment to them) of the use «حساب جاری شریک» moves it in euros:
 *
 * - a euro row is that many euros at the bank row's rate; a rial row is turned into euros at the euro rate typed with it;
 * - the euros that settle the open balance (a receipt against what the partner owes, a payment against what the company
 *   owes them) leave it at the balance's **average rate** (its rials over its euros), so a part payment leaves the rest at
 *   the same rate; euros beyond the balance go on at the move's own rate;
 * - the rial difference between the bank row and the partner row goes to «سود تسعیر ارز» (5201) or «زیان تسعیر ارز»
 *   (7008), never to the partner's account.
 *
 * Every rial amount is rounded to the rial per row, as the ledger reads a foreign row (TD-260), so the voucher balances.
 * The caller passes the mapped accounts, so this treasury file imports no other core package (package boundary).
 */

export interface PartnerMoveAccounts {
  partner: { id: number } | null;
  gain: { id: number } | null;
  loss: { id: number } | null;
}

export interface PartnerOpenBalance {
  /** euros the partner owes (above zero) or is owed (below zero) */
  euro: FinancialDecimal;
  /** the same balance in rials, as the ledger reads it */
  rial: FinancialDecimal;
}

/** The partner's open balance on 4101 (every live voucher row of their detail, draft or approved) */
export async function partnerOpenBalance(tx: DbExecutor, accountId: number, personnelId: number): Promise<PartnerOpenBalance> {
  const rows = await tx.select({
    debit: journalVoucherItems.debit, credit: journalVoucherItems.credit,
    currency: journalVoucherItems.currency, exchangeRate: journalVoucherItems.exchangeRate,
  }).from(journalVoucherItems)
    .innerJoin(journalVouchers, eq(journalVoucherItems.voucherId, journalVouchers.id))
    .where(and(
      eq(journalVoucherItems.accountId, accountId),
      eq(journalVoucherItems.detailedType, 'personnel'),
      eq(journalVoucherItems.detailedId, personnelId),
      eq(journalVouchers.isDeleted, 0),
      eq(journalVoucherItems.isDeleted, 0),
    ));
  let euro = fin(0);
  let rial = fin(0);
  for (const r of rows) {
    const net = fin(r.debit).subtract(fin(r.credit));
    const currency = String(r.currency || 'IRR').trim().toUpperCase();
    if (currency === PARTNER_ACCOUNT_CURRENCY) {
      euro = euro.add(net);
      rial = rial.add(net.multiply(fin(r.exchangeRate ?? 1)).round(0));
    } else {
      rial = rial.add(currency === 'IRR' ? net : net.multiply(fin(r.exchangeRate ?? 1)).round(0));
    }
  }
  return { euro, rial };
}

export interface PartnerMoveRow {
  accountId: number;
  detailedType: string;
  detailedId: number | null;
  detailedName: string;
  debit: FinancialDecimal;
  credit: FinancialDecimal;
  currency: string;
  exchangeRate: FinancialDecimal;
  description: string;
}

export interface PartnerMoveInput {
  type: 'receipt' | 'payment';
  personnelId: number;
  partnerName: string;
  /** the row's amount, in its own currency */
  amount: FinancialDecimal;
  /** the row's currency: euros or rials */
  currency: string;
  /** the bank row's rate (rials per unit of `currency`; 1 for rials) */
  rate: FinancialDecimal;
  /** rials per euro for a rial row (typed with it); not used for a euro row */
  euroRate?: FinancialDecimal | null;
  bankRow: { accountId: number; detailedType: string; detailedId: number | null; detailedName: string };
  description: string;
}

export interface PartnerMove {
  rows: PartnerMoveRow[];
  /** the euros the move takes off (receipt) or puts on (payment) the partner's account */
  euros: FinancialDecimal;
  /** rials of exchange gain (above zero) or loss (below zero) */
  exchange: FinancialDecimal;
}

const unreadable = (label: string) =>
  new ValidationError(`حساب «${label}» در نگاشت حساب‌ها پیدا نشد؛ دریافت و پرداخت حساب جاری شریک بی آن ثبت نمی‌شود.`, undefined, 'ACCOUNT_MAPPING_UNREADABLE');

/** The rial currency check and the euro rate of a partner move, before anything is locked or written */
export function partnerMoveEuroRate(currency: string, rate: FinancialDecimal, euroRate: FinancialDecimal | null | undefined): FinancialDecimal {
  const code = currency.trim().toUpperCase();
  if (code === PARTNER_ACCOUNT_CURRENCY) return rate;
  if (code !== 'IRR') {
    throw new ValidationError('حساب جاری شریک به یورو است؛ دریافت یا پرداخت آن یورویی یا ریالی (با نرخ یورو) ثبت می‌شود.', { currency: code }, 'TREASURY_PARTNER_ACCOUNT_CURRENCY');
  }
  if (!euroRate || !euroRate.isPositive()) {
    throw new ValidationError('برای دریافت یا پرداخت ریالیِ حساب جاری شریک، نرخ یورو (ریال برای هر یورو) را وارد کنید تا مبلغ به یورو حساب شود.', undefined, 'TREASURY_PARTNER_EURO_RATE_REQUIRED');
  }
  return euroRate;
}

/** The voucher rows of a partner move: the bank row, the partner's euro row and, when the rates differ, the exchange row */
export async function partnerMoveRows(tx: DbExecutor, input: PartnerMoveInput, accounts: PartnerMoveAccounts): Promise<PartnerMove> {
  const account = accounts.partner;
  if (!account) throw unreadable('حساب جاری شرکا');
  const code = input.currency.trim().toUpperCase();
  const euroRate = partnerMoveEuroRate(code, input.rate, input.euroRate);
  const euros = code === PARTNER_ACCOUNT_CURRENCY ? input.amount : input.amount.divide(euroRate).round(4);
  if (!euros.isPositive()) throw new ValidationError('مبلغ یورویی این دریافت یا پرداخت صفر می‌شود؛ مبلغ یا نرخ را درست کنید.', undefined, 'TREASURY_PARTNER_EURO_ZERO');
  const bankRial = (code === 'IRR' ? input.amount : input.amount.multiply(input.rate)).round(0);

  const open = await partnerOpenBalance(tx, account.id, input.personnelId);
  // a receipt settles what the partner owes; a payment settles what the company owes them
  const settleable = input.type === 'receipt' ? (open.euro.isPositive() ? open.euro : fin(0)) : (open.euro.isNegative() ? open.euro.negate() : fin(0));
  const averageRate = settleable.isPositive() ? open.rial.abs().divide(open.euro.abs()) : euroRate;
  const settled = euros.greaterThan(settleable) ? settleable : euros;
  const rest = euros.subtract(settled);
  const partnerRialWanted = settled.multiply(averageRate).add(rest.multiply(euroRate)).round(0);
  // the row's own rate, and the rials the ledger reads from it
  const partnerRate = partnerRialWanted.divide(euros).round(4);
  const partnerRial = euros.multiply(partnerRate).round(0);
  // receipt: bank in, partner out; payment: partner in, bank out
  const exchange = input.type === 'receipt' ? bankRial.subtract(partnerRial) : partnerRial.subtract(bankRial);

  const partnerRow = {
    accountId: account.id, detailedType: 'personnel', detailedId: input.personnelId, detailedName: input.partnerName,
    currency: PARTNER_ACCOUNT_CURRENCY, exchangeRate: partnerRate, description: input.description,
  };
  const bankRow = { ...input.bankRow, currency: code, exchangeRate: code === 'IRR' ? fin(1) : input.rate, description: input.description };
  const rows: PartnerMoveRow[] = input.type === 'receipt'
    ? [{ ...bankRow, debit: input.amount, credit: fin(0) }, { ...partnerRow, debit: fin(0), credit: euros }]
    : [{ ...partnerRow, debit: euros, credit: fin(0) }, { ...bankRow, debit: fin(0), credit: input.amount }];
  if (!exchange.isZero()) {
    const gain = exchange.isPositive();
    const fxAccount = gain ? accounts.gain : accounts.loss;
    if (!fxAccount) throw unreadable(gain ? 'سود تسعیر ارز' : 'زیان تسعیر ارز');
    rows.push({
      accountId: fxAccount.id, detailedType: 'personnel', detailedId: input.personnelId, detailedName: input.partnerName,
      debit: gain ? fin(0) : exchange.abs(), credit: gain ? exchange : fin(0), currency: 'IRR', exchangeRate: fin(1),
      description: `${gain ? 'سود' : 'زیان'} تسعیر ${input.type === 'receipt' ? 'دریافت' : 'پرداخت'} یورویی حساب جاری شریک ${input.partnerName}`,
    });
  }
  return { rows, euros, exchange };
}
