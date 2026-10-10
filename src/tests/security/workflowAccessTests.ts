import { TestCaseResult } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { draftSalesDocument, runCase, type Row, type Session, type ShouldRun } from './workflowTestHarness.js';

/**
 * بسته ۱۴ (گردش کار و تأییدات) — دسترسی و یکپارچگی موتور گردش‌کار در مسیرهای واقعی Express، با ورود واقعی (کوکی و CSRF)
 * و مجوزهایی که خود سرور از نقش می‌خواند؛ هیچ مجوزی دستی به سرویس داده نمی‌شود (درس TD-444: آزمون V8 همین را پنهان کرد).
 */

export async function runWorkflowAccessTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_workflow_start_entity_scope_td_443', 'security', 'td443', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_start_entity_scope_td_443',
      name: 'v9.0.33: a workflow starts only with an active definition of the same entity type and on an existing entity; an instance whose definition is of another type does not run the domain action (TD-443)',
      details: 'The document workflow on a journal voucher is 422 and the voucher stays draft; an unknown type or id and an object id are refused; a legacy mismatched instance is 409; a correct start on a document is 200',
    }, async (h, wrong) => {
      const { createTestVoucher } = await import('../fixtures/factories.js');
      const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
      const { voucher } = await createTestVoucher({ status: 'draft', date: await businessTodayIsoDate(), totalDebit: 5000000, totalCredit: 5000000 } as never);
      const seller = await h.sessionWith('sales_manager');

      // ۱) گردش‌کار اسناد روی سند حسابداری: ۴۲۲؛ اگر شروع شد، رفتن گام‌ها نباید سند را تأیید کند
      const start = await h.post('/api/workflow/start', { workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'journal_voucher', entityId: String(voucher.id) }, seller);
      if (start.status !== 422) {
        wrong.push(`Starting DOC_APPROVAL_WORKFLOW on a journal voucher returned ${start.status}, not 422`);
        const instanceId = Number(start.body?.data?.id);
        if (instanceId > 0) await h.walk(instanceId, ['submit_to_warehouse', 'approve_warehouse', 'approve_accounting'], seller);
      }
      const [after] = await h.q(`SELECT status FROM journal_vouchers WHERE id = $1`, [voucher.id]);
      if (after?.status !== 'draft') wrong.push(`The journal voucher became ${String(after?.status)} after the forged start`);

      // ۲) ورودی نادرست
      const unknownType = await h.post('/api/workflow/start', { workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'no_such_type', entityId: '999999999' });
      if (unknownType.status !== 422) wrong.push(`Unknown entity type returned ${unknownType.status}, not 422`);
      const missingDoc = await h.post('/api/workflow/start', { workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'document', entityId: '999999999' });
      if (missingDoc.status !== 404) wrong.push(`Missing document returned ${missingDoc.status}, not 404`);
      const objectId = await h.post('/api/workflow/start', { workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'document', entityId: { a: 1 } });
      if (objectId.status !== 400) wrong.push(`Object id returned ${objectId.status}, not 400`);
      const stored = await h.q(`SELECT count(*)::int AS n FROM workflow_instances WHERE entity_id IN ('999999999', '[object Object]')`);
      if (Number(stored[0]?.n) !== 0) wrong.push(`${String(stored[0]?.n)} workflow instances were created on a missing entity`);

      // ۳) فرایند ناهمخوانی که پیش از رفع ساخته شده: انتقال آن ۴۰۹ و سند دست‌نخورده
      const [docDef] = await h.q(`SELECT id, version FROM workflow_definitions WHERE code = 'DOC_APPROVAL_WORKFLOW'`);
      const [initial] = await h.q(`SELECT id FROM workflow_states WHERE workflow_definition_id = $1 AND state_type = 'initial' ORDER BY id LIMIT 1`, [docDef?.id]);
      const { voucher: legacyVoucher } = await createTestVoucher({ status: 'draft', date: await businessTodayIsoDate(), totalDebit: 1000, totalCredit: 1000 } as never);
      const [legacy] = await h.q(
        `INSERT INTO workflow_instances (workflow_definition_id, definition_version, entity_type, entity_id, current_state_id, status, started_by_name)
         VALUES ($1, $2, 'journal_voucher', $3, $4, 'IN_PROGRESS', 'آزمون') RETURNING id`,
        [docDef?.id, docDef?.version ?? 1, String(legacyVoucher.id), initial?.id],
      );
      const adminWalk = await h.walk(Number(legacy?.id), ['submit_to_warehouse', 'approve_warehouse', 'approve_accounting'], h.admin);
      if (adminWalk[0] !== 409) wrong.push(`Transition of the legacy mismatched instance returned ${adminWalk.join(',')}, not 409`);
      const [legacyAfter] = await h.q(`SELECT status FROM journal_vouchers WHERE id = $1`, [legacyVoucher.id]);
      if (legacyAfter?.status !== 'draft') wrong.push(`The journal voucher of the mismatched instance became ${String(legacyAfter?.status)}`);
      const widget = await h.get(`/api/workflow/instance/journal_voucher/${legacyVoucher.id}`);
      if (widget.body?.instance) wrong.push('The journal voucher widget showed the mismatched instance');

      // ۴) شروع درست: گردش‌کار اسناد روی سند پیش‌نویس موجود
      const docId = await draftSalesDocument(h);
      const ok = await h.post('/api/workflow/start', { workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'document', entityId: docId });
      if (ok.status !== 200 || !(Number(ok.body?.data?.id) > 0)) wrong.push(`Correct start on a document returned ${ok.status}: ${JSON.stringify(ok.body).slice(0, 160)}`);
    });
  }

  if (shouldRun('sec_workflow_signer_permissions_td_444', 'security', 'td444', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_signer_permissions_td_444',
      name: 'v9.0.34: the engine reads the signer role permissions itself and the inbox follows the widget rule; a design permission does not sign the steps of others (TD-444)',
      details: 'The CFO sees and executes the journal voucher task in the inbox; the warehouse record permission opens the "warehouse record" step; workflow.manage/admin neither sees nor executes the accounting step',
    }, async (h, wrong) => {
      const { createTestVoucher, createTestWorkflow } = await import('../fixtures/factories.js');
      const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
      const tasksOf = async (s: Session, instanceId: number): Promise<Row[]> => {
        const res = await h.get('/api/workflow/tasks/my-tasks?limit=1000', s);
        const rows = Array.isArray(res.body?.data) ? (res.body.data as Row[]) : [];
        return rows.filter(t => Number(t.instanceId ?? (t.instance as Row | undefined)?.id) === instanceId);
      };

      // ۱) گردش‌کار سند حسابداری (گام‌ها با مجوز accounting.vouchers، از v9.0.128 بی نقش): مدیر مالی آن مجوز را دارد
      const { voucher } = await createTestVoucher({ status: 'draft', date: await businessTodayIsoDate(), totalDebit: 2000000, totalCredit: 2000000 } as never);
      const started = await h.post('/api/workflow/start', { workflowCode: 'JOURNAL_VOUCHER_WORKFLOW', entityType: 'journal_voucher', entityId: voucher.id });
      const voucherInstance = Number(started.body?.data?.id);
      if (!(voucherInstance > 0)) throw new Error(`Starting the journal voucher workflow returned ${started.status}: ${JSON.stringify(started.body).slice(0, 160)}`);

      const designer = await h.sessionWith(['workflow.view', 'workflow.approve', 'workflow.manage', 'workflow.admin']);
      const designerTasks = await tasksOf(designer, voucherInstance);
      if (designerTasks.length > 0) wrong.push('A design permission holder saw the accountant task in the inbox');
      const [anyTask] = await h.q(`SELECT id FROM workflow_tasks WHERE instance_id = $1 AND status = 'pending' ORDER BY id LIMIT 1`, [voucherInstance]);
      if (anyTask) {
        const designerExec = await h.post(`/api/workflow/tasks/${String(anyTask.id)}/execute`, { action: 'approve' }, designer);
        if (designerExec.status !== 403) wrong.push(`Executing the accountant task with a design permission returned ${designerExec.status}, not 403`);
      } else {
        wrong.push('The journal voucher instance created no pending task');
      }
      const designerWalk = await h.walk(voucherInstance, ['approve_voucher'], designer);
      if (designerWalk[0] !== 403) wrong.push(`The accountant action with a design permission returned ${designerWalk.join(',')}, not 403`);

      const cfo = await h.sessionWith('cfo_accountant');
      const stats = await h.get('/api/workflow/tasks/stats', cfo);
      if (!(Number(stats.body?.pendingCount) > 0)) wrong.push(`The CFO inbox stats are ${String(stats.body?.pendingCount)}`);
      const cfoTasks = await tasksOf(cfo, voucherInstance);
      if (cfoTasks.length === 0) {
        wrong.push('The CFO did not see the accountant task in the inbox');
      } else {
        const exec = await h.post(`/api/workflow/tasks/${String(cfoTasks[0].id)}/execute`, { action: 'approve' }, cfo);
        if (exec.status !== 200) wrong.push(`Executing the task from the CFO inbox returned ${exec.status}: ${JSON.stringify(exec.body).slice(0, 160)}`);
      }
      const [vAfter] = await h.q(`SELECT status FROM journal_vouchers WHERE id = $1`, [voucher.id]);
      if (vAfter?.status !== 'approved') wrong.push(`The journal voucher is ${String(vAfter?.status)} after the CFO executed the task`);

      // ۲) v9.0.128 (TD-542): گامی که مجوز ثبت انبار می‌خواهد (بی نقش): نقش تازه با همان مجوز آن را می‌بیند و اجرا می‌کند و
      // مجوز مشاهده انبار نه. پیش‌تر همین را گام نقش «انباردار» با هم‌ارزی مجوز ثبت بخش می‌داد که حذف شد
      const { definition } = await createTestWorkflow({ definition: { entityType: 'test_document' } });
      await h.q(`UPDATE workflow_transitions SET required_role = '', required_permission = 'warehouse.out' WHERE workflow_definition_id = $1`, [definition.id]);
      const docStart = await h.post('/api/workflow/start', { workflowCode: definition.code, entityType: 'test_document', entityId: `TD444-${h.tag}` });
      const docInstance = Number(docStart.body?.data?.id);
      if (!(docInstance > 0)) throw new Error(`Starting the test workflow returned ${docStart.status}`);
      const viewer = await h.sessionWith(['workflow.view', 'workflow.approve', 'warehouse.view']);
      const widget = await h.get(`/api/workflow/instance/test_document/TD444-${h.tag}`, viewer);
      if ((widget.body?.availableTransitions ?? []).length > 0) wrong.push('A warehouse view permission saw the action of the "warehouse record" step in the widget');
      const stockKeeper = await h.sessionWith(['workflow.view', 'workflow.approve', 'warehouse.view', 'warehouse.out']);
      const keeperTasks = await tasksOf(stockKeeper, docInstance);
      if (keeperTasks.length === 0) {
        wrong.push('The warehouse record permission holder did not see the "warehouse record" step in the inbox');
      } else {
        const exec = await h.post(`/api/workflow/tasks/${String(keeperTasks[0].id)}/execute`, { action: 'approve' }, stockKeeper);
        if (exec.status !== 200) wrong.push(`Executing the "warehouse record" step from the inbox returned ${exec.status}: ${JSON.stringify(exec.body).slice(0, 160)}`);
      }
      const keeperWalk = await h.walk(docInstance, ['approve'], stockKeeper);
      if (keeperWalk[0] !== 200) wrong.push(`The second action of the "warehouse record" step from the widget returned ${keeperWalk.join(',')}, not 200`);
      await h.q(`DELETE FROM workflow_tasks WHERE instance_id = $1`, [docInstance]).catch(() => undefined);
    });
  }

  if (shouldRun('sec_workflow_document_steps_permission_td_445', 'security', 'td445', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_document_steps_permission_td_445',
      name: 'v9.0.35: the warehouse and finance steps of the document workflow are guarded by permissions and finalizing from the workflow needs the document permission; an untouched installed definition is upgraded (TD-445)',
      details: 'Salesperson and treasurer get 403 at the warehouse step; an edited workflow without guards: the treasurer does not finalize and the health check lists it; the warehouse keeper and the CFO finalize the document',
    }, async (h, wrong) => {
      const { createTestWorkflow } = await import('../fixtures/factories.js');
      const { WorkflowDefinitionService } = await import('../../services/workflow/workflowDefinitionService.js');
      const { findUnguardedDocumentApprovals } = await import('../../services/workflow/docApprovalGuards.js');
      const docStatus = async (id: number) => (await h.q(`SELECT type, status FROM documents WHERE id = $1`, [id]))[0];
      const startDoc = async (code: string, docId: number, s: Session = h.admin) => {
        const res = await h.post('/api/workflow/start', { workflowCode: code, entityType: 'document', entityId: docId }, s);
        const id = Number(res.body?.data?.id);
        if (!(id > 0)) throw new Error(`Starting ${code} on document ${docId}: ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
        return id;
      };

      // ۰) تعریف پیش‌فرض به حالت seed پیشین برمی‌گردد و به‌روزرسانی نصب موجود اجرا می‌شود
      const [docDef] = await h.q(`SELECT id, version FROM workflow_definitions WHERE code = 'DOC_APPROVAL_WORKFLOW'`);
      const legacyGuards = `UPDATE workflow_transitions SET required_role = CASE WHEN action_key = 'direct_approve' THEN 'admin' ELSE '' END,
        required_permission = CASE WHEN action_key = 'direct_approve' THEN 'workflow.approve' ELSE '' END, is_initiator_only = 0 WHERE workflow_definition_id = $1`;
      await h.q(legacyGuards, [docDef?.id]);
      await h.q(`UPDATE workflow_transitions SET title = title || ' (ویرایش)' WHERE workflow_definition_id = $1 AND action_key = 'approve_accounting'`, [docDef?.id]);
      await WorkflowDefinitionService.seedDefaultWorkflows();
      const edited = await h.q(`SELECT required_permission FROM workflow_transitions WHERE workflow_definition_id = $1 AND action_key = 'approve_accounting'`, [docDef?.id]);
      if (edited[0]?.required_permission !== '') wrong.push('The edited workflow was changed automatically');
      const listed = await findUnguardedDocumentApprovals();
      if (!listed.some(r => r.definitionId === Number(docDef?.id))) wrong.push('The health check did not list the unguarded approval step of the edited workflow');
      await h.q(`UPDATE workflow_transitions SET title = replace(title, ' (ویرایش)', '') WHERE workflow_definition_id = $1`, [docDef?.id]);
      await WorkflowDefinitionService.seedDefaultWorkflows();
      const guards = await h.q(`SELECT action_key, required_role, required_permission FROM workflow_transitions WHERE workflow_definition_id = $1 ORDER BY id`, [docDef?.id]);
      const guardOf = (key: string) => guards.filter(g => g.action_key === key).map(g => `${String(g.required_role)}|${String(g.required_permission)}`).join(',');
      if (guardOf('approve_warehouse') !== '|warehouse.out') wrong.push(`Warehouse review guard ${guardOf('approve_warehouse')}`);
      if (guardOf('approve_accounting') !== '|accounting.vouchers') wrong.push(`Finance review guard ${guardOf('approve_accounting')}`);
      if (guardOf('direct_approve') !== '|workflow.admin') wrong.push(`Direct approval guard ${guardOf('direct_approve')}`);
      const [defAfter] = await h.q(`SELECT version FROM workflow_definitions WHERE id = $1`, [docDef?.id]);
      if (!(Number(defAfter?.version) > Number(docDef?.version))) wrong.push('The upgrade did not create a new definition version');
      if ((await findUnguardedDocumentApprovals()).some(r => r.definitionId === Number(docDef?.id))) wrong.push('The default workflow is still listed as unguarded after the upgrade');

      // ۱) فروشنده پیش‌فاکتور خودش را از گام انبار نمی‌گذراند
      const seller = await h.sessionWith('sales_manager');
      const proforma = await draftSalesDocument(h, 'proforma');
      const sellerWalk = await h.walk(await startDoc('DOC_APPROVAL_WORKFLOW', proforma, seller), ['submit_to_warehouse', 'approve_warehouse', 'approve_accounting'], seller);
      if (sellerWalk[1] !== 403) wrong.push(`The salesperson passed the warehouse step with ${sellerWalk.join(',')}`);
      if ((await docStatus(proforma))?.status !== 'proforma') wrong.push(`The salesperson proforma became ${JSON.stringify(await docStatus(proforma))}`);

      // ۲) خزانه‌دار: گام انبار ۴۰۳؛ در گردش کار ویرایش‌شده بی نگهبان هم قطعی‌سازی مجوز سند را می‌خواهد (ت۳)
      const treasurer = await h.sessionWith('treasurer');
      const draftA = await draftSalesDocument(h);
      // v10.0.85 (TD-1220): ارسال به انبار فقط با سازنده (این‌جا مدیر سیستم که فرایند را آغاز کرده)
      const instanceA = await startDoc('DOC_APPROVAL_WORKFLOW', draftA);
      await h.walk(instanceA, ['submit_to_warehouse'], h.admin);
      const treasurerWalk = [0, ...await h.walk(instanceA, ['approve_warehouse'], treasurer)];
      if (treasurerWalk[1] !== 403) wrong.push(`The treasurer passed the warehouse step with ${treasurerWalk.join(',')}`);
      const { definition: open } = await createTestWorkflow({ definition: { entityType: 'document', code: `WF445_${h.tag}` } });
      const draftB = await draftSalesDocument(h);
      const openWalk = await h.walk(await startDoc(open.code, draftB), ['submit', 'approve'], treasurer);
      if (openWalk[0] !== 200 || openWalk[1] !== 403) wrong.push(`The treasurer got ${openWalk.join(',')} in the unguarded workflow, not 200,403`);
      if ((await docStatus(draftB))?.status !== 'draft') wrong.push(`The treasurer document became ${JSON.stringify(await docStatus(draftB))}`);
      await h.q(`UPDATE workflow_definitions SET is_active = 0 WHERE id = $1`, [open.id]);

      // ۳) مسیر درست: انباردار گام انبار، مدیر مالی گام مالی؛ سند قطعی می‌شود
      const keeper = await h.sessionWith('warehouse_keeper');
      const cfo = await h.sessionWith('cfo_accountant');
      const draftC = await draftSalesDocument(h);
      const instanceC = await startDoc('DOC_APPROVAL_WORKFLOW', draftC);
      const okWalk = [...await h.walk(instanceC, ['submit_to_warehouse'], h.admin), ...await h.walk(instanceC, ['approve_warehouse'], keeper), ...await h.walk(instanceC, ['approve_accounting'], cfo)];
      if (okWalk.join(',') !== '200,200,200') wrong.push(`The warehouse keeper and CFO path returned ${okWalk.join(',')}`);
      const finalC = await docStatus(draftC);
      if (finalC?.status !== 'final') wrong.push(`The document after finance approval is ${JSON.stringify(finalC)}`);
    });
  }

  if (shouldRun('sec_workflow_start_failure_td_451', 'security', 'td451', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_start_failure_td_451',
      name: 'v9.0.36: a start error of an active workflow definition is not swallowed; a treasury account and an item get no opening voucher without approval (TD-451)',
      details: 'Active definition without an initial step for treasury account and item: the create is refused, and neither the account or item nor an opening voucher is created',
    }, async (h, wrong) => {
      const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
      // تعریف‌های فعال دیگر این دو نوع موقتاً غیرفعال می‌شوند تا تعریف خراب انتخاب شود
      const others = await h.q(`SELECT id FROM workflow_definitions WHERE entity_type IN ('bank_account', 'item') AND is_active = 1`);
      const otherIds = others.map(r => Number(r.id));
      if (otherIds.length > 0) await h.q(`UPDATE workflow_definitions SET is_active = 0 WHERE id = ANY($1::int[])`, [otherIds]);
      const broken = await h.q(
        `INSERT INTO workflow_definitions (code, title, entity_type, version, is_active)
         VALUES ($1, 'گردش کار خراب حساب خزانه', 'bank_account', 1, 1), ($2, 'گردش کار خراب کالا', 'item', 1, 1) RETURNING id`,
        [`WF451_BANK_${h.tag}`, `WF451_ITEM_${h.tag}`],
      );
      try {
        const title = `بانک آزمون ۴۵۱ ${h.tag}`;
        const [parent] = await h.q(`SELECT id FROM accounts WHERE code = '1003' AND is_deleted = 0`);
        const [ledger] = await h.q(
          `INSERT INTO accounts (code, name, level, parent_id, account_type, nature, is_system, is_active, is_deleted)
           VALUES ($1, $2, 'subsidiary', $3, 'asset', 'debit', 0, 1, 0) RETURNING id`,
          [`1003451${h.tag}`, title, parent?.id ?? null],
        );
        const bank = await h.post('/api/accounting/bank-accounts', { title, type: 'bank', bankName: 'ملت', currency: 'IRR', initialBalance: 7000000, accountId: ledger?.id });
        if (bank.status < 400) wrong.push(`Creating a treasury account with a broken workflow returned ${bank.status}`);
        const banks = await h.q(`SELECT id FROM bank_accounts WHERE title = $1 AND is_deleted = 0`, [title]);
        if (banks.length > 0) {
          wrong.push('A treasury account was created with a broken workflow');
          const vouchers = await h.q(`SELECT count(*)::int AS n FROM journal_vouchers WHERE is_deleted = 0 AND reference_module = 'treasury_opening' AND reference_id = $1`, [banks[0].id]);
          if (Number(vouchers[0]?.n) > 0) wrong.push('The treasury account opening voucher was issued without approval');
        }

        const code = `WF451-${h.tag}`;
        const item = await h.post('/api/items', {
          type: 'raw_material', name: `کالای آزمون ۴۵۱ ${h.tag}`, code, unit: 'عدد', category: 'دستبند',
          weighted_average_cost: 1000, [`stock_${await getDefaultWarehouseCode(orm)}`]: 5,
        });
        if (item.status < 400) wrong.push(`Creating an item with a broken workflow returned ${item.status}`);
        const created = await h.q(`SELECT id FROM items WHERE code = $1 AND is_deleted = 0`, [code]);
        if (created.length > 0) {
          wrong.push('An item was created with a broken workflow');
          const opening = await h.q(`SELECT count(*)::int AS n FROM journal_vouchers WHERE is_deleted = 0 AND reference_module = 'item_opening' AND reference_id = $1`, [created[0].id]);
          if (Number(opening[0]?.n) > 0) wrong.push('The item opening voucher was issued without approval');
        }
      } finally {
        await h.q(`UPDATE workflow_definitions SET is_active = 0 WHERE id = ANY($1::int[])`, [broken.map(r => Number(r.id))]);
        if (otherIds.length > 0) await h.q(`UPDATE workflow_definitions SET is_active = 1 WHERE id = ANY($1::int[])`, [otherIds]);
      }
    });
  }

  if (shouldRun('sec_workflow_single_open_instance_td_455', 'security', 'td455', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_single_open_instance_td_455',
      name: 'v9.0.37: concurrent starts for one entity create only one running instance and the database refuses a second open instance (TD-455)',
      details: 'Six concurrent starts on one document: one running instance; a direct insert of a second open instance is refused by the partial unique index',
    }, async (h, wrong) => {
      const docId = await draftSalesDocument(h);
      const starts = await Promise.all(Array.from({ length: 6 }, () =>
        h.post('/api/workflow/start', { workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'document', entityId: docId })));
      const statuses = starts.map(r => r.status);
      if (statuses.some(s => s !== 200)) wrong.push(`Concurrent starts returned ${statuses.join(',')}`);
      const open = await h.q(`SELECT id FROM workflow_instances WHERE entity_type = 'document' AND entity_id = $1 AND status = 'IN_PROGRESS'`, [String(docId)]);
      if (open.length !== 1) wrong.push(`${open.length} running instances were created for one document`);
      const ids = new Set(starts.map(r => Number(r.body?.data?.id)));
      if (ids.size !== 1) wrong.push(`Concurrent starts returned ${ids.size} different instances`);

      const [first] = open;
      if (first) {
        try {
          await h.q(
            `INSERT INTO workflow_instances (workflow_definition_id, definition_version, entity_type, entity_id, current_state_id, status, started_by_name)
             SELECT workflow_definition_id, definition_version, entity_type, entity_id, current_state_id, 'IN_PROGRESS', 'آزمون' FROM workflow_instances WHERE id = $1`,
            [first.id],
          );
          wrong.push('The database accepted a second running instance for the same document');
        } catch (err) {
          if ((err as { code?: string }).code !== '23505') wrong.push(`Inserting the second instance raised another error: ${String(err)}`);
        }
      }
    });
  }

  if (shouldRun('sec_workflow_instance_entity_read_td_458', 'security', 'td458', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_instance_entity_read_td_458',
      name: 'v9.0.38: the workflow widget gives entity data only to holders of the read permission of that entity (TD-458)',
      details: 'Workflow viewer without accounting permission: journal voucher 403 and its widget 403 too; with accounting.view 200; treasury account and item likewise with their own read permission',
    }, async (h, wrong) => {
      const { createTestVoucher } = await import('../fixtures/factories.js');
      const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
      const { voucher } = await createTestVoucher({ status: 'draft', date: await businessTodayIsoDate(), totalDebit: 7777777, totalCredit: 7777777 } as never);
      const started = await h.post('/api/workflow/start', { workflowCode: 'JOURNAL_VOUCHER_WORKFLOW', entityType: 'journal_voucher', entityId: voucher.id });
      if (started.status !== 200) throw new Error(`Starting the journal voucher workflow returned ${started.status}`);

      const viewer = await h.sessionWith(['workflow.view']);
      const direct = await h.get(`/api/accounting/vouchers/${voucher.id}`, viewer);
      if (direct.status !== 403) wrong.push(`Direct read of the journal voucher returned ${direct.status}, not 403`);
      const widget = await h.get(`/api/workflow/instance/journal_voucher/${voucher.id}`, viewer);
      if (widget.status !== 403) wrong.push(`The journal voucher widget for a viewer without accounting permission returned ${widget.status}, not 403`);
      if (JSON.stringify(widget.body ?? {}).includes('7777777')) wrong.push('The widget gave the journal voucher debit total to a viewer without permission');
      for (const [type, id] of [['bank_account', '1'], ['item', '1'], ['purchase_requisition', '1']] as const) {
        const res = await h.get(`/api/workflow/instance/${type}/${id}`, viewer);
        if (res.status !== 403) wrong.push(`Widget "${type}" for a viewer without read permission returned ${res.status}, not 403`);
      }

      const reader = await h.sessionWith(['workflow.view', 'accounting.view']);
      const allowed = await h.get(`/api/workflow/instance/journal_voucher/${voucher.id}`, reader);
      if (allowed.status !== 200 || !allowed.body?.instance) wrong.push(`The journal voucher widget for an accounting.view holder returned ${allowed.status}`);
    });
  }

  return results;
}
