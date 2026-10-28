import { readFileSync } from 'node:fs';
import { and, eq, sql } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { fiscalPeriods, legacyDateRepairs, workflowDefinitions } from '../../db/schema.js';
import { resolveJalaliFiscalYear } from '../../lib/businessClock.js';
import { FiscalPeriodService } from '../../services/accounting/fiscalPeriod.service.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';
import { brief, codeOf, ok, tagOf, world } from './receiptsOnInvoicesV11Tests.js';

/**
 * v11 phase 7.2 (findings F1 to F6 of the v11 full test, card ت۶۲): a direct link goes only to an issued document; what a
 * receipt or cheque of a closed year settles does not change; the Excel import starts the item workflow; a void stores the
 * real instant; a direct link asks the documents section. Real Express routes and services on PostgreSQL, each scenario in
 * its own schema; each is red on v11.5.0.
 */

const count = async (query: ReturnType<typeof sql>) => Number(((await orm.execute(query)).rows[0] as { n: number | string }).n);

async function closeYearOf(date: string): Promise<number> {
  const year = resolveJalaliFiscalYear(date);
  await orm.insert(fiscalPeriods).values({ fiscalYear: year, status: 'closed', closedBy: 'reg' })
    .onConflictDoUpdate({ target: fiscalPeriods.fiscalYear, set: { status: 'closed', closedBy: 'reg' } });
  FiscalPeriodService.resetCache();
  return year;
}

export async function runClosingFindingsV11Tests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const draftLink = 'reg_direct_link_issued_document_v11_7_2_f1_f6';
  if (shouldRun(draftLink, 'v11', 'phase7', 'treasury', 'documents', 'settlement')) {
    await runCase(results, draftLink, 'v11 phase 7.2 (F1, F6): a receipt is not linked directly to a draft invoice, neither when it is recorded nor by a move to another document (422 SETTLEMENT_DOCUMENT_NOT_ISSUED), while a final invoice still takes it; a treasurer without the documents section links nothing directly and lists no documents to move to (403 SETTLEMENT_DOCUMENTS_NOT_READABLE), but still records on account', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const w = await world(admin);
      const draft = await w.doc('invoice', w.customer, 1_000_000, 'draft');
      const final = await w.doc('invoice', w.customer, 1_000_000);
      const rowsBefore = await count(sql`SELECT count(*)::int AS n FROM treasury_transactions WHERE is_deleted = 0`);

      const direct = await w.receipt(100_000, { documentId: draft });
      if (direct.status !== 422 || codeOf(direct) !== 'SETTLEMENT_DOCUMENT_NOT_ISSUED') problems.push(`a receipt linked directly to a draft returned ${brief(direct)}, expected 422 SETTLEMENT_DOCUMENT_NOT_ISSUED`);
      if (await count(sql`SELECT count(*)::int AS n FROM treasury_transactions WHERE is_deleted = 0`) !== rowsBefore) problems.push('the refused receipt left a treasury row');
      const onAccount = await w.receipt(50_000);
      const onAccountId = Number(onAccount.body?.id);
      if (onAccount.status !== 201 || !onAccountId) throw new Error(`setup: a receipt on account returned ${brief(onAccount)}`);
      const relink = await admin.put(`/api/accounting/treasury/${onAccountId}/document`, { documentId: draft });
      if (relink.status !== 422 || codeOf(relink) !== 'SETTLEMENT_DOCUMENT_NOT_ISSUED') problems.push(`moving a receipt to a draft returned ${brief(relink)}, expected 422 SETTLEMENT_DOCUMENT_NOT_ISSUED`);
      const draftState = await w.state(draft);
      if (draftState.paid !== 0) problems.push(`the draft shows paid ${draftState.paid}, expected 0`);
      const toFinal = await admin.put(`/api/accounting/treasury/${onAccountId}/document`, { documentId: final });
      if (!ok(toFinal)) problems.push(`moving the receipt to a final invoice returned ${brief(toFinal)}, expected success`);
      const directFinal = await w.receipt(100_000, { documentId: final });
      if (directFinal.status !== 201) problems.push(`a receipt linked directly to a final invoice returned ${brief(directFinal)}, expected 201`);
      if ((await w.state(final)).paid !== 150_000) problems.push(`the final invoice shows paid ${(await w.state(final)).paid}, expected 150000`);

      const treasurer = await sandboxClientWith(['accounting.treasury']);
      const body = { type: 'receipt', method: 'bank_transfer', bankAccountId: w.bank, amount: 10_000, date: w.today, partyType: 'customer', partyId: w.customer.id, partyName: w.customer.name };
      const linked = await treasurer.post('/api/accounting/treasury', { ...body, documentId: final });
      if (linked.status !== 403 || codeOf(linked) !== 'SETTLEMENT_DOCUMENTS_NOT_READABLE') problems.push(`a treasurer without documents linking a receipt returned ${brief(linked)}, expected 403`);
      const plain = await treasurer.post('/api/accounting/treasury', body);
      const plainId = Number(plain.body?.id);
      if (plain.status !== 201 || !plainId) problems.push(`a treasurer without documents recording on account returned ${brief(plain)}, expected 201`);
      else {
        const options = await treasurer.get(`/api/accounting/treasury/${plainId}/document-options`);
        if (options.status !== 403) problems.push(`a treasurer without documents listing documents to move to returned ${brief(options)}, expected 403`);
        const moved = await treasurer.put(`/api/accounting/treasury/${plainId}/document`, { documentId: final });
        if (moved.status !== 403 || codeOf(moved) !== 'SETTLEMENT_DOCUMENTS_NOT_READABLE') problems.push(`a treasurer without documents moving a receipt returned ${brief(moved)}, expected 403`);
      }
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'direct link and move to a draft → 422; to a final invoice → accepted; treasurer without documents → 403 on link, move and options';
    }));
  }

  const closedYear = 'reg_settlement_closed_year_v11_7_2_f2';
  if (shouldRun(closedYear, 'v11', 'phase7', 'treasury', 'cheques', 'fiscal', 'settlement')) {
    await runCase(results, closedYear, 'v11 phase 7.2 (F2): in a closed fiscal year, moving a receipt\'s parts to another invoice, moving a receipt off its invoice, taking a cheque\'s parts off and deleting a cheque that settles an invoice are refused (409 SETTLEMENT_IN_CLOSED_YEAR) and the invoices keep their paid amounts; saving the same parts unchanged and deleting a cheque that settles nothing still work', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const w = await world(admin);
      const inv1 = await w.doc('invoice', w.customer, 1_000_000);
      const inv2 = await w.doc('invoice', w.customer, 1_000_000);
      const parts = await w.receipt(300_000, { allocations: [{ documentId: inv1, amount: 300_000 }] });
      const direct = await w.receipt(200_000, { documentId: inv1 });
      const chequeParts = await w.cheque('received', 120_000, { allocations: [{ documentId: inv2, amount: 120_000 }] });
      const chequeDelete = await w.cheque('received', 150_000, { createVoucher: false, allocations: [{ documentId: inv2, amount: 150_000 }] });
      const chequeFree = await w.cheque('received', 90_000, { createVoucher: false });
      for (const [label, res] of [['receipt with parts', parts], ['linked receipt', direct], ['cheque with parts', chequeParts], ['cheque to delete', chequeDelete], ['free cheque', chequeFree]] as const) {
        if (!ok(res) || !Number(res.body?.id)) throw new Error(`setup: the ${label} returned ${brief(res)}`);
      }
      const year = await closeYearOf(w.today);

      const refused = (label: string, res: Awaited<ReturnType<typeof admin.get>>) => {
        if (res.status !== 409 || codeOf(res) !== 'SETTLEMENT_IN_CLOSED_YEAR') problems.push(`${label} in the closed year ${year} returned ${brief(res)}, expected 409 SETTLEMENT_IN_CLOSED_YEAR`);
      };
      refused('moving the receipt\'s part to another invoice', await admin.put(`/api/accounting/treasury/${parts.body.id}/allocations`, { allocations: [{ documentId: inv2, amount: 300_000 }] }));
      refused('moving the linked receipt on account', await admin.put(`/api/accounting/treasury/${direct.body.id}/document`, { documentId: null }));
      refused('taking the cheque\'s part off', await admin.put(`/api/accounting/cheques/${chequeParts.body.id}/allocations`, { allocations: [] }));
      refused('deleting the cheque that settles an invoice', await admin.del(`/api/accounting/cheques/${chequeDelete.body.id}`));
      const s1 = await w.state(inv1);
      const s2 = await w.state(inv2);
      if (s1.paid !== 500_000 || s2.paid !== 270_000) problems.push(`the invoices show paid ${s1.paid} and ${s2.paid}, expected 500000 and 270000`);

      const same = await admin.put(`/api/accounting/treasury/${parts.body.id}/allocations`, { allocations: [{ documentId: inv1, amount: 300_000 }] });
      if (!ok(same)) problems.push(`saving the same parts unchanged returned ${brief(same)}, expected success`);
      const freeDelete = await admin.del(`/api/accounting/cheques/${chequeFree.body.id}`);
      if (!ok(freeDelete)) problems.push(`deleting a cheque that settles nothing returned ${brief(freeDelete)}, expected success`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return `closed year ${year}: four settlement changes → 409; invoices keep 500000 and 270000; unchanged parts and a free cheque delete → accepted`;
    }));
  }

  const importWorkflow = 'reg_item_import_starts_workflow_v11_7_2_f3';
  if (shouldRun(importWorkflow, 'v11', 'phase7', 'item', 'excel', 'workflow', 'opening')) {
    await runCase(results, importWorkflow, 'v11 phase 7.2 (F3): with an active item workflow, a new item from the Excel import starts it as the item form does and its opening voucher waits for the approval; without one, the import still issues the opening voucher at once', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const importOne = async (suffix: string) => {
        // a raw material code is a prefix and a two- or three-digit number
        const code = `XL${tagOf()}-${suffix}`;
        const res = await admin.post('/api/items/unified-import', { rows: [
          { 'کد کالا': code, 'نام محصول': `کالای اکسل ${code}`, 'نوع': 'ماده اولیه', 'میانگین موزون بها': 1000, 'موجودی کل': 5 },
        ] });
        const [row] = (await orm.execute(sql`SELECT id, current_stock::text AS stock FROM items WHERE code = ${code} AND is_deleted = 0`)).rows as Array<{ id: number; stock: string }>;
        if (!ok(res) || !row) throw new Error(`setup: importing ${code} returned ${brief(res)}`);
        const id = Number(row.id);
        return {
          id,
          stock: Number(row.stock),
          instances: await count(sql`SELECT count(*)::int AS n FROM workflow_instances WHERE entity_type = 'item' AND entity_id = ${String(id)}`),
          openingVouchers: await count(sql`SELECT count(*)::int AS n FROM item_opening_voucher_items WHERE item_id = ${id}`),
        };
      };
      const plain = await importOne('11');
      if (plain.stock !== 5 || plain.instances !== 0 || plain.openingVouchers !== 1) problems.push(`without a workflow the imported item has stock ${plain.stock}, ${plain.instances} workflow(s), ${plain.openingVouchers} opening voucher line(s); expected 5, 0, 1`);

      const { WorkflowDefinitionService } = await import('../../services/workflow/workflowDefinitionService.js');
      const saved = await WorkflowDefinitionService.saveWorkflowDefinition({
        code: `REG_72_ITEM_${tagOf()}`, title: 'تعریف کالا ۷.۲', entityType: 'item', description: 'v11 7.2 F3',
        states: [
          { stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial' },
          { stateKey: 'approved', title: 'تایید', stateType: 'terminal' },
        ],
        transitions: [{ fromStateKey: 'draft', toStateKey: 'approved', actionKey: 'approve', title: 'تایید' }],
      });
      const defId = Number(saved?.definition?.id);
      await orm.update(workflowDefinitions).set({ isActive: 0 }).where(eq(workflowDefinitions.entityType, 'item'));
      await orm.update(workflowDefinitions).set({ isActive: 1 }).where(and(eq(workflowDefinitions.id, defId), eq(workflowDefinitions.entityType, 'item')));
      const routed = await importOne('12');
      if (routed.stock !== 5 || routed.instances !== 1 || routed.openingVouchers !== 0) problems.push(`with a workflow the imported item has stock ${routed.stock}, ${routed.instances} workflow(s), ${routed.openingVouchers} opening voucher line(s); expected 5, 1, 0`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'no workflow → opening voucher at once; active workflow → one instance, voucher waits';
    }));
  }

  const deletedAt = 'reg_document_deleted_at_instant_v11_7_2_f4';
  if (shouldRun(deletedAt, 'v11', 'phase7', 'documents', 'void', 'timestamps', 'migration')) {
    await runCase(results, deletedAt, 'v11 phase 7.2 (F4): a void stores the real instant in documents.deleted_at; the repair of migration 0007 moves an old void time written as the business wall clock to the instant of its activity row, records it in legacy_date_repairs, leaves a row it cannot prove and changes nothing when run again', () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const w = await world(admin);
      const inv = await w.doc('invoice', w.customer, 500_000);
      const voided = await admin.del(`/api/documents/${inv}`);
      if (!ok(voided)) throw new Error(`setup: voiding the invoice returned ${brief(voided)}`);
      const [gap] = (await pool.query(`SELECT abs(extract(epoch FROM (deleted_at - now())))::float AS s FROM documents WHERE id = $1`, [inv])).rows as Array<{ s: number }>;
      if (!(gap && gap.s < 120)) problems.push(`deleted_at is ${gap?.s} seconds from now, expected under 120`);

      // an old void: deleted_at holds the wall clock read as UTC (3.5 hours ahead), its activity row the real instant
      const wallClock = '2026-05-10 14:30:00';
      const old = await w.doc('invoice', w.customer, 400_000);
      const unproven = await w.doc('invoice', w.customer, 300_000);
      await pool.query(`UPDATE documents SET is_deleted = 1, deleted_at = ($2::timestamp AT TIME ZONE 'UTC') WHERE id = ANY($1::int[])`, [[old, unproven], wallClock]);
      await pool.query(`INSERT INTO activity_logs (username, action, entity, entity_id, description, details, "timestamp")
        VALUES ('reg', 'DELETE', 'اسناد انبار', $1, 'reg void', jsonb_build_object('deletedAt', $2::text), ($2::timestamp AT TIME ZONE 'Asia/Tehran'))`, [String(old), wallClock]);
      const repair = readFileSync(new URL('../../../drizzle/0007_document_deleted_at_instant.sql', import.meta.url), 'utf8')
        .split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean).at(-1) as string;
      await pool.query(repair);
      const rows = (await pool.query(`SELECT id, to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS utc FROM documents WHERE id = ANY($1::int[]) ORDER BY id`, [[old, unproven]])).rows as Array<{ id: number; utc: string }>;
      const byId = new Map(rows.map(r => [Number(r.id), r.utc]));
      if (byId.get(old) !== '2026-05-10 11:00:00') problems.push(`the proven old void is ${byId.get(old)} UTC, expected 2026-05-10 11:00:00`);
      if (byId.get(unproven) !== wallClock) problems.push(`the unproven old void is ${byId.get(unproven)} UTC, expected unchanged ${wallClock}`);
      const recorded = await orm.select().from(legacyDateRepairs).where(and(eq(legacyDateRepairs.tableName, 'documents'), eq(legacyDateRepairs.repairKind, 'timezone')));
      if (recorded.length !== 1 || recorded[0]?.rowId !== old || recorded[0]?.oldValue !== '2026-05-10T14:30:00Z' || recorded[0]?.newValue !== '2026-05-10T11:00:00Z') {
        problems.push(`legacy_date_repairs holds ${JSON.stringify(recorded.map(r => [r.rowId, r.oldValue, r.newValue]))}, expected one row for the proven void`);
      }
      await pool.query(repair);
      if ((await orm.select().from(legacyDateRepairs).where(eq(legacyDateRepairs.repairKind, 'timezone'))).length !== 1) problems.push('running the repair again recorded another row');
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'void → now(); proven old void moved 3.5 h back and recorded; unproven kept; second run no change';
    }));
  }

  return results;
}
