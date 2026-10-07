import { orm } from '../../db/drizzle.js';
import { TestCaseResult } from '../types.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';

/**
 * بسته ۲ (مدل مجوز)، M3 — ثبت و قطعی کردن سند با مجوز نوع سند (TD-541، TD-771)، از مسیرهای واقعی Express با ورود
 * واقعی. هر آزمون روی کد پیشین قرمز است.
 */

export async function runAccessPackageTwoDocumentTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_document_permission_matrix_td_541', 'security', 'td541', 'td771', 'documents', 'permissions', 'package2')) {
    await runCase(results, {
      id: 'sec_document_permission_matrix_td_541',
      name: 'v9.0.108: recording and finalizing a document asks the permission of its type and status, never the role code; the workflow approval step asks the same (TD-541, TD-771)',
      details: 'a custom role with warehouse.in records a final receipt but no waste draft and cannot finalize a waste; a sales role keeps its draft a draft and cannot finalize its proforma; documents.finalize records and finalizes sales documents; audit.apply records a stock count and the seed accountant no longer does; the workflow approval step needs documents.finalize for a sales document',
    }, async (h, wrong) => {
      const { createTestItem, createTestWorkflow } = await import('../fixtures/factories.js');
      const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
      const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
      const { draftSalesDocument } = await import('./workflowTestHarness.js');
      const wh = String(await getDefaultWarehouseCode(orm));
      const today = await businessTodayIsoDate();
      const item = await createTestItem({ type: 'product', stocks: { [wh]: 100 }, weightedAverageCost: 10_000, code: `P2DOC-${h.tag}` } as never);
      const body = (docType: string, status: string, extra: Record<string, unknown> = {}) => ({
        docType, status, refNumber: 'auto', date: today, buyer_name: `طرف حساب ${h.tag}`,
        items: [{ itemId: item.id, quantity: 1, unit_price: 20_000, location: wh }], ...extra,
      });
      const stored = async (id: unknown) => (await h.q(`SELECT type, status FROM documents WHERE id = $1`, [Number(id)]))[0];
      const persian = (res: { body?: { error?: unknown; message?: unknown } }) => /[؀-ۿ]/.test(String(res.body?.error ?? res.body?.message ?? ''));
      const adminDoc = async (docType: string, status: string, extra: Record<string, unknown> = {}) => {
        const res = await h.post('/api/documents', body(docType, status, extra));
        if (res.status !== 200) throw new Error(`the admin could not record ${docType}/${status}: ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
        return Number(res.body?.docId);
      };

      // 1) warehouse.in only: final receipt yes; a waste (stock out) neither as a draft nor through finalize
      const inOnly = await h.sessionWith(['warehouse.view', 'warehouse.in']);
      const receipt = await h.post('/api/documents', body('receipt', 'final', { inOut: 'in' }), inOnly);
      if (receipt.status !== 200) wrong.push(`warehouse.in recorded a final receipt with ${receipt.status}: ${JSON.stringify(receipt.body).slice(0, 160)}`);
      const wasteDraft = await h.post('/api/documents', body('waste', 'draft', { inOut: 'out' }), inOnly);
      if (wasteDraft.status !== 403) wrong.push(`warehouse.in recorded a waste draft with ${wasteDraft.status}, not 403`);
      else if (!persian(wasteDraft)) wrong.push('the refusal of the waste draft is not Persian');
      const adminWaste = await adminDoc('waste', 'draft', { inOut: 'out' });
      const wasteFinalize = await h.put(`/api/documents/${adminWaste}/finalize`, {}, inOnly);
      if (wasteFinalize.status !== 403) wrong.push(`warehouse.in finalized a waste with ${wasteFinalize.status}, not 403`);
      if ((await stored(adminWaste))?.status !== 'draft') wrong.push('the waste draft changed status after a refused finalize');

      // 2) a sales role without documents.finalize: its draft stays a draft, its proforma is not finalized
      const seller = await h.sessionWith(['documents.view', 'documents.create', 'documents.edit']);
      const draft = await h.post('/api/documents', body('invoice', 'draft'), seller);
      const draftRow = draft.status === 200 ? await stored(draft.body?.docId) : undefined;
      if (draftRow?.type !== 'invoice' || draftRow?.status !== 'draft') wrong.push(`a seller's draft invoice was stored as ${JSON.stringify(draftRow)} (${draft.status})`);
      const sellerFinal = await h.post('/api/documents', body('invoice', 'final'), seller);
      if (sellerFinal.status !== 403) wrong.push(`a seller recorded a final invoice with ${sellerFinal.status}, not 403`);
      const sellerProforma = await h.post('/api/documents', body('invoice', 'proforma'), seller);
      const proformaId = Number(sellerProforma.body?.docId);
      const proformaRow = await stored(proformaId);
      if (proformaRow?.type !== 'proforma' || proformaRow?.status !== 'proforma') wrong.push(`a seller's proforma was stored as ${JSON.stringify(proformaRow)}, not proforma/proforma as before`);
      const sellerFinalize = await h.put(`/api/documents/${proformaId}/finalize`, {}, seller);
      if (sellerFinalize.status !== 403) wrong.push(`a seller finalized its proforma with ${sellerFinalize.status}, not 403`);
      if ((await stored(proformaId))?.status !== 'proforma') wrong.push('the seller proforma changed after a refused finalize');

      // 3) documents.finalize: final invoice, finalize a proforma; its own proforma keeps the invoice type
      const finalizer = await h.sessionWith(['documents.view', 'documents.create', 'documents.finalize']);
      const finalInvoice = await h.post('/api/documents', body('invoice', 'final'), finalizer);
      if (finalInvoice.status !== 200 || (await stored(finalInvoice.body?.docId))?.status !== 'final') wrong.push(`documents.finalize recorded a final invoice with ${finalInvoice.status}: ${JSON.stringify(finalInvoice.body).slice(0, 160)}`);
      const finalizeProforma = await h.put(`/api/documents/${proformaId}/finalize`, {}, finalizer);
      if (finalizeProforma.status !== 200) wrong.push(`documents.finalize finalized a proforma with ${finalizeProforma.status}: ${JSON.stringify(finalizeProforma.body).slice(0, 160)}`);
      const ownProforma = await h.post('/api/documents', body('invoice', 'proforma'), finalizer);
      const ownRow = await stored(ownProforma.body?.docId);
      if (ownRow?.type !== 'invoice' || ownRow?.status !== 'proforma') wrong.push(`a finalizer's proforma was stored as ${JSON.stringify(ownRow)}, not invoice/proforma as before`);

      // 4) stock count: audit.apply yes, the seed accountant (documents.create, no audit.apply) no
      const [{ qty: book } = { qty: 0 }] = await h.q(`SELECT current_stock::float8 AS qty FROM items WHERE id = $1`, [item.id]);
      const countBody = body('audit', 'final', { location: wh, items: [{ itemId: item.id, quantity: Number(book), physical_stock: Number(book), system_stock: Number(book), location: wh }] });
      const auditor = await h.sessionWith(['warehouse.view', 'audit.view', 'audit.apply']);
      const auditorCount = await h.post('/api/documents', countBody, auditor);
      if (auditorCount.status !== 200) wrong.push(`audit.apply recorded a stock count with ${auditorCount.status}: ${JSON.stringify(auditorCount.body).slice(0, 160)}`);
      const accountant = await h.sessionWith('accountant');
      const accountantCount = await h.post('/api/documents', countBody, accountant);
      if (accountantCount.status !== 403) wrong.push(`the seed accountant recorded a stock count with ${accountantCount.status}, not 403`);
      const keeper = await h.sessionWith('warehouse_keeper');
      const keeperInvoice = await h.post('/api/documents', body('invoice', 'final'), keeper);
      if (keeperInvoice.status !== 200) wrong.push(`the seed warehouse keeper recorded a final invoice with ${keeperInvoice.status}`);

      // 5) workflow approval step: documents.edit with warehouse.in and warehouse.out no longer finalizes a sales document
      const { definition: open } = await createTestWorkflow({ definition: { entityType: 'document', code: `WF541_${h.tag}` } });
      try {
        const docId = await draftSalesDocument(h);
        const start = await h.post('/api/workflow/start', { workflowCode: open.code, entityType: 'document', entityId: docId });
        const instanceId = Number(start.body?.data?.id);
        if (!(instanceId > 0)) throw new Error(`starting the test workflow returned ${start.status}`);
        const oldKeys = await h.sessionWith(['workflow.view', 'workflow.approve', 'workflow.execute', 'documents.view', 'documents.edit', 'warehouse.view', 'warehouse.in', 'warehouse.out']);
        const oldWalk = await h.walk(instanceId, ['submit', 'approve'], oldKeys);
        if (oldWalk.join(',') !== '200,403') wrong.push(`documents.edit with warehouse.in/out walked the approval step with ${oldWalk.join(',')}, not 200,403`);
        if ((await stored(docId))?.status !== 'draft') wrong.push('the sales document was finalized through the workflow without documents.finalize');
        const finalizerSigner = await h.sessionWith(['workflow.view', 'workflow.approve', 'workflow.execute', 'documents.view', 'documents.finalize']);
        const okWalk = await h.walk(instanceId, ['approve'], finalizerSigner);
        if (okWalk.join(',') !== '200') wrong.push(`documents.finalize walked the approval step with ${okWalk.join(',')}, not 200`);
        if ((await stored(docId))?.status !== 'final') wrong.push('the approval step with documents.finalize did not finalize the document');
      } finally {
        await h.q(`UPDATE workflow_definitions SET is_active = 0 WHERE id = $1`, [open.id]);
      }
    });
  }

  if (shouldRun('sec_document_finalize_migration_td_541', 'security', 'td541', 'td771', 'permissions', 'package2', 'migration')) {
    await runCase(results, {
      id: 'sec_document_finalize_migration_td_541',
      name: 'v9.0.108: migration 0063 gives documents.finalize to the seed roles that finalized sales documents and to roles expanded from «*», and logs every change (TD-541)',
      details: 'seed manager, warehouse_keeper, accountant and cfo_accountant get documents.finalize; seed sales_manager and a custom role coded accountant do not; a role expanded from «*» by 0062 gets it while it holds documents.edit; one activity_logs row per changed role',
    }, async (h, wrong) => {
      const { runMigrationRolledBack } = await import('./workflowLifecycleTests.js');
      const starCode = `td541_star_${h.tag}`;
      const starIdle = `td541_idle_${h.tag}`;
      const seedCodes = ['manager', 'warehouse_keeper', 'cfo_accountant', 'sales_manager'];
      const outcome = await runMigrationRolledBack('0063_documents_finalize_permission.sql', async (q) => {
        await q(`UPDATE roles SET permissions = (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM jsonb_array_elements(permissions) e WHERE e <> '"documents.finalize"'), is_system = 1 WHERE code = ANY($1::text[])`, [seedCodes]);
        await q(`UPDATE roles SET permissions = '["documents.view","documents.create"]'::jsonb, is_system = 0 WHERE code = 'accountant'`);
        for (const [code, perms] of [[starCode, '["documents.view","documents.edit"]'], [starIdle, '["documents.view"]']] as const) {
          const [role] = await q(`INSERT INTO roles (name, code, permissions, is_system) VALUES ($1, $1, $2::jsonb, 0) RETURNING id`, [code, perms]);
          await q(`INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
                   VALUES ('system', 'سیستم', 'UPDATE', 'نقش و دسترسی', $1, 'td541', $2::jsonb, '', now())`,
            [String(role.id), JSON.stringify({ migration: '0062_role_code_guards_to_permissions', reason: 'wildcard' })]);
        }
      }, async (q) => ({
        roles: await q(`SELECT id, code, permissions FROM roles WHERE code = ANY($1::text[])`, [[...seedCodes, 'accountant', starCode, starIdle]]),
        logs: await q(`SELECT entity_id, details FROM activity_logs WHERE details->>'migration' = '0063_documents_finalize_permission' ORDER BY id`),
      }));
      const holds = (code: string) => ((outcome.roles.find(r => r.code === code)?.permissions ?? []) as string[]).includes('documents.finalize');
      for (const code of ['manager', 'warehouse_keeper', 'cfo_accountant', starCode]) if (!holds(code)) wrong.push(`${code} did not get documents.finalize`);
      for (const code of ['sales_manager', 'accountant', starIdle]) if (holds(code)) wrong.push(`${code} got documents.finalize`);
      const idOf = (code: string) => String(outcome.roles.find(r => r.code === code)?.id);
      const logged = outcome.logs.map(l => String(l.entity_id)).sort();
      const expected = ['manager', 'warehouse_keeper', 'cfo_accountant', starCode].map(idOf).sort();
      if (JSON.stringify(logged) !== JSON.stringify(expected)) wrong.push(`activity_logs rows for roles ${logged.join(', ')}, expected ${expected.join(', ')}`);
      const keeperLog = outcome.logs.find(l => l.entity_id === idOf('warehouse_keeper'))?.details as Record<string, unknown> | undefined;
      if (JSON.stringify(keeperLog?.addedPermissions) !== '["documents.finalize"]' || keeperLog?.reason !== 'seed_role') wrong.push(`warehouse_keeper log: ${JSON.stringify(keeperLog)}`);
    });
  }

  return results;
}
