import { and, asc, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { journalVoucherItems, journalVouchers, productionProjects } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { AccountingReportService } from '../../services/accounting/accountingReport.service.js';
import { FinancialHealthService } from '../../services/accounting/financialHealth.service.js';
import { TestCaseResult } from '../types.js';
import {
  type ShouldRun, accountIdsByCode, amountOf, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith,
} from './fiscalClosingTests.js';

/**
 * Package 3 PR «ج»: manual journal vouchers and currencies (decision t7 «الف»). Each scenario runs in its own isolated
 * schema with the standard chart of accounts and is red on the version before its fix.
 */

async function storedRows(voucherId: number) {
  const rows = await orm.select({ currency: journalVoucherItems.currency, rate: journalVoucherItems.exchangeRate })
    .from(journalVoucherItems)
    .where(and(eq(journalVoucherItems.voucherId, voucherId), eq(journalVoucherItems.isDeleted, 0)))
    .orderBy(asc(journalVoucherItems.rowOrder));
  return rows.map(r => `${r.currency}@${amountOf(r.rate)}`);
}

/** A voucher written straight into the tables, as versions before v9.0.153 could store it */
async function insertLegacyVoucher(description: string, rows: Array<{ accountId: number; debit: number; credit: number; currency: string; rate: number }>): Promise<number> {
  const voucherNumber = await VoucherService.getNextVoucherNumber();
  const [v] = await orm.insert(journalVouchers).values({
    voucherNumber, manualVoucherNumber: '', date: await businessTodayIsoDate(), voucherType: 'general', status: 'approved',
    totalDebit: money(rows.reduce((s, r) => s + r.debit, 0)), totalCredit: money(rows.reduce((s, r) => s + r.credit, 0)),
    description, referenceModule: 'manual', referenceNumber: '', currency: 'IRR', attachments: [],
  }).returning({ id: journalVouchers.id });
  await orm.insert(journalVoucherItems).values(rows.map((r, i) => ({
    voucherId: v.id, accountId: r.accountId, rowOrder: i + 1, detailedType: 'none', detailedName: '',
    debit: money(r.debit), credit: money(r.credit), currency: r.currency, exchangeRate: money(r.rate), description,
  })));
  return v.id;
}

export async function runManualVoucherCurrencyTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const rateId = 'reg_manual_voucher_foreign_rate_and_rial_balance_td_551';
  if (shouldRun(rateId, 'td551', 'voucher', 'currency', 'package3')) {
    await runCase(results, rateId, 'v9.0.153: a manual voucher needs a rate on every non-rial row, a row without a currency takes the voucher currency, a multi-currency voucher balances in rials, and the journal book and the health check use the same rule (TD-551)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const acc = await accountIdsByCode('1001', '4001');
      const admin = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const base = { date: today, status: 'approved', description: 'TD-551 manual voucher' };
      const row = (accountId: number, debit: number, credit: number, extra: Record<string, unknown> = {}) => ({ accountId, debit, credit, ...extra });
      const vouchersBefore = (await orm.select({ id: journalVouchers.id }).from(journalVouchers)).length;

      // 1) B03-09 S07: «Dr 1001 100 USD without a rate / Cr 4001 100 IRR» was accepted and the dollar row stored at rate 1
      const noRate = await admin.post('/api/accounting/vouchers', { ...base, items: [row(acc['1001'], 100, 0, { currency: 'USD' }), row(acc['4001'], 0, 100, { currency: 'IRR' })] });
      if (noRate.status !== 422 || noRate.body?.code !== 'VOUCHER_ROW_RATE_REQUIRED') problems.push(`USD row without a rate: ${noRate.status} ${JSON.stringify(noRate.body).slice(0, 200)}, expected 422 VOUCHER_ROW_RATE_REQUIRED`);
      // 2) the same voucher at 600,000: 60,000,000 rials against 100 rials is not balanced
      const unbalanced = await admin.post('/api/accounting/vouchers', { ...base, items: [row(acc['1001'], 100, 0, { currency: 'USD', exchangeRate: 600000 }), row(acc['4001'], 0, 100, { currency: 'IRR' })] });
      if (unbalanced.status !== 400 && unbalanced.status !== 422) problems.push(`100 USD at 600,000 against 100 IRR answered ${unbalanced.status}, expected a refusal`);
      const vouchersAfterRefusals = (await orm.select({ id: journalVouchers.id }).from(journalVouchers)).length;
      if (vouchersAfterRefusals !== vouchersBefore) problems.push(`${vouchersAfterRefusals - vouchersBefore} refused vouchers were stored`);

      // 3) balanced in rials: 100 USD at 600,000 against 60,000,000 IRR
      const mixed = await admin.post('/api/accounting/vouchers', { ...base, items: [row(acc['1001'], 100, 0, { currency: 'USD', exchangeRate: 600000 }), row(acc['4001'], 0, 60_000_000, { currency: 'IRR' })] });
      if (mixed.status !== 201) problems.push(`a voucher balanced in rials answered ${mixed.status} ${JSON.stringify(mixed.body).slice(0, 200)}, expected 201`);
      else {
        const stored = await storedRows(mixed.body.id);
        if (stored.join(',') !== 'USD@600000,IRR@1') problems.push(`mixed voucher rows stored as ${stored.join(',')}`);
        await VoucherService.finalizeJournalVoucher(mixed.body.id).catch((err: Error) => problems.push(`finalizing the mixed voucher failed: ${err.message}`));
      }

      // 4) B03-22 server side: a row without a currency takes the voucher currency (was stored IRR at the given rate)
      const header = await admin.post('/api/accounting/vouchers', { ...base, currency: 'USD', items: [row(acc['1001'], 100, 0, { exchangeRate: 600000 }), row(acc['4001'], 0, 100, { exchangeRate: 600000 })] });
      if (header.status !== 201) problems.push(`a USD voucher with rated rows answered ${header.status} ${JSON.stringify(header.body).slice(0, 200)}`);
      else if ((await storedRows(header.body.id)).join(',') !== 'USD@600000,USD@600000') problems.push(`USD voucher rows stored as ${(await storedRows(header.body.id)).join(',')}`);
      const headerNoRate = await admin.post('/api/accounting/vouchers', { ...base, currency: 'USD', items: [row(acc['1001'], 100, 0), row(acc['4001'], 0, 100)] });
      if (headerNoRate.status !== 422 || headerNoRate.body?.code !== 'VOUCHER_ROW_RATE_REQUIRED') problems.push(`USD voucher without rates: ${headerNoRate.status} ${JSON.stringify(headerNoRate.body).slice(0, 160)}`);

      // 5) correction: replacement rows follow the same rule, with the original voucher's currency
      if (header.status === 201) {
        const correctNoRate = await admin.post(`/api/accounting/vouchers/${header.body.id}/correct`, { reason: 'TD-551 rate', newItems: [row(acc['1001'], 50, 0), row(acc['4001'], 0, 50)] });
        if (correctNoRate.status !== 422 || correctNoRate.body?.code !== 'VOUCHER_ROW_RATE_REQUIRED') problems.push(`correction without rates: ${correctNoRate.status} ${JSON.stringify(correctNoRate.body).slice(0, 160)}`);
      }

      // 6) journal book: all currencies in rials at each row's rate, one currency only that currency's rows
      const all = await AccountingReportService.getJournalBook({ startDate: today, endDate: today });
      if (all.totalDebit !== 120_000_000 || all.totalCredit !== 120_000_000 || !all.isBalanced || all.reportCurrency !== 'IRR') {
        problems.push(`journal book (all): ${all.totalDebit} / ${all.totalCredit} balanced=${all.isBalanced} in ${all.reportCurrency}, expected 120,000,000 in IRR`);
      }
      const usdRow = all.items.find(i => i.currency === 'USD' && i.debit > 0);
      if (!usdRow || usdRow.debit !== 60_000_000 || usdRow.originalDebit !== 100 || usdRow.exchangeRate !== 600000) problems.push(`journal book USD row: ${JSON.stringify(usdRow)}`);
      const irr = await AccountingReportService.getJournalBook({ startDate: today, endDate: today, currency: 'IRR' });
      if (irr.items.some(i => i.currency !== 'IRR') || irr.totalCredit !== 60_000_000) problems.push(`journal book (IRR) rows ${irr.items.map(i => i.currency).join(',')}, credit ${irr.totalCredit}`);
      const usd = await AccountingReportService.getJournalBook({ startDate: today, endDate: today, currency: 'USD' });
      if (usd.totalDebit !== 200 || usd.reportCurrency !== 'USD') problems.push(`journal book (USD): debit ${usd.totalDebit} in ${usd.reportCurrency}, expected 200 USD`);

      // 7) health check: legacy rows at rate 1 are listed; a legacy mixed voucher balanced only on raw amounts is unbalanced
      const legacyRate = await insertLegacyVoucher('TD-551 legacy rate 1', [
        { accountId: acc['1001'], debit: 100, credit: 0, currency: 'USD', rate: 1 },
        { accountId: acc['4001'], debit: 0, credit: 100, currency: 'USD', rate: 1 },
      ]);
      const legacyMixed = await insertLegacyVoucher('TD-551 legacy raw balance', [
        { accountId: acc['1001'], debit: 100, credit: 0, currency: 'USD', rate: 600000 },
        { accountId: acc['4001'], debit: 0, credit: 100, currency: 'IRR', rate: 1 },
      ]);
      const report = await FinancialHealthService.runHealthCheck();
      const rateTest = report.tests.find(t => t.id === 'voucher_foreign_rows_without_rate');
      const rateIds = (rateTest?.items ?? []).map(i => i.id);
      if (!rateTest || rateTest.status !== 'warning' || !rateIds.includes(legacyRate) || rateIds.includes(legacyMixed)) problems.push(`health rate test: ${rateTest?.status} ${JSON.stringify(rateIds)}, expected ${legacyRate} only among these`);
      const balanceIds = (report.tests.find(t => t.id === 'vouchers_balance')?.items ?? []).map(i => i.id);
      if (!balanceIds.includes(legacyMixed) || balanceIds.includes(legacyRate) || (mixed.status === 201 && balanceIds.includes(mixed.body.id))) {
        problems.push(`health balance test lists ${JSON.stringify(balanceIds)}, expected ${legacyMixed} and not ${legacyRate} or the balanced mixed voucher`);
      }

      assertNoProblems(problems);
      return 'Rows without a rate refused (422), a voucher balanced in rials accepted and finalized, the voucher currency applied to rows without one, the correction under the same rule, the journal book in rials with the original amount, and the health check listing rate-1 rows and raw-only balances.';
    }));
  }

  const listId = 'reg_manual_voucher_currency_list_td_564';
  if (shouldRun(listId, 'td564', 'voucher', 'currency', 'package3')) {
    await runCase(results, listId, 'v9.0.154: a manual voucher and its rows take only the treasury currencies; «TOMAN» is refused, a lowercase code is read as the code and an empty row currency follows the voucher (TD-564)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const acc = await accountIdsByCode('1001', '4001');
      const admin = await sandboxAdminClient();
      const base = { date: await businessTodayIsoDate(), status: 'approved', description: 'TD-564 voucher currency' };
      const row = (accountId: number, debit: number, credit: number, extra: Record<string, unknown> = {}) => ({ accountId, debit, credit, ...extra });
      const vouchersBefore = (await orm.select({ id: journalVouchers.id }).from(journalVouchers)).length;

      // 1) B03-22: the form offered «تومان»; a TOMAN voucher with rial rows was stored and read as rials
      const tomanHeader = await admin.post('/api/accounting/vouchers', { ...base, currency: 'TOMAN', items: [row(acc['1001'], 1_000_000, 0, { currency: 'IRR' }), row(acc['4001'], 0, 1_000_000, { currency: 'IRR' })] });
      if (tomanHeader.status !== 400 || !JSON.stringify(tomanHeader.body).includes('تومانی')) problems.push(`TOMAN voucher: ${tomanHeader.status} ${JSON.stringify(tomanHeader.body).slice(0, 200)}, expected 400 naming toman`);
      const tomanRow = await admin.post('/api/accounting/vouchers', { ...base, items: [row(acc['1001'], 1_000_000, 0, { currency: 'TOMAN', exchangeRate: 10 }), row(acc['4001'], 0, 10_000_000, { currency: 'IRR' })] });
      if (tomanRow.status !== 400) problems.push(`TOMAN row: ${tomanRow.status} ${JSON.stringify(tomanRow.body).slice(0, 200)}, expected 400`);
      const tomanEdit = await admin.post('/api/accounting/vouchers', { ...base, status: 'draft', items: [row(acc['1001'], 10, 0), row(acc['4001'], 0, 10)] });
      if (tomanEdit.status === 201) {
        const put = await admin.put(`/api/accounting/vouchers/${tomanEdit.body.id}`, { currency: 'TOMAN', items: [row(acc['1001'], 10, 0, { currency: 'IRR' }), row(acc['4001'], 0, 10, { currency: 'IRR' })] });
        if (put.status !== 400) problems.push(`TOMAN on edit: ${put.status}, expected 400`);
      } else problems.push(`a plain rial draft answered ${tomanEdit.status}`);
      const vouchersAfterRefusals = (await orm.select({ id: journalVouchers.id }).from(journalVouchers)).length;
      if (vouchersAfterRefusals !== vouchersBefore + 1) problems.push(`${vouchersAfterRefusals - vouchersBefore - 1} refused vouchers were stored`);

      // 2) the form now sends each row's currency and rate: a lowercase code is the code, an empty row currency is the voucher's
      const usd = await admin.post('/api/accounting/vouchers', { ...base, currency: 'usd', items: [row(acc['1001'], 100, 0, { currency: '', exchangeRate: 600000 }), row(acc['4001'], 0, 60_000_000, { currency: 'irr' })] });
      if (usd.status !== 201) problems.push(`USD voucher with an IRR row: ${usd.status} ${JSON.stringify(usd.body).slice(0, 200)}, expected 201`);
      else if ((await storedRows(usd.body.id)).join(',') !== 'USD@600000,IRR@1') problems.push(`USD voucher rows stored as ${(await storedRows(usd.body.id)).join(',')}`);

      assertNoProblems(problems);
      return 'TOMAN refused on the voucher, its rows and on edit (400, nothing stored); a lowercase code read as the code and an empty row currency stored as the voucher currency.';
    }));
  }

  const amountId = 'reg_manual_voucher_row_amount_decimal_input_td_557';
  if (shouldRun(amountId, 'td557', 'voucher', 'amount', 'package3')) {
    await runCase(results, amountId, 'v9.0.155: manual voucher row amounts and rates are read as decimals: Persian digits and thousands separators are accepted, «0x10» and «1e3» are refused (TD-557)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const acc = await accountIdsByCode('1001', '4001');
      const admin = await sandboxAdminClient();
      const base = { date: await businessTodayIsoDate(), status: 'approved', description: 'TD-557 row amount' };
      const vouchersBefore = (await orm.select({ id: journalVouchers.id }).from(journalVouchers)).length;

      // B03-15 S11: «0x10» was stored as 16 and «1e3» as 1,000; «۱۰۰۰» was refused with «expected number, received NaN»
      for (const text of ['0x10', '1e3', 'ده']) {
        const res = await admin.post('/api/accounting/vouchers', { ...base, items: [{ accountId: acc['1001'], debit: text, credit: 0 }, { accountId: acc['4001'], debit: 0, credit: text }] });
        if (res.status !== 400 || !String(res.body?.message ?? '').includes('مبلغ بدهکار باید عدد معتبر باشد')) problems.push(`amount «${text}»: ${res.status} ${String(res.body?.message ?? '').slice(0, 160)}, expected 400 naming the debit`);
      }
      const rate = await admin.post('/api/accounting/vouchers', { ...base, items: [{ accountId: acc['1001'], debit: '100', credit: 0, currency: 'USD', exchangeRate: '6e5' }, { accountId: acc['4001'], debit: 0, credit: '60000000' }] });
      if (rate.status !== 400) problems.push(`rate «6e5»: ${rate.status}, expected 400`);
      const vouchersAfterRefusals = (await orm.select({ id: journalVouchers.id }).from(journalVouchers)).length;
      if (vouchersAfterRefusals !== vouchersBefore) problems.push(`${vouchersAfterRefusals - vouchersBefore} refused vouchers were stored`);

      const persian = await admin.post('/api/accounting/vouchers', { ...base, items: [
        { accountId: acc['1001'], debit: '۱۰۰٫۵', credit: '', currency: 'USD', exchangeRate: '۶۰۰٬۰۰۰' },
        { accountId: acc['4001'], debit: 0, credit: '۶۰٬۳۰۰٬۰۰۰' },
      ] });
      if (persian.status !== 201) problems.push(`Persian digits: ${persian.status} ${JSON.stringify(persian.body).slice(0, 200)}, expected 201`);
      else {
        const rows = await orm.select({ debit: journalVoucherItems.debit, credit: journalVoucherItems.credit, rate: journalVoucherItems.exchangeRate })
          .from(journalVoucherItems).where(and(eq(journalVoucherItems.voucherId, persian.body.id), eq(journalVoucherItems.isDeleted, 0)))
          .orderBy(asc(journalVoucherItems.rowOrder));
        const stored = rows.map(r => `${amountOf(r.debit)}/${amountOf(r.credit)}@${amountOf(r.rate)}`).join(',');
        if (stored !== '100.5/0@600000,0/60300000@1') problems.push(`Persian digits stored as ${stored}`);
      }

      assertNoProblems(problems);
      return '«0x10», «1e3», text and a «6e5» rate refused with a Persian message (nothing stored); «۱۰۰٫۵» at «۶۰۰٬۰۰۰» against «۶۰٬۳۰۰٬۰۰۰» stored as 100.5 at 600,000 and 60,300,000.';
    }));
  }

  const detailId = 'reg_manual_voucher_detailed_types_td_569';
  if (shouldRun(detailId, 'td569', 'voucher', 'detailed', 'package3')) {
    await runCase(results, detailId, 'v9.0.156: a manual voucher row takes a project, bank account or «other» detail, the voucher form reads the project pick list with accounting.vouchers, and the legacy «custom» type is refused (TD-569)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const acc = await accountIdsByCode('1001', '4001');
      const admin = await sandboxAdminClient();
      const base = { date: await businessTodayIsoDate(), status: 'approved', description: 'TD-569 detailed rows' };

      // B03-27 FE-08: the forms sent «متفرقه» / «سایر» as `custom`, which the server refused with 400
      const custom = await admin.post('/api/accounting/vouchers', { ...base, items: [
        { accountId: acc['1001'], debit: 10, credit: 0, detailedType: 'custom', detailedName: 'هزینه متفرقه' },
        { accountId: acc['4001'], debit: 0, credit: 10 },
      ] });
      if (custom.status !== 400) problems.push(`detail «custom»: ${custom.status}, expected 400`);
      const [project] = await orm.insert(productionProjects).values({ projectCode: 'PRJ-TD569', title: 'پروژه آزمون', customerName: 'مشتری', status: 'in_progress' })
        .returning({ id: productionProjects.id });
      const rows = await admin.post('/api/accounting/vouchers', { ...base, items: [
        { accountId: acc['1001'], debit: 10, credit: 0, detailedType: 'project', detailedId: project.id, detailedName: 'پروژه آزمون (PRJ-TD569)' },
        { accountId: acc['1001'], debit: 5, credit: 0, detailedType: 'other', detailedName: 'هزینه متفرقه' },
        { accountId: acc['4001'], debit: 0, credit: 15, detailedType: 'none' },
      ] });
      if (rows.status !== 201) problems.push(`project and other rows: ${rows.status} ${JSON.stringify(rows.body).slice(0, 200)}, expected 201`);
      else {
        const stored = await orm.select({ type: journalVoucherItems.detailedType, id: journalVoucherItems.detailedId, name: journalVoucherItems.detailedName })
          .from(journalVoucherItems).where(and(eq(journalVoucherItems.voucherId, rows.body.id), eq(journalVoucherItems.isDeleted, 0)))
          .orderBy(asc(journalVoucherItems.rowOrder));
        const text = stored.map(r => `${r.type}:${r.id ?? '-'}:${r.name}`).join(',');
        if (text !== `project:${project.id}:پروژه آزمون (PRJ-TD569),other:-:هزینه متفرقه,none:-:`) problems.push(`stored details ${text}`);
      }

      // the voucher form now offers the project detail: a holder of accounting.vouchers alone reads the pick list, not the full list
      const accountant = await sandboxClientWith(['accounting.vouchers']);
      const options = await accountant.get('/api/projects/options?search=PRJ-TD569');
      const pick = (options.body?.data ?? []) as Array<Record<string, unknown>>;
      if (options.status !== 200 || !pick.some(p => p.id === project.id)) problems.push(`accounting.vouchers: GET /api/projects/options ${options.status} with ${JSON.stringify(pick).slice(0, 160)}`);
      const full = await accountant.get('/api/projects');
      if (full.status !== 403) problems.push(`accounting.vouchers: GET /api/projects returned ${full.status}, not 403`);
      const banks = await accountant.get('/api/accounting/bank-accounts/options');
      if (banks.status !== 200) problems.push(`accounting.vouchers: GET /api/accounting/bank-accounts/options returned ${banks.status}`);

      assertNoProblems(problems);
      return '«custom» refused (400); project and «other» rows stored with their detail; accounting.vouchers reads the project and bank pick lists but not the full project list.';
    }));
  }

  return results;
}
