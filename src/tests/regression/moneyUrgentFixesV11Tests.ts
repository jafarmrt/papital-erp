import type request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, bankAccounts, fiscalPeriods, journalVouchers } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { fin } from '../../lib/financialDecimal.js';
import { FiscalPeriodService } from '../../services/accounting/fiscalPeriod.service.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { createTestItem, createTestWarehouse } from '../fixtures/factories.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, accountIdsByCode, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';

/**
 * v11 phase 3.1 (urgent money fixes, findings of the phase 2 evaluation): real Express routes and services on PostgreSQL,
 * each scenario in its own schema with the standard chart of accounts; each is red on v11.1.0.
 *  - M1: a voucher correction issues its replacement as a manual draft (workflow, maker-checker), never approved with no
 *    approver; on v11.1.0 a user who may only draft vouchers replaced an approved voucher with any amount in the books.
 *  - M2: the opening voucher of a treasury account and the adjustments of its opening balance are sourced vouchers; on
 *    v11.1.0 the voucher page edited, deleted, corrected and reversed them and the bank card and the ledger drifted apart.
 *  - M4: a misplaced group separator («12,5»، «1٬00٬0») is refused by every server number field; on v11.1.0 it was dropped
 *    and «12,5» was read as 125.
 *  - M5 / S6 / M23: the fiscal-year lock holds on every sub-ledger write: a treasury row, a transfer or a cheque without a
 *    voucher, a warehouse transfer, and a draft document; on v11.1.0 each was accepted in a closed year.
 */

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;
const brief = (res: request.Response) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 220)}`;
const codeOf = (res: request.Response) => String(res.body?.code ?? res.body?.error?.code ?? '');
const textOf = (res: request.Response) => JSON.stringify(res.body ?? null);

type Api = Awaited<ReturnType<typeof sandboxAdminClient>> | Awaited<ReturnType<typeof sandboxClientWith>>;

const RECORD = ['accounting.view', 'accounting.vouchers'];
const APPROVE = [...RECORD, 'accounting.vouchers_approve'];

async function pairOf(amount: number | string) {
  const acc = await accountIdsByCode('7001', '1001');
  return [
    { accountId: acc['7001'], debit: amount, credit: 0 },
    { accountId: acc['1001'], debit: 0, credit: amount },
  ];
}

async function voucherRow(id: number) {
  const [row] = await orm.select({
    status: journalVouchers.status, approvedById: journalVouchers.approvedById, createdById: journalVouchers.createdById,
    date: journalVouchers.date, totalDebit: journalVouchers.totalDebit,
  }).from(journalVouchers).where(eq(journalVouchers.id, id));
  return row;
}

/** the net of account 7001 in the books (approved and permanent vouchers only) */
async function booked7001(): Promise<string> {
  const acc = await accountIdsByCode('7001');
  const r = await orm.execute(sql`SELECT COALESCE(SUM(i.debit - i.credit), 0)::text AS net FROM journal_voucher_items i
    JOIN journal_vouchers v ON v.id = i.voucher_id
    WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND v.status IN ('approved', 'permanent') AND i.account_id = ${acc['7001']}`);
  return fin(String((r.rows[0] as { net: string }).net)).toString();
}

/** a treasury account with its own ledger account under 1003 */
async function bankWith(api: Api, title: string, body: Record<string, unknown> = {}): Promise<number> {
  const [parent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
  const [ledger] = await orm.insert(accounts).values({
    code: `1003${tagOf()}`, name: `${title} ledger`, level: 'subsidiary', parentId: parent?.id ?? null,
    accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
  }).returning({ id: accounts.id });
  const res = await api.post('/api/accounting/bank-accounts', { title: `${title} ${tagOf()}`, type: 'bank', accountId: ledger.id, initialBalance: 0, ...body });
  if (res.status !== 201) throw new Error(`setup: bank account ${brief(res)}`);
  return Number(res.body.id);
}

async function openingVoucherIds(bankId: number): Promise<number[]> {
  const rows = await orm.select({ id: journalVouchers.id }).from(journalVouchers)
    .where(and(eq(journalVouchers.referenceModule, 'treasury_opening'), eq(journalVouchers.referenceId, bankId), eq(journalVouchers.isDeleted, 0)))
    .orderBy(journalVouchers.id);
  return rows.map(r => r.id);
}

async function bankState(bankId: number): Promise<string> {
  const [bank] = await orm.select({ current: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, bankId));
  const r = await orm.execute(sql`SELECT COALESCE(SUM(i.debit - i.credit), 0)::text AS net FROM journal_voucher_items i
    JOIN journal_vouchers v ON v.id = i.voucher_id
    WHERE v.is_deleted = 0 AND i.is_deleted = 0 AND i.detailed_type = 'bank_account' AND i.detailed_id = ${bankId}`);
  return `card ${fin(bank?.current ?? 0).toString()} ledger ${fin(String((r.rows[0] as { net: string }).net)).toString()}`;
}

const count = async (query: ReturnType<typeof sql>) => Number(((await orm.execute(query)).rows[0] as { n: number | string }).n);

export async function runMoneyUrgentFixesV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const m1 = 'reg_voucher_correction_is_draft_v11_m1';
  if (shouldRun(m1, 'v11', 'phase3', 'm1', 'voucher', 'correct', 'vouchers_approve', 'maker')) {
    await runCase(results, m1, 'v11 phase 3.1 (M1): a voucher correction issues the replacement as a manual draft that another holder of the approve key approves; a recorder corrects but never posts the new amount', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const today = await businessTodayIsoDate();
      const maker = await sandboxClientWith(RECORD);
      const checker = await sandboxClientWith(APPROVE);
      const clerk = await sandboxClientWith(RECORD);
      const approvedVoucher = async (amount: number) => {
        const created = await maker.post('/api/accounting/vouchers', { date: today, description: `M1 voucher ${amount}`, items: await pairOf(amount) });
        if (created.status !== 201) throw new Error(`setup: voucher create ${brief(created)}`);
        const approved = await checker.put(`/api/accounting/vouchers/${created.body.id}/status`, { status: 'approved' });
        if (approved.status !== 200) throw new Error(`setup: voucher approve ${brief(approved)}`);
        return Number(created.body.id);
      };

      // 1) a recorder corrects an approved voucher of 8,000 into 800,000
      const original = await approvedVoucher(8_000);
      const corrected = await clerk.post(`/api/accounting/vouchers/${original}/correct`, { reason: 'M1 correction', newItems: await pairOf(800_000) });
      if (corrected.status !== 201) throw new Error(`correct returned ${brief(corrected)}`);
      const corrId = Number(corrected.body?.correctedVoucher?.id);
      const revId = Number(corrected.body?.reversalVoucher?.id);
      const corr = await voucherRow(corrId);
      if (corr?.status !== 'draft' || corr?.approvedById !== null) problems.push(`the replacement is ${corr?.status} approved by ${String(corr?.approvedById)}, expected a draft with no approver`);
      if (corr?.createdById !== clerk.userId) problems.push(`the replacement was made by ${String(corr?.createdById)}, expected the corrector ${clerk.userId}`);
      if ((await voucherRow(revId))?.status !== 'approved') problems.push('the reversal of the original is not approved');
      if (!String(corrected.body?.message ?? '').includes('پیش‌نویس')) problems.push(`the answer does not say the replacement is a draft: ${String(corrected.body?.message)}`);
      if (await booked7001() !== '0') problems.push(`account 7001 has ${await booked7001()} in the books after the correction, expected 0 until the replacement is approved`);

      // 2) the recorder does not approve it; another holder of the approve key does, and only then it is in the books
      const byClerk = await clerk.put(`/api/accounting/vouchers/${corrId}/status`, { status: 'approved' });
      if (byClerk.status !== 403) problems.push(`the recorder approving the replacement returned ${brief(byClerk)}, expected 403`);
      const byChecker = await checker.put(`/api/accounting/vouchers/${corrId}/status`, { status: 'approved' });
      if (byChecker.status !== 200) problems.push(`another holder approving the replacement returned ${brief(byChecker)}`);
      if (await booked7001() !== '800000') problems.push(`account 7001 has ${await booked7001()} after the approval, expected 800000`);

      // 3) a holder of the approve key who corrects is the replacement's maker and does not approve it
      const corrector = await sandboxClientWith(APPROVE);
      const second = await approvedVoucher(9_000);
      const own = await corrector.post(`/api/accounting/vouchers/${second}/correct`, { reason: 'M1 own correction', newItems: await pairOf(90_000) });
      if (own.status !== 201) throw new Error(`second correct returned ${brief(own)}`);
      const ownId = Number(own.body?.correctedVoucher?.id);
      const self = await corrector.put(`/api/accounting/vouchers/${ownId}/status`, { status: 'approved' });
      if (self.status !== 403 || codeOf(self) !== 'VOUCHER_MAKER_CANNOT_APPROVE') problems.push(`the corrector approving their own replacement returned ${brief(self)}, expected 403 VOUCHER_MAKER_CANNOT_APPROVE`);
      if ((await voucherRow(ownId))?.status !== 'draft') problems.push('the refused self approval changed the replacement');
      assertNoProblems(problems);
      return 'recorder corrected 8,000 → 800,000: reversal approved, replacement a draft without approver, 7001 at 0; recorder approve 403, checker 200, 7001 at 800,000; a corrector holding the key cannot approve their own replacement';
    }));
  }

  const m2 = 'reg_bank_opening_voucher_sourced_v11_m2';
  if (shouldRun(m2, 'v11', 'phase3', 'm2', 'treasury', 'bank', 'opening', 'voucher_source')) {
    await runCase(results, m2, 'v11 phase 3.1 (M2): the opening voucher of a treasury account and its opening balance adjustments are only approved and finalized from the voucher page; the start date of a draft opening voucher moves from the account form, an approved one is fixed', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const bankId = await bankWith(api, 'M2 bank', { initialBalance: 3_000_000, openingDate: '2026-04-05' });
      const [openingId] = await openingVoucherIds(bankId);
      if (!openingId) throw new Error('the bank has no opening voucher');
      const detail = await api.get(`/api/accounting/vouchers/${openingId}`);
      if (detail.body?.sourceKind !== 'treasury_opening') problems.push(`the opening voucher has source ${String(detail.body?.sourceKind)}, expected treasury_opening`);
      const refused = (label: string, res: request.Response) => {
        if (res.status !== 409 || codeOf(res) !== 'VOUCHER_HAS_SOURCE') problems.push(`${label} returned ${brief(res)}, expected 409 VOUCHER_HAS_SOURCE`);
      };

      // 1) the draft: no edit, no delete; the refusal names the account form
      const edit = await api.put(`/api/accounting/vouchers/${openingId}`, { version: Number(detail.body?.version ?? 1), description: 'M2 edit', items: await pairOf(1) });
      refused('editing the draft opening voucher', edit);
      if (edit.status === 409 && !textOf(edit).includes('ویرایش همان حساب خزانه')) problems.push(`the edit refusal does not point to the account form: ${textOf(edit).slice(0, 200)}`);
      refused('deleting the draft opening voucher', await api.del(`/api/accounting/vouchers/${openingId}`));

      // 2) the start date of the draft moves from the account form, the voucher with it
      const moved = await api.put(`/api/accounting/bank-accounts/${bankId}`, { openingDate: '2026-04-06' });
      if (moved.status !== 200) problems.push(`moving the start date of a draft opening voucher returned ${brief(moved)}, expected 200`);
      if ((await voucherRow(openingId))?.date !== '2026-04-06') problems.push(`the draft opening voucher is dated ${(await voucherRow(openingId))?.date}, expected 2026-04-06`);

      // 3) approved: no back to draft, no correction, no reversal; the start date is fixed
      const approved = await api.put(`/api/accounting/vouchers/${openingId}/status`, { status: 'approved' });
      if (approved.status !== 200) throw new Error(`approving the opening voucher returned ${brief(approved)}`);
      refused('the approved opening voucher back to draft', await api.put(`/api/accounting/vouchers/${openingId}/status`, { status: 'draft' }));
      refused('correcting the approved opening voucher', await api.post(`/api/accounting/vouchers/${openingId}/correct`, { reason: 'M2 correction', newItems: await pairOf(1) }));
      refused('reversing the approved opening voucher', await api.post(`/api/accounting/vouchers/${openingId}/reverse`, { reason: 'M2 reversal' }));
      const late = await api.put(`/api/accounting/bank-accounts/${bankId}`, { openingDate: '2026-04-07' });
      if (late.status !== 422 || codeOf(late) !== 'BANK_OPENING_DATE_LOCKED') problems.push(`moving the start date after the approval returned ${brief(late)}, expected 422 BANK_OPENING_DATE_LOCKED`);
      if (await bankState(bankId) !== 'card 3000000 ledger 3000000') problems.push(`after the refusals the bank shows ${await bankState(bankId)}, expected card 3000000 ledger 3000000`);

      // 4) the opening balance changes in the account form; its adjustment voucher is sourced too
      const raised = await api.put(`/api/accounting/bank-accounts/${bankId}`, { initialBalance: 3_500_000 });
      if (raised.status !== 200) problems.push(`raising the opening balance returned ${brief(raised)}`);
      const adjustmentId = (await openingVoucherIds(bankId)).find(id => id !== openingId);
      if (!adjustmentId) problems.push('raising the opening balance issued no adjustment voucher');
      else {
        const adj = await api.get(`/api/accounting/vouchers/${adjustmentId}`);
        if (adj.body?.sourceKind !== 'treasury_opening') problems.push(`the adjustment voucher has source ${String(adj.body?.sourceKind)}, expected treasury_opening`);
        refused('editing the adjustment voucher', await api.put(`/api/accounting/vouchers/${adjustmentId}`, { version: Number(adj.body?.version ?? 1), description: 'M2 adjustment edit', items: await pairOf(1) }));
        const adjApproved = await api.put(`/api/accounting/vouchers/${adjustmentId}/status`, { status: 'approved' });
        if (adjApproved.status !== 200) problems.push(`approving the adjustment voucher returned ${brief(adjApproved)}`);
      }
      if (await bankState(bankId) !== 'card 3500000 ledger 3500000') problems.push(`after the adjustment the bank shows ${await bankState(bankId)}, expected card 3500000 ledger 3500000`);
      assertNoProblems(problems);
      return 'opening voucher sourced (treasury_opening): edit and delete 409 naming the account form; draft start date moved to 2026-04-06 with its voucher; approved: draft, correct, reverse 409, date move 422; adjustment sourced; card and ledger 3,500,000';
    }));
  }

  const m4 = 'reg_misplaced_group_separator_refused_v11_m4';
  if (shouldRun(m4, 'v11', 'phase3', 'm4', 'decimal', 'separator', 'voucher', 'treasury', 'document', 'transfer')) {
    await runCase(results, m4, 'v11 phase 3.1 (M4): a misplaced group separator is refused in a voucher row, a treasury amount, a document line and a warehouse transfer, and nothing is written; groups of three are still read', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const refused = (label: string, res: request.Response) => {
        if (res.status !== 400) problems.push(`${label} returned ${brief(res)}, expected 400`);
      };
      const vouchers = () => count(sql`SELECT count(*)::int AS n FROM journal_vouchers WHERE is_deleted = 0`);

      // 1) voucher rows
      const vouchersBefore = await vouchers();
      for (const bad of ['12,5', '1٬00٬0', '۱٬۰', '1,000,0']) {
        refused(`a voucher row of «${bad}»`, await api.post('/api/accounting/vouchers', { date: today, description: `M4 ${bad}`, items: await pairOf(bad) }));
      }
      if (await vouchers() !== vouchersBefore) problems.push('a refused voucher was saved');
      const grouped = await api.post('/api/accounting/vouchers', { date: today, description: 'M4 grouped', items: await pairOf('۱٬۰۰۰') });
      if (grouped.status !== 201) problems.push(`a voucher row of «۱٬۰۰۰» returned ${brief(grouped)}`);
      else if (fin((await voucherRow(Number(grouped.body.id)))?.totalDebit ?? 0).toString() !== '1000') problems.push(`«۱٬۰۰۰» was stored as ${(await voucherRow(Number(grouped.body.id)))?.totalDebit}`);

      // 2) a treasury receipt
      const bankId = await bankWith(api, 'M4 bank');
      refused('a treasury receipt of «1٬0»', await api.post('/api/accounting/treasury', {
        type: 'receipt', method: 'bank_transfer', amount: '1٬0', bankAccountId: bankId, partyType: 'other',
        contraAccountId: await miscContraAccountId(), partyName: 'M4 party', date: today,
      }));
      if (await bankState(bankId) !== 'card 0 ledger 0') problems.push(`the refused receipt changed the bank: ${await bankState(bankId)}`);

      // 3) a document line and 4) a warehouse transfer
      const main = String(await getDefaultWarehouseCode(orm));
      const other = await createTestWarehouse();
      const item = await createTestItem({ type: 'raw_material', stocks: { [main]: 50 }, weightedAverageCost: 1000 });
      refused('a receipt line quantity of «۱٬۲»', await api.post('/api/documents', {
        docType: 'receipt', status: 'draft', refNumber: 'auto', date: today, location: main, buyer_name: 'M4 supplier',
        items: [{ itemId: item.id, quantity: '۱٬۲', unit_price: 1000 }],
      }));
      refused('a receipt line price of «12,5»', await api.post('/api/documents', {
        docType: 'receipt', status: 'draft', refNumber: 'auto', date: today, location: main, buyer_name: 'M4 supplier',
        items: [{ itemId: item.id, quantity: 1, unit_price: '12,5' }],
      }));
      refused('a warehouse transfer of «1,2»', await api.post('/api/inventory/transfer', { itemId: item.id, fromLocation: main, toLocation: other.code, quantity: '1,2', date: today }));
      const kardex = await count(sql`SELECT count(*)::int AS n FROM transactions WHERE item_id = ${item.id} AND is_deleted = 0`);
      if (kardex !== 0) problems.push(`the refused transfer wrote ${kardex} Kardex rows`);
      assertNoProblems(problems);
      return 'voucher rows «12,5» «1٬00٬0» «۱٬۰» «1,000,0», receipt «1٬0», line quantity «۱٬۲» and price «12,5», transfer «1,2»: 400, nothing written; «۱٬۰۰۰» stored 1000';
    }));
  }

  const m5 = 'reg_fiscal_lock_on_sub_ledgers_v11_m5_s6_m23';
  if (shouldRun(m5, 'v11', 'phase3', 'm5', 's6', 'm23', 'fiscal', 'treasury', 'cheque', 'transfer', 'document')) {
    await runCase(results, m5, 'v11 phase 3.1 (M5, S6, M23): in a closed fiscal year a treasury row, a transfer and a cheque without a voucher, a cheque step, a warehouse transfer and a draft document (created or moved there) are refused and write nothing; a proforma is still saved', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      // 1387 = 2008-03-20 .. 2009-03-20, closed in this schema only
      const CLOSED_DAY = '2008-06-01';
      await orm.insert(fiscalPeriods).values({ fiscalYear: 1387, status: 'closed', closedAt: '2009-04-01 00:00:00', closedBy: 'v11-m5' });
      FiscalPeriodService.resetCache();
      const refused = (label: string, res: request.Response) => {
        if (res.status !== 422 || !textOf(res).includes('سال مالی')) problems.push(`${label} returned ${brief(res)}, expected 422 naming the closed fiscal year`);
      };
      const contra = await miscContraAccountId();

      // 1) treasury: a receipt, a transfer and a cheque without a voucher; a cheque step
      const bankA = await bankWith(api, 'M5 bank A');
      const bankB = await bankWith(api, 'M5 bank B');
      const fund = await api.post('/api/accounting/treasury', {
        type: 'receipt', method: 'bank_transfer', amount: 5_000_000, bankAccountId: bankA, partyType: 'other', contraAccountId: contra, partyName: 'M5 funding', date: today,
      });
      if (fund.status !== 201) throw new Error(`setup: funding ${brief(fund)}`);
      const treasuryRows = () => count(sql`SELECT count(*)::int AS n FROM treasury_transactions`);
      const rowsBefore = await treasuryRows();
      for (const createVoucher of [false, true]) {
        refused(`a receipt in the closed year (voucher ${createVoucher})`, await api.post('/api/accounting/treasury', {
          type: 'receipt', method: 'bank_transfer', amount: 1_000_000, bankAccountId: bankA, partyType: 'other', contraAccountId: contra,
          partyName: 'M5 party', date: CLOSED_DAY, createVoucher,
        }));
        refused(`a transfer in the closed year (voucher ${createVoucher})`, await api.post('/api/accounting/treasury/transfer', {
          fromBankAccountId: bankA, toBankAccountId: bankB, amount: 1_000_000, date: CLOSED_DAY, createVoucher,
        }));
      }
      if (await treasuryRows() !== rowsBefore) problems.push('a refused receipt or transfer wrote a treasury row');
      if (await bankState(bankA) !== 'card 5000000 ledger 5000000' || await bankState(bankB) !== 'card 0 ledger 0') {
        problems.push(`the refusals changed the banks: A ${await bankState(bankA)}, B ${await bankState(bankB)}`);
      }
      const cheques = () => count(sql`SELECT count(*)::int AS n FROM cheques WHERE is_deleted = 0`);
      const chequesBefore = await cheques();
      refused('a cheque without a voucher issued in the closed year', await api.post('/api/accounting/cheques', {
        type: 'received', chequeNumber: `M5${tagOf()}`, amount: 250_000, partyType: 'other', contraAccountId: contra, partyName: 'M5 cheque party',
        bankName: 'ملت', issueDate: CLOSED_DAY, dueDate: '2008-07-01', createVoucher: false,
      }));
      if (await cheques() !== chequesBefore) problems.push('the refused cheque was saved');
      const cheque = await api.post('/api/accounting/cheques', {
        type: 'received', chequeNumber: `M5${tagOf()}`, amount: 250_000, partyType: 'other', contraAccountId: contra, partyName: 'M5 cheque party',
        bankName: 'ملت', issueDate: today, dueDate: today,
      });
      if (cheque.status !== 201 && cheque.status !== 200) throw new Error(`setup: cheque ${brief(cheque)}`);
      refused('a cheque step dated in the closed year', await api.put(`/api/accounting/cheques/${cheque.body.id}/status`, { status: 'in_treasury', actionDate: CLOSED_DAY }));
      const [chequeRow] = (await orm.execute(sql`SELECT status FROM cheques WHERE id = ${Number(cheque.body.id)}`)).rows as Array<{ status: string }>;
      if (chequeRow?.status !== 'received') problems.push(`the refused step left the cheque ${chequeRow?.status}`);

      // 2) a warehouse transfer
      const main = String(await getDefaultWarehouseCode(orm));
      const other = await createTestWarehouse();
      const item = await createTestItem({ type: 'raw_material', stocks: { [main]: 10 }, weightedAverageCost: 1000 });
      refused('a warehouse transfer in the closed year', await api.post('/api/inventory/transfer', { itemId: item.id, fromLocation: main, toLocation: other.code, quantity: 1, date: CLOSED_DAY }));
      const kardex = await count(sql`SELECT count(*)::int AS n FROM transactions WHERE item_id = ${item.id}`);
      if (kardex !== 0) problems.push(`the refused transfer wrote ${kardex} Kardex rows`);

      // 3) documents: a draft invoice created there or moved there is refused, a proforma is saved (it takes the finalize day)
      const documents = () => count(sql`SELECT count(*)::int AS n FROM documents WHERE is_deleted = 0`);
      const docsBefore = await documents();
      const line = [{ itemId: item.id, quantity: 1, unit_price: 2000 }];
      refused('a draft invoice dated in the closed year', await api.post('/api/documents', {
        docType: 'invoice', status: 'draft', refNumber: 'auto', date: CLOSED_DAY, location: main, buyer_name: 'M23 buyer', items: line,
      }));
      if (await documents() !== docsBefore) problems.push('the refused draft invoice was saved');
      const proforma = await api.post('/api/documents', {
        docType: 'proforma', status: 'proforma', refNumber: 'auto', date: CLOSED_DAY, location: main, buyer_name: 'M23 buyer', items: line,
      });
      if (proforma.status !== 200) problems.push(`a proforma dated in the closed year returned ${brief(proforma)}, expected 200`);
      const draft = await api.post('/api/documents', {
        docType: 'invoice', status: 'draft', refNumber: 'auto', date: today, location: main, buyer_name: 'M23 buyer', items: line,
      });
      const draftId = Number(draft.body?.docId);
      if (draft.status !== 200 || !draftId) throw new Error(`setup: draft invoice ${brief(draft)}`);
      const storedDraft = async () => ((await orm.execute(sql`SELECT to_char(date, 'YYYY-MM-DD') AS day, version FROM documents WHERE id = ${draftId}`))
        .rows as Array<{ day: string; version: number }>)[0];
      refused('moving a draft invoice into the closed year', await api.put(`/api/documents/${draftId}`, { date: CLOSED_DAY, items: line, version: (await storedDraft()).version }));
      if ((await storedDraft())?.day !== today) problems.push(`the refused move left the draft dated ${(await storedDraft())?.day}, expected ${today}`);
      const kept = await api.put(`/api/documents/${draftId}`, { date: today, items: line, notes: 'M23 same year', version: (await storedDraft()).version });
      if (kept.status !== 200) problems.push(`editing the draft inside its open year returned ${brief(kept)}`);
      assertNoProblems(problems);
      return 'closed 1387: receipt and transfer (with and without voucher), cheque without voucher, cheque step, warehouse transfer, draft invoice create and move: 422 naming the year, nothing written; proforma 200; same-year edit 200';
    }));
  }

  return results;
}
