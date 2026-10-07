import fs from 'fs';
import path from 'path';
import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, appSettings, journalVoucherItems, journalVouchers } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { AccountingReportService } from '../../services/accounting/accountingReport.service.js';
import { FinancialHealthService } from '../../services/accounting/financialHealth.service.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import { DocumentService } from '../../services/document.service.js';
import { createTestItem, createTestWarehouse } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import {
  type ShouldRun, accountIdsByCode, amountOf, assertNoProblems, inFiscalSandbox, postApproved, runCase, sandboxAdminClient,
} from './fiscalClosingTests.js';

/**
 * Package 3 PR «ه»: the chart of accounts (decision t4 «الف»). Each scenario runs in its own isolated schema with the
 * standard chart of accounts and is red on the version before its fix.
 */

type AdminClient = Awaited<ReturnType<typeof sandboxAdminClient>>;

async function createSubsidiary(admin: AdminClient, code: string, name: string, parentId: number, accountType = 'expense', nature = 'debit'): Promise<number> {
  const res = await admin.post('/api/accounting/accounts', { code, name, level: 'subsidiary', parentId, accountType, nature });
  if (res.status !== 201) throw new Error(`creating account ${code} answered ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  return Number(res.body.id);
}

async function accountRow(id: number) {
  const [row] = await orm.select({ id: accounts.id, isDeleted: accounts.isDeleted, name: accounts.name, accountType: accounts.accountType, level: accounts.level, parentId: accounts.parentId })
    .from(accounts).where(eq(accounts.id, id));
  return row;
}

async function activeRowsOn(accountId: number): Promise<number> {
  const rows = await orm.select({ id: journalVoucherItems.id }).from(journalVoucherItems)
    .where(and(eq(journalVoucherItems.accountId, accountId), eq(journalVoucherItems.isDeleted, 0)));
  return rows.length;
}

/** A voucher written straight into the tables, as versions before the posting rule could store it */
async function insertLegacyVoucher(date: string, status: string, description: string, rows: Array<{ accountId: number; debit: number; credit: number }>): Promise<number> {
  const voucherNumber = await VoucherService.getNextVoucherNumber();
  const total = rows.reduce((s, r) => s + r.debit, 0);
  const [v] = await orm.insert(journalVouchers).values({
    voucherNumber, manualVoucherNumber: '', date, voucherType: 'general', status, totalDebit: money(total), totalCredit: money(total),
    description, referenceModule: 'manual', referenceNumber: '', currency: 'IRR', attachments: [],
  }).returning({ id: journalVouchers.id });
  await orm.insert(journalVoucherItems).values(rows.map((r, i) => ({
    voucherId: v.id, accountId: r.accountId, rowOrder: i + 1, detailedType: 'none', detailedName: '',
    debit: money(r.debit), credit: money(r.credit), currency: 'IRR', exchangeRate: money(1), description,
  })));
  return v.id;
}

async function voucherCount(): Promise<number> {
  return (await orm.select({ id: journalVouchers.id }).from(journalVouchers)).length;
}

export async function runChartOfAccountsTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const deleteId = 'reg_account_with_voucher_rows_not_deleted_td_546';
  if (shouldRun(deleteId, 'td546', 'account', 'chart', 'package3')) {
    await runCase(results, deleteId, 'v9.0.197: an account with voucher rows of any status is not deleted (409), a new account with a deleted code gets a new id instead of reviving the old row, and the health check lists deleted accounts that still carry rows (TD-546)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const acc = await accountIdsByCode('70', '1001');
      const today = await businessTodayIsoDate();

      // 1) B03-04 S03: expense 7091 with an approved voucher of 700,000 was deleted (200) and the trial balance lost its debit
      const posted = await createSubsidiary(admin, '7091', 'TD-546 rent', acc['70']);
      await postApproved(today, posted, acc['1001'], 700_000, 'TD-546 approved row');
      const delPosted = await admin.del(`/api/accounting/accounts/${posted}`);
      if (delPosted.status !== 409 || delPosted.body?.code !== 'ACCOUNT_HAS_VOUCHER_ROWS') {
        problems.push(`deleting an account with an approved row answered ${delPosted.status} ${JSON.stringify(delPosted.body).slice(0, 200)}, expected 409 ACCOUNT_HAS_VOUCHER_ROWS`);
      }
      if ((await accountRow(posted))?.isDeleted !== 0) problems.push('the refused account was deleted anyway');
      const tb = await AccountingReportService.getTrialBalance({ level: 'subsidiary', endDate: today });
      const debit = tb.reduce((s, r) => s + amountOf(r.debitBalance), 0);
      const credit = tb.reduce((s, r) => s + amountOf(r.creditBalance), 0);
      if (debit !== credit || debit !== 700_000) problems.push(`trial balance after the refused delete: debit ${debit}, credit ${credit}, expected 700,000 each`);

      // 2) a draft row counts too: «with any status»
      const drafted = await createSubsidiary(admin, '7092', 'TD-546 draft only', acc['70']);
      await VoucherService.createJournalVoucher({
        date: today, voucherType: 'general', status: 'draft', description: 'TD-546 draft row', referenceModule: 'manual',
        items: [{ accountId: drafted, debit: 50_000, credit: 0 }, { accountId: acc['1001'], debit: 0, credit: 50_000 }],
      });
      const delDraft = await admin.del(`/api/accounting/accounts/${drafted}`);
      if (delDraft.status !== 409 || delDraft.body?.code !== 'ACCOUNT_HAS_VOUCHER_ROWS') problems.push(`deleting an account with a draft row answered ${delDraft.status}, expected 409`);
      else if (!String(delDraft.body?.error ?? delDraft.body?.message ?? '').includes('غیرفعال')) problems.push(`the refusal does not point to deactivation: ${JSON.stringify(delDraft.body).slice(0, 200)}`);

      // 3) an unused account is still deleted, and its code then makes a new row (was the same id with the new name and type)
      const unused = await createSubsidiary(admin, '7093', 'TD-546 unused', acc['70']);
      const delUnused = await admin.del(`/api/accounting/accounts/${unused}`);
      if (delUnused.status !== 200) problems.push(`deleting an unused account answered ${delUnused.status} ${JSON.stringify(delUnused.body).slice(0, 160)}`);
      const reused = await createSubsidiary(admin, '7093', 'TD-546 scrap sales', acc['70'], 'revenue', 'credit').catch((err: Error) => { problems.push(err.message); return 0; });
      if (reused === unused) problems.push(`the deleted code 7093 revived account ${unused} instead of making a new one`);
      if ((await accountRow(unused))?.isDeleted !== 1) problems.push('the deleted account 7093 is no longer deleted');

      // 4) an account deleted with rows by an earlier version: the new account with its code does not inherit the rows,
      //    and the health check lists the deleted one
      const legacy = await createSubsidiary(admin, '7094', 'TD-546 legacy', acc['70']);
      await postApproved(today, legacy, acc['1001'], 300_000, 'TD-546 legacy row');
      await orm.update(accounts).set({ isDeleted: 1 }).where(eq(accounts.id, legacy));
      const successor = await createSubsidiary(admin, '7094', 'TD-546 successor', acc['70'], 'revenue', 'credit').catch((err: Error) => { problems.push(err.message); return 0; });
      if (successor === legacy) problems.push(`the deleted code 7094 revived account ${legacy} with its voucher row`);
      else if (successor && await activeRowsOn(successor) !== 0) problems.push(`the new account 7094 carries ${await activeRowsOn(successor)} voucher rows`);
      const report = await FinancialHealthService.runHealthCheck();
      const health = report.tests.find(t => t.id === 'deleted_accounts_with_voucher_rows');
      const listed = (health?.items ?? []).map(i => Number(i.id));
      if (!health || health.status !== 'warning' || JSON.stringify(listed) !== JSON.stringify([legacy])) {
        problems.push(`health check deleted_accounts_with_voucher_rows: ${health?.status} ${JSON.stringify(listed)}, expected warning with ${legacy} only`);
      }

      assertNoProblems(problems);
      return 'Accounts with approved or draft rows refused (409), the trial balance kept, an unused account deleted, its code reused as a new id, and the legacy deleted account with rows listed by the health check.';
    }));
  }

  const postingId = 'reg_voucher_rows_only_on_posting_accounts_td_549';
  if (shouldRun(postingId, 'td549', 'voucher', 'account', 'chart', 'package3')) {
    await runCase(results, postingId, 'v9.0.198: manual, edited and correction voucher rows go only on an active subsidiary or detailed account without an active sub-account (422 VOUCHER_ACCOUNT_NOT_POSTABLE), and the health check lists vouchers already on such accounts (TD-549)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const acc = await accountIdsByCode('7', '14', '70', '1001', '1201', '5001', '7002');
      const today = await businessTodayIsoDate();
      const base = { date: today, status: 'approved', description: 'TD-549 manual voucher' };
      const pair = (debitAccountId: number, creditAccountId: number, amount: number) => [
        { accountId: debitAccountId, debit: amount, credit: 0 }, { accountId: creditAccountId, debit: 0, credit: amount },
      ];
      const refused = (label: string, res: { status: number; body?: { code?: string } }) => {
        if (res.status !== 422 || res.body?.code !== 'VOUCHER_ACCOUNT_NOT_POSTABLE') problems.push(`${label} answered ${res.status} ${JSON.stringify(res.body).slice(0, 200)}, expected 422 VOUCHER_ACCOUNT_NOT_POSTABLE`);
      };
      const before = await voucherCount();

      // 1) B03-07 S04: «Dr 14 (general) 300,000» and «Dr 7 (group) 200,000» were stored (201) and the subsidiary trial balance lost the debits
      refused('a row on general account 14', await admin.post('/api/accounting/vouchers', { ...base, items: pair(acc['14'], acc['1001'], 300_000) }));
      refused('a row on group account 7', await admin.post('/api/accounting/vouchers', { ...base, items: pair(acc['7'], acc['1001'], 200_000) }));
      // 2) a deactivated account (was 201); a system account is not deactivated (TD-553), so a custom one is
      const inactive = await createSubsidiary(admin, '7095', 'TD-549 deactivated', acc['70']);
      const deactivate = await admin.put(`/api/accounting/accounts/${inactive}`, { isActive: false });
      if (deactivate.status !== 200) problems.push(`deactivating 7095 answered ${deactivate.status}`);
      refused('a row on deactivated 7095', await admin.post('/api/accounting/vouchers', { ...base, items: pair(inactive, acc['1001'], 100_000) }));
      // 3) a subsidiary with an active detailed account under it takes no row; the detailed account does
      const detail = await admin.post('/api/accounting/accounts', { code: '700201', name: 'TD-549 rent of the workshop', level: 'detailed', parentId: acc['7002'], accountType: 'expense', nature: 'debit' });
      if (detail.status !== 201) problems.push(`creating detailed account 700201 answered ${detail.status}`);
      refused('a row on 7002 with an active detailed account', await admin.post('/api/accounting/vouchers', { ...base, items: pair(acc['7002'], acc['1001'], 100_000) }));
      if ((await voucherCount()) !== before) problems.push(`${(await voucherCount()) - before} refused vouchers were stored`);
      const onDetail = await admin.post('/api/accounting/vouchers', { ...base, items: pair(Number(detail.body?.id), acc['1001'], 100_000) });
      if (onDetail.status !== 201) problems.push(`a row on detailed account 700201 answered ${onDetail.status} ${JSON.stringify(onDetail.body).slice(0, 200)}`);

      // 4) editing a draft and correcting an approved voucher follow the same rule
      const draft = await admin.post('/api/accounting/vouchers', { ...base, status: 'draft', items: pair(acc['1201'], acc['5001'], 400_000) });
      if (draft.status !== 201) problems.push(`a valid draft answered ${draft.status}`);
      else refused('editing a draft onto 14', await admin.put(`/api/accounting/vouchers/${draft.body.id}`, { ...base, status: 'draft', items: pair(acc['14'], acc['5001'], 400_000) }));
      const approved = await admin.post('/api/accounting/vouchers', { ...base, items: pair(acc['1201'], acc['5001'], 500_000) });
      if (approved.status !== 201) problems.push(`a valid approved voucher answered ${approved.status}`);
      else {
        const beforeCorrection = await voucherCount();
        refused('a correction onto 14', await admin.post(`/api/accounting/vouchers/${approved.body.id}/correct`, { date: today, reason: 'TD-549', newItems: pair(acc['14'], acc['5001'], 500_000) }));
        if ((await voucherCount()) !== beforeCorrection) problems.push('the refused correction left a reversal voucher');
      }
      const tb = await AccountingReportService.getTrialBalance({ level: 'subsidiary', endDate: today });
      const debit = tb.reduce((s, r) => s + amountOf(r.debitBalance), 0);
      const credit = tb.reduce((s, r) => s + amountOf(r.creditBalance), 0);
      if (debit !== credit) problems.push(`subsidiary trial balance out of balance: debit ${debit}, credit ${credit}`);

      // 5) vouchers stored before the rule: on a general account (approved), on an inactive account (draft); an approved
      //    voucher on an account deactivated later is history and is not listed
      const onGeneral = await insertLegacyVoucher(today, 'approved', 'TD-549 legacy general', pair(acc['14'], acc['1001'], 300_000));
      const draftInactive = await insertLegacyVoucher(today, 'draft', 'TD-549 legacy draft on inactive', pair(inactive, acc['1001'], 50_000));
      const history = await insertLegacyVoucher(today, 'approved', 'TD-549 history on inactive', pair(inactive, acc['1001'], 20_000));
      const report = await FinancialHealthService.runHealthCheck();
      const health = report.tests.find(t => t.id === 'voucher_rows_on_non_posting_accounts');
      const listed = (health?.items ?? []).map(i => Number(i.id)).sort((a, b) => a - b);
      if (!health || health.status !== 'warning' || JSON.stringify(listed) !== JSON.stringify([onGeneral, draftInactive].sort((a, b) => a - b))) {
        problems.push(`health check voucher_rows_on_non_posting_accounts: ${health?.status} ${JSON.stringify(listed)}, expected ${onGeneral} and ${draftInactive}, not ${history}`);
      }

      assertNoProblems(problems);
      return 'Rows on group, general, inactive and parent accounts refused in new, edited and correction vouchers (422) with nothing stored, a detailed account accepted, and legacy vouchers listed by the health check.';
    }));
  }

  const mappingId = 'reg_account_mapping_validated_td_550';
  if (shouldRun(mappingId, 'td550', 'mapping', 'account', 'chart', 'package3')) {
    await runCase(results, mappingId, 'v9.0.199: an account mapping is saved only onto a posting account of the concept\'s type (422 ACCOUNT_MAPPING_INVALID), automatic vouchers never fall back to a general account, and the health check lists mappings that are wrong today (TD-550)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const acc = await accountIdsByCode('14', '1401', '1201');
      const stored = async () => (await AccountMappingService.getMappings()).inventoryRawMaterialsCode;
      const save = (body: Record<string, unknown>) => admin.post('/api/accounting/mappings', body);

      // 1) B03-08 S04: «1499» (missing), «9999» and «5001» (revenue) were saved (200); a general account and the group «1» too
      for (const code of ['1499', '9999', '5001', '14', '1']) {
        const res = await save({ inventoryRawMaterialsCode: code });
        if (res.status !== 422 || res.body?.code !== 'ACCOUNT_MAPPING_INVALID') problems.push(`raw materials mapped to ${code} answered ${res.status} ${JSON.stringify(res.body).slice(0, 160)}, expected 422 ACCOUNT_MAPPING_INVALID`);
        else if (!String(res.body?.error ?? res.body?.message ?? '').includes('موجودی مواد اولیه')) problems.push(`the refusal for ${code} does not name the concept: ${JSON.stringify(res.body).slice(0, 200)}`);
      }
      if (await stored() !== '1401') problems.push(`a refused mapping was stored: ${await stored()}`);
      // 2) a posting asset account is accepted, Persian digits become Latin; a disabled concept is not checked
      const custom = await admin.post('/api/accounting/accounts', { code: '1499', name: 'TD-550 raw materials', level: 'subsidiary', parentId: acc['14'], accountType: 'asset', nature: 'debit' });
      if (custom.status !== 201) problems.push(`creating 1499 answered ${custom.status}`);
      const persian = await save({ inventoryRawMaterialsCode: '۱۴۹۹' });
      if (persian.status !== 200 || await stored() !== '1499') problems.push(`«۱۴۹۹» answered ${persian.status}, stored ${await stored()}`);
      const disabledSave = await save({ inventoryRawMaterialsCode: '1401', salesRevenueAccountCode: '9999', disabled: ['salesRevenueAccountCode'] });
      if (disabledSave.status !== 200) problems.push(`a disabled concept with an unknown code answered ${disabledSave.status} ${JSON.stringify(disabledSave.body).slice(0, 160)}`);
      await save({ salesRevenueAccountCode: '5001', disabled: [] });

      // 3) mappings stored before the check: a missing code and a general account resolve to the concept's default 1401,
      //    never to general account 14, and the health check lists them
      const writeLegacy = (value: Record<string, string>) => orm.update(appSettings).set({ value: JSON.stringify({ ...value }) })
        .where(eq(appSettings.key, 'accounting_account_mappings'));
      for (const legacy of ['7777', '14']) {
        await writeLegacy({ ...(await AccountMappingService.getMappings()), inventoryRawMaterialsCode: legacy });
        const resolved = await AccountMappingService.resolveAccount('inventoryRawMaterialsCode');
        if (resolved?.code !== '1401') problems.push(`a legacy mapping ${legacy} resolved to ${resolved?.code ?? 'nothing'}, expected 1401`);
      }
      await writeLegacy({ ...(await AccountMappingService.getMappings()), inventoryRawMaterialsCode: '14', salesRevenueAccountCode: '1201' });
      const report = await FinancialHealthService.runHealthCheck();
      const health = report.tests.find(t => t.id === 'account_mapping_invalid');
      const listed = (health?.items ?? []).map(i => String(i.code)).sort();
      if (!health || health.status !== 'warning' || JSON.stringify(listed) !== JSON.stringify(['inventoryRawMaterialsCode', 'salesRevenueAccountCode'])) {
        problems.push(`health check account_mapping_invalid: ${health?.status} ${JSON.stringify(listed)}, expected the raw materials and sales revenue mappings`);
      }

      // 4) with neither the mapped account nor 1401, a purchase receipt never posts to general account 14 (it did)
      await writeLegacy({ ...(await AccountMappingService.getMappings()), inventoryRawMaterialsCode: '7777', salesRevenueAccountCode: '5001' });
      await orm.update(accounts).set({ isDeleted: 1 }).where(eq(accounts.id, acc['1401']));
      const wh = await createTestWarehouse();
      const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
      await DocumentService.createDocument({
        docType: 'receipt', status: 'final', inOut: 'in', date: await businessTodayIsoDate(), user: 'td550', buyerName: 'td550',
        location: wh.code, items: [{ itemId: item.id, quantity: 2, unitPrice: 100_000, location: wh.code }],
      }).catch(() => null);
      if (await activeRowsOn(acc['14']) !== 0) problems.push(`the purchase receipt posted ${await activeRowsOn(acc['14'])} rows on general account 14`);

      assertNoProblems(problems);
      return 'Missing, revenue, general and group codes refused (422), a posting asset account saved with Latin digits, disabled concepts skipped, legacy mappings resolved to 1401 and listed, and no automatic row on general account 14.';
    }));
  }

  const editId = 'reg_account_edit_guards_td_553';
  if (shouldRun(editId, 'td553', 'account', 'chart', 'package3')) {
    await runCase(results, editId, 'v9.0.200: an account edit keeps the tree acyclic with the parent one level up, a system account takes only a new name and description, an account with voucher rows keeps its type, nature, level and parent, and the tree and the trial balance survive a legacy cycle (TD-553)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const acc = await accountIdsByCode('7', '70', '1001', '1201', '5001');
      const today = await businessTodayIsoDate();
      const expect = (label: string, res: { status: number; body?: { code?: string } }, status: number, code?: string) => {
        if (res.status !== status || (code && res.body?.code !== code)) problems.push(`${label} answered ${res.status} ${JSON.stringify(res.body).slice(0, 180)}, expected ${status}${code ? ` ${code}` : ''}`);
      };

      // 1) B03-11 S12: 7093's parent set to its own sub-account 709301 (200) and the tree answered 500
      const parent = await createSubsidiary(admin, '7093', 'TD-553 parent', acc['70']);
      const child = await admin.post('/api/accounting/accounts', { code: '709301', name: 'TD-553 child', level: 'detailed', parentId: parent, accountType: 'expense', nature: 'debit' });
      expect('creating detailed 709301 under 7093', child, 201);
      expect('making 709301 the parent of 7093', await admin.put(`/api/accounting/accounts/${parent}`, { parentId: child.body?.id }), 422, 'ACCOUNT_PARENT_INVALID');
      expect('making 7093 a detailed account under 709301', await admin.put(`/api/accounting/accounts/${parent}`, { level: 'detailed', parentId: child.body?.id }), 422);
      expect('a subsidiary under group 7', await admin.post('/api/accounting/accounts', { code: '7096', name: 'TD-553 wrong level', level: 'subsidiary', parentId: acc['7'], accountType: 'expense', nature: 'debit' }), 422, 'ACCOUNT_PARENT_INVALID');
      expect('moving 7093 under group 7', await admin.put(`/api/accounting/accounts/${parent}`, { parentId: acc['7'] }), 422, 'ACCOUNT_PARENT_INVALID');
      expect('7093 becoming a group with a detailed child', await admin.put(`/api/accounting/accounts/${parent}`, { level: 'group', parentId: null }), 422, 'ACCOUNT_LEVEL_INVALID');
      expect('the tree', await admin.get('/api/accounting/accounts/tree'), 200);

      // 2) B03-11 S17: system account 5001 became an asset and then a group (200) and the income statement lost its revenue
      await postApproved(today, acc['1201'], acc['5001'], 1_000_000, 'TD-553 sale');
      expect('5001 as an asset', await admin.put(`/api/accounting/accounts/${acc['5001']}`, { accountType: 'asset' }), 409, 'ACCOUNT_IS_SYSTEM');
      expect('5001 as a group', await admin.put(`/api/accounting/accounts/${acc['5001']}`, { level: 'group' }), 409, 'ACCOUNT_IS_SYSTEM');
      expect('5001 deactivated', await admin.put(`/api/accounting/accounts/${acc['5001']}`, { isActive: false }), 409, 'ACCOUNT_IS_SYSTEM');
      expect('renaming 5001 with the form body', await admin.put(`/api/accounting/accounts/${acc['5001']}`, {
        code: '5001', name: 'TD-553 sales', level: 'subsidiary', parentId: (await accountIdsByCode('50'))['50'], accountType: 'revenue', nature: 'credit', description: 'TD-553',
      }), 200);
      const income = await AccountingReportService.getIncomeStatement({ endDate: today });
      if (amountOf(income.totalRevenue) !== 1_000_000) problems.push(`income statement revenue ${income.totalRevenue}, expected 1,000,000`);

      // 3) a custom account with rows keeps its type, nature, level and parent; its name and active flag change
      const posted = await createSubsidiary(admin, '7094', 'TD-553 posted', acc['70']);
      await postApproved(today, posted, acc['1001'], 200_000, 'TD-553 expense');
      expect('7094 with rows as revenue', await admin.put(`/api/accounting/accounts/${posted}`, { accountType: 'revenue' }), 409, 'ACCOUNT_HAS_VOUCHER_ROWS');
      expect('7094 with rows as credit nature', await admin.put(`/api/accounting/accounts/${posted}`, { nature: 'credit' }), 409, 'ACCOUNT_HAS_VOUCHER_ROWS');
      expect('renaming and deactivating 7094', await admin.put(`/api/accounting/accounts/${posted}`, { name: 'TD-553 renamed', isActive: false }), 200);
      const row = await accountRow(posted);
      if (row?.accountType !== 'expense' || row?.name !== 'TD-553 renamed') problems.push(`7094 after the edits: ${JSON.stringify(row)}`);
      // an account without rows still changes its type
      expect('7093 without rows as cost of sales', await admin.put(`/api/accounting/accounts/${parent}`, { accountType: 'cost_of_sales' }), 200);

      // 4) a cycle stored by an earlier version: the tree answers and the trial balance finishes
      await orm.update(accounts).set({ parentId: Number(child.body?.id) }).where(eq(accounts.id, parent));
      const tree = await admin.get('/api/accounting/accounts/tree');
      if (tree.status !== 200) problems.push(`the tree with a legacy cycle answered ${tree.status} ${JSON.stringify(tree.body).slice(0, 160)}`);
      // the roll-up climbed the parents with no stop: on the previous version this call never returns
      await postApproved(today, Number(child.body?.id), acc['1001'], 50_000, 'TD-553 row under a cycle');
      const cyclic = await AccountingReportService.getTrialBalance({ level: 'subsidiary', endDate: today });
      const row7093 = cyclic.find(r => r.code === '7093');
      // 709301's row rolls up into 7093 once, not once per turn of the cycle
      if (row7093?.debitTurnover !== 50_000) problems.push(`7093 in the trial balance with a legacy cycle: ${JSON.stringify(row7093)}`);

      assertNoProblems(problems);
      return 'Cycles and wrong parent levels refused (422), system account 5001 kept its type, level and active flag (409) and took a new name, an account with rows kept its type and nature (409), and a legacy cycle left the tree and the trial balance working.';
    }));
  }

  const codeId = 'reg_account_code_latin_digits_td_558';
  if (shouldRun(codeId, 'td558', 'account', 'chart', 'package3')) {
    await runCase(results, codeId, 'v9.0.201: an account code is stored with Latin digits and digits only, a duplicate code (Persian digits included, concurrent requests too) is 409, a new code on edit is 422, a legacy Persian code turns Latin when its account is saved, and the health check lists the codes still not Latin (TD-558)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const acc = await accountIdsByCode('70');
      const expect = (label: string, res: { status: number; body?: { code?: string } }, status: number, code?: string) => {
        if (res.status !== status || (code && res.body?.code !== code)) problems.push(`${label} answered ${res.status} ${JSON.stringify(res.body).slice(0, 180)}, expected ${status}${code ? ` ${code}` : ''}`);
      };
      const body = (code: string, name: string) => ({ code, name, level: 'subsidiary', parentId: acc['70'], accountType: 'expense', nature: 'debit' });
      const codeOf = async (id: number) => (await orm.select({ code: accounts.code }).from(accounts).where(eq(accounts.id, id)))[0]?.code;

      // 1) B03-16 S12: «۷۰۹۶» and «7096» became two accounts
      const persian = await admin.post('/api/accounting/accounts', body('۷۰۹۶', 'TD-558 Persian digits'));
      expect('creating «۷۰۹۶»', persian, 201);
      const id7096 = Number(persian.body?.id);
      if (await codeOf(id7096) !== '7096') problems.push(`«۷۰۹۶» was stored as ${await codeOf(id7096)}`);
      expect('creating 7096 again', await admin.post('/api/accounting/accounts', body('7096', 'TD-558 duplicate')), 409, 'ACCOUNT_CODE_TAKEN');
      expect('creating «70-96»', await admin.post('/api/accounting/accounts', body('70-96', 'TD-558 dash')), 400);

      // 2) five concurrent requests with one code answered [201, 409, 500, 500, 500]. Migration 0012 looks for the index in
      // every schema, so this sandbox schema, made beside the suite's own, lacks it; production has it.
      await orm.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_code_active ON accounts (code) WHERE is_deleted = 0`);
      const burst = await Promise.all([1, 2, 3, 4, 5].map(i => admin.post('/api/accounting/accounts', body('7097', `TD-558 burst ${i}`))));
      const statuses = burst.map(r => r.status).sort();
      if (statuses.join(',') !== '201,409,409,409,409') problems.push(`five concurrent creates of 7097 answered ${statuses.join(',')}`);

      // 3) a new code on edit was ignored and the form said «ویرایش شد»
      expect('changing the code of 7096', await admin.put(`/api/accounting/accounts/${id7096}`, { code: '7098', name: 'TD-558 renamed' }), 422, 'ACCOUNT_CODE_IMMUTABLE');
      if (await codeOf(id7096) !== '7096') problems.push('the refused code change still changed the code');
      expect('saving 7096 with its own code in Persian digits', await admin.put(`/api/accounting/accounts/${id7096}`, { code: '۷۰۹۶', name: 'TD-558 renamed' }), 200);

      // 4) legacy codes written by earlier versions
      const [legacy] = await orm.insert(accounts).values({ code: '۷۰۹۹', name: 'TD-558 legacy', level: 'subsidiary', parentId: acc['70'], accountType: 'expense', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0 }).returning({ id: accounts.id });
      const [twin] = await orm.insert(accounts).values({ code: '۷۰۹۶', name: 'TD-558 legacy twin', level: 'subsidiary', parentId: acc['70'], accountType: 'expense', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0 }).returning({ id: accounts.id });
      const before = (await FinancialHealthService.runHealthCheck()).tests.find(t => t.id === 'account_code_not_latin');
      const listed = (before?.items ?? []).map(i => Number(i.id)).sort();
      if (before?.status !== 'warning' || listed.join(',') !== [legacy.id, twin.id].sort().join(',')) problems.push(`health check before the repair: ${JSON.stringify(before).slice(0, 300)}`);
      if (!before?.items?.find(i => Number(i.id) === twin.id)?.details?.includes('7096')) problems.push('the health check did not name the account that holds the twin code');
      expect('creating 7099 beside legacy «۷۰۹۹»', await admin.post('/api/accounting/accounts', body('7099', 'TD-558 beside legacy')), 409, 'ACCOUNT_CODE_TAKEN');
      expect('saving legacy «۷۰۹۹»', await admin.put(`/api/accounting/accounts/${legacy.id}`, { code: '۷۰۹۹', name: 'TD-558 legacy saved' }), 200);
      if (await codeOf(legacy.id) !== '7099') problems.push(`legacy «۷۰۹۹» after saving: ${await codeOf(legacy.id)}`);
      expect('saving legacy «۷۰۹۶» while 7096 exists', await admin.put(`/api/accounting/accounts/${twin.id}`, { code: '۷۰۹۶', name: 'TD-558 twin saved' }), 409, 'ACCOUNT_CODE_TAKEN');
      const after = (await FinancialHealthService.runHealthCheck()).tests.find(t => t.id === 'account_code_not_latin');
      if ((after?.items ?? []).map(i => Number(i.id)).join(',') !== String(twin.id)) problems.push(`health check after the repair: ${JSON.stringify(after?.items)}`);

      // 5) restoring a deleted account whose code is taken answered 500
      expect('deleting the legacy twin', await admin.del(`/api/accounting/accounts/${twin.id}`), 200);
      expect('restoring the twin while 7096 exists', await admin.post(`/api/accounting/accounts/${twin.id}/restore`, {}), 409, 'ACCOUNT_CODE_TAKEN');

      assertNoProblems(problems);
      return '«۷۰۹۶» stored as 7096, duplicates 409 (five concurrent creates: one 201, four 409), a code change 422, a legacy Persian code turned Latin on save, its taken twin 409 and listed by the health check, and its restore 409.';
    }));
  }

  const constraintId = 'reg_accounting_check_constraints_td_562';
  if (shouldRun(constraintId, 'td562', 'constraint', 'account', 'chart', 'package3')) {
    await runCase(results, constraintId, 'v9.0.202: the database refuses a negative or empty voucher row, an unknown voucher status or type, an unknown account level, type or nature and a missing parent account; a soft-deleted row is exempt, and a legacy row that breaks a rule leaves its constraint NOT VALID and is listed by the health check (TD-562)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const acc = await accountIdsByCode('1001', '5001', '70');
      const today = await businessTodayIsoDate();
      const pgCode = (err: unknown): string | undefined => {
        for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
          const code = (e as { code?: unknown }).code;
          if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
        }
        return undefined;
      };
      const refused = async (label: string, expected: string, write: () => Promise<unknown>) => {
        try {
          await write();
          problems.push(`${label} was stored`);
        } catch (err) {
          if (pgCode(err) !== expected) problems.push(`${label} failed with ${pgCode(err)} instead of ${expected}: ${String(err).slice(0, 160)}`);
        }
      };
      const gaps = async () => (await FinancialHealthService.runHealthCheck()).tests.find(t => t.id === 'accounting_integrity_constraints');

      // 1) on clean data every constraint is validated
      const clean = await gaps();
      if (clean?.status !== 'healthy') problems.push(`health check on clean data: ${String(JSON.stringify(clean)).slice(0, 300)}`);

      // 2) B03-20 S00: the database took every one of these rows
      const voucherId = await insertLegacyVoucher(today, 'draft', 'TD-562 voucher', [
        { accountId: acc['1001'], debit: 1000, credit: 0 }, { accountId: acc['5001'], debit: 0, credit: 1000 },
      ]);
      const row = (debit: number, credit: number, isDeleted = 0) => orm.insert(journalVoucherItems).values({
        voucherId, accountId: acc['1001'], rowOrder: 9, detailedType: 'none', detailedName: '', debit: money(debit), credit: money(credit),
        currency: 'IRR', exchangeRate: money(1), description: 'TD-562 row', isDeleted,
      });
      await refused('a row with a negative debit', '23514', () => row(-5, 0));
      await refused('a row with neither debit nor credit', '23514', () => row(0, 0));
      await row(0, 0, 1); // a soft-deleted row is exempt
      await refused('a voucher with status «final»', '23514', () => orm.update(journalVouchers).set({ status: 'final' }).where(eq(journalVouchers.id, voucherId)));
      await refused('a voucher with type «manual»', '23514', () => orm.update(journalVouchers).set({ voucherType: 'manual' }).where(eq(journalVouchers.id, voucherId)));
      const account = (over: Partial<typeof accounts.$inferInsert>) => orm.insert(accounts).values({
        code: '7091', name: 'TD-562 account', level: 'subsidiary', parentId: acc['70'], accountType: 'expense', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0, ...over,
      });
      await refused('an account at level «leaf»', '23514', () => account({ level: 'leaf' }));
      await refused('an account of type «cost»', '23514', () => account({ accountType: 'cost' }));
      await refused('an account of nature «mixed»', '23514', () => account({ nature: 'mixed' }));
      await refused('an account under a missing parent', '23503', () => account({ parentId: 99_999_999 }));

      // 3) a legacy row from before the constraint: the migration leaves it NOT VALID and the health check lists it
      await orm.execute(sql`ALTER TABLE journal_voucher_items DROP CONSTRAINT chk_jvi_amount_present`);
      const [legacy] = await row(0, 0).returning({ id: journalVoucherItems.id });
      const dir = path.resolve(process.cwd(), 'drizzle');
      const file = fs.readdirSync(dir).find(f => f.endsWith('_accounting_check_constraints.sql'));
      if (!file) throw new Error('the accounting constraint migration file is missing');
      await orm.execute(sql.raw(fs.readFileSync(path.join(dir, file), 'utf8')));
      const state = await orm.execute(sql`SELECT convalidated FROM pg_constraint WHERE conname = 'chk_jvi_amount_present' AND conrelid = to_regclass('journal_voucher_items')`);
      if ((state.rows as Array<{ convalidated?: boolean }>)[0]?.convalidated !== false) problems.push(`chk_jvi_amount_present over a legacy row: ${JSON.stringify(state.rows)}`);
      await refused('a new row with neither debit nor credit after the rerun', '23514', () => row(0, 0));
      const listed = await gaps();
      const item = listed?.items?.find(i => i.code === 'chk_jvi_amount_present');
      if (listed?.status !== 'warning' || listed?.items?.length !== 1 || !item?.subtitle?.includes('۱')) problems.push(`health check with a legacy row: ${String(JSON.stringify(listed)).slice(0, 400)}`);
      // the legacy row can still be soft-deleted
      await orm.update(journalVoucherItems).set({ isDeleted: 1 }).where(eq(journalVoucherItems.id, legacy.id));

      assertNoProblems(problems);
      return 'Negative and empty rows, an unknown status, type, level and nature were refused (23514) and a missing parent (23503); a soft-deleted empty row was stored; a legacy empty row left chk_jvi_amount_present NOT VALID, was listed by the health check and was soft-deleted.';
    }));
  }

  return results;
}
