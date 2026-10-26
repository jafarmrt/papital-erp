import type request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { dailyWorkLogs, journalVouchers } from '../../db/schema.js';
import { businessTodayIsoDate, resolveJalaliFiscalYear } from '../../lib/businessClock.js';
import { fin } from '../../lib/financialDecimal.js';
import { PayrollPaymentService } from '../../services/accounting/payrollPayment.service.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { jalaliYearBounds } from '../../utils/calendarDate.js';
import { createTestItem } from '../fixtures/factories.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';
import { addLog, fundedBank, issueApproved, newTask, newWorker, refusalOf } from '../invariants/payrollScenarios.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, accountIdsByCode, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';

/**
 * v11 phase 6.1a (input guards, findings of the phase 2 evaluation): real Express routes and services on PostgreSQL, each
 * scenario in its own schema with the standard chart of accounts; each is red on v11.3.0.
 *  - M9: a manual voucher is dated neither after today nor before the books' first fiscal year (create, edit, reverse,
 *    correct); on v11.3.0 a voucher dated 1990 opened fiscal year 1368 and blocked every later year-end close.
 *  - M12: a cheque is due on or after its issue day, a cheque step follows its previous step, and wages are paid on or after
 *    the payslip's voucher; on v11.3.0 each was accepted out of order.
 *  - M16, S10, S12: an amount or quantity beyond numeric(18,4) (more than 14 whole digits or 4 decimals, or a product that
 *    overflows) is a clear 4xx, never a 500 or a silently changed number.
 *  - M15: the year-close preview adds in decimals («0.2», not «0.19999999999999998»).
 *  - C10: a work log is not dated after today, and a reviewed log whose report changes goes back to «ارسال‌شده».
 */

const DAY_MS = 86_400_000;
const shiftDay = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;
const brief = (res: request.Response) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 220)}`;
const codeOf = (res: request.Response) => String(res.body?.code ?? res.body?.error?.code ?? '');

// Persian text sent as typed input
const BANK_NAME = 'ملت';
const LOG_TITLE = 'گزارش آزمون';
const LOG_TEXT = 'شرح کار آزمون';
const LOG_TEXT_CHANGED = 'شرح کار دیگر';

async function pairOf(amount: number | string, debitCode = '7001', creditCode = '1001') {
  const acc = await accountIdsByCode(debitCode, creditCode);
  return [
    { accountId: acc[debitCode], debit: amount, credit: 0 },
    { accountId: acc[creditCode], debit: 0, credit: amount },
  ];
}

const count = async (query: ReturnType<typeof sql>) => Number(((await orm.execute(query)).rows[0] as { n: number | string }).n);

export async function runInputGuardsV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const m9 = 'reg_manual_voucher_date_bounds_v11_6_1a_m9';
  if (shouldRun(m9, 'v11', 'phase6', 'm9', 'voucher', 'date', 'fiscal')) {
    await runCase(results, m9, 'v11 phase 6.1a (M9): a manual voucher dated after today or before the books\' first fiscal year is refused on create, edit, reverse and correct, and nothing is written; last year is still open to entries', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const tomorrow = shiftDay(today, 1);
      const lastYearFirstDay = jalaliYearBounds(resolveJalaliFiscalYear(today) - 1)!.firstDay;
      const expect = (label: string, res: request.Response, status: number, code: string) => {
        if (res.status !== status || codeOf(res) !== code) problems.push(`${label} returned ${brief(res)}, expected ${status} ${code}`);
      };
      const vouchers = () => count(sql`SELECT count(*)::int AS n FROM journal_vouchers WHERE is_deleted = 0`);
      const before = await vouchers();

      // 1) create
      expect('a voucher dated tomorrow', await api.post('/api/accounting/vouchers', { date: tomorrow, description: 'M9 future', items: await pairOf(1000) }), 422, 'VOUCHER_DATE_IN_FUTURE');
      expect('a voucher dated 1990', await api.post('/api/accounting/vouchers', { date: '1990-01-01', description: 'M9 ancient', items: await pairOf(1000) }), 422, 'VOUCHER_DATE_TOO_EARLY');
      if (await vouchers() !== before) problems.push('a refused voucher was saved');
      const last = await api.post('/api/accounting/vouchers', { date: lastYearFirstDay, description: 'M9 last year', status: 'draft', items: await pairOf(1000) });
      if (last.status !== 201) problems.push(`a voucher on the first day of last year returned ${brief(last)}, expected 201`);
      const years = await api.get('/api/accounting/fiscal-closing/years');
      if (JSON.stringify(years.body ?? null).includes('1368')) problems.push('the fiscal years list names 1368 after the refused 1990 voucher');

      // 2) edit a draft
      const draft = await api.post('/api/accounting/vouchers', { date: today, description: 'M9 draft', status: 'draft', items: await pairOf(2000) });
      if (draft.status !== 201) throw new Error(`setup: draft ${brief(draft)}`);
      expect('moving a draft to tomorrow', await api.put(`/api/accounting/vouchers/${draft.body.id}`, { date: tomorrow, version: draft.body.version }), 422, 'VOUCHER_DATE_IN_FUTURE');
      const [kept] = await orm.select({ date: journalVouchers.date }).from(journalVouchers).where(eq(journalVouchers.id, Number(draft.body.id)));
      if (kept?.date !== today) problems.push(`the refused edit left the draft dated ${kept?.date}`);

      // 3) reverse and correct an approved voucher
      const approved = await api.post('/api/accounting/vouchers', { date: today, description: 'M9 approved', status: 'approved', items: await pairOf(3000) });
      if (approved.status !== 201) throw new Error(`setup: approved voucher ${brief(approved)}`);
      const mid = await vouchers();
      expect('a reversal dated tomorrow', await api.post(`/api/accounting/vouchers/${approved.body.id}/reverse`, { date: tomorrow, reason: 'M9 reverse' }), 422, 'VOUCHER_DATE_IN_FUTURE');
      expect('a correction dated 1990', await api.post(`/api/accounting/vouchers/${approved.body.id}/correct`, { date: '1990-01-01', reason: 'M9 correct', newItems: await pairOf(4000) }), 422, 'VOUCHER_DATE_TOO_EARLY');
      if (await vouchers() !== mid) problems.push('a refused reversal or correction wrote a voucher');
      const reversed = await api.post(`/api/accounting/vouchers/${approved.body.id}/reverse`, { date: today, reason: 'M9 reverse today' });
      if (reversed.status !== 201) problems.push(`a reversal dated today returned ${brief(reversed)}, expected 201`);
      assertNoProblems(problems);
      return 'create tomorrow 422 VOUCHER_DATE_IN_FUTURE, 1990 422 VOUCHER_DATE_TOO_EARLY, nothing saved, 1368 not listed; first day of last year 201; draft moved to tomorrow 422; reversal tomorrow and correction 1990 refused, nothing written; reversal today 201';
    }));
  }

  const m12 = 'reg_cheque_and_payslip_date_order_v11_6_1a_m12';
  if (shouldRun(m12, 'v11', 'phase6', 'm12', 'cheque', 'payroll', 'payment', 'date')) {
    await runCase(results, m12, 'v11 phase 6.1a (M12): a cheque due before its issue day is refused, a cheque step dated before its previous step is refused, and a payslip payment dated before the payslip\'s voucher is refused; in-order dates are accepted', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const yesterday = shiftDay(today, -1);
      const contra = await miscContraAccountId();
      const cheque = (issueDate: string, dueDate: string) => api.post('/api/accounting/cheques', {
        type: 'received', chequeNumber: `M12${tagOf()}`, amount: 250_000, partyType: 'other', contraAccountId: contra, partyName: 'M12 party',
        bankName: BANK_NAME, issueDate, dueDate,
      });
      const cheques = () => count(sql`SELECT count(*)::int AS n FROM cheques WHERE is_deleted = 0`);

      // 1) due before issue
      const before = await cheques();
      const early = await cheque(today, yesterday);
      if (early.status !== 422 || codeOf(early) !== 'CHEQUE_DUE_BEFORE_ISSUE') problems.push(`a cheque due the day before its issue returned ${brief(early)}, expected 422 CHEQUE_DUE_BEFORE_ISSUE`);
      if (await cheques() !== before) problems.push('the refused cheque was saved');

      // 2) a step before the issue day, then one on it
      const ok = await cheque(today, today);
      if (ok.status !== 201 && ok.status !== 200) throw new Error(`setup: cheque ${brief(ok)}`);
      const back = await api.put(`/api/accounting/cheques/${ok.body.id}/status`, { status: 'in_treasury', actionDate: yesterday });
      if (back.status !== 422 || codeOf(back) !== 'CHEQUE_STEP_BEFORE_PREVIOUS') problems.push(`a step dated the day before the issue returned ${brief(back)}, expected 422 CHEQUE_STEP_BEFORE_PREVIOUS`);
      const [row] = (await orm.execute(sql`SELECT status FROM cheques WHERE id = ${Number(ok.body.id)}`)).rows as Array<{ status: string }>;
      if (row?.status !== 'received') problems.push(`the refused step left the cheque ${row?.status}`);
      const onDay = await api.put(`/api/accounting/cheques/${ok.body.id}/status`, { status: 'in_treasury', actionDate: today });
      if (onDay.status !== 200) problems.push(`a step dated the issue day returned ${brief(onDay)}, expected 200`);

      // 3) a payslip for April 2026 (its voucher is dated 2026-04-30) paid on 2026-04-10, then on 2026-04-30
      const worker = await newWorker('M12 worker');
      await addLog(worker, await newTask(), '2026-04-05', 1_000_000);
      const issued = await issueApproved({ personnelId: worker, startDate: '2026-04-01', endDate: '2026-04-30', username: 'inv' });
      if (!issued.payroll) throw new Error(`setup: payslip ${JSON.stringify(issued.refusal)}`);
      const bankId = await fundedBank();
      const pay = (paymentDate: string) => PayrollPaymentService.registerPayrollPayment({ payrollId: issued.payroll!.id, bankAccountId: bankId, amount: 1_000_000, paymentDate, username: 'inv' });
      const refusal = await refusalOf(() => pay('2026-04-10'));
      if (!refusal) problems.push('a payment dated before the payslip voucher was accepted');
      const paidRows = await count(sql`SELECT count(*)::int AS n FROM treasury_transactions WHERE bank_account_id = ${bankId} AND type = 'payment'`);
      if (paidRows !== 0) problems.push(`the refused payment wrote ${paidRows} treasury rows`);
      const paid = await refusalOf(() => pay('2026-04-30'));
      if (paid) problems.push(`a payment dated the payslip voucher's day was refused: ${paid}`);
      assertNoProblems(problems);
      return 'cheque due before issue 422, not saved; step before issue 422, cheque still received; step on issue day 200; payslip voucher 2026-04-30: payment 2026-04-10 refused with no treasury row, 2026-04-30 accepted';
    }));
  }

  const m16 = 'reg_number_bounds_v11_6_1a_m16';
  if (shouldRun(m16, 'v11', 'phase6', 'm16', 's10', 's12', 'decimal', 'voucher', 'treasury', 'document')) {
    await runCase(results, m16, 'v11 phase 6.1a (M16, S10, S12): amounts and quantities with more than 14 whole digits or 4 decimals are refused with a Persian 4xx, a treasury amount a number cannot hold is refused, an overflowing line value is 422 (never 500), and a computed number\'s float noise is cut at 4 decimals', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const fourXX = (label: string, res: request.Response, status: number) => {
        if (res.status !== status) problems.push(`${label} returned ${brief(res)}, expected ${status}`);
      };

      // 1) voucher rows
      fourXX('a voucher row of 15 whole digits', await api.post('/api/accounting/vouchers', { date: today, description: 'M16 big', items: await pairOf('100000000000000') }), 400);
      fourXX('a voucher row of 0.00001', await api.post('/api/accounting/vouchers', { date: today, description: 'M16 tiny', items: await pairOf('0.00001') }), 400);
      fourXX('a voucher row sent as the number 1e14', await api.post('/api/accounting/vouchers', { date: today, description: 'M16 number', items: await pairOf(1e14) }), 400);
      const noise = await api.post('/api/accounting/vouchers', { date: today, description: 'M16 noise', status: 'draft', items: await pairOf(0.1 + 0.2) });
      if (noise.status !== 201) problems.push(`a voucher row of 0.1 + 0.2 as a number returned ${brief(noise)}, expected 201`);
      else {
        const [v] = await orm.select({ total: journalVouchers.totalDebit }).from(journalVouchers).where(eq(journalVouchers.id, Number(noise.body.id)));
        if (fin(v?.total ?? 0).toString() !== '0.3') problems.push(`0.1 + 0.2 was stored as ${String(v?.total)}, expected 0.3`);
      }

      // 2) a treasury amount a JS number cannot hold
      const bank = await fundedBank();
      const precise = await api.post('/api/accounting/treasury', {
        type: 'receipt', method: 'bank_transfer', amount: '12345678901234.5678', bankAccountId: bank, partyType: 'other',
        contraAccountId: await miscContraAccountId(), partyName: 'M16 party', date: today,
      });
      if (precise.status !== 422 || codeOf(precise) !== 'AMOUNT_PRECISION_EXCEEDED') problems.push(`a receipt of 12345678901234.5678 returned ${brief(precise)}, expected 422 AMOUNT_PRECISION_EXCEEDED`);

      // 3) document lines: a fifth decimal, and a line whose value overflows the column
      const main = String(await getDefaultWarehouseCode(orm));
      const item = await createTestItem({ type: 'raw_material', stocks: { [main]: 5 }, weightedAverageCost: 1000 });
      const receipt = (quantity: unknown, unitPrice: unknown) => api.post('/api/documents', {
        docType: 'receipt', status: 'final', refNumber: 'auto', date: today, location: main, buyer_name: 'M16 supplier',
        items: [{ itemId: item.id, quantity, unit_price: unitPrice }],
      });
      fourXX('a receipt line of 1.23456', await receipt('1.23456', 1100), 400);
      fourXX('a receipt line of 0.00001', await receipt('0.00001', 1100), 400);
      const huge = await receipt('99999999999999', '99999999999');
      if (huge.status >= 500 || huge.status < 400) problems.push(`a receipt line worth 10^25 returned ${brief(huge)}, expected a 4xx`);
      const kardex = await count(sql`SELECT count(*)::int AS n FROM transactions WHERE item_id = ${item.id}`);
      if (kardex !== 0) problems.push(`the refused receipts wrote ${kardex} Kardex rows`);
      const fine = await receipt('1.2346', 1100);
      if (fine.status !== 200) problems.push(`a receipt line of 1.2346 returned ${brief(fine)}, expected 200`);
      else {
        const [k] = (await orm.execute(sql`SELECT quantity::text AS q, total_price::text AS t FROM transactions WHERE item_id = ${item.id} AND is_deleted = 0`)).rows as Array<{ q: string; t: string }>;
        if (!fin(k?.q ?? 0).equals('1.2346') || !fin(k?.t ?? 0).equals('1358.06')) problems.push(`the Kardex row holds ${k?.q} worth ${k?.t}, expected 1.2346 worth 1358.06`);
      }
      assertNoProblems(problems);
      return 'voucher rows 10^14, 0.00001 and the number 1e14: 400; 0.1 + 0.2 stored 0.3; receipt 12345678901234.5678: 422 AMOUNT_PRECISION_EXCEEDED; receipt lines 1.23456 and 0.00001: 400, line worth 10^25: 4xx, no Kardex row; 1.2346 × 1,100 = 1,358.06';
    }));
  }

  const m15 = 'reg_fiscal_close_preview_decimal_v11_6_1a_m15';
  if (shouldRun(m15, 'v11', 'phase6', 'm15', 'fiscal', 'closing', 'preview')) {
    await runCase(results, m15, 'v11 phase 6.1a (M15): the year-close preview adds revenue and profit in decimals: a revenue credited 0.3 and debited 0.1 shows 0.2, not 0.19999999999999998', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const year = resolveJalaliFiscalYear(await businessTodayIsoDate()) - 1;
      const day = jalaliYearBounds(year)!.firstDay;
      // 5001 credited 0.3 and debited 0.1: JS numbers give 0.3 − 0.1 = 0.19999999999999998
      for (const [amount, debitCode, creditCode] of [['0.3', '1001', '5001'], ['0.1', '5001', '1001']]) {
        const res = await api.post('/api/accounting/vouchers', { date: day, description: `M15 ${amount}`, status: 'approved', items: await pairOf(amount, debitCode, creditCode) });
        if (res.status !== 201) throw new Error(`setup: revenue voucher ${brief(res)}`);
      }
      const preview = await api.get(`/api/accounting/fiscal-closing/preview?year=${year}`);
      if (preview.status !== 200) throw new Error(`preview returned ${brief(preview)}`);
      const body = preview.body as { totalRevenues?: number; netProfit?: number };
      if (String(body.totalRevenues) !== '0.2') problems.push(`the preview shows revenue ${String(body.totalRevenues)}, expected 0.2`);
      if (String(body.netProfit) !== '0.2') problems.push(`the preview shows net profit ${String(body.netProfit)}, expected 0.2`);
      assertNoProblems(problems);
      return `year ${year}: revenue credited 0.3 and debited 0.1 → preview revenue 0.2, net profit 0.2`;
    }));
  }

  const c10 = 'reg_daily_log_date_and_review_v11_6_1a_c10';
  if (shouldRun(c10, 'v11', 'phase6', 'c10', 'daily_log', 'review')) {
    await runCase(results, c10, 'v11 phase 6.1a (C10): a work log dated after today is refused on create and edit; a reviewed log whose text changes goes back to «ارسال‌شده», an edit of its tags keeps the review', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const tomorrow = shiftDay(today, 1);
      const logs = () => count(sql`SELECT count(*)::int AS n FROM daily_work_logs WHERE is_deleted = 0`);
      const before = await logs();
      const ahead = await api.post('/api/daily-logs', { date: tomorrow, start_time: '08:00', end_time: '09:00', title: LOG_TITLE, content: LOG_TEXT });
      if (ahead.status !== 422 || codeOf(ahead) !== 'DAILY_LOG_DATE_IN_FUTURE') problems.push(`a log dated tomorrow returned ${brief(ahead)}, expected 422 DAILY_LOG_DATE_IN_FUTURE`);
      if (await logs() !== before) problems.push('the refused log was saved');

      const created = await api.post('/api/daily-logs', { date: today, start_time: '08:00', end_time: '09:00', title: LOG_TITLE, content: LOG_TEXT });
      if (created.status !== 201 && created.status !== 200) throw new Error(`setup: log ${brief(created)}`);
      const id = Number(created.body?.id ?? created.body?.log?.id);
      const stored = async () => (await orm.select({ status: dailyWorkLogs.status, version: dailyWorkLogs.version, date: dailyWorkLogs.date })
        .from(dailyWorkLogs).where(eq(dailyWorkLogs.id, id)))[0];
      const movedAhead = await api.put(`/api/daily-logs/${id}`, { date: tomorrow, version: (await stored()).version });
      if (movedAhead.status !== 422 || codeOf(movedAhead) !== 'DAILY_LOG_DATE_IN_FUTURE') problems.push(`moving the log to tomorrow returned ${brief(movedAhead)}, expected 422 DAILY_LOG_DATE_IN_FUTURE`);

      const review = async () => {
        const res = await api.put(`/api/daily-logs/${id}/review`, { manager_notes: 'C10 review' });
        if (res.status !== 200) throw new Error(`setup: review ${brief(res)}`);
      };
      await review();
      const tags = await api.put(`/api/daily-logs/${id}`, { tags: ['C10'], version: (await stored()).version });
      if (tags.status !== 200) problems.push(`editing the tags returned ${brief(tags)}`);
      if ((await stored()).status !== 'reviewed') problems.push(`a tag edit moved the reviewed log to ${(await stored()).status}`);
      const text = await api.put(`/api/daily-logs/${id}`, { content: LOG_TEXT_CHANGED, version: (await stored()).version });
      if (text.status !== 200) problems.push(`editing the text returned ${brief(text)}`);
      if ((await stored()).status !== 'submitted') problems.push(`after its text changed the reviewed log is ${(await stored()).status}, expected submitted`);
      assertNoProblems(problems);
      return 'log dated tomorrow 422 on create and edit, not saved; reviewed log: tag edit keeps reviewed, text edit returns it to submitted';
    }));
  }

  return results;
}
