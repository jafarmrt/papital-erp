import type request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { activityLogs, bankAccounts, crmLeads, documents, journalVoucherItems, journalVouchers, purchaseRequisitions } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { WorkflowEngineService } from '../../services/workflow/workflowEngineService.js';
import { createTestCustomer, createTestItem } from '../fixtures/factories.js';
import { fundedBank } from '../invariants/payrollScenarios.js';
import { TestCaseResult } from '../types.js';
import {
  type ShouldRun, accountIdsByCode, assertNoProblems, inFiscalSandbox, postApproved, runCase, sandboxAdminClient, sandboxClientWith,
} from './fiscalClosingTests.js';

/**
 * v11 phase 6.1b (control accounts and known parties, findings of the phase 2 evaluation): real Express routes and services
 * on PostgreSQL, each scenario in its own schema with the standard chart of accounts; each is red on v11.3.0.
 *  - M3 (decisions ت۵۲-۲, ت۵۶-۳): a manual voucher row (and a replacement row of a correction) on a control account needs
 *    «اصلاح حساب کنترلی» and a reason, stored on the voucher; a reversal needs neither. A row's detail names a live record
 *    of its type and stores its name.
 *  - M6: a treasury «متفرقه» entry never takes a control account (insurance, payroll tax, eidi, advances, inventory) as its
 *    counter account.
 *  - C8, S16: a priced purchase names a supplier on the list, a purchase order goes to one, and a sales document by a
 *    known name is linked to that party (an unknown name stays a walk-in sale).
 *  - C5: a lead with only a phone makes a party named from the phone, never from the lead title, with its own audit row.
 */

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;
const brief = (res: request.Response) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 260)}`;
const codeOf = (res: request.Response) => String(res.body?.code ?? res.body?.error?.code ?? '');
const textOf = (res: request.Response) => String(res.body?.message ?? res.body?.error?.message ?? res.body?.error ?? '');
const ok = (res: request.Response) => res.status >= 200 && res.status < 300;

// Persian text sent as typed input
const CONTROL_REASON = 'اصلاح ماندهٔ افتتاحیه طبق صورت‌حساب';
const CORRECTION_REASON = 'اصلاح حساب معین';
const WRONG_DETAIL_NAME = 'نام نادرست';
const PERMISSION_TITLE = 'اصلاح حساب کنترلی';
const PARTY_BOOK = 'فاکتور فروش';
const TREASURY_BOOK = 'خزانه';
const INVENTORY_BOOK = 'اسناد انبار';
const PHONE_PARTY_PREFIX = 'مشتری تلفن';
const PARTY_ENTITY = 'طرف حساب';
const CONTROL_WORD = 'حساب کنترلی';

const count = async (query: ReturnType<typeof sql>) => Number(((await orm.execute(query)).rows[0] as { n: number | string }).n);

export async function runControlAccountsV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const m3 = 'reg_manual_voucher_control_account_v11_6_1b_m3';
  if (shouldRun(m3, 'v11', 'phase6', 'm3', 'voucher', 'control')) {
    await runCase(results, m3, 'v11 phase 6.1b (M3): a manual voucher row on a control account (party, treasury, inventory, statutory) is refused without the control adjustment permission (403, naming the book), needs a reason with it (422, the system admin too) and stores the reason; a correction follows the same rule and a reversal needs neither', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const today = await businessTodayIsoDate();
      const plain = await sandboxClientWith(['accounting.view', 'accounting.vouchers']);
      const adjuster = await sandboxClientWith(['accounting.view', 'accounting.vouchers', 'accounting.control_adjustment']);
      const admin = await sandboxAdminClient();
      const customer = await createTestCustomer();
      const acc = await accountIdsByCode('1201', '1404', '3204', '7001', '7009');
      const bank = await fundedBank();
      const [bankRow] = await orm.select({ accountId: bankAccounts.accountId }).from(bankAccounts).where(eq(bankAccounts.id, bank));
      const bankLedger = Number(bankRow?.accountId);
      const vouchers = () => count(sql`SELECT count(*)::int AS n FROM journal_vouchers WHERE is_deleted = 0`);
      const body = (debit: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
        date: today, description: 'M3 control', status: 'draft',
        items: [{ debit: 1000, credit: 0, ...debit }, { accountId: acc['7009'], debit: 0, credit: 1000 }],
        ...extra,
      });
      const expectRefused = (label: string, res: request.Response, status: number, code: string, ...words: string[]) => {
        if (res.status !== status || codeOf(res) !== code) problems.push(`${label} returned ${brief(res)}, expected ${status} ${code}`);
        for (const word of words) if (!textOf(res).includes(word)) problems.push(`${label}: the message does not name «${word}»: ${textOf(res)}`);
      };

      // 1) create: a party receivable row
      const partyRow = { accountId: acc['1201'], detailedType: 'customer', detailedId: customer.id };
      const before = await vouchers();
      expectRefused('a receivable row without the permission', await plain.post('/api/accounting/vouchers', body(partyRow)), 403, 'VOUCHER_CONTROL_ACCOUNT', PERMISSION_TITLE, PARTY_BOOK);
      expectRefused('a receivable row with the permission and no reason', await adjuster.post('/api/accounting/vouchers', body(partyRow)), 422, 'VOUCHER_CONTROL_REASON_REQUIRED');
      expectRefused('a receivable row by the system admin with no reason', await admin.post('/api/accounting/vouchers', body(partyRow, { controlReason: '  ' })), 422, 'VOUCHER_CONTROL_REASON_REQUIRED');
      if (await vouchers() !== before) problems.push('a refused voucher was saved');
      const adjusted = await adjuster.post('/api/accounting/vouchers', body(partyRow, { controlReason: CONTROL_REASON }));
      if (adjusted.status !== 201) problems.push(`a receivable row with the permission and a reason returned ${brief(adjusted)}, expected 201`);
      else {
        const [v] = await orm.select({ reason: journalVouchers.controlReason }).from(journalVouchers).where(eq(journalVouchers.id, Number(adjusted.body.id)));
        if (v?.reason !== CONTROL_REASON) problems.push(`the voucher stores the reason «${v?.reason}», expected «${CONTROL_REASON}»`);
      }

      // 2) the other kinds: a treasury account's ledger, an unmapped inventory account of group 14, the insurance payable
      expectRefused('a treasury account row without the permission', await plain.post('/api/accounting/vouchers', body({ accountId: bankLedger })), 403, 'VOUCHER_CONTROL_ACCOUNT', TREASURY_BOOK);
      expectRefused('a 1404 inventory row without the permission', await plain.post('/api/accounting/vouchers', body({ accountId: acc['1404'] })), 403, 'VOUCHER_CONTROL_ACCOUNT', INVENTORY_BOOK);
      expectRefused('an insurance payable row without the permission', await plain.post('/api/accounting/vouchers', body({ accountId: acc['3204'] })), 403, 'VOUCHER_CONTROL_ACCOUNT');

      // 3) an ordinary voucher needs neither and stores no reason
      const ordinary = await plain.post('/api/accounting/vouchers', body({ accountId: acc['7001'] }, { controlReason: CONTROL_REASON }));
      if (ordinary.status !== 201) problems.push(`an expense voucher returned ${brief(ordinary)}, expected 201`);
      const ordinaryId = Number(ordinary.body?.id);
      if (ordinaryId) {
        const [v] = await orm.select({ reason: journalVouchers.controlReason, version: journalVouchers.version }).from(journalVouchers).where(eq(journalVouchers.id, ordinaryId));
        if (v?.reason !== '') problems.push(`an expense voucher stores the reason «${v?.reason}», expected none`);

        // 4) edit: moving a row of the draft onto a control account follows the same rule
        expectRefused('an edit onto the insurance payable without the permission', await plain.put(`/api/accounting/vouchers/${ordinaryId}`, body({ accountId: acc['3204'] }, { version: v?.version })), 403, 'VOUCHER_CONTROL_ACCOUNT');
        const rows = await orm.select({ accountId: journalVoucherItems.accountId }).from(journalVoucherItems)
          .where(and(eq(journalVoucherItems.voucherId, ordinaryId), eq(journalVoucherItems.isDeleted, 0)));
        if (rows.some(r => r.accountId === acc['3204'])) problems.push('the refused edit moved a row onto the insurance payable');
      }

      // 5) correct: the replacement rows follow the rule, and the correction reason is stored as the reason
      const original = await postApproved(today, acc['7001'], acc['7009'], 2000, 'M3 correct');
      const replacement = { date: today, reason: CORRECTION_REASON, newItems: [
        { accountId: acc['3204'], debit: 2000, credit: 0 }, { accountId: acc['7009'], debit: 0, credit: 2000 },
      ] };
      expectRefused('a correction onto the insurance payable without the permission', await plain.post(`/api/accounting/vouchers/${original}/correct`, replacement), 403, 'VOUCHER_CONTROL_ACCOUNT');
      const corrected = await adjuster.post(`/api/accounting/vouchers/${original}/correct`, replacement);
      if (corrected.status !== 201) problems.push(`a correction onto the insurance payable with the permission returned ${brief(corrected)}, expected 201`);
      else {
        const [v] = await orm.select({ reason: journalVouchers.controlReason }).from(journalVouchers).where(eq(journalVouchers.id, Number(corrected.body?.correctedVoucher?.id)));
        if (v?.reason !== CORRECTION_REASON) problems.push(`the correction stores the reason «${v?.reason}», expected the correction reason`);
      }

      // 6) reverse: undoing a voucher on a control account needs no permission
      const onReceivable = await postApproved(today, acc['1201'], acc['7009'], 3000, 'M3 reverse');
      const reversed = await plain.post(`/api/accounting/vouchers/${onReceivable}/reverse`, { reason: CORRECTION_REASON, date: today });
      if (!ok(reversed)) problems.push(`reversing a voucher on the receivables without the permission returned ${brief(reversed)}, expected success`);

      // 7) the voucher forms read the control accounts
      const list = await plain.get('/api/accounting/control-accounts');
      const codes = new Set((Array.isArray(list.body?.data) ? list.body.data : []).map((a: { code: string }) => a.code));
      for (const code of ['1201', '3001', '3201', '3204', '3206', '3207', '1301', '1101', '1401', '1404']) {
        if (!codes.has(code)) problems.push(`the control account list lacks ${code}`);
      }
      if (codes.has('7009') || codes.has('4401')) problems.push('the control account list names 7009 or 4401');
      assertNoProblems(problems);
      return 'control rows: 403 without the permission, 422 without a reason (admin too), 201 with both and the reason stored; edit and correct follow it; reversal free';
    }));
  }

  const detail = 'reg_manual_voucher_row_detail_v11_6_1b_m3';
  if (shouldRun(detail, 'v11', 'phase6', 'm3', 'voucher', 'detail')) {
    await runCase(results, detail, 'v11 phase 6.1b (M3, DEBT_LESSONS #8): the detail of a manual voucher row names a live record of its type (422 VOUCHER_DETAIL_INVALID for a ghost id, a party of the other side, or a type without an id) and the row stores that record\'s own name', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const today = await businessTodayIsoDate();
      const admin = await sandboxAdminClient();
      const acc = await accountIdsByCode('7001', '7009');
      const customer = await createTestCustomer();
      const supplierOnly = await createTestCustomer({ partyType: 'supplier' });
      const post = (detailFields: Record<string, unknown>) => admin.post('/api/accounting/vouchers', {
        date: today, description: 'M3 detail', status: 'draft',
        items: [{ accountId: acc['7001'], debit: 1000, credit: 0, ...detailFields }, { accountId: acc['7009'], debit: 0, credit: 1000 }],
      });
      const refused = async (label: string, detailFields: Record<string, unknown>) => {
        const res = await post(detailFields);
        if (res.status !== 422 || codeOf(res) !== 'VOUCHER_DETAIL_INVALID') problems.push(`${label} returned ${brief(res)}, expected 422 VOUCHER_DETAIL_INVALID`);
      };
      const before = await count(sql`SELECT count(*)::int AS n FROM journal_vouchers WHERE is_deleted = 0`);
      await refused('a customer that does not exist', { detailedType: 'customer', detailedId: 99_999_999, detailedName: WRONG_DETAIL_NAME });
      await refused('a supplier-only party as a customer', { detailedType: 'customer', detailedId: supplierOnly.id });
      await refused('a customer named without an id', { detailedType: 'customer', detailedName: customer.name });
      await refused('personnel that does not exist', { detailedType: 'personnel', detailedId: 99_999_999 });
      await refused('a project that does not exist', { detailedType: 'project', detailedId: 99_999_999 });
      if (await count(sql`SELECT count(*)::int AS n FROM journal_vouchers WHERE is_deleted = 0`) !== before) problems.push('a refused voucher was saved');

      const good = await post({ detailedType: 'customer', detailedId: customer.id, detailedName: WRONG_DETAIL_NAME });
      if (good.status !== 201) problems.push(`a live customer returned ${brief(good)}, expected 201`);
      else {
        const [row] = await orm.select({ name: journalVoucherItems.detailedName }).from(journalVoucherItems)
          .where(and(eq(journalVoucherItems.voucherId, Number(good.body.id)), eq(journalVoucherItems.accountId, acc['7001'])));
        if (row?.name !== customer.name) problems.push(`the row stores the detail name «${row?.name}», expected the party's own «${customer.name}»`);
      }
      const other = await post({ detailedType: 'other', detailedId: customer.id, detailedName: WRONG_DETAIL_NAME });
      if (other.status !== 201) problems.push(`a miscellaneous detail returned ${brief(other)}, expected 201`);
      else {
        const [row] = await orm.select({ id: journalVoucherItems.detailedId }).from(journalVoucherItems)
          .where(and(eq(journalVoucherItems.voucherId, Number(other.body.id)), eq(journalVoucherItems.accountId, acc['7001'])));
        if (row?.id !== null) problems.push(`a miscellaneous row keeps the id ${row?.id}, expected none`);
      }
      assertNoProblems(problems);
      return 'ghost, wrong-side and id-less details refused with 422 and nothing saved; a live party stores its own name; a miscellaneous row keeps no id';
    }));
  }

  const m6 = 'reg_treasury_contra_control_v11_6_1b_m6';
  if (shouldRun(m6, 'v11', 'phase6', 'm6', 'treasury', 'contra')) {
    await runCase(results, m6, 'v11 phase 6.1b (M6): a treasury miscellaneous payment refuses a control account as its counter account (insurance and payroll tax payables, eidi, other deductions, advances, inventory) with 422 naming the book, and the counter account list leaves them out', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const today = await businessTodayIsoDate();
      const admin = await sandboxAdminClient();
      const bank = await fundedBank();
      const refusedCodes = ['3204', '3205', '3206', '3207', '1301', '1404'];
      const acc = await accountIdsByCode(...refusedCodes, '7009');
      const pay = (contraAccountId: number) => admin.post('/api/accounting/treasury', {
        type: 'payment', method: 'bank_transfer', amount: 1000, bankAccountId: bank, partyType: 'other',
        contraAccountId, partyName: `M6 ${tagOf()}`, date: today,
      });
      const movements = () => count(sql`SELECT count(*)::int AS n FROM treasury_transactions WHERE is_deleted = 0`);
      const before = await movements();
      for (const code of refusedCodes) {
        const res = await pay(acc[code]);
        if (res.status !== 422 || codeOf(res) !== 'TREASURY_CONTRA_ACCOUNT_INVALID' || !textOf(res).includes(CONTROL_WORD)) {
          problems.push(`a payment against ${code} returned ${brief(res)}, expected 422 TREASURY_CONTRA_ACCOUNT_INVALID naming a control account`);
        }
      }
      if (await movements() !== before) problems.push('a refused payment was saved');
      const fine = await pay(acc['7009']);
      if (!ok(fine)) problems.push(`a payment against 7009 returned ${brief(fine)}, expected success`);

      const list = await admin.get('/api/accounting/treasury/contra-accounts');
      const codes = new Set((Array.isArray(list.body?.data) ? list.body.data : []).map((a: { code: string }) => a.code));
      for (const code of refusedCodes) if (codes.has(code)) problems.push(`the counter account list offers ${code}`);
      if (!codes.has('7009')) problems.push('the counter account list lacks 7009');
      assertNoProblems(problems);
      return 'six control accounts refused with 422 and left out of the list; 7009 accepted';
    }));
  }

  const c8 = 'reg_document_known_party_v11_6_1b_c8';
  if (shouldRun(c8, 'v11', 'phase6', 'c8', 's16', 'documents', 'party')) {
    await runCase(results, c8, 'v11 phase 6.1b (C8, S16): a priced purchase receipt is finalized only with a supplier on the list (422 for a name no party has or none, on create and on finalize); a sales invoice by a known name is linked to that party, and an unknown name stays a walk-in sale with its name', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const today = await businessTodayIsoDate();
      const admin = await sandboxAdminClient();
      const main = String(await getDefaultWarehouseCode(orm));
      const item = await createTestItem({ type: 'raw_material', stocks: { [main]: 50 }, weightedAverageCost: 1000 });
      const customer = await createTestCustomer();
      const supplier = await createTestCustomer({ partyType: 'supplier' });
      const unknownSupplier = `C8 unknown supplier ${tagOf()}`;
      const walkInName = `C8 walk-in buyer ${tagOf()}`;
      const doc = (docType: string, status: string, buyerName: string) => admin.post('/api/documents', {
        docType, status, refNumber: 'auto', date: today, location: main, buyer_name: buyerName, inOut: docType === 'receipt' ? 'in' : 'out',
        items: [{ itemId: item.id, quantity: 1, unit_price: 2000 }],
      });
      const partyOf = async (res: request.Response) => (await orm.select({ partyId: documents.partyId, buyerName: documents.buyerName })
        .from(documents).where(eq(documents.id, Number(res.body?.docId))))[0];
      const docs = () => count(sql`SELECT count(*)::int AS n FROM documents WHERE is_deleted = 0`);
      const before = await docs();

      // 1) purchases: a supplier on the list, or nothing
      const ghost = await doc('receipt', 'final', unknownSupplier);
      if (ghost.status !== 422 || codeOf(ghost) !== 'DOCUMENT_PARTY_UNKNOWN') problems.push(`a final receipt from «${unknownSupplier}» returned ${brief(ghost)}, expected 422 DOCUMENT_PARTY_UNKNOWN`);
      const noSupplier = await doc('receipt', 'final', '');
      if (noSupplier.status !== 422 || codeOf(noSupplier) !== 'DOCUMENT_SUPPLIER_REQUIRED') problems.push(`a priced final receipt with no supplier returned ${brief(noSupplier)}, expected 422 DOCUMENT_SUPPLIER_REQUIRED`);
      if (await docs() !== before) problems.push('a refused document was saved');
      const draft = await doc('receipt', 'draft', unknownSupplier);
      const draftId = Number(draft.body?.docId);
      if (!ok(draft) || !draftId) problems.push(`a draft receipt from «${unknownSupplier}» returned ${brief(draft)}, expected success`);
      else {
        const fin = await admin.put(`/api/documents/${draftId}/finalize`, {});
        if (fin.status !== 422 || codeOf(fin) !== 'DOCUMENT_PARTY_UNKNOWN') problems.push(`finalizing the draft receipt from «${unknownSupplier}» returned ${brief(fin)}, expected 422 DOCUMENT_PARTY_UNKNOWN`);
        const [row] = await orm.select({ status: documents.status }).from(documents).where(eq(documents.id, draftId));
        if (row?.status === 'final') problems.push('the refused draft receipt became final');
      }
      const known = await doc('receipt', 'final', supplier.name);
      if (!ok(known)) problems.push(`a final receipt from «${supplier.name}» by name returned ${brief(known)}, expected success`);
      else if ((await partyOf(known))?.partyId !== supplier.id) problems.push(`the receipt by name is not linked to supplier ${supplier.id}`);

      // 2) sales: a known name is linked, an unknown name is a walk-in sale that keeps its name
      const byName = await doc('invoice', 'final', customer.name);
      if (!ok(byName)) problems.push(`a final invoice to «${customer.name}» by name returned ${brief(byName)}, expected success`);
      else if ((await partyOf(byName))?.partyId !== customer.id) problems.push(`the invoice by name is not linked to party ${customer.id}`);
      const walkIn = await doc('invoice', 'final', walkInName);
      if (!ok(walkIn)) problems.push(`a walk-in final invoice to «${walkInName}» returned ${brief(walkIn)}, expected success`);
      else {
        const row = await partyOf(walkIn);
        if (row?.partyId !== null || row?.buyerName !== walkInName) problems.push(`the walk-in invoice holds party ${row?.partyId} and name «${row?.buyerName}», expected none and its name`);
      }
      assertNoProblems(problems);
      return 'receipt from an unknown or no supplier 422 on create and finalize, from a known name linked; invoice by a known name linked, an unknown name a walk-in sale';
    }));
  }

  const order = 'reg_procurement_supplier_required_v11_6_1b_c8';
  if (shouldRun(order, 'v11', 'phase6', 'c8', 's16', 'procurement', 'supplier')) {
    await runCase(results, order, 'v11 phase 6.1b (C8, S16): a purchase order from a requisition goes to a supplier on the list; a name no supplier has, or none, is refused (422 PROCUREMENT_SUPPLIER_REQUIRED) and nothing is ordered', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      await WorkflowEngineService.seedDefaultWorkflows();
      const admin = await sandboxAdminClient();
      const main = String(await getDefaultWarehouseCode(orm));
      const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
      const supplier = await createTestCustomer({ partyType: 'supplier' });
      const created = await admin.post('/api/procurement/requisitions', { title: `C8 requisition ${tagOf()}`, items: [{ itemId: item.id, itemName: item.name, requestedQty: 3 }] });
      const reqId = Number(created.body?.data?.id);
      if (created.status !== 201 || !reqId) throw new Error(`requisition answered ${brief(created)}`);
      const convert = (group: Record<string, unknown>) => admin.post(`/api/procurement/requisitions/${reqId}/convert-to-orders`, {
        orderGroups: [{ targetWarehouse: main, docType: 'receipt', status: 'draft', items: [{ itemId: item.id, itemName: item.name, quantity: 3, unitPrice: 1000 }], ...group }],
      });
      const orders = () => count(sql`SELECT count(*)::int AS n FROM documents WHERE procurement_requisition_id = ${reqId} AND is_deleted = 0`);

      const ghost = await convert({ supplierName: `C8 ghost supplier ${tagOf()}` });
      if (ghost.status !== 422 || codeOf(ghost) !== 'PROCUREMENT_SUPPLIER_REQUIRED') problems.push(`an order to an unknown supplier returned ${brief(ghost)}, expected 422 PROCUREMENT_SUPPLIER_REQUIRED`);
      const none = await convert({});
      if (none.status !== 422 || codeOf(none) !== 'PROCUREMENT_SUPPLIER_REQUIRED') problems.push(`an order with no supplier returned ${brief(none)}, expected 422 PROCUREMENT_SUPPLIER_REQUIRED`);
      if (await orders() !== 0) problems.push('a refused order was saved');
      const [req] = await orm.select({ items: purchaseRequisitions.items }).from(purchaseRequisitions).where(eq(purchaseRequisitions.id, reqId));
      if ((Array.isArray(req?.items) ? req.items : []).some((r: { orderedQty?: number }) => Number(r.orderedQty || 0) > 0)) problems.push('a refused order counted as ordered on the requisition');

      const good = await convert({ supplierName: supplier.name });
      if (good.status !== 200) problems.push(`an order to «${supplier.name}» by name returned ${brief(good)}, expected 200`);
      else {
        const [doc] = await orm.select({ partyId: documents.partyId }).from(documents).where(eq(documents.procurementRequisitionId, reqId));
        if (doc?.partyId !== supplier.id) problems.push(`the order is linked to party ${doc?.partyId}, expected ${supplier.id}`);
      }
      assertNoProblems(problems);
      return 'unknown and missing supplier refused with 422, nothing ordered; a supplier on the list by name is linked';
    }));
  }

  const c5 = 'reg_crm_phone_only_party_v11_6_1b_c5';
  if (shouldRun(c5, 'v11', 'phase6', 'c5', 'crm', 'party')) {
    await runCase(results, c5, 'v11 phase 6.1b (C5): a lead with only a phone makes a party named from that phone, never from the lead title, with its own audit row; a second lead with the same title and another phone makes another party', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const title = `C5 call about doors ${tagOf()}`;
      const phoneA = `0912${String(Date.now()).slice(-7)}`;
      const phoneB = `0935${String(Date.now() + 1).slice(-7)}`;
      const lead = async (phone: string) => {
        const res = await admin.post('/api/crm/leads', { title, phone });
        const id = Number(res.body?.data?.id ?? res.body?.id);
        if (!ok(res) || !id) throw new Error(`lead create answered ${brief(res)}`);
        const [row] = await orm.select({ customerId: crmLeads.customerId }).from(crmLeads).where(eq(crmLeads.id, id));
        return Number(row?.customerId ?? 0);
      };
      const first = await lead(phoneA);
      const second = await lead(phoneB);
      if (!first || !second) problems.push(`the leads made parties ${first} and ${second}, expected two`);
      if (first && first === second) problems.push('two leads with one title and two phones share a party');
      const names = (await orm.execute(sql`SELECT id, name FROM customers WHERE id IN (${first}, ${second}) ORDER BY id`)).rows as Array<{ id: number; name: string }>;
      for (const row of names) {
        if (row.name.includes(title)) problems.push(`party ${row.id} is named after the lead title: «${row.name}»`);
        if (!row.name.startsWith(PHONE_PARTY_PREFIX)) problems.push(`party ${row.id} is named «${row.name}», expected «${PHONE_PARTY_PREFIX} …»`);
      }
      const audits = await orm.select({ entityId: activityLogs.entityId }).from(activityLogs)
        .where(and(eq(activityLogs.entity, PARTY_ENTITY), eq(activityLogs.action, 'CREATE')));
      for (const id of [first, second]) {
        if (id && !audits.some(a => String(a.entityId) === String(id))) problems.push(`party ${id} made from a lead has no audit row`);
      }
      assertNoProblems(problems);
      return 'two phone-only leads with one title: two parties named from their phones, each with an audit row';
    }));
  }

  return results;
}
