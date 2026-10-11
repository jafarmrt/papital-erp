import { TestCaseResult } from '../types.js';
import { draftSalesDocument, runCase, type Row, type Session, type ShouldRun } from './workflowTestHarness.js';

/**
 * v10.0.120 (TD-1220، یافته B-01 آزمون راهنما): «ارسال به انبار جهت تایید اقلام» و «بازگشایی مجدد جهت اصلاح» در گردش کار
 * پیش‌فرض اسناد نگهبان نداشتند؛ خریدار (دارنده documents.create برای سند خرید) پیش‌فاکتور فروشنده دیگر را به انبار
 * می‌فرستاد و هر کاربر گردش کار سند ردشده را باز می‌کرد. ارسال حالا documents.create و «فقط آغازکننده» می‌خواهد
 * (فروشنده پیش‌فاکتور خودش را می‌فرستد، ت۳) و بازگشایی documents.edit.
 */
export async function runDocSubmitGuardTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_doc_submit_initiator_only_td_1220', 'security', 'td1220', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_doc_submit_initiator_only_td_1220',
      name: 'v10.0.120: only the creator of a sales document sends it to the warehouse and reopening a rejected one needs documents.edit; an untouched installed definition is upgraded (TD-1220)',
      details: 'A buyer holding documents.create gets 403 on another user\'s proforma and is not offered the action; the creator sends it; reopen without documents.edit is 403, with it 200; an edited definition stays and is listed by the health check',
    }, async (h, wrong) => {
      const { WorkflowDefinitionService } = await import('../../services/workflow/workflowDefinitionService.js');
      const { findUnguardedDocumentSteps } = await import('../../services/accounting/unguardedDocumentStepHealth.js');
      const { orm } = await import('../../db/drizzle.js');
      const startDoc = async (docId: number, s: Session) => {
        const res = await h.post('/api/workflow/start', { workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'document', entityId: docId }, s);
        const id = Number(res.body?.data?.id);
        if (!(id > 0)) throw new Error(`Starting the document workflow on ${docId}: ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
        return id;
      };
      const guardsOf = async (defId: unknown) => {
        const rows = await h.q(`SELECT action_key, required_permission, is_initiator_only FROM workflow_transitions WHERE workflow_definition_id = $1 ORDER BY id`, [defId]);
        return (key: string) => rows.filter((r: Row) => r.action_key === key).map((r: Row) => `${String(r.required_permission)}|${String(r.is_initiator_only)}`).join(',');
      };

      // ۰) تعریف پیش‌فرض به نگهبان‌های v9.0.35 برمی‌گردد؛ ویرایش‌شده دست نمی‌خورد و فهرست می‌شود، دست‌نخورده ارتقا می‌یابد
      const [docDef] = await h.q(`SELECT id, version FROM workflow_definitions WHERE code = 'DOC_APPROVAL_WORKFLOW'`);
      await h.q(`UPDATE workflow_transitions SET required_permission = '', is_initiator_only = 0
        WHERE workflow_definition_id = $1 AND action_key IN ('submit_to_warehouse', 'reopen')`, [docDef?.id]);
      await h.q(`UPDATE workflow_transitions SET title = title || ' (ویرایش)' WHERE workflow_definition_id = $1 AND action_key = 'reopen'`, [docDef?.id]);
      await WorkflowDefinitionService.seedDefaultWorkflows();
      if ((await guardsOf(docDef?.id))('submit_to_warehouse') !== '|0') wrong.push('The edited workflow was changed automatically');
      if (!(await findUnguardedDocumentSteps(orm)).some(r => r.definitionId === Number(docDef?.id))) wrong.push('The health check did not list the unguarded steps of the edited workflow');
      await h.q(`UPDATE workflow_transitions SET title = replace(title, ' (ویرایش)', '') WHERE workflow_definition_id = $1`, [docDef?.id]);
      await WorkflowDefinitionService.seedDefaultWorkflows();
      const guard = await guardsOf(docDef?.id);
      if (guard('submit_to_warehouse') !== 'documents.create|1') wrong.push(`Send to warehouse guard ${guard('submit_to_warehouse')}`);
      if (guard('reopen') !== 'documents.edit|0') wrong.push(`Reopen guard ${guard('reopen')}`);
      const [defAfter] = await h.q(`SELECT version FROM workflow_definitions WHERE id = $1`, [docDef?.id]);
      if (!(Number(defAfter?.version) > Number(docDef?.version))) wrong.push('The upgrade did not create a new definition version');
      if ((await findUnguardedDocumentSteps(orm)).some(r => r.definitionId === Number(docDef?.id))) wrong.push('The default workflow is still listed after the upgrade');

      const seller = await h.sessionWith(['documents.view', 'documents.create', 'documents.edit', 'workflow.view', 'workflow.execute']);
      const buyer = await h.sessionWith(['documents.view', 'documents.create', 'workflow.view', 'workflow.execute']);
      const keeper = await h.sessionWith(['warehouse.view', 'warehouse.out', 'workflow.view', 'workflow.execute']);
      const noEdit = await h.sessionWith(['documents.view', 'workflow.view', 'workflow.execute']);

      // ۱) خریدار با documents.create پیش‌فاکتور فروشنده دیگر را نمی‌فرستد و اقدام به او پیشنهاد نمی‌شود
      const proforma = await draftSalesDocument(h, 'proforma');
      const instance = await startDoc(proforma, seller);
      const offered = await h.get(`/api/workflow/instance/document/${proforma}`, buyer);
      const offeredKeys = ((offered.body?.data?.availableTransitions ?? offered.body?.availableTransitions ?? []) as Row[]).map(t => t.actionKey);
      if (offeredKeys.includes('submit_to_warehouse')) wrong.push('The buyer was offered sending another user\'s proforma');
      const buyerWalk = await h.walk(instance, ['submit_to_warehouse'], buyer);
      if (buyerWalk[0] !== 403) wrong.push(`The buyer sent another user's proforma with ${buyerWalk.join(',')}`);

      // ۲) سازنده پیش‌فاکتور خودش را می‌فرستد؛ انبار رد می‌کند
      const sellerWalk = await h.walk(instance, ['submit_to_warehouse'], seller);
      if (sellerWalk[0] !== 200) wrong.push(`The creator could not send their own proforma: ${sellerWalk.join(',')}`);
      const rejectWalk = await h.walk(instance, ['reject'], keeper);
      if (rejectWalk[0] !== 200) wrong.push(`The warehouse keeper could not reject: ${rejectWalk.join(',')}`);

      // ۳) بازگشایی بی documents.edit ۴۰۳ است و با آن ۲۰۰
      const noEditWalk = await h.walk(instance, ['reopen'], noEdit);
      if (noEditWalk[0] !== 403) wrong.push(`Reopen without documents.edit returned ${noEditWalk.join(',')}`);
      const reopenWalk = await h.walk(instance, ['reopen'], seller);
      if (reopenWalk[0] !== 200) wrong.push(`Reopen with documents.edit returned ${reopenWalk.join(',')}`);
    });
  }

  return results;
}
