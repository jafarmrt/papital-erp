import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, bankAccounts, pieceworkPayrolls } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { BankAccountService } from '../../services/accounting/treasury/bankAccount.service.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import type { TreasuryImportResult, TreasuryImportRow } from '../../lib/historyImport/treasuryHistoryImport.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';
import { addLog, fundedBank, issueApproved, newTask, newWorker } from '../invariants/payrollScenarios.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';
import { brief, ok, world } from './receiptsOnInvoicesV11Tests.js';

/**
 * v11 history import, tool 1 (the 1405 replay from Excel): receipts, payments, transfers and payslip payments posted at once
 * through the services a hand entry uses. Real Express routes and services on PostgreSQL, each scenario in its own schema
 * with the standard chart of accounts. Red before this change: the route did not exist (404).
 */

const URL = '/api/accounting/treasury/history-import';
const SHEET = 'دریافت و پرداخت';

type Admin = Awaited<ReturnType<typeof sandboxAdminClient>>;

const count = async (query: ReturnType<typeof sql>) => Number(((await orm.execute(query)).rows[0] as { n: number | string }).n);
const footprint = async () => ({
  treasury: await count(sql`SELECT count(*)::int AS n FROM treasury_transactions`),
  vouchers: await count(sql`SELECT count(*)::int AS n FROM journal_vouchers`),
  parts: await count(sql`SELECT count(*)::int AS n FROM settlement_allocations`),
  audit: await count(sql`SELECT count(*)::int AS n FROM activity_logs`),
  outbox: await count(sql`SELECT count(*)::int AS n FROM outbox_events`),
  voucherSeq: await count(sql`SELECT last_value::bigint AS n FROM journal_voucher_number_seq`),
  treasurySeq: await count(sql`SELECT last_value::bigint AS n FROM treasury_tx_number_seq`),
});
const balanceOf = async (id: number) => {
  const [b] = await orm.select({ v: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, id));
  return fin(b?.v ?? 0).toNumber();
};

/** A bank account with its own ledger account under 1003 and no balance */
async function emptyBank(): Promise<number> {
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
  const code = `1003${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const [ledger] = await orm.insert(accounts).values({
    code, name: 'بانک خالی آزمون ورود سابقه', level: 'subsidiary', parentId: parent?.id ?? null, accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  const bank = await BankAccountService.createBankAccount({ title: `بانک خالی ${code}`, type: 'bank', accountId: ledger.id, initialBalance: 0, currency: 'IRR', openingDate: '2026-03-21' });
  return bank.id;
}

const post = async (client: Admin, rows: TreasuryImportRow[], commit: boolean) => {
  const res = await client.post(URL, { commit, rows });
  // a post that recorded nothing answers 409 with its rows, so its key is released
  if (commit && res.status === 409 && res.body?.code === 'HISTORY_IMPORT_NOT_POSTED') return res.body.details as TreasuryImportResult;
  if (!ok(res)) throw new Error(`the import (${commit ? 'post' : 'preview'}) returned ${brief(res)}`);
  return res.body as TreasuryImportResult;
};
const rowOf = (result: TreasuryImportResult, rowNo: number) => result.rows.find(r => r.rowNo === rowNo);
const sameFootprint = (a: Record<string, number>, b: Record<string, number>) => Object.keys(a).filter(k => a[k] !== b[k]).map(k => `${k} ${a[k]} -> ${b[k]}`);

export async function runHistoryImportTreasuryV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const posting = 'reg_history_import_treasury_v11';
  if (shouldRun(posting, 'v11', 'history_import', 'treasury', 'payroll', 'settlement')) {
    await runCase(results, posting, 'v11 history import (tool 1): a preview of receipts, payments, a transfer, an advance and a payslip payment from Excel runs every row through the real services and keeps nothing (no row, voucher, part, audit row, event or sequence number); the post keeps them all, in date order whatever the Excel order, with draft vouchers, the receipt settling the customer\'s oldest invoice and the payslip paid through its payment', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const w = await world(admin);
      // the invoice of 1405-02-05 is settled by the receipt of 1405-02-10; one dated today is later than it and is left alone
      const invoice = await w.doc('invoice', w.customer, 1_000_000, 'final', { date: '2026-04-25' });
      const laterInvoice = await w.doc('invoice', w.customer, 700_000);
      const payable = (await w.state(invoice)).remaining;
      const bankB = await emptyBank();
      const misc = await miscContraAccountId();
      const worker = await newWorker('همکار آزمون ورود سابقه');
      await addLog(worker, await newTask(), '2026-04-05', 900_000);
      const slip = await issueApproved({ personnelId: worker, startDate: '2026-04-01', endDate: '2026-04-30', username: 'inv' });
      if (!slip.payroll) throw new Error(`setup: the payslip was refused (${slip.refusal?.message})`);
      const [issued] = await orm.select({ net: pieceworkPayrolls.netPayable }).from(pieceworkPayrolls).where(eq(pieceworkPayrolls.id, slip.payroll.id));
      const net = fin(issued?.net ?? 0).toNumber();
      if (!(net >= 600_000)) throw new Error(`setup: the payslip pays ${net}, expected at least 600,000`);
      const [aBefore, bBefore] = [await balanceOf(w.bank), await balanceOf(bankB)];

      // The Excel order is not the date order: on 1405-02-12 the payment from B is listed before the transfer into B.
      const rows: TreasuryImportRow[] = [
        { rowNo: 2, sheet: SHEET, date: '1405-02-12', kind: 'payment', bankAccountId: bankB, amount: '300,000'.replace(/,/g, ''), partyType: 'other', partyName: 'کارمزد بانکی', contraAccountId: misc, description: 'کارمزد', costCenter: 'عمومی و مشترک' },
        { rowNo: 3, sheet: SHEET, date: '1405-02-12', kind: 'transfer', bankAccountId: w.bank, toBankAccountId: bankB, amount: '2000000', description: 'واریز به حساب دوم', invoiceRef: 'ACH1' },
        { rowNo: 4, sheet: SHEET, date: '1405/02/10', kind: 'receipt', bankAccountId: w.bank, amount: String(payable + 250_000), partyType: 'customer', partyId: w.customer.id, partyName: w.customer.name, settleOldest: true, invoiceRef: '61', description: 'واریز فروشگاه' },
        { rowNo: 5, sheet: SHEET, date: '1405-02-15', kind: 'payment', bankAccountId: w.bank, amount: '200000', partyType: 'personnel', partyId: worker, partyName: 'همکار آزمون', purpose: 'advance', description: 'مساعده' },
        { rowNo: 6, sheet: SHEET, date: '1405-02-20', kind: 'payslip', bankAccountId: w.bank, amount: '600000', personnelId: worker, description: 'حقوق فروردین' },
      ];

      const before = await footprint();
      const preview = await post(admin, rows, false);
      const after = await footprint();
      if (preview.committed || preview.okCount !== 5 || preview.errorCount !== 0) problems.push(`the preview read ${JSON.stringify(preview).slice(0, 600)}, expected five rows ok and nothing committed`);
      const moved = sameFootprint(before, after);
      if (moved.length > 0) problems.push(`the preview left a trace: ${moved.join(', ')}`);
      if (await balanceOf(w.bank) !== aBefore || await balanceOf(bankB) !== bBefore) problems.push('the preview moved a bank balance');
      if (rowOf(preview, 4)?.settled?.[0]?.amount !== payable) problems.push(`the preview shows the receipt settling ${JSON.stringify(rowOf(preview, 4)?.settled)}, expected the invoice in full (${payable})`);
      if (preview.rows.some(r => r.created)) problems.push('the preview sent placeholder numbers');

      const posted = await post(admin, rows, true);
      if (!posted.committed || posted.okCount !== 5) problems.push(`the post read ${JSON.stringify(posted).slice(0, 600)}, expected five rows committed`);
      const end = await footprint();
      if (end.treasury - before.treasury !== 6) problems.push(`the post made ${end.treasury - before.treasury} treasury rows, expected 6 (receipt, two transfer sides, payment, advance, payslip payment)`);
      if (end.voucherSeq - before.voucherSeq < 5) problems.push(`the voucher sequence moved by ${end.voucherSeq - before.voucherSeq}, expected at least 5 (the preview took none)`);
      if (!rowOf(posted, 3)?.created?.length) problems.push('the transfer row does not name what it made');
      if (await balanceOf(w.bank) !== aBefore + payable + 250_000 - 2_000_000 - 200_000 - 600_000) problems.push(`the first bank ends at ${await balanceOf(w.bank)}`);
      if (await balanceOf(bankB) !== bBefore + 2_000_000 - 300_000) problems.push(`the second bank ends at ${await balanceOf(bankB)}`);
      const s = await w.state(invoice);
      if (s.remaining !== 0 || s.parts.length !== 1) problems.push(`the invoice shows ${s.remaining} left with parts ${JSON.stringify(s.parts)}, expected settled by the receipt`);
      const later = await w.state(laterInvoice);
      if (later.parts.length !== 0) problems.push(`an invoice dated after the receipt was settled by it: ${JSON.stringify(later.parts)}`);
      const [paidSlip] = await orm.select({ paid: pieceworkPayrolls.paidAmount, status: pieceworkPayrolls.status }).from(pieceworkPayrolls).where(eq(pieceworkPayrolls.id, slip.payroll.id));
      if (fin(paidSlip?.paid ?? 0).toNumber() !== 600_000) problems.push(`the payslip shows ${paidSlip?.paid} paid (${paidSlip?.status}), expected 600,000`);
      const dated = (await orm.execute(sql`SELECT to_char(date::date, 'YYYY-MM-DD') AS d, description FROM treasury_transactions WHERE bank_account_id = ${bankB} AND type = 'payment' AND is_deleted = 0`)).rows as Array<{ d: string; description: string }>;
      if (dated[0]?.d !== '2026-05-02' || !String(dated[0]?.description).includes('مرکز هزینه')) problems.push(`the fee row reads ${JSON.stringify(dated)}, expected 1405-02-12 (2026-05-02) with its cost centre in the description`);
      const receiptRow = (await orm.execute(sql`SELECT description FROM treasury_transactions WHERE bank_account_id = ${w.bank} AND type = 'receipt' AND party_id = ${w.customer.id} AND is_deleted = 0`)).rows as Array<{ description: string }>;
      if (!String(receiptRow[0]?.description).includes('مرجع اکسل: 61')) problems.push(`the receipt's description is ${JSON.stringify(receiptRow)}, expected the Excel invoice number`);
      const drafts = await count(sql`SELECT count(*)::int AS n FROM journal_vouchers WHERE is_deleted = 0 AND status <> 'draft' AND voucher_number > ${before.voucherSeq}`);
      if (drafts !== 0) problems.push(`${drafts} imported vouchers are not drafts`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'a preview keeps nothing; the post records every row in date order through the hand-entry services';
    }));
  }

  const refusing = 'reg_history_import_treasury_refusals_v11';
  if (shouldRun(refusing, 'v11', 'history_import', 'treasury')) {
    await runCase(results, refusing, 'v11 history import (tool 1): one refused row posts nothing (an overdrawn account on its day, a payslip paid beyond what it has left, a row before the account\'s last movement, an unreadable date or amount), a row like one in the file or the books waits until accepted, and the import needs its own permission', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const bank = await fundedBank(); // 5,000,000 received on 2026-04-01 (1405-01-12)
      const misc = await miscContraAccountId();
      const worker = await newWorker('همکار آزمون ورود سابقه');
      const pay = (rowNo: number, date: string, amount: string, extra: Partial<TreasuryImportRow> = {}): TreasuryImportRow => ({
        rowNo, sheet: SHEET, date, kind: 'payment', bankAccountId: bank, amount, partyType: 'other', partyName: 'هزینه', contraAccountId: misc, ...extra,
      });

      const before = await footprint();
      const rows = [
        pay(2, '1405-02-01', '1000000'),
        pay(3, '1405-02-02', '9000000'),
        pay(4, '1405-01-05', '1000'),
        pay(5, '1405-13-40', '1000'),
        pay(6, '1405-02-03', ''),
        { rowNo: 7, sheet: SHEET, date: '1405-02-04', kind: 'payslip', bankAccountId: bank, amount: '1000', personnelId: worker } as TreasuryImportRow,
        pay(11, '', '1000'),
        pay(12, '1405-02-05', '1e3'),
      ];
      const posted = await post(admin, rows, true);
      if (posted.committed) problems.push('a file with refused rows was posted');
      const refusedWith = (rowNo: number, label: string, part: string) => {
        const r = rowOf(posted, rowNo);
        if (r?.status !== 'error' || !String(r?.message).includes(part)) problems.push(`${label}: row ${rowNo} reads ${JSON.stringify(r)}, expected an error naming «${part}»`);
      };
      if (rowOf(posted, 2)?.status !== 'ok') problems.push(`the good row reads ${JSON.stringify(rowOf(posted, 2))}`);
      refusedWith(3, 'an overdrawn account', 'مانده');
      refusedWith(4, 'a row before the last movement', 'گردشی با تاریخ');
      refusedWith(5, 'an unreadable date', 'معتبر نیست');
      refusedWith(6, 'an empty amount', 'مبلغ');
      refusedWith(7, 'a payslip beyond what it has left', 'فیش');
      refusedWith(11, 'an empty date (it was posted on today)', 'خالی');
      refusedWith(12, 'an amount in exponent form', 'مبلغ');
      // a refused post takes no voucher or treasury number either: it is tried as a preview first
      const moved = sameFootprint(before, await footprint());
      if (moved.length > 0) problems.push(`a refused post left a trace: ${moved.join(', ')}`);
      if (await balanceOf(bank) !== 5_000_000) problems.push(`a refused post moved the bank to ${await balanceOf(bank)}`);

      // duplicates: a row like the fixture's receipt in the books, and two equal rows of the file
      const receiptAgain: TreasuryImportRow = { rowNo: 8, sheet: SHEET, date: '1405-01-12', kind: 'receipt', bankAccountId: bank, amount: '5000000', partyType: 'other', partyName: 'واریز', contraAccountId: misc };
      const twice = [pay(9, '1405-02-01', '1000'), pay(10, '1405-02-01', '1000')];
      const held = await post(admin, [receiptAgain, ...twice], true);
      if (held.committed || rowOf(held, 8)?.status !== 'duplicate' || rowOf(held, 10)?.status !== 'duplicate' || rowOf(held, 9)?.status !== 'ok') problems.push(`duplicates read ${JSON.stringify(held.rows)}, expected rows 8 and 10 held`);
      const accepted = await post(admin, [{ ...receiptAgain, duplicateAccepted: true }, twice[0], { ...twice[1], duplicateAccepted: true }], true);
      if (!accepted.committed) problems.push(`accepted duplicates were not posted: ${JSON.stringify(accepted.rows)}`);
      if (await balanceOf(bank) !== 10_000_000 - 2_000) problems.push(`after the accepted rows the bank shows ${await balanceOf(bank)}, expected 9,998,000`);

      // permission: the treasury alone does not import
      const treasurer = await sandboxClientWith(['accounting.view', 'accounting.treasury']);
      const refused = await treasurer.post(URL, { commit: false, rows: [pay(2, '1405-02-01', '1000')] });
      if (refused.status !== 403) problems.push(`a treasurer without the import permission got ${brief(refused)}, expected 403`);
      const importer = await sandboxClientWith(['accounting.view', 'accounting.treasury', 'accounting.history_import']);
      const allowed = await importer.post(URL, { commit: false, rows: [pay(2, '1405-02-01', '1000')] });
      if (allowed.status !== 200) problems.push(`a holder of the import permission got ${brief(allowed)}, expected 200`);
      // a payslip row needs «پرداخت حقوق», as the payslip payment form does
      const slipRow = { rowNo: 13, sheet: SHEET, date: '1405-02-04', kind: 'payslip', bankAccountId: bank, amount: '1000', personnelId: worker } as TreasuryImportRow;
      const noPay = (await importer.post(URL, { commit: false, rows: [slipRow] })).body as TreasuryImportResult;
      if (rowOf(noPay, 13)?.status !== 'error' || !String(rowOf(noPay, 13)?.message).includes('پرداخت حقوق')) problems.push(`a payslip row without piecework.pay reads ${JSON.stringify(noPay?.rows)}, expected refused`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'refused rows post nothing, duplicates wait for acceptance, the import needs its permission';
    }));
  }

  const racing = 'reg_history_import_treasury_races_v11';
  if (shouldRun(racing, 'v11', 'history_import', 'treasury', 'concurrency')) {
    await runCase(results, racing, 'v11 history import (tool 1): two posts of the same file at once record it once (the second waits and finds every row recorded); a row before the account\'s opening day or before a voucher on its ledger account (a cleared cheque, a manual voucher) is refused, since that money had not arrived yet', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const misc = await miscContraAccountId();
      const receipt = (bankAccountId: number, rowNo: number, date: string, amount: string): TreasuryImportRow => ({
        rowNo, sheet: SHEET, date, kind: 'receipt', bankAccountId, amount, partyType: 'other', partyName: 'واریز', contraAccountId: misc,
      });

      const bank = await emptyBank();
      const file = [receipt(bank, 2, '1405-02-01', '400000'), receipt(bank, 3, '1405-02-02', '200000')];
      const [a, b] = await Promise.all([post(admin, file, true), post(admin, file, true)]);
      if ([a, b].filter(r => r.committed).length !== 1) problems.push(`two posts at once read ${JSON.stringify([a.committed, b.committed])}, expected exactly one committed`);
      if (await balanceOf(bank) !== 600_000) problems.push(`after two posts at once the bank holds ${await balanceOf(bank)}, expected 600,000 (the file once)`);

      const opened = await emptyBank();
      await orm.update(bankAccounts).set({ openingDate: '2026-06-01' }).where(eq(bankAccounts.id, opened));
      const early = await post(admin, [receipt(opened, 2, '1405-02-01', '1000')], false);
      if (rowOf(early, 2)?.status !== 'error' || !String(rowOf(early, 2)?.message).includes('گردشی با تاریخ')) problems.push(`a row before the account's opening day reads ${JSON.stringify(early.rows)}, expected refused`);

      const cleared = await emptyBank();
      const [ledger] = await orm.select({ accountId: bankAccounts.accountId }).from(bankAccounts).where(eq(bankAccounts.id, cleared));
      await VoucherService.createJournalVoucher({
        date: '2026-07-01', voucherType: 'general', status: 'draft', description: 'وصول چک آزمون', currency: 'IRR',
        items: [
          { accountId: Number(ledger?.accountId), debit: 5000, credit: 0, currency: 'IRR', description: 'وصول' },
          { accountId: misc, debit: 0, credit: 5000, currency: 'IRR', description: 'وصول' },
        ],
      });
      const beforeVoucher = await post(admin, [receipt(cleared, 2, '1405-02-01', '1000')], false);
      if (rowOf(beforeVoucher, 2)?.status !== 'error' || !String(rowOf(beforeVoucher, 2)?.message).includes('گردشی با تاریخ')) problems.push(`a row before a voucher on the account reads ${JSON.stringify(beforeVoucher.rows)}, expected refused`);

      // two banks on one ledger account: money on the second today does not hold back the first
      const [sharedLedger] = await orm.select({ accountId: bankAccounts.accountId }).from(bankAccounts).where(eq(bankAccounts.id, opened));
      const first = await BankAccountService.createBankAccount({ title: `بانک هم‌حساب الف ${Date.now()}`, type: 'bank', accountId: Number(sharedLedger?.accountId), initialBalance: 0, currency: 'IRR', openingDate: '2026-03-21' });
      const second = await BankAccountService.createBankAccount({ title: `بانک هم‌حساب ب ${Date.now()}`, type: 'bank', accountId: Number(sharedLedger?.accountId), initialBalance: 0, currency: 'IRR', openingDate: '2026-03-21' });
      await orm.update(bankAccounts).set({ openingDate: '2026-03-21' }).where(eq(bankAccounts.id, opened));
      await post(admin, [receipt(second.id, 2, '1405-08-01', '3000')], true);
      const sharing = await post(admin, [receipt(first.id, 2, '1405-02-01', '1000')], false);
      if (rowOf(sharing, 2)?.status !== 'ok') problems.push(`a row on a bank whose ledger account another bank shares reads ${JSON.stringify(sharing.rows)}, expected ok`);
      const later = await post(admin, [receipt(second.id, 2, '1405-02-01', '1000')], false);
      if (rowOf(later, 2)?.status !== 'error') problems.push(`a row before the same bank's own later receipt reads ${JSON.stringify(later.rows)}, expected refused`);

      // a refused post releases its key: the same key sent again once fixed is posted, not answered from memory
      const key = `history-import-${Date.now()}`;
      const bad = await admin.post(URL, { commit: true, rows: [receipt(first.id, 2, '', '1000')] }).set('Idempotency-Key', key);
      if (bad.status !== 409 || bad.body?.code !== 'HISTORY_IMPORT_NOT_POSTED') problems.push(`a refused post answered ${brief(bad)}, expected 409 HISTORY_IMPORT_NOT_POSTED`);
      const fixed = await admin.post(URL, { commit: true, rows: [receipt(first.id, 2, '1405-02-02', '1000')] }).set('Idempotency-Key', key);
      if (!ok(fixed) || !(fixed.body as TreasuryImportResult).committed) problems.push(`the fixed post with the same key answered ${brief(fixed)}, expected committed`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'concurrent posts record the file once; money that arrived later never pays an earlier row';
    }));
  }

  return results;
}
