import { readFileSync } from 'node:fs';
import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, journalVouchers, productionProjects, roles, transactions } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { ROLE_TEMPLATES } from '../../lib/permissions/roleTemplates.js';
import { FiscalYearService } from '../../services/accounting/fiscalYear.service.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { createTestCustomer, createTestItem, createTestRole, createTestWarehouse } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import {
  inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith, type ShouldRun, yearBounds,
} from './fiscalClosingTests.js';
import { brief, codeOf, ok } from './receiptsOnInvoicesV11Tests.js';

/**
 * v11 phase 6.1j: one path for opening stock and the stock details of the independent evaluation (S4, S7, S8, S9, S13,
 * S17, M10, N1, N3, N4; M8 and M21 are in stockHealthV11Tests). Real Express routes and services on PostgreSQL, each case
 * in its own schema with the standard chart of accounts; each is red on v11.4.0.
 */

export type Admin = Awaited<ReturnType<typeof sandboxAdminClient>>;

async function stockOf(itemId: number): Promise<{ total: number; byCode: Record<string, number> }> {
  const res = await orm.execute(sql`SELECT warehouse_code AS code, current_stock::float AS qty FROM item_warehouse_stocks WHERE item_id = ${itemId}`);
  const byCode: Record<string, number> = {};
  for (const r of res.rows as Array<{ code: string; qty: number }>) byCode[r.code] = Number(r.qty);
  return { total: Object.values(byCode).reduce((a, b) => a + b, 0), byCode };
}

const liveKardexRows = async (itemId: number) => Number(((await orm.execute(sql`
  SELECT count(*)::int AS n FROM transactions WHERE item_id = ${itemId} AND is_deleted = 0`)).rows[0] as { n: number }).n);
/** v11 phase 7.2 (F5): Kardex rows that are a real movement (no voided row, no reversal of one), and the reversal rows */
const ledgerKardexRows = async (itemId: number) => Number(((await orm.execute(sql`
  SELECT count(*)::int AS n FROM transactions t WHERE t.item_id = ${itemId} AND t.is_deleted = 0
     AND NOT EXISTS (SELECT 1 FROM transactions o WHERE o.id = t.reversal_of_id AND o.is_deleted = 1)`)).rows[0] as { n: number }).n);
const reversalKardexRows = async (itemId: number) => Number(((await orm.execute(sql`
  SELECT count(*)::int AS n FROM transactions t JOIN transactions o ON o.id = t.reversal_of_id
   WHERE t.item_id = ${itemId} AND t.is_deleted = 0 AND o.is_deleted = 1 AND t.type = 'out' AND o.type = 'in' AND t.quantity = o.quantity`)).rows[0] as { n: number }).n);

/** a final stock document through `POST /api/documents` */
export async function stockDoc(admin: Admin, body: Record<string, unknown>): Promise<number> {
  const res = await admin.post('/api/documents', { refNumber: 'auto', status: 'final', ...body });
  const id = Number(res.body?.docId);
  if (!ok(res) || !id) throw new Error(`setup: a ${String(body.docType)} returned ${brief(res)}`);
  return id;
}

export async function runStockPathsV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const transferId = 'reg_transfer_keeps_reservation_v11_6_1j_s4';
  if (shouldRun(transferId, 'v11', 'phase6', 's4', 'transfer', 'reservation', 'inventory')) {
    await runCase(results, transferId, 'v11 phase 6.1j (S4): a transfer that leaves the source warehouse with less than the sales proformas taking from it reserve is refused (409 TRANSFER_BREAKS_RESERVATION) and moves nothing; a transfer that keeps the reservation goes through; voiding a transfer is held to the same rule at its destination', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const main = String(await getDefaultWarehouseCode(orm));
      const other = await createTestWarehouse();
      const item = await createTestItem({ type: 'product', stocks: { [main]: 10 }, weightedAverageCost: 1000 });
      const customer = await createTestCustomer();
      const proforma = await admin.post('/api/documents', {
        docType: 'invoice', status: 'proforma', refNumber: 'auto', date: today, location: main, buyer_name: customer.name, partyId: customer.id,
        inOut: 'out', items: [{ itemId: item.id, quantity: 8, unit_price: 2000 }],
      });
      if (!ok(proforma)) throw new Error(`setup: the proforma returned ${brief(proforma)}`);

      const refused = await admin.post('/api/inventory/transfer', { itemId: item.id, fromLocation: main, toLocation: other.code, quantity: 5, date: today });
      const afterRefused = await stockOf(item.id);
      if (refused.status !== 409 || codeOf(refused) !== 'TRANSFER_BREAKS_RESERVATION') problems.push(`a transfer of 5 of 10 with 8 reserved returned ${brief(refused)}, expected 409 TRANSFER_BREAKS_RESERVATION`);
      if (afterRefused.byCode[main] !== 10 || (afterRefused.byCode[other.code] ?? 0) !== 0) problems.push(`the refused transfer moved stock: ${JSON.stringify(afterRefused.byCode)}`);

      const kept = await admin.post('/api/inventory/transfer', { itemId: item.id, fromLocation: main, toLocation: other.code, quantity: 2, date: today });
      const afterKept = await stockOf(item.id);
      if (!ok(kept)) problems.push(`a transfer of 2 that keeps the reservation of 8 returned ${brief(kept)}`);
      if (afterKept.byCode[main] !== 8 || afterKept.byCode[other.code] !== 2) problems.push(`after the transfer of 2 the stock is ${JSON.stringify(afterKept.byCode)}, expected 8 / 2`);

      // voiding the transfer moves the 2 back out of the other warehouse, where a proforma now reserves them
      const fromOther = await admin.post('/api/documents', {
        docType: 'invoice', status: 'proforma', refNumber: 'auto', date: today, location: other.code, buyer_name: customer.name, partyId: customer.id,
        inOut: 'out', items: [{ itemId: item.id, quantity: 2, unit_price: 2000, location: other.code }],
      });
      if (!ok(fromOther)) throw new Error(`setup: the proforma from the other warehouse returned ${brief(fromOther)}`);
      const transferDoc = Number(kept.body?.data?.transferDocId);
      const voided = await admin.del(`/api/documents/${transferDoc}`);
      const afterVoid = await stockOf(item.id);
      if (voided.status !== 409 || codeOf(voided) !== 'TRANSFER_BREAKS_RESERVATION') problems.push(`voiding the transfer of 2 with 2 reserved at its destination returned ${brief(voided)}, expected 409 TRANSFER_BREAKS_RESERVATION`);
      if (afterVoid.byCode[main] !== 8 || afterVoid.byCode[other.code] !== 2) problems.push(`the refused void moved stock: ${JSON.stringify(afterVoid.byCode)}`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return `transfer of 5 → ${refused.status} ${codeOf(refused)}; transfer of 2 → ${kept.status}, stock 8 / 2; its void with 2 reserved at the destination → ${voided.status} ${codeOf(voided)}`;
    }));
  }

  const voidKeyId = 'reg_stock_document_void_key_v11_6_1j_s7';
  if (shouldRun(voidKeyId, 'v11', 'phase6', 's7', 'permissions', 'documents', 'void')) {
    await runCase(results, voidKeyId, 'v11 phase 6.1j (S7, card t56-7): voiding a stock document asks documents.void_stock and voiding an invoice keeps documents.delete; each key alone is refused the other (403 DOCUMENT_VOID_NOT_ALLOWED, nothing voided); the migration and the role templates give the new key to every role that holds documents.delete', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const main = String(await getDefaultWarehouseCode(orm));
      const received = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
      const sold = await createTestItem({ type: 'product', stocks: { [main]: 50 }, weightedAverageCost: 1000 });
      const supplier = await createTestCustomer({ partyType: 'supplier' });
      const customer = await createTestCustomer();
      const receipt = () => stockDoc(admin, { docType: 'receipt', inOut: 'in', date: today, location: main, buyer_name: supplier.name, partyId: supplier.id, items: [{ itemId: received.id, quantity: 2, unit_price: 1000 }] });
      const invoice = () => stockDoc(admin, { docType: 'invoice', inOut: 'out', date: today, location: main, buyer_name: customer.name, partyId: customer.id, items: [{ itemId: sold.id, quantity: 1, unit_price: 3000 }] });
      const isLive = async (id: number) => Number(((await orm.execute(sql`SELECT is_deleted FROM documents WHERE id = ${id}`)).rows[0] as { is_deleted: number }).is_deleted) === 0;

      const invoiceOnly = await sandboxClientWith(['documents.view', 'documents.delete']);
      const stockOnly = await sandboxClientWith(['documents.view', 'documents.void_stock']);
      const r1 = await receipt();
      const i1 = await invoice();
      const refusedReceipt = await invoiceOnly.del(`/api/documents/${r1}`);
      if (refusedReceipt.status !== 403 || codeOf(refusedReceipt) !== 'DOCUMENT_VOID_NOT_ALLOWED' || !(await isLive(r1))) problems.push(`documents.delete alone voiding a receipt returned ${brief(refusedReceipt)}, live ${await isLive(r1)}`);
      const refusedInvoice = await stockOnly.del(`/api/documents/${i1}`);
      if (refusedInvoice.status !== 403 || codeOf(refusedInvoice) !== 'DOCUMENT_VOID_NOT_ALLOWED' || !(await isLive(i1))) problems.push(`documents.void_stock alone voiding an invoice returned ${brief(refusedInvoice)}, live ${await isLive(i1)}`);
      const voidedReceipt = await stockOnly.del(`/api/documents/${r1}`);
      if (!ok(voidedReceipt) || await isLive(r1)) problems.push(`documents.void_stock voiding a receipt returned ${brief(voidedReceipt)}`);
      const voidedInvoice = await invoiceOnly.del(`/api/documents/${i1}`);
      if (!ok(voidedInvoice) || await isLive(i1)) problems.push(`documents.delete voiding an invoice returned ${brief(voidedInvoice)}`);

      // the migration gives the key to a role holding documents.delete, and leaves the others alone
      const holder = await createTestRole({ permissions: ['documents.view', 'documents.delete'] });
      const reader = await createTestRole({ permissions: ['documents.view'] });
      const migration = readFileSync('drizzle/0005_stock_document_void.sql', 'utf8');
      await orm.execute(sql.raw(migration.split('\n').filter(line => !line.startsWith('--')).join('\n')));
      const permsOf = async (id: number) => ((await orm.select({ permissions: roles.permissions }).from(roles).where(eq(roles.id, id)))[0]?.permissions ?? []) as string[];
      if (!(await permsOf(holder.id)).includes('documents.void_stock')) problems.push(`the migration did not give documents.void_stock to a role with documents.delete: ${JSON.stringify(await permsOf(holder.id))}`);
      if ((await permsOf(reader.id)).includes('documents.void_stock')) problems.push('the migration gave documents.void_stock to a role without documents.delete');
      const missing = ROLE_TEMPLATES.filter(t => t.permissions.includes('documents.delete') && !t.permissions.includes('documents.void_stock')).map(t => t.code);
      if (missing.length > 0) problems.push(`role templates with documents.delete and without documents.void_stock: ${missing.join(', ')}`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return `receipt by documents.delete → ${refusedReceipt.status}, invoice by documents.void_stock → ${refusedInvoice.status}; each voids its own; migration and templates give the key`;
    }));
  }

  const openingId = 'reg_item_opening_stock_rules_v11_6_1j_s8_s9';
  if (shouldRun(openingId, 'v11', 'phase6', 's8', 's9', 'item', 'opening', 'permissions')) {
    await runCase(results, openingId, 'v11 phase 6.1j (S8, S9, card t56-5): opening stock in the item form needs warehouse.in (403 ITEM_OPENING_STOCK_NOT_ALLOWED) and a cost (422 ITEM_OPENING_WITHOUT_COST), only when the item is defined, in the item form and the Excel import; an item edit never takes opening stock (422 ITEM_OPENING_ON_CREATE_ONLY); nothing is written when refused', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const main = String(await getDefaultWarehouseCode(orm));
      let n = 0;
      const body = (cost: number, stock?: number) => {
        n += 1;
        return {
          type: 'raw_material', code: `M-${String(Date.now()).slice(-6)}${n}`, name: `کالای ۶.۱ج ${Date.now()} ${n}`, unit: 'عدد', category: 'سایر اقلام',
          weighted_average_cost: cost, ...(stock !== undefined ? { stocks: { [main]: stock } } : {}),
        };
      };
      const existsByCode = async (code: string) => (await orm.select({ id: items.id }).from(items).where(eq(items.code, code))).length > 0;

      const definer = await sandboxClientWith(['products.view', 'products.create', 'products.edit']);
      const noKey = body(1000, 5);
      const refusedKey = await definer.post('/api/items', noKey);
      if (refusedKey.status !== 403 || codeOf(refusedKey) !== 'ITEM_OPENING_STOCK_NOT_ALLOWED' || await existsByCode(noKey.code)) problems.push(`opening stock without warehouse.in returned ${brief(refusedKey)}, item written ${await existsByCode(noKey.code)}`);
      const plain = await definer.post('/api/items', body(1000));
      if (!ok(plain)) problems.push(`an item without stock by products.create alone returned ${brief(plain)}`);
      // the Excel import holds a new item with stock to the same key; the row is not created
      // a raw material code of the import's pattern (RAW_MATERIAL_CODE_PATTERN)
      const excelCode = `XL${String(Date.now()).slice(-6)}-12`;
      const controlCode = `XL${String(Date.now()).slice(-6)}-11`;
      const excel = await definer.post('/api/items/unified-import', { rows: [
        { 'کد کالا': controlCode, 'نام محصول': `کالای اکسل ۶.۱ج بی موجودی ${Date.now()}`, 'نوع': 'ماده اولیه', 'میانگین موزون بها': 1000 },
        { 'کد کالا': excelCode, 'نام محصول': `کالای اکسل ۶.۱ج ${Date.now()}`, 'نوع': 'ماده اولیه', 'میانگین موزون بها': 1000, 'موجودی کل': 5 },
      ] });
      if (!(await existsByCode(controlCode)) || await existsByCode(excelCode) || Number(excel.body?.createdCount ?? 0) !== 1) {
        problems.push(`an Excel file with a new item without stock and one with stock, by a user without warehouse.in, returned ${brief(excel)}; without stock written ${await existsByCode(controlCode)}, with stock written ${await existsByCode(excelCode)}`);
      }

      const zero = body(0, 5);
      const refusedCost = await admin.post('/api/items', zero);
      if (refusedCost.status !== 422 || codeOf(refusedCost) !== 'ITEM_OPENING_WITHOUT_COST' || await existsByCode(zero.code)) problems.push(`opening stock at zero cost returned ${brief(refusedCost)}, item written ${await existsByCode(zero.code)}`);
      const good = await admin.post('/api/items', body(1000, 5));
      const goodId = Number(good.body?.id);
      if (!ok(good) || (await stockOf(goodId)).total !== 5) problems.push(`opening stock 5 at cost 1000 returned ${brief(good)}`);

      const plainId = Number(plain.body?.id);
      if (plainId > 0) {
        const [row] = await orm.select({ version: items.version, name: items.name, code: items.code }).from(items).where(eq(items.id, plainId));
        const edit = await admin.put(`/api/items/${plainId}`, { ...body(1000), code: row.code, name: row.name, version: row.version, stocks: { [main]: 3 } });
        if (edit.status !== 422 || codeOf(edit) !== 'ITEM_OPENING_ON_CREATE_ONLY' || (await stockOf(plainId)).total !== 0 || await liveKardexRows(plainId) !== 0) {
          problems.push(`opening stock through an item edit returned ${brief(edit)}, stock ${(await stockOf(plainId)).total}`);
        }
        const rename = await admin.put(`/api/items/${plainId}`, { ...body(1000), code: row.code, name: `${row.name} ۲`, version: row.version });
        if (!ok(rename)) problems.push(`an item edit without stock returned ${brief(rename)}`);
      }
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return `no receipt key → ${refusedKey.status}, Excel row not created; zero cost → ${refusedCost.status}; with both → stock 5; edit with stock → 422`;
    }));
  }

  const rejectId = 'reg_item_rejected_opening_withdrawn_v11_6_1j_s13';
  if (shouldRun(rejectId, 'v11', 'phase6', 's13', 'item', 'opening', 'workflow')) {
    await runCase(results, rejectId, 'v11 phase 6.1j (S13): when an item definition with opening stock is rejected or canceled, the opening that never got a voucher leaves stock and Kardex; when the item moved since, the rejection is refused (409 ITEM_OPENING_IN_USE), but a voided sale is no movement; through the workflow engine too; an opening in a closed year is not withdrawn (409 ITEM_OPENING_IN_CLOSED_YEAR); approval still issues the opening voucher', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const { ItemCatalogService } = await import('../../services/items/itemCatalog.service.js');
      const { issueApprovedItemOpening } = await import('../../services/inventory/itemOpeningWorkflowAction.js');
      const { normalizeError } = await import('../../errors/customErrors.js');
      const main = String(await getDefaultWarehouseCode(orm));
      const admin = await sandboxAdminClient();
      // the item route with an item workflow: the item and its opening stock, the voucher waits for the approval
      const define = async (label: string) => {
        const created = await orm.transaction(tx => ItemCatalogService.createItem({
          type: 'raw_material', code: `W-${String(Date.now()).slice(-6)}${label}`, name: `کالای گردش‌کار ${Date.now()} ${label}`, unit: 'عدد', category: 'سایر اقلام',
          // the route turns the form's `stocks` into these keys (items.schemas.ts)
          weighted_average_cost: 1500, [`stock_${main}`]: 4,
        }, { username: 'reg' }, tx, { canEnterStock: true }));
        return created.insertedId;
      };
      const step = (itemId: number, toStateKey: string) => orm.transaction(tx => issueApprovedItemOpening(tx, {
        entityType: 'item', entityId: String(itemId), toStateKey, performedByName: 'reg',
      } as Parameters<typeof issueApprovedItemOpening>[1]));

      for (const stateKey of ['rejected', 'canceled']) {
        const id = await define(stateKey.slice(0, 2));
        if ((await stockOf(id)).total !== 4) throw new Error(`setup: the opening stock is ${(await stockOf(id)).total}`);
        await step(id, stateKey);
        // v11 phase 7.2 (F5): the opening row is voided and gets one reversal row, as a document void does
        if ((await stockOf(id)).total !== 0 || await ledgerKardexRows(id) !== 0 || await reversalKardexRows(id) !== 1) {
          problems.push(`after «${stateKey}» the item keeps stock ${(await stockOf(id)).total}, ${await ledgerKardexRows(id)} Kardex movement(s) and ${await reversalKardexRows(id)} reversal row(s), expected 0, 0 and 1`);
        }
      }

      const moved = await define('mv');
      const customer = await createTestCustomer();
      await stockDoc(admin, { docType: 'invoice', inOut: 'out', date: await businessTodayIsoDate(), location: main, buyer_name: customer.name, partyId: customer.id, items: [{ itemId: moved, quantity: 1, unit_price: 5000 }] });
      let code = 'accepted';
      try { await step(moved, 'rejected'); } catch (err) { code = normalizeError(err).code ?? 'error'; }
      if (code !== 'ITEM_OPENING_IN_USE' || (await stockOf(moved)).total !== 3) problems.push(`rejecting an item sold since ended as ${code} with stock ${(await stockOf(moved)).total}`);

      // an opening dated in a closed year stays, as a void there does (M10)
      const dated = await define('cy');
      const closedYear = 1395;
      const closedDate = yearBounds(closedYear).firstDay.replace(/-\d\d$/, '-25');
      await orm.execute(sql`UPDATE transactions SET date = ${closedDate} WHERE item_id = ${dated}`);
      await FiscalYearService.executeFiscalYearClosing({ year: closedYear, createOpeningVoucher: true, username: 'reg' });
      let closedCode = 'accepted';
      try { await step(dated, 'rejected'); } catch (err) { closedCode = normalizeError(err).code ?? 'error'; }
      if (closedCode !== 'ITEM_OPENING_IN_CLOSED_YEAR' || (await stockOf(dated)).total !== 4) problems.push(`rejecting an item whose opening is in the closed year ${closedYear} ended as ${closedCode} with stock ${(await stockOf(dated)).total}`);

      // through the workflow engine and the item route: a sale voided since does not keep the opening in use
      const { WorkflowDefinitionService } = await import('../../services/workflow/workflowDefinitionService.js');
      const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
      const { registerItemOpeningWorkflowAction } = await import('../../services/inventory/itemOpeningWorkflowAction.js');
      registerItemOpeningWorkflowAction();
      const saved = await WorkflowDefinitionService.saveWorkflowDefinition({
        code: `REG_61J_ITEM_${Date.now()}`, title: 'تعریف کالا ۶.۱ج', entityType: 'item', description: 'v11 6.1j S13',
        states: [
          { stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial' },
          { stateKey: 'approved', title: 'تایید', stateType: 'terminal' },
          { stateKey: 'rejected', title: 'رد', stateType: 'terminal' },
        ],
        transitions: [
          { fromStateKey: 'draft', toStateKey: 'approved', actionKey: 'approve', title: 'تایید' },
          { fromStateKey: 'draft', toStateKey: 'rejected', actionKey: 'reject', title: 'رد' },
        ],
      });
      const defId = Number(saved?.definition?.id);
      await orm.execute(sql`UPDATE workflow_definitions SET is_active = CASE WHEN id = ${defId} THEN 1 ELSE 0 END WHERE entity_type = 'item'`);
      const routed = await admin.post('/api/items', {
        type: 'raw_material', code: `W-${String(Date.now()).slice(-6)}eg`, name: `کالای موتور گردش‌کار ${Date.now()}`, unit: 'عدد', category: 'سایر اقلام',
        weighted_average_cost: 1500, stocks: { [main]: 4 },
      });
      const routedId = Number(routed.body?.id);
      if (!ok(routed) || !routedId) throw new Error(`setup: the item with a workflow returned ${brief(routed)}`);
      const sale = await stockDoc(admin, { docType: 'invoice', inOut: 'out', date: await businessTodayIsoDate(), location: main, buyer_name: customer.name, partyId: customer.id, items: [{ itemId: routedId, quantity: 1, unit_price: 5000 }] });
      const voidSale = await admin.del(`/api/documents/${sale}`);
      if (!ok(voidSale) || (await stockOf(routedId)).total !== 4) throw new Error(`setup: voiding the sale returned ${brief(voidSale)}, stock ${(await stockOf(routedId)).total}`);
      const [instance] = (await orm.execute(sql`SELECT id FROM workflow_instances WHERE entity_type = 'item' AND entity_id = ${String(routedId)}`)).rows as Array<{ id: number }>;
      const state = await WorkflowTransitionExecutor.getInstanceByEntity('item', String(routedId), undefined, 'admin', ['*']);
      const reject = ((state?.availableTransitions || []) as Array<{ id: number; actionKey: string }>).find(t => t.actionKey === 'reject');
      let engineCode = 'accepted';
      if (!instance || !reject) {
        engineCode = `no instance (${instance?.id}) or reject action`;
      } else {
        try {
          await WorkflowTransitionExecutor.executeTransition({ instanceId: Number(instance.id), transitionId: reject.id, userRole: 'admin', userPermissions: ['*'] });
        } catch (err) { engineCode = normalizeError(err).code ?? 'error'; }
      }
      const openingLeft = Number(((await orm.execute(sql`SELECT count(*)::int AS n FROM transactions t WHERE t.item_id = ${routedId} AND t.is_deleted = 0 AND t.document_id IS NULL AND t.reversal_of_id IS NULL`)).rows[0] as { n: number }).n);
      if (engineCode !== 'accepted' || (await stockOf(routedId)).total !== 0 || openingLeft !== 0) {
        problems.push(`rejecting through the engine after a voided sale ended as ${engineCode} with stock ${(await stockOf(routedId)).total} and ${openingLeft} opening row(s)`);
      }

      const approved = await define('ap');
      await step(approved, 'approved');
      const vouchers = await orm.select({ id: journalVouchers.id }).from(journalVouchers)
        .where(and(eq(journalVouchers.referenceModule, 'item_opening'), eq(journalVouchers.referenceId, approved), eq(journalVouchers.isDeleted, 0)));
      if ((await stockOf(approved)).total !== 4 || vouchers.length !== 1) problems.push(`approval left stock ${(await stockOf(approved)).total} and ${vouchers.length} opening voucher(s)`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return `rejected and canceled → stock 0, no Kardex; moved item → ${code}; engine reject after a voided sale → ${engineCode}; opening in a closed year → ${closedCode}; approved → opening voucher`;
    }));
  }

  const countId = 'reg_stock_count_book_stock_v11_6_1j_s17';
  if (shouldRun(countId, 'v11', 'phase6', 's17', 'audit', 'count', 'inventory')) {
    await runCase(results, countId, 'v11 phase 6.1j (S17): a stock count line without the book stock it was counted against is refused (422 AUDIT_BOOK_STOCK_MISSING) and so is a negative count (422 AUDIT_COUNT_NEGATIVE); nothing moves; a full line still adjusts the stock', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const main = String(await getDefaultWarehouseCode(orm));
      const item = await createTestItem({ type: 'raw_material', stocks: { [main]: 6 }, weightedAverageCost: 1000 });
      const count = (line: Record<string, unknown>) => admin.post('/api/documents', {
        docType: 'audit', refNumber: 'auto', date: today, location: main, status: 'final', items: [{ itemId: item.id, location: main, ...line }],
      });
      const blank = await count({ physical_stock: 4, quantity: 4 });
      if (blank.status !== 422 || codeOf(blank) !== 'AUDIT_BOOK_STOCK_MISSING') problems.push(`a count without its book stock returned ${brief(blank)}`);
      const negative = await count({ system_stock: 6, physical_stock: -1, quantity: -1 });
      if (negative.status !== 422 || codeOf(negative) !== 'AUDIT_COUNT_NEGATIVE') problems.push(`a negative count returned ${brief(negative)}`);
      if ((await stockOf(item.id)).total !== 6) problems.push(`a refused count moved the stock to ${(await stockOf(item.id)).total}`);
      const full = await count({ system_stock: 6, physical_stock: 4, quantity: 4 });
      if (!ok(full) || (await stockOf(item.id)).total !== 4) problems.push(`a full count line returned ${brief(full)}, stock ${(await stockOf(item.id)).total}`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return `no book stock → ${blank.status} ${codeOf(blank)}; negative → ${negative.status} ${codeOf(negative)}; full line → stock 4`;
    }));
  }

  const closedId = 'reg_void_in_closed_year_refused_v11_6_1j_m10';
  if (shouldRun(closedId, 'v11', 'phase6', 'm10', 'fiscal', 'void', 'documents')) {
    await runCase(results, closedId, 'v11 phase 6.1j (M10): a document with Kardex rows in a closed fiscal year is not voided (409 DOCUMENT_IN_CLOSED_YEAR); its rows and voucher stay as they were', () => inFiscalSandbox(async () => {
      const admin = await sandboxAdminClient();
      const main = String(await getDefaultWarehouseCode(orm));
      const year = 1395;
      const { firstDay } = yearBounds(year);
      const date = firstDay.replace(/-\d\d$/, '-25');
      const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
      const supplier = await createTestCustomer({ partyType: 'supplier' });
      const receipt = await stockDoc(admin, { docType: 'receipt', inOut: 'in', date, location: main, buyer_name: supplier.name, partyId: supplier.id, items: [{ itemId: item.id, quantity: 3, unit_price: 2000 }] });
      // a receipt voucher starts as a draft; a year with a draft voucher is not closed
      await orm.update(journalVouchers).set({ status: 'approved' }).where(eq(journalVouchers.sourceDocumentId, receipt));
      await FiscalYearService.executeFiscalYearClosing({ year, createOpeningVoucher: true, username: 'reg' });
      const rowsBefore = await liveKardexRows(item.id);
      const vouchersOf = async () => JSON.stringify((await orm.execute(sql`
        SELECT v.id, v.status, v.is_deleted, v.total_debit::text AS debit FROM journal_vouchers v
         WHERE v.source_document_id = ${receipt} OR v.reference_id IN (SELECT id FROM journal_vouchers WHERE source_document_id = ${receipt})
         ORDER BY v.id`)).rows);
      const vouchersBefore = await vouchersOf();
      const res = await admin.del(`/api/documents/${receipt}`);
      const [doc] = (await orm.execute(sql`SELECT is_deleted FROM documents WHERE id = ${receipt}`)).rows as Array<{ is_deleted: number }>;
      const vouchersAfter = await vouchersOf();
      if (res.status !== 409 || codeOf(res) !== 'DOCUMENT_IN_CLOSED_YEAR' || Number(doc.is_deleted) !== 0 || await liveKardexRows(item.id) !== rowsBefore || vouchersAfter !== vouchersBefore) {
        throw new Error(`voiding a receipt of the closed year ${year} returned ${brief(res)}; deleted ${doc.is_deleted}, Kardex rows ${rowsBefore} → ${await liveKardexRows(item.id)}, vouchers ${vouchersBefore} → ${vouchersAfter}`);
      }
      return `void of a receipt dated ${date} after closing ${year} → ${res.status} ${codeOf(res)}`;
    }));
  }

  const followId = 'reg_item_followups_v11_6_1j_n1_n3_n4';
  if (shouldRun(followId, 'v11', 'phase6', 'n1', 'n3', 'n4', 'item', 'delete', 'excel')) {
    await runCase(results, followId, 'v11 phase 6.1j (N1, N3, N4): an item an open project plans as its product is not deleted (409 ITEM_IS_OPEN_PROJECT_PRODUCT) until the project closes; a deleted item named by a sales line or a transfer answers 409 ITEM_DELETED like a receipt, not 404; an item whose only receipt was voided changes its type from Excel', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const today = await businessTodayIsoDate();
      const main = String(await getDefaultWarehouseCode(orm));

      // N1
      const product = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
      const [project] = await orm.insert(productionProjects).values({
        projectCode: `PRJ-N1-${String(Date.now()).slice(-6)}`, title: 'پروژه آزمون N1', status: 'in_progress', quantity: 2, version: 1, isDeleted: 0,
        products: [{ item_id: product.id, quantity: 2 }],
      }).returning({ id: productionProjects.id });
      const refused = await admin.del(`/api/items/${product.id}`);
      if (refused.status !== 409 || codeOf(refused) !== 'ITEM_IS_OPEN_PROJECT_PRODUCT') problems.push(`deleting the product of an open project returned ${brief(refused)}`);
      await orm.update(productionProjects).set({ status: 'completed' }).where(eq(productionProjects.id, project.id));
      const deleted = await admin.del(`/api/items/${product.id}`);
      if (!ok(deleted)) problems.push(`deleting it after the project completed returned ${brief(deleted)}`);

      // N3
      const gone = await createTestItem({ type: 'product', stocks: { [main]: 5 }, weightedAverageCost: 1000 });
      await orm.update(items).set({ isDeleted: 1 }).where(eq(items.id, gone.id));
      const customer = await createTestCustomer();
      const sale = await admin.post('/api/documents', {
        docType: 'invoice', status: 'final', refNumber: 'auto', date: today, location: main, buyer_name: customer.name, partyId: customer.id,
        inOut: 'out', items: [{ itemId: gone.id, quantity: 1, unit_price: 3000 }],
      });
      if (sale.status !== 409 || codeOf(sale) !== 'ITEM_DELETED') problems.push(`a sale of a deleted item returned ${brief(sale)}, expected 409 ITEM_DELETED`);
      const other = await createTestWarehouse();
      const move = await admin.post('/api/inventory/transfer', { itemId: gone.id, fromLocation: main, toLocation: other.code, quantity: 1, date: today });
      if (move.status !== 409 || codeOf(move) !== 'ITEM_DELETED') problems.push(`a transfer of a deleted item returned ${brief(move)}, expected 409 ITEM_DELETED`);

      // N4
      const material = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
      const supplier = await createTestCustomer({ partyType: 'supplier' });
      const receipt = await stockDoc(admin, { docType: 'receipt', inOut: 'in', date: today, location: main, buyer_name: supplier.name, partyId: supplier.id, items: [{ itemId: material.id, quantity: 2, unit_price: 1000 }] });
      const voided = await admin.del(`/api/documents/${receipt}`);
      if (!ok(voided)) throw new Error(`setup: voiding the receipt returned ${brief(voided)}`);
      const excel = await admin.post('/api/items/unified-import', { rows: [{ 'کد کالا': material.code, 'نام محصول': material.name, 'نوع کالا': 'محصول نهایی' }] });
      const [after] = await orm.select({ type: items.type }).from(items).where(eq(items.id, material.id));
      const errors = (excel.body?.errors ?? []) as Array<{ message?: string }>;
      if (excel.status !== 200 || after.type !== 'product' || errors.length > 0) problems.push(`the type change after the only receipt was voided returned ${brief(excel)}, type ${after.type}`);
      const reversals = await orm.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.itemId, material.id), eq(transactions.isDeleted, 0)));
      if (reversals.length === 0) problems.push('setup: the voided receipt left no live reversal row, so the case does not test N4');
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return `open project product → ${refused.status}; deleted item sale → ${sale.status} ${codeOf(sale)}, transfer → ${move.status}; voided receipt → type changed`;
    }));
  }

  return results;
}
