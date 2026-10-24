import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/drizzle.js';
import { bankAccounts, treasuryTransactions } from '../../../db/schema.js';
import { NotFoundError, ValidationError } from '../../../errors/customErrors.js';
import { businessTodayIsoDate } from '../../../lib/businessClock.js';
import { fin, type DecimalValue, type FinancialDecimal } from '../../../lib/financialDecimal.js';
import { money, moneyOr } from '../../../lib/money.js';
import { formatPersianNumber } from '../../../utils/persianNumber.js';
import { domainEventBus } from '../../events/domainEventBus.js';
import { DomainEventType } from '../../events/domainEvents.js';
import { OutboxService } from '../../events/outboxService.js';
import { isHighValueAmount, treasuryHighValueThreshold, treasuryRowIsHighValue } from './treasuryHighValue.js';

/**
 * v10.2.2 (OBS-R2-52، بسته ۴ برنامه ۱۰.۲): راه یگانه ثبت و ابطال یک ردیف خزانه. دریافت و پرداخت فرم خزانه، پرداخت فیش
 * حقوق، صورت‌هزینه تنخواه و پرداخت ماهانه بیمه و مالیات، و ابطال هر کدام، همه از همین دو تابع می‌گذرند تا یک‌جور سنجیده
 * شوند: ارز ردیف همان ارز حساب، سرفصل حسابداری حساب پیش از صدور سند، مانده هرگز منفی، شماره از دنباله خزانه، سند در همان
 * تراکنش و رویداد «تراکنش خزانه تأیید شد» در صف ارسال. پیش‌تر پرداخت و ابطال پرداخت فیش مانده بانک و ردیف خزانه را خودشان
 * می‌نوشتند. فراخواننده حساب را با `lockTreasuryBank` (یا `lockTreasuryBankRow` / `lockTreasuryBanks`) پیش از هر قفل دیگر می‌گیرد و قاعده‌های دامنه
 * خودش (فیش، سند، تنخواه) را پیش از این توابع می‌سنجد؛ ردیف‌های ویژه (فیش، صورت‌هزینه) را پس از آن می‌نویسد.
 */

export type TreasuryBank = typeof bankAccounts.$inferSelect;
export type TreasuryRow = typeof treasuryTransactions.$inferSelect;

declare const lockedBankBrand: unique symbol;
/**
 * 10.3 package 4 (10.2 backlog, review of #320): a bank row read FOR UPDATE in the caller's transaction. Only the lock
 * helpers below make one, and the balance writers (`postTreasuryRow`, `reverseTreasuryRow`) take nothing else, so a
 * write that forgot the bank lock does not compile; before, "the caller has locked the row" was only a comment. Vitest
 * `lockedTreasuryBank.test.ts` refuses a cast to this type anywhere else.
 */
export type LockedTreasuryBank = TreasuryBank & { readonly [lockedBankBrand]: true };

interface EventActor {
  userId?: number;
  username?: string;
}

/**
 * ۱۰.۲ بسته ۸ (TD-1297): رویداد «تراکنش خزانه تأیید شد» مبلغ، شرح و دلیل ابطال ندارد، چون به هر وبهوک و قاعده خودکاری
 * که این رویداد را بگیرد می‌رسد و شرح ردیف نام طرف حساب و مبلغ را در خود دارد؛ فقط شناسه ردیف، نوع، ارز و حساب می‌ماند.
 * فرم خزانه، انتقال میان حساب‌ها، صورت‌هزینه تنخواه، پرداخت ماهانه بیمه و مالیات و فیش حقوق همه از این‌جا می‌گذرند.
 * به‌جای مبلغ فقط `isHighValue` (ارزش ریالی ردیف دست‌کم «آستانه تراکنش کلان خزانه») می‌آید، جز در فیش حقوق.
 */
export const TREASURY_EVENT_PRIVATE_KEYS: readonly string[] = ['amount', 'description', 'reason'];

export function treasuryEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !TREASURY_EVENT_PRIVATE_KEYS.includes(key)));
}

/**
 * the event of one treasury row: the caller's payload without the private keys, plus `isHighValue` (review M-3,
 * `treasuryRowIsHighValue`) unless the row is a payslip payment or its void, whose event carries nothing derived from
 * the amount
 */
export { isHighValueAmount, treasuryHighValueThreshold };

async function treasuryRowEventPayload(tx: DbExecutor, row: TreasuryRow, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const event = treasuryEventPayload(payload);
  if (row.payrollId) return event;
  return { ...event, isHighValue: await treasuryRowIsHighValue(tx, row) };
}

/**
 * a bank row FOR UPDATE, live only unless `includeDeleted` (the void of an old payslip payment); undefined when there is
 * none, so the caller refuses with its own message
 */
export async function lockTreasuryBankRow(
  tx: DbExecutor, bankAccountId: number, options: { includeDeleted?: boolean } = {},
): Promise<LockedTreasuryBank | undefined> {
  const [bank] = await tx.select().from(bankAccounts)
    .where(options.includeDeleted ? eq(bankAccounts.id, bankAccountId) : and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.isDeleted, 0)))
    .for('update');
  return bank as LockedTreasuryBank | undefined;
}

/** حساب زنده خزانه را برای تغییر مانده قفل می‌کند (FOR UPDATE)؛ نخستین قفل هر نوشتن خزانه */
export async function lockTreasuryBank(tx: DbExecutor, bankAccountId: number): Promise<LockedTreasuryBank> {
  const bank = await lockTreasuryBankRow(tx, bankAccountId);
  if (!bank) throw new NotFoundError('حساب بانکی یا صندوق انتخاب‌شده یافت نشد');
  return bank;
}

/** the live banks of these ids FOR UPDATE in id order (one lock level, so two writers never wait on each other in a circle) */
export async function lockTreasuryBanks(tx: DbExecutor, bankAccountIds: readonly number[]): Promise<LockedTreasuryBank[]> {
  const ids = [...new Set(bankAccountIds)].sort((a, b) => a - b);
  if (ids.length === 0) return [];
  const banks = await tx.select().from(bankAccounts)
    .where(and(inArray(bankAccounts.id, ids), eq(bankAccounts.isDeleted, 0)))
    .orderBy(asc(bankAccounts.id))
    .for('update');
  return banks as LockedTreasuryBank[];
}

/** شماره ردیف خزانه از دنباله اتمیک `treasury_tx_number_seq` (هرگز شمارش یا بیشینه + ۱) */
export async function nextTreasuryTransactionNumber(type: 'receipt' | 'payment', tx: DbExecutor): Promise<string> {
  const result = await tx.execute(sql`SELECT nextval('treasury_tx_number_seq') AS num`);
  const seqNum = Number(result.rows?.[0]?.num);
  return `${type === 'receipt' ? 'REC' : 'PAY'}-${String(seqNum).padStart(6, '0')}`;
}

const currencyKey = (currency: string) => currency.trim().toUpperCase();

/**
 * V1.4.0: ردیف هم‌ارز حساب است تا مانده‌ها معنادار بمانند؛ حساب بی ارز هر ارزی را می‌پذیرد. کد ارز بی‌توجه به بزرگی و
 * کوچکی حروف سنجیده می‌شود، چون تنخواه قدیمی با ارز ذخیره‌شده «irr» پیش از این راه یگانه پذیرفته می‌شد.
 */
export function assertBankCurrency(bank: TreasuryBank, currency: string): void {
  if (bank.currency && currencyKey(currency) !== currencyKey(bank.currency)) {
    throw new ValidationError(`ارز تراکنش (${currency}) با ارز حساب «${bank.title}» (${bank.currency}) هم‌خوانی ندارد. تراکنش هم‌ارز ثبت کنید.`);
  }
}

/** همان متن پیام‌های پیشین فرم خزانه و پرداخت بیمه: رقم فارسی با جداکننده «٬»، بی واحد */
const balanceText = (balance: FinancialDecimal) => formatPersianNumber(balance.toString(), 4);

/**
 * ردیف ابطال‌شده‌ای که مانده حساب را تکان داده بود. ردیف روش «چک» فرم خزانه (پیش از v8.0.26، TD-148) مانده را تغییر
 * نداده بود و ابطالش هم تغییر نمی‌دهد؛ پرداخت فیش با روش «چک» (پیش از v8.0.120، TD-411) فقط برچسب بود و بانک همان روز
 * بستانکار شده بود، پس ابطالش مانده را برمی‌گرداند، همان کاری که ابطال پرداخت فیش از v8.0.31 کرده است.
 */
export function movedBankBalance(row: Pick<TreasuryRow, 'method' | 'payrollId'>): boolean {
  return row.method !== 'cheque' || row.payrollId !== null;
}

async function writeBankBalance(
  tx: DbExecutor,
  bank: LockedTreasuryBank,
  direction: 'in' | 'out',
  amount: FinancialDecimal,
  refusal: (balance: FinancialDecimal) => Error,
): Promise<void> {
  const balance = fin(bank.currentBalance);
  const next = (direction === 'in' ? balance.add(amount) : balance.subtract(amount)).round(4);
  // V1.4.0: سیاست مانده منفی ممنوع
  if (next.isNegative()) throw refusal(balance);
  await tx.update(bankAccounts).set({ currentBalance: money(next) }).where(eq(bankAccounts.id, bank.id));
  bank.currentBalance = money(next);
}

export interface TreasuryRowPosting {
  type: 'receipt' | 'payment';
  /** تاریخ ISO که `resolveTreasuryWriteDate` خوانده است */
  date: string;
  method: string;
  amount: DecimalValue;
  currency: string;
  exchangeRate: DecimalValue;
  partyType: string;
  partyId: number | null;
  partyName: string;
  purpose?: string | null;
  contraAccountId?: number | null;
  trackingNumber?: string;
  documentId?: number | null;
  payrollId?: number | null;
  /** شرح ذخیره‌شده روی ردیف */
  description: string;
  createdById?: number | null;
  /** سند ردیف را با شماره آن در همین تراکنش صادر می‌کند؛ null یعنی ردیف بی سند (فقط با مجوز TD-409) */
  voucher: ((transactionNumber: string) => Promise<{ id: number }>) | null;
  /** داده رویداد «تراکنش خزانه تأیید شد» ردیف درج‌شده (بی مبلغ و شرح، `treasuryEventPayload`) */
  event: (rowId: number) => Record<string, unknown>;
  actor: EventActor;
  /** پیام خود فراخواننده برای کمبود مانده (تنخواه)؛ پیش‌فرض `TREASURY_BALANCE_INSUFFICIENT` */
  insufficientBalance?: (balance: FinancialDecimal) => Error;
}

export interface PostedTreasuryRow {
  row: TreasuryRow;
  transactionNumber: string;
  voucherId: number | null;
}

/** یک دریافت یا پرداخت خزانه: مانده حساب، شماره، سند، ردیف و رویداد آن، همه با `tx` فراخواننده */
export async function postTreasuryRow(tx: DbExecutor, bank: LockedTreasuryBank, posting: TreasuryRowPosting): Promise<PostedTreasuryRow> {
  const amount = fin(posting.amount).round(4);
  if (!amount.isPositive()) throw new ValidationError('مبلغ تراکنش باید بزرگتر از صفر باشد');
  assertBankCurrency(bank, posting.currency);
  if (posting.voucher && !bank.accountId) {
    throw new ValidationError('حساب معین مرتبط در چارت حساب‌ها برای این حساب بانکی/صندوق تعریف نشده است', undefined, 'BANK_LEDGER_ACCOUNT_INVALID');
  }

  await writeBankBalance(tx, bank, posting.type === 'receipt' ? 'in' : 'out', amount, posting.insufficientBalance ?? (balance =>
    new ValidationError(`مانده حساب «${bank.title}» کافی نیست (مانده فعلی: ${balanceText(balance)})`, undefined, 'TREASURY_BALANCE_INSUFFICIENT')));

  const transactionNumber = await nextTreasuryTransactionNumber(posting.type, tx);
  const voucherId = posting.voucher ? (await posting.voucher(transactionNumber)).id : null;

  const [row] = await tx.insert(treasuryTransactions).values({
    transactionNumber,
    type: posting.type,
    date: posting.date,
    method: posting.method,
    amount: money(amount),
    currency: posting.currency,
    exchangeRate: money(posting.exchangeRate),
    bankAccountId: bank.id,
    partyType: posting.partyType,
    partyId: posting.partyId,
    partyName: posting.partyName,
    purpose: posting.purpose ?? null,
    contraAccountId: posting.contraAccountId ?? null,
    trackingNumber: posting.trackingNumber ?? '',
    voucherId,
    documentId: posting.documentId ?? null,
    payrollId: posting.payrollId ?? null,
    description: posting.description,
    status: 'completed',
    attachments: [],
    createdById: posting.createdById ?? null,
  }).returning();

  await OutboxService.saveToOutbox(tx, domainEventBus.createEvent(
    DomainEventType.TREASURY_TRANSACTION_APPROVED, 'Treasury', String(row.id), await treasuryRowEventPayload(tx, row, posting.event(row.id)),
    { userId: posting.actor.userId, userName: posting.actor.username },
  ));
  return { row, transactionNumber, voucherId };
}

export interface TreasuryRowReversal {
  /** سند معکوسی که `voidSourceVoucher` پیش از این تابع ساخت (سند پیش‌نویس حذف نرم می‌شود و معکوس ندارد) */
  reversalVoucherId: number | null;
  description: string;
  createdById?: number | null;
  event: (reversal: TreasuryRow) => Record<string, unknown>;
  actor: EventActor;
}

/**
 * V1.4.0 (DB-009): ابطال یک ردیف خزانه با ردیف معکوس — مانده حساب برمی‌گردد، ردیف معکوس (دریافت ↔ پرداخت) با شماره تازه
 * و `reversal_of_id` درج، اصل «باطل‌شده» (بی حذف) و رویداد آن در صف ارسال نوشته می‌شود. ردیف معکوس پیوندهای اصل (سند،
 * چک، فیش، سرفصل طرف مقابل) را نگه می‌دارد.
 */
export async function reverseTreasuryRow(
  tx: DbExecutor,
  original: TreasuryRow,
  bank: LockedTreasuryBank,
  reversal: TreasuryRowReversal,
): Promise<TreasuryRow> {
  const amount = fin(original.amount);
  if (movedBankBalance(original)) {
    await writeBankBalance(tx, bank, original.type === 'receipt' ? 'out' : 'in', amount, balance =>
      new ValidationError(`ابطال ممکن نیست: مانده فعلی «${bank.title}» (${balanceText(balance)}) برای برگشت این وجه کافی نیست`, undefined, 'TREASURY_BALANCE_INSUFFICIENT'));
  }

  const reversalType = original.type === 'receipt' ? 'payment' : 'receipt';
  const [row] = await tx.insert(treasuryTransactions).values({
    transactionNumber: await nextTreasuryTransactionNumber(reversalType, tx),
    type: reversalType,
    date: await businessTodayIsoDate(),
    method: original.method,
    amount: money(amount),
    currency: original.currency || bank.currency || 'IRR',
    exchangeRate: moneyOr(original.exchangeRate, 1),
    bankAccountId: original.bankAccountId,
    partyType: original.partyType,
    partyId: original.partyId,
    partyName: original.partyName,
    purpose: original.purpose,
    contraAccountId: original.contraAccountId,
    trackingNumber: original.trackingNumber || '',
    voucherId: reversal.reversalVoucherId,
    chequeId: original.chequeId || null,
    documentId: original.documentId || null,
    payrollId: original.payrollId || null,
    reversalOfId: original.id,
    description: reversal.description,
    status: 'completed',
    createdById: reversal.createdById ?? null,
  }).returning();

  await tx.update(treasuryTransactions)
    .set({ status: 'voided', updatedAt: sql`now()` })
    .where(eq(treasuryTransactions.id, original.id));

  await OutboxService.saveToOutbox(tx, domainEventBus.createEvent(
    DomainEventType.TREASURY_TRANSACTION_APPROVED, 'Treasury', String(row.id), await treasuryRowEventPayload(tx, row, reversal.event(row)),
    { userId: reversal.actor.userId, userName: reversal.actor.username },
  ));
  return row;
}
