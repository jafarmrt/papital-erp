import request from 'supertest';
import { and, desc, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts, activityLogs, documents, fiscalPeriods, journalVoucherItems, journalVouchers, treasuryTransactions } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { money } from '../../lib/money.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { FiscalPeriodService } from '../../services/accounting/fiscalPeriod.service.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { checkBusinessInvariants } from '../invariants/businessInvariants.js';
import { createTestItem } from '../fixtures/factories.js';
import { miscContraAccountId } from '../fixtures/treasuryParty.js';
import { TestCaseResult } from '../types.js';
import {
  type ShouldRun, accountIdsByCode, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient,
} from './fiscalClosingTests.js';

/**
 * Package 3 PR «و»: automatic vouchers and the journal voucher page (decision t8 «الف»). Each scenario runs in its own
 * isolated schema with the standard chart of accounts and is red on the version before its fix.
 */

type Api = Awaited<ReturnType<typeof sandboxAdminClient>>;

let seq = 0;
const tag = () => `${String(Date.now()).slice(-6)}${++seq}`;
const brief = (res: request.Response) => `${res.status} ${JSON.stringify(res.body ?? {}).slice(0, 220)}`;

/** The documents and vouchers this sandbox created, for the business invariants */
async function scopeStart() {
  const max = async (table: 'documents' | 'journal_vouchers') => {
    const res = await orm.execute(sql.raw(`SELECT COALESCE(MAX(id), 0)::int AS m FROM ${table}`));
    return Number((res.rows[0] as { m: number }).m);
  };
  return { documentIdAfter: await max('documents'), voucherIdAfter: await max('journal_vouchers') };
}

async function finalDocument(api: Api, docType: 'receipt' | 'invoice', itemId: number, quantity: number, unitPrice: number): Promise<number> {
  const wh = await getDefaultWarehouseCode(orm);
  const res = await api.post('/api/documents', {
    docType, inOut: docType === 'receipt' ? 'in' : 'out', status: 'final', refNumber: docType === 'receipt' ? `R-${tag()}` : 'auto',
    date: await businessTodayIsoDate(), buyer_name: docType === 'receipt' ? 'Voucher page supplier' : 'Voucher page customer', location: wh,
    items: [{ itemId, quantity, unit_price: unitPrice }],
  });
  if (res.status !== 200 && res.status !== 201) throw new Error(`${docType} create returned ${brief(res)}`);
  return Number(res.body?.docId ?? res.body?.data?.docId ?? res.body?.id);
}

async function documentVoucher(documentId: number) {
  const [row] = await orm.select({ id: journalVouchers.id, status: journalVouchers.status, voucherNumber: journalVouchers.voucherNumber, version: journalVouchers.version })
    .from(journalVouchers).where(and(eq(journalVouchers.sourceDocumentId, documentId), eq(journalVouchers.isDeleted, 0)));
  if (!row) throw new Error(`document ${documentId} has no active voucher`);
  return row;
}

async function voucherState(id: number): Promise<string> {
  const [row] = await orm.select({ status: journalVouchers.status, isDeleted: journalVouchers.isDeleted, total: journalVouchers.totalDebit })
    .from(journalVouchers).where(eq(journalVouchers.id, id));
  return row ? `${row.status}/${row.isDeleted}/${Number(row.total)}` : 'missing';
}

/** The latest audit row of an entity and action */
type AuditSide = Record<string, unknown> & { rows?: unknown[] };
type AuditDetails = { before?: AuditSide; after?: AuditSide };

async function lastAudit(entity: string, entityId: number, action: string): Promise<AuditDetails | null> {
  const [row] = await orm.select({ details: activityLogs.details }).from(activityLogs)
    .where(and(eq(activityLogs.entity, entity), eq(activityLogs.entityId, String(entityId)), eq(activityLogs.action, action)))
    .orderBy(desc(activityLogs.id)).limit(1);
  return (row?.details as AuditDetails | undefined) ?? null;
}

async function voucherRows(api: Api, id: number) {
  const res = await api.get(`/api/accounting/vouchers/${id}`);
  const items: Array<{ accountId: number; debit: number; credit: number; detailedType?: string; detailedId?: number | null; detailedName?: string }> = res.body?.items ?? [];
  return items.map(i => ({ accountId: i.accountId, debit: Number(i.debit), credit: Number(i.credit), detailedType: i.detailedType, detailedId: i.detailedId ?? undefined, detailedName: i.detailedName }));
}

export async function runVoucherPageTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const sourceId = 'reg_source_voucher_locked_on_voucher_page_td_552';
  if (shouldRun(sourceId, 'td552', 'voucher', 'source', 'package3')) {
    await runCase(results, sourceId, 'v9.0.294: the voucher of a document, a treasury transaction or a reversal of one is only approved and finalized from the voucher page; delete, edit, back to draft, reverse and correct are 409 VOUCHER_HAS_SOURCE, the page reads its source, and voiding the document still works (TD-552)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const scope = await scopeStart();
      const refused = (label: string, res: request.Response) => {
        if (res.status !== 409 || res.body?.code !== 'VOUCHER_HAS_SOURCE') problems.push(`${label}: ${brief(res)}, expected 409 VOUCHER_HAS_SOURCE`);
      };
      const sourceKindOf = async (id: number) => (await api.get(`/api/accounting/vouchers/${id}`)).body?.sourceKind ?? null;

      // (a) B03-10 S08: a final receipt's draft voucher was deleted from the voucher page (200), leaving 10,000 rials of stock without a ledger
      const x = await createTestItem({ type: 'raw_material', currentStock: 0, weightedAverageCost: 0, code: `VP_X_${tag()}` });
      const receiptX = await finalDocument(api, 'receipt', x.id, 10, 1000);
      const vX = await documentVoucher(receiptX);
      if (await sourceKindOf(vX.id) !== 'document') problems.push(`voucher ${vX.id} of receipt ${receiptX}: sourceKind ${await sourceKindOf(vX.id)}, expected document`);
      const listed = await api.get('/api/accounting/vouchers?page=1&limit=100&status=all');
      const listedRow = (listed.body?.data ?? []).find((v: { id: number }) => Number(v.id) === vX.id);
      if (listedRow?.sourceKind !== 'document') problems.push(`voucher list row of ${vX.id}: sourceKind ${listedRow?.sourceKind}, expected document`);
      refused('DELETE the receipt voucher', await api.del(`/api/accounting/vouchers/${vX.id}`));
      const rowsX = await voucherRows(api, vX.id);
      refused('edit the receipt voucher', await api.put(`/api/accounting/vouchers/${vX.id}`, {
        version: vX.version, items: rowsX.map(r => ({ ...r, debit: r.debit ? 500 : 0, credit: r.credit ? 500 : 0 })),
      }));
      if (await voucherState(vX.id) !== 'draft/0/10000') problems.push(`receipt voucher after the refusals: ${await voucherState(vX.id)}, expected draft/0/10000`);
      const approveX = await api.post('/api/accounting/vouchers/batch-approve', { ids: [vX.id] });
      if (approveX.status !== 200 || approveX.body?.approvedCount !== 1) problems.push(`approving the receipt voucher: ${brief(approveX)}`);

      // (b) S08: an approved invoice voucher went back to draft (200) and its cost rows were edited from 2,000 to 500 (200)
      const y = await createTestItem({ type: 'product', currentStock: 0, weightedAverageCost: 0, code: `VP_Y_${tag()}` });
      await api.post('/api/accounting/vouchers/batch-approve', { ids: [(await documentVoucher(await finalDocument(api, 'receipt', y.id, 10, 1000))).id] });
      const invoiceY = await finalDocument(api, 'invoice', y.id, 2, 5000);
      const vY = await documentVoucher(invoiceY);
      await api.post('/api/accounting/vouchers/batch-approve', { ids: [vY.id] });
      const totalY = await voucherState(vY.id);
      refused('approved invoice voucher back to draft', await api.put(`/api/accounting/vouchers/${vY.id}/status`, { status: 'draft' }));
      refused('reverse the invoice voucher', await api.post(`/api/accounting/vouchers/${vY.id}/reverse`, { reason: 'TD-552 reverse' }));
      const rowsY = await voucherRows(api, vY.id);
      refused('correct the invoice voucher', await api.post(`/api/accounting/vouchers/${vY.id}/correct`, { reason: 'TD-552 correct', newItems: rowsY }));
      if (await voucherState(vY.id) !== totalY) problems.push(`invoice voucher after the refusals: ${await voucherState(vY.id)}, expected ${totalY}`);
      const finalizeY = await api.post(`/api/accounting/vouchers/${vY.id}/finalize`, {});
      if (finalizeY.status !== 200 || finalizeY.body?.voucher?.status !== 'permanent') problems.push(`finalizing the invoice voucher: ${brief(finalizeY)}, expected 200 permanent`);

      // (c) S08: a reversed approved invoice voucher left an invoice that could no longer be voided (409); now the reverse is
      // refused, the invoice is voided, and its reversal voucher carries the same source and the same lock
      const z = await createTestItem({ type: 'product', currentStock: 0, weightedAverageCost: 0, code: `VP_Z_${tag()}` });
      await api.post('/api/accounting/vouchers/batch-approve', { ids: [(await documentVoucher(await finalDocument(api, 'receipt', z.id, 10, 1000))).id] });
      const invoiceZ = await finalDocument(api, 'invoice', z.id, 3, 4000);
      const vZ = await documentVoucher(invoiceZ);
      await api.post('/api/accounting/vouchers/batch-approve', { ids: [vZ.id] });
      refused('reverse the second invoice voucher', await api.post(`/api/accounting/vouchers/${vZ.id}/reverse`, { reason: 'TD-552 reverse' }));
      const voidZ = await api.del(`/api/documents/${invoiceZ}`);
      if (voidZ.status !== 200) problems.push(`voiding invoice ${invoiceZ}: ${brief(voidZ)}, expected 200`);
      const [reversalZ] = await orm.select({ id: journalVouchers.id }).from(journalVouchers)
        .where(and(eq(journalVouchers.referenceNumber, `REV-V${vZ.voucherNumber}`), eq(journalVouchers.isDeleted, 0)));
      if (!reversalZ) problems.push(`voiding invoice ${invoiceZ} issued no reversal of voucher ${vZ.voucherNumber}`);
      else {
        if (await sourceKindOf(reversalZ.id) !== 'document') problems.push(`reversal voucher ${reversalZ.id}: sourceKind ${await sourceKindOf(reversalZ.id)}, expected document`);
        refused('reversal voucher back to draft', await api.put(`/api/accounting/vouchers/${reversalZ.id}/status`, { status: 'draft' }));
        refused('DELETE the reversal voucher', await api.del(`/api/accounting/vouchers/${reversalZ.id}`));
      }

      // (d) a treasury receipt's voucher is locked the same way
      const [bankParent] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1003'), eq(accounts.isDeleted, 0)));
      const [ledger] = await orm.insert(accounts).values({
        code: `1003${tag()}`, name: 'Voucher page bank (test ledger)', level: 'subsidiary', parentId: bankParent?.id ?? null,
        accountType: 'asset', nature: 'debit', isSystem: 0, isActive: 1, isDeleted: 0,
      }).returning({ id: accounts.id });
      const bank = await api.post('/api/accounting/bank-accounts', { title: `Voucher page bank ${tag()}`, type: 'bank', accountId: ledger.id, initialBalance: 0 });
      if (bank.status !== 200 && bank.status !== 201) throw new Error(`bank create returned ${brief(bank)}`);
      const treasury = await api.post('/api/accounting/treasury', {
        type: 'receipt', method: 'bank_transfer', amount: 750_000, bankAccountId: Number(bank.body.id),
        partyType: 'other', partyName: 'Voucher page payer', contraAccountId: await miscContraAccountId(),
      });
      if (treasury.status !== 200 && treasury.status !== 201) throw new Error(`treasury receipt returned ${brief(treasury)}`);
      const [tRow] = await orm.select({ voucherId: treasuryTransactions.voucherId }).from(treasuryTransactions).where(eq(treasuryTransactions.id, Number(treasury.body.id)));
      if (!tRow?.voucherId) problems.push('the treasury receipt has no voucher');
      else {
        if (await sourceKindOf(tRow.voucherId) !== 'treasury') problems.push(`treasury voucher ${tRow.voucherId}: sourceKind ${await sourceKindOf(tRow.voucherId)}, expected treasury`);
        refused('DELETE the treasury voucher', await api.del(`/api/accounting/vouchers/${tRow.voucherId}`));
      }

      // (e) a manual voucher has no source and is still deleted as a draft
      const acc = await accountIdsByCode('7009', '1001');
      const manual = await api.post('/api/accounting/vouchers', {
        date: await businessTodayIsoDate(), status: 'draft', description: 'TD-552 manual voucher',
        items: [{ accountId: acc['7009'], debit: 1000, credit: 0 }, { accountId: acc['1001'], debit: 0, credit: 1000 }],
      });
      if (manual.status !== 201) problems.push(`manual voucher: ${brief(manual)}`);
      else {
        if (await sourceKindOf(manual.body.id) !== null) problems.push(`manual voucher sourceKind ${await sourceKindOf(manual.body.id)}, expected null`);
        const del = await api.del(`/api/accounting/vouchers/${manual.body.id}`);
        if (del.status !== 200) problems.push(`deleting the manual draft voucher: ${brief(del)}, expected 200`);
      }

      // the V8 invariants I3 (stock value = inventory ledger) and I4 (one voucher per final document) hold on X, Y and Z
      const violations = (await checkBusinessInvariants({ ...scope, itemIds: [x.id, y.id, z.id] }))
        .filter(v => v.invariant === 'I3_stock_value_equals_ledger' || v.invariant === 'I4_one_voucher_per_document');
      if (violations.length > 0) problems.push(`invariants: ${violations.map(v => `${v.invariant} ${v.key}: ${v.message}`).join('; ')}`);

      assertNoProblems(problems);
      return 'Receipt, invoice, reversal and treasury vouchers: delete, edit, back to draft, reverse and correct answered 409 VOUCHER_HAS_SOURCE; approve and finalize worked; the invoice was voided with its reversal locked too; the manual draft was deleted; I3 and I4 held.';
    }));
  }

  const versionId = 'reg_voucher_edit_version_and_audit_td_555';
  if (shouldRun(versionId, 'td555', 'voucher', 'occ', 'audit', 'package3')) {
    await runCase(results, versionId, 'v9.0.295: a voucher edit needs the version it read (400 without, 409 OCC_CONFLICT when stale), a deleted voucher is not edited and gets no live rows, and voucher and account edits and deletes are audited with before and after (TD-555)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const acc = await accountIdsByCode('7003', '1001', '70');
      const today = await businessTodayIsoDate();
      const pair = (amount: number) => [{ accountId: acc['7003'], debit: amount, credit: 0 }, { accountId: acc['1001'], debit: 0, credit: amount }];
      const draft = async (amount: number) => {
        const res = await api.post('/api/accounting/vouchers', { date: today, status: 'draft', description: 'TD-555 voucher', items: pair(amount) });
        if (res.status !== 201) throw new Error(`voucher create returned ${brief(res)}`);
        return { id: Number(res.body.id), version: Number(res.body.version) };
      };
      const stored = async (id: number) => {
        const [v] = await orm.select({ total: journalVouchers.totalDebit, version: journalVouchers.version }).from(journalVouchers).where(eq(journalVouchers.id, id));
        return `${Number(v?.total)}@v${v?.version}`;
      };

      // 1) B03-13 S09: two accountants saved the same draft read at version 1 (200 / 200) and the first save was lost silently
      const shared = await draft(100_000);
      const first = await api.put(`/api/accounting/vouchers/${shared.id}`, { version: shared.version, items: pair(111_000) });
      const second = await api.put(`/api/accounting/vouchers/${shared.id}`, { version: shared.version, items: pair(222_000) });
      if (first.status !== 200) problems.push(`first save: ${brief(first)}, expected 200`);
      if (second.status !== 409 || second.body?.code !== 'OCC_CONFLICT') problems.push(`second save at the stale version: ${brief(second)}, expected 409 OCC_CONFLICT`);
      if (await stored(shared.id) !== `111000@v${shared.version + 1}`) problems.push(`stored after both saves: ${await stored(shared.id)}, expected 111000@v${shared.version + 1}`);
      const noVersion = await api.put(`/api/accounting/vouchers/${shared.id}`, { items: pair(333_000) });
      if (noVersion.status !== 400) problems.push(`save without a version: ${brief(noVersion)}, expected 400`);

      // 2) the audit row of the edit has the amounts before and after (was only the request body)
      const edit = await lastAudit('journal_voucher', shared.id, 'UPDATE');
      if (Number(edit?.before?.totalDebit) !== 100_000 || Number(edit?.after?.totalDebit) !== 111_000 || !Array.isArray(edit?.before?.rows) || !Array.isArray(edit?.after?.rows)) {
        problems.push(`edit audit details ${JSON.stringify(edit).slice(0, 300)}, expected before 100,000 and after 111,000 with their rows`);
      }

      // 3) S09: a PUT on a deleted draft answered 404 but wrote live rows of 999,000 under it and changed its total
      const gone = await draft(50_000);
      const del = await api.del(`/api/accounting/vouchers/${gone.id}`);
      if (del.status !== 200) problems.push(`deleting the draft: ${brief(del)}`);
      const deleted = await lastAudit('journal_voucher', gone.id, 'DELETE');
      if (Number(deleted?.before?.totalDebit) !== 50_000 || (deleted?.before?.rows ?? []).length !== 2) problems.push(`delete audit details ${JSON.stringify(deleted).slice(0, 300)}, expected the whole voucher before`);
      const ghost = await api.put(`/api/accounting/vouchers/${gone.id}`, { version: gone.version, items: pair(999_000) });
      if (ghost.status !== 404) problems.push(`editing the deleted draft: ${brief(ghost)}, expected 404`);
      const liveRows = await orm.select({ id: journalVoucherItems.id }).from(journalVoucherItems)
        .where(and(eq(journalVoucherItems.voucherId, gone.id), eq(journalVoucherItems.isDeleted, 0)));
      if (liveRows.length !== 0 || (await stored(gone.id)).split('@')[0] !== '50000') problems.push(`deleted draft after the edit: ${liveRows.length} live rows, total ${await stored(gone.id)}`);

      // 4) account edit and delete audit rows carry before and after (were the request body and the id)
      const created = await api.post('/api/accounting/accounts', { code: '7097', name: 'TD-555 account', level: 'subsidiary', parentId: acc['70'], accountType: 'expense', nature: 'debit' });
      if (created.status !== 201) problems.push(`account create: ${brief(created)}`);
      else {
        const renamed = await api.put(`/api/accounting/accounts/${created.body.id}`, { name: 'TD-555 account renamed' });
        if (renamed.status !== 200) problems.push(`account rename: ${brief(renamed)}`);
        const accEdit = await lastAudit('account', created.body.id, 'UPDATE');
        if (accEdit?.before?.name !== 'TD-555 account' || accEdit?.after?.name !== 'TD-555 account renamed' || 'code' in (accEdit?.after ?? {})) {
          problems.push(`account edit audit ${JSON.stringify(accEdit)}, expected only the name before and after`);
        }
        const removed = await api.del(`/api/accounting/accounts/${created.body.id}`);
        const accDel = await lastAudit('account', created.body.id, 'DELETE');
        if (removed.status !== 200 || accDel?.before?.code !== '7097' || accDel?.before?.name !== 'TD-555 account renamed') problems.push(`account delete ${removed.status}, audit ${JSON.stringify(accDel)}`);
      }

      assertNoProblems(problems);
      return 'Second save at version 1 answered 409 and the first 111,000 stayed; no version 400; the deleted draft answered 404 with no live rows; voucher and account edits and deletes audited before and after.';
    }));
  }

  const batchId = 'reg_batch_finalize_real_count_and_refusals_td_556';
  if (shouldRun(batchId, 'td556', 'voucher', 'finalize', 'package3')) {
    await runCase(results, batchId, 'v9.0.296: batch finalize counts only the vouchers it made permanent and lists each refused id with its reason: missing, deleted, already permanent, closed fiscal year, unbalanced (TD-556)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const acc = await accountIdsByCode('7004', '1001');
      const today = await businessTodayIsoDate();
      const create = async (status: 'draft' | 'approved', amount: number) => {
        const res = await api.post('/api/accounting/vouchers', { date: today, status, description: 'TD-556 voucher', items: [{ accountId: acc['7004'], debit: amount, credit: 0 }, { accountId: acc['1001'], debit: 0, credit: amount }] });
        if (res.status !== 201) throw new Error(`voucher create returned ${brief(res)}`);
        return Number(res.body.id);
      };
      /** written straight into the tables, as legacy data or a closed year can hold it */
      const legacy = async (date: string, debit: number, credit: number) => {
        const [v] = await orm.insert(journalVouchers).values({
          voucherNumber: await VoucherService.getNextVoucherNumber(), manualVoucherNumber: '', date, voucherType: 'general', status: 'approved',
          totalDebit: money(debit), totalCredit: money(credit), description: 'TD-556 legacy voucher', referenceModule: 'manual', referenceNumber: '', currency: 'IRR', attachments: [],
        }).returning({ id: journalVouchers.id });
        await orm.insert(journalVoucherItems).values([
          { voucherId: v.id, accountId: acc['7004'], rowOrder: 1, detailedType: 'none', detailedName: '', debit: money(debit), credit: money(0), currency: 'IRR', exchangeRate: money(1), description: 'TD-556' },
          { voucherId: v.id, accountId: acc['1001'], rowOrder: 2, detailedType: 'none', detailedName: '', debit: money(0), credit: money(credit), currency: 'IRR', exchangeRate: money(1), description: 'TD-556' },
        ]);
        return v.id;
      };

      // B03-14 S10: [approved, permanent, deleted, missing] answered «4 سند با موفقیت قطعی و دائم شدند» while one changed
      const approved = await create('approved', 10_000);
      const permanent = await create('approved', 20_000);
      await api.post(`/api/accounting/vouchers/${permanent}/finalize`, {});
      const deleted = await create('draft', 30_000);
      await api.del(`/api/accounting/vouchers/${deleted}`);
      const unbalanced = await legacy(today, 40_000, 39_000);
      await orm.insert(fiscalPeriods).values({ fiscalYear: 1390, status: 'closed', closedAt: '2012-03-20 00:00:00', closedBy: 'TD-556' });
      FiscalPeriodService.resetCache();
      const closedYear = await legacy('2011-06-01', 50_000, 50_000);
      const missing = 99_999_999;

      const res = await api.post('/api/accounting/vouchers/batch-finalize', { ids: [missing, closedYear, unbalanced, deleted, permanent, approved] });
      if (res.status !== 200) problems.push(`batch finalize: ${brief(res)}`);
      if (res.body?.finalizedCount !== 1 || JSON.stringify(res.body?.ids) !== JSON.stringify([approved])) problems.push(`finalized ${res.body?.finalizedCount} ${JSON.stringify(res.body?.ids)}, expected 1 [${approved}]`);
      const reasons = new Map<number, string>((res.body?.refused ?? []).map((r: { id: number; reason: string }) => [Number(r.id), String(r.reason)]));
      const expected: Array<[number, string]> = [[missing, 'یافت نشد'], [deleted, 'حذف شده'], [permanent, 'پیش‌تر قطعی'], [closedYear, 'سال مالی'], [unbalanced, 'تراز نیست']];
      for (const [id, phrase] of expected) {
        if (!reasons.get(id)?.includes(phrase)) problems.push(`refusal of ${id}: ${JSON.stringify(reasons.get(id))}, expected one naming «${phrase}»`);
      }
      if (reasons.size !== expected.length) problems.push(`${reasons.size} refusals, expected ${expected.length}`);
      if (!String(res.body?.message ?? '').startsWith('۱ سند قطعی و دائم شد؛ ۵ سند قطعی نشد')) problems.push(`message «${res.body?.message}»`);
      const statuses = await orm.select({ id: journalVouchers.id, status: journalVouchers.status }).from(journalVouchers)
        .where(sql`${journalVouchers.id} IN (${sql.join([approved, unbalanced, closedYear].map(id => sql`${id}`), sql`, `)})`);
      const statusOf = (id: number) => statuses.find(r => r.id === id)?.status;
      if (statusOf(approved) !== 'permanent' || statusOf(unbalanced) !== 'approved' || statusOf(closedYear) !== 'approved') {
        problems.push(`statuses approved=${statusOf(approved)} unbalanced=${statusOf(unbalanced)} closedYear=${statusOf(closedYear)}`);
      }
      const audit = await orm.select({ details: activityLogs.details }).from(activityLogs)
        .where(and(eq(activityLogs.entity, 'journal_voucher'), eq(activityLogs.action, 'UPDATE'))).orderBy(desc(activityLogs.id)).limit(1);
      const details = audit[0]?.details as { finalizedIds?: number[]; refused?: unknown[] } | undefined;
      if (JSON.stringify(details?.finalizedIds) !== JSON.stringify([approved]) || (details?.refused ?? []).length !== 5) problems.push(`audit details ${JSON.stringify(details).slice(0, 200)}`);

      assertNoProblems(problems);
      return 'Six ids: one finalized and counted; missing, deleted, already permanent, closed-year and unbalanced vouchers listed with their reasons and left as they were; the audit row separates them.';
    }));
  }

  const automationId = 'reg_automation_status_final_documents_td_560';
  if (shouldRun(automationId, 'td560', 'voucher', 'automation', 'package3')) {
    await runCase(results, automationId, 'v9.0.297: the automation status counts only final documents, takes a stock count as automatic when it has a valued difference, shows a transfer as without financial effect, and lists only the types that miss a voucher (TD-560)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const api = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const wh = (await getDefaultWarehouseCode(orm)) as string;
      type Row = { docType: string; totalDocs: number; needVoucher: number; withVoucher: number; missingVoucher: number; voucherRule: string };
      const status = async () => {
        const res = await api.get('/api/accounting/automation-status');
        if (res.status !== 200) throw new Error(`automation status returned ${brief(res)}`);
        const byType = new Map<string, Row>((res.body.report ?? []).map((r: Row) => [r.docType, r]));
        const show = (t: string) => { const r = byType.get(t); return r ? `${r.totalDocs}/${r.needVoucher}/${r.withVoucher}/${r.missingVoucher}/${r.voucherRule}` : 'missing'; };
        return { body: res.body, show, types: Array.from(byType.keys()) };
      };

      // a final receipt and invoice (vouchers), a sales and a purchase proforma (never a voucher)
      const y = await createTestItem({ type: 'product', currentStock: 0, weightedAverageCost: 0, code: `VP_A_${tag()}` });
      await finalDocument(api, 'receipt', y.id, 10, 1000);
      const invoice = await finalDocument(api, 'invoice', y.id, 2, 5000);
      for (const [docType, inOut] of [['invoice', 'out'], ['receipt', 'in']] as const) {
        const res = await api.post('/api/documents', { docType, inOut, status: 'proforma', refNumber: docType === 'receipt' ? `P-${tag()}` : 'auto', date: today, buyer_name: 'Automation party', location: wh, items: [{ itemId: y.id, quantity: 1, unit_price: 5000 }] });
        if (res.status !== 200 && res.status !== 201) problems.push(`${docType} proforma: ${brief(res)}`);
      }
      // two stock counts: one with a valued shortage (voucher on 7012), one of an item without WAC (no voucher, none needed)
      const valued = await createTestItem({ type: 'raw_material', stocks: { [wh]: 10 }, weightedAverageCost: 1000, code: `VP_B_${tag()}` });
      const free = await createTestItem({ type: 'raw_material', stocks: { [wh]: 4 }, weightedAverageCost: 0, code: `VP_C_${tag()}` });
      for (const [item, book, counted] of [[valued.id, 10, 8], [free.id, 4, 3]] as const) {
        const res = await api.post('/api/documents', { docType: 'audit', refNumber: 'auto', date: today, location: wh, status: 'final', items: [{ itemId: item, system_stock: book, physical_stock: counted, quantity: counted, location: wh }] });
        if (res.status !== 200 && res.status !== 201) problems.push(`stock count of ${item}: ${brief(res)}`);
      }
      // a warehouse transfer document has no financial effect
      await orm.insert(documents).values({ type: 'transfer', refNumber: `TR-${tag()}`, date: `${today} 10:00:00`, status: 'final' });

      const first = await status();
      const expected: Record<string, string> = {
        invoice: '1/1/1/0/always', receipt: '1/1/1/0/always', audit: '2/1/1/0/valued_difference', transfer: '1/0/0/0/none',
      };
      for (const [t, want] of Object.entries(expected)) if (first.show(t) !== want) problems.push(`${t}: ${first.show(t)}, expected ${want} (final/need/with/missing/rule)`);
      if (first.types.includes('proforma')) problems.push('the report still has a proforma row');
      const s1 = first.body.summary;
      if (s1?.totalDocs !== 3 || s1?.coveredDocs !== 3 || s1?.coveragePercent !== 100 || (s1?.missingTypes ?? []).length !== 0) problems.push(`summary ${JSON.stringify(s1)}, expected 3 of 3, 100%, nothing missing`);

      // an invoice whose voucher is gone is the only missing type
      await orm.update(journalVouchers).set({ isDeleted: 1 }).where(eq(journalVouchers.sourceDocumentId, invoice));
      const second = await status();
      const s2 = second.body.summary;
      if (second.show('invoice') !== '1/1/0/1/always') problems.push(`invoice after its voucher is gone: ${second.show('invoice')}`);
      if (s2?.coveragePercent !== 67 || JSON.stringify((s2?.missingTypes ?? []).map((m: { docType: string; missingVoucher: number }) => `${m.docType}:${m.missingVoucher}`)) !== JSON.stringify(['invoice:1'])) {
        problems.push(`summary after the gap ${JSON.stringify(s2)}, expected 67% and only invoice:1 missing`);
      }

      assertNoProblems(problems);
      return 'Proformas left out, the valued stock count covered and the zero-value one not needed, the transfer shown without financial effect, 100% coverage; with one invoice voucher gone only «invoice: 1» is missing at 67%.';
    }));
  }

  return results;
}
