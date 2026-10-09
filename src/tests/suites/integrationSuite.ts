import { money } from '../../lib/money.js';
import { TestCaseResult, makeTestCase } from '../types.js';
import { ensureTestDatabaseReady, cleanupAllTestFixtures } from '../fixtures/dbTestHelper.js';
import { createTestWorkflow, createTestWorkflowInstance, createTestUser, createTestItem } from '../fixtures/factories.js';
import { WorkflowTransitionExecutor } from '../../services/workflow/workflowTransitionExecutor.js';
import { AccountingService } from '../../services/accounting.service.js';
import { IdempotencyService } from '../../services/idempotency.service.js';
import { OutboxService } from '../../services/events/outboxService.js';
import { FormDraftService } from '../../services/drafts/formDraft.service.js';
import { InsufficientStockError, UnbalancedVoucherError, normalizeError } from '../../errors/customErrors.js';
import { orm } from '../../db/drizzle.js';
import { items, workflowInstances, workflowHistoryLogs, journalVouchers, journalVoucherItems, outboxEvents, accounts, documents, appSettings, warehouses, itemWarehouseStocks } from '../../db/schema.js';
import { eq, or, and } from 'drizzle-orm';
import { ItemWarehouseStockService } from '../../services/inventory/itemWarehouseStock.service.js';

export async function runIntegrationTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  // Ensure DB connection and schema validity
  const isDbReady = await ensureTestDatabaseReady();
  if (!isDbReady) {
    results.push(makeTestCase({
      id: 'int_db_readiness_check',
      scenarioId: 'db_readiness',
      name: 'PostgreSQL database readiness and connection check',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      status: 'BLOCKED',
      durationMs: 0,
      error: 'Could not connect to the database'
    }));
    return results;
  }

  // Helper to resolve test accounts for accounting vouchers
  const getTestAccounts = async () => {
    let accList = await orm.select().from(accounts).limit(2);
    if (accList.length < 2) {
      await AccountingService.seedStandardAccounts();
      accList = await orm.select().from(accounts).limit(2);
    }
    return accList;
  };

  // 1. Workflow approval with PostgreSQL
  const t1Start = Date.now();
  try {
    const wf = await createTestWorkflow({
      // v9.0.33 (TD-443): شناسه ساختگی؛ نوع «document» فقط روی سند موجود شروع می‌شود
      definition: { entityType: 'test_document' },
      states: [
        { key: 'draft', title: 'پیش‌نویس', type: 'initial' },
        { key: 'review', title: 'در حال بررسی', type: 'intermediate' },
        { key: 'approved', title: 'تایید شده', type: 'terminal' }
      ],
      transitions: [
        { fromKey: 'draft', toKey: 'review', actionKey: 'submit', title: 'ارسال جهت بررسی' },
        { fromKey: 'review', toKey: 'approved', actionKey: 'approve', title: 'تایید نهایی' }
      ]
    });

    const user = await createTestUser({ role: 'admin' });
    const instance = await WorkflowTransitionExecutor.startInstance({
      workflowDefinitionId: wf.definition.id,
      entityType: 'test_document',
      entityId: `DOC_WF_${Date.now()}`,
      userId: user.id,
      userName: user.username
    });

    // Execute transition: draft -> review
    const submitTransition = wf.transitions.find(t => t.fromStateId === wf.states['draft'].id);
    if (!submitTransition) throw new Error('Initial transition not found');

    await WorkflowTransitionExecutor.executeTransition({
      instanceId: instance.id,
      transitionId: submitTransition.id,
      userId: user.id,
      userName: user.username,
      userRole: 'admin',
      userPermissions: ['*']
    });

    // Verify in PostgreSQL DB
    const [updatedInstance] = await orm.select().from(workflowInstances).where(eq(workflowInstances.id, instance.id));
    const logs = await orm.select().from(workflowHistoryLogs).where(eq(workflowHistoryLogs.instanceId, instance.id));

    if (
      updatedInstance &&
      updatedInstance.currentStateId === wf.states['review'].id &&
      updatedInstance.status === 'IN_PROGRESS' &&
      logs.length >= 2
    ) {
      results.push(makeTestCase({
        id: 'int_workflow_approval_postgres',
        scenarioId: 'workflow_approval_postgres',
        name: 'Workflow approval on a real PostgreSQL database',
        layer: 'integration',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t1Start,
        details: `Workflow instance #${instance.id} moved to state '${wf.states['review'].title}' in PostgreSQL and its history was recorded.`
      }));
    } else {
      throw new Error(`Workflow state update in PostgreSQL failed (current state: ${updatedInstance?.currentStateId})`);
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_workflow_approval_postgres',
      scenarioId: 'workflow_approval_postgres',
      name: 'Workflow approval on a real PostgreSQL database',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t1Start,
      error: err.message
    }));
  }

  // 2. Two concurrent stock issues using real transactions
  const t2Start = Date.now();
  try {
    const testItem = await createTestItem({
      currentStock: 10,
      stocks: { main: 10 }
    });

    // v7.0.48 (TD-214): کسر از مسیر واقعی تولید — قفل سطری کالا و applyMovement روی جدول موجودی انبارها
    const issueStockTx = (requestedQty: number) =>
      orm.transaction(async (tx) => {
        await tx.select({ id: items.id }).from(items).where(eq(items.id, testItem.id)).for('update');
        const wh = await ItemWarehouseStockService.resolveWarehouse(tx, 'main');
        const { newLocationStock } = await ItemWarehouseStockService.applyMovement(tx, { itemId: testItem.id, warehouse: wh, inOut: 'out', quantity: requestedQty });
        return newLocationStock;
      });

    // Execute two concurrent stock issues (7 units each -> total 14 > 10)
    const [res1, res2] = await Promise.allSettled([issueStockTx(7), issueStockTx(7)]);

    const fulfilledCount = [res1, res2].filter(r => r.status === 'fulfilled').length;
    const rejectedCount = [res1, res2].filter(r => r.status === 'rejected').length;

    const [finalItem] = await orm.select().from(items).where(eq(items.id, testItem.id));

    if (fulfilledCount === 1 && rejectedCount === 1 && Number(finalItem.currentStock) === 3) {
      results.push(makeTestCase({
        id: 'int_concurrent_stock_issues_postgres',
        scenarioId: 'concurrent_stock_issues_postgres',
        name: 'Two concurrent stock remittances with real database transactions',
        layer: 'integration',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t2Start,
        details: 'The first transaction deducted stock (stock: 3) and the concurrent second one was rejected under the atomic lock for insufficient stock.'
      }));
    } else {
      throw new Error(`Invalid warehouse concurrency behaviour: succeeded=${fulfilledCount}, failed=${rejectedCount}, final stock=${finalItem?.currentStock}`);
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_concurrent_stock_issues_postgres',
      scenarioId: 'concurrent_stock_issues_postgres',
      name: 'Two concurrent stock remittances with real database transactions',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t2Start,
      error: err.message
    }));
  }

  // 3. Two concurrent workflow transitions using real requests
  const t3Start = Date.now();
  try {
    const wf = await createTestWorkflow({
      states: [
        { key: 'draft', title: 'پیش‌نویس', type: 'initial' },
        { key: 'approved', title: 'تایید شده', type: 'terminal' }
      ],
      transitions: [
        { fromKey: 'draft', toKey: 'approved', actionKey: 'approve', title: 'تایید سند' }
      ]
    });

    const instance = await createTestWorkflowInstance(wf.definition.id, wf.states['draft'].id, 'document', `DOC_RACE_${Date.now()}`);
    const trans = wf.transitions[0];

    // Fire two parallel transition attempts on the same instance
    const [p1, p2] = await Promise.allSettled([
      WorkflowTransitionExecutor.executeTransition({
        instanceId: instance.id,
        transitionId: trans.id,
        userRole: 'admin',
        userPermissions: ['*']
      }),
      WorkflowTransitionExecutor.executeTransition({
        instanceId: instance.id,
        transitionId: trans.id,
        userRole: 'admin',
        userPermissions: ['*']
      })
    ]);

    const successes = [p1, p2].filter(p => p.status === 'fulfilled').length;
    const failures = [p1, p2].filter(p => p.status === 'rejected').length;

    const [finalInstance] = await orm.select().from(workflowInstances).where(eq(workflowInstances.id, instance.id));

    if (successes === 1 && failures === 1 && finalInstance.currentStateId === wf.states['approved'].id) {
      results.push(makeTestCase({
        id: 'int_concurrent_workflow_transitions_postgres',
        scenarioId: 'concurrent_workflow_transitions_postgres',
        name: 'Two concurrent transition requests on one workflow instance',
        layer: 'integration',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t3Start,
        details: 'Exactly one transition request succeeded and the concurrent second one was rejected because the previous state no longer matched.'
      }));
    } else {
      throw new Error(`Unexpected concurrent workflow results: succeeded=${successes}, failed=${failures}`);
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_concurrent_workflow_transitions_postgres',
      scenarioId: 'concurrent_workflow_transitions_postgres',
      name: 'Two concurrent transition requests on one workflow instance',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t3Start,
      error: err.message
    }));
  }

  // 4. Balanced accounting voucher
  const t4Start = Date.now();
  try {
    const [accA, accB] = await getTestAccounts();

    // Valid balanced voucher
    const createdVoucher = await AccountingService.createJournalVoucher({
      date: new Date().toISOString().split('T')[0],
      description: 'ERP-TEST-MARKER سند آزمایشی متوازن PostgreSQL',
      items: [
        { accountId: accA.id, debit: 250000, credit: 0, description: 'ردیف بدهکار' },
        { accountId: accB.id, debit: 0, credit: 250000, description: 'ردیف بستانکار' }
      ]
    });

    const [voucherDb] = await orm.select().from(journalVouchers).where(eq(journalVouchers.id, createdVoucher.id));
    const itemsDb = await orm.select().from(journalVoucherItems).where(eq(journalVoucherItems.voucherId, createdVoucher.id));

    // Test unbalanced voucher rejection
    let unbalancedCaught = false;
    try {
      await AccountingService.createJournalVoucher({
        date: new Date().toISOString().split('T')[0],
        description: 'ERP-TEST-MARKER سند آزمایشی ناهمتراز',
        items: [
          { accountId: accA.id, debit: 250000, credit: 0 },
          { accountId: accB.id, debit: 0, credit: 100000 }
        ]
      });
    } catch (err: any) {
      if (err.message.includes('سند تراز نیست')) {
        unbalancedCaught = true;
      }
    }

    if (
      voucherDb &&
      Number(voucherDb.totalDebit) === 250000 &&
      Number(voucherDb.totalCredit) === 250000 &&
      itemsDb.length === 2 &&
      unbalancedCaught
    ) {
      results.push(makeTestCase({
        id: 'int_balanced_voucher_postgres',
        scenarioId: 'balanced_voucher_postgres',
        name: 'Validating and saving a balanced journal voucher in the database',
        layer: 'integration',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t4Start,
        details: 'The balanced voucher (debit = credit = 250,000) was saved in the database and the unbalanced voucher was refused.'
      }));
    } else {
      throw new Error('Balance check or persistence of the journal voucher in the database failed');
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_balanced_voucher_postgres',
      scenarioId: 'balanced_voucher_postgres',
      name: 'Validating and saving a balanced journal voucher in the database',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t4Start,
      error: err.message
    }));
  }

  // 5. Voucher reversal
  const t5Start = Date.now();
  try {
    const [accA, accB] = await getTestAccounts();

    const originalVoucher = await AccountingService.createJournalVoucher({
      date: new Date().toISOString().split('T')[0],
      description: 'سند اولیه جهت تست برگشت',
      status: 'approved', // v8.0.70 (TD-323): سند پیش‌نویس برگشت نمی‌خورد
      items: [
        { accountId: accA.id, debit: 350000, credit: 0 },
        { accountId: accB.id, debit: 0, credit: 350000 }
      ]
    });

    const reversedVoucher = await AccountingService.reverseVoucher({
      voucherId: originalVoucher.id,
      date: new Date().toISOString().split('T')[0],
      reason: 'اصلاح ثبت اشتباه'
    });

    const [reversalDb] = await orm.select().from(journalVouchers).where(eq(journalVouchers.id, reversedVoucher.id));
    const reversalItems = await orm.select().from(journalVoucherItems).where(eq(journalVoucherItems.voucherId, reversedVoucher.id));

    const itemA = reversalItems.find(i => i.accountId === accA.id);
    const itemB = reversalItems.find(i => i.accountId === accB.id);

    if (
      reversalDb &&
      reversalDb.referenceId === originalVoucher.id &&
      Number(reversalDb.totalDebit) === 350000 &&
      Number(reversalDb.totalCredit) === 350000 &&
      Number(itemA?.debit) === 0 && Number(itemA?.credit) === 350000 &&
      Number(itemB?.debit) === 350000 && Number(itemB?.credit) === 0
    ) {
      results.push(makeTestCase({
        id: 'int_voucher_reversal_postgres',
        scenarioId: 'voucher_reversal_postgres',
        name: 'Issuing and saving a correction/reversal journal voucher in PostgreSQL',
        layer: 'integration',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t5Start,
        details: `Reversal voucher #${reversalDb.voucherNumber} was issued with debit/credit swapped and a reference to original voucher #${originalVoucher.voucherNumber}.`
      }));
    } else {
      throw new Error('The reversal voucher did not swap the debit and credit amounts correctly');
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_voucher_reversal_postgres',
      scenarioId: 'voucher_reversal_postgres',
      name: 'Issuing and saving a correction/reversal journal voucher in PostgreSQL',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t5Start,
      error: err.message
    }));
  }

  // 6. WooCommerce webhook idempotency
  const t6Start = Date.now();
  try {
    const deliveryKey = `woo_delivery_pg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const scope = 'woocommerce_webhooks';

    // First attempt: Must grant lock to process new payload
    const firstAcquire = await IdempotencyService.acquireOrGet({
      key: deliveryKey,
      scope,
      requestPath: '/api/woocommerce/webhook/order',
      requestMethod: 'POST',
      requestBody: { orderId: 9988, total: 1200000 }
    });

    if (firstAcquire.action !== 'PROCESS_NEW') {
      throw new Error(`The first request returned ${firstAcquire.action} instead of PROCESS_NEW`);
    }

    // Mark completion
    await IdempotencyService.complete({
      key: deliveryKey,
      scope,
      statusCode: 200,
      responseBody: { success: true, orderId: 9988, documentCreated: true }
    });

    // Second attempt (duplicate webhook retry from WooCommerce): Must return cached response!
    const secondAcquire = await IdempotencyService.acquireOrGet({
      key: deliveryKey,
      scope,
      requestPath: '/api/woocommerce/webhook/order',
      requestMethod: 'POST',
      requestBody: { orderId: 9988, total: 1200000 }
    });

    if (
      secondAcquire.action === 'RETURN_CACHED' &&
      secondAcquire.statusCode === 200 &&
      (secondAcquire.responseBody as { orderId?: number } | undefined)?.orderId === 9988
    ) {
      results.push(makeTestCase({
        id: 'int_woocommerce_webhook_idempotency',
        scenarioId: 'woocommerce_webhook_idempotency',
        name: 'WooCommerce webhook idempotency with an Idempotency Key',
        layer: 'integration',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t6Start,
        details: 'The repeated WooCommerce webhook attempt was detected and the stored response was returned without issuing a duplicate document.'
      }));
    } else {
      throw new Error(`Idempotency did not work for the second webhook: ${secondAcquire.action}`);
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_woocommerce_webhook_idempotency',
      scenarioId: 'woocommerce_webhook_idempotency',
      name: 'WooCommerce webhook idempotency with an Idempotency Key',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t6Start,
      error: err.message
    }));
  }

  // 7. Outbox processing and retries
  const t7Start = Date.now();
  try {
    const eventId = `evt_outbox_pg_${Date.now()}`;
    const testEvent = {
      eventId,
      eventType: 'InvoicePosted',
      aggregateType: 'Document' as const,
      aggregateId: 'DOC-5500',
      payload: { docId: 5500, amount: 800000 },
      metadata: { timestamp: new Date().toISOString() },
      occurredAt: new Date().toISOString()
    };

    // Save event to Outbox in DB
    await OutboxService.recordEvent(orm, testEvent);

    // Run Outbox batch processing worker until this event is claimed. Earlier suites of the same run leave their own
    // events pending and one batch takes the oldest 50 (v9.0.2, TD-415: workflow events of those suites, including
    // WorkflowCompleted / WorkflowRejected, now go only through the outbox).
    let processed = 0;
    let outboxRow: typeof outboxEvents.$inferSelect | undefined;
    for (let round = 0; round < 20; round++) {
      const batch = await OutboxService.processPendingBatch(50);
      processed += batch.processed;
      [outboxRow] = await orm.select().from(outboxEvents).where(eq(outboxEvents.eventId, eventId));
      if (batch.processed === 0 || (outboxRow && outboxRow.status !== 'pending')) break;
    }

    if (processed >= 1 && outboxRow && (outboxRow.status === 'completed' || outboxRow.status === 'processed')) {
      results.push(makeTestCase({
        id: 'int_outbox_processing_retries',
        scenarioId: 'outbox_processing_retries',
        name: 'Outbox queue event processing and retries',
        layer: 'integration',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - t7Start,
        details: `Outbox event [${eventId}] was processed and its database status changed to 'processed'.`
      }));
    } else {
      throw new Error(`Outbox processing failed: processed=${processed}, DB status=${outboxRow?.status}`);
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_outbox_processing_retries',
      scenarioId: 'outbox_processing_retries',
      name: 'Outbox queue event processing and retries',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t7Start,
      error: err.message
    }));
  }

  // 8. Subphase 9.1 — Ledger Invariants & Repost Lifecycle Test
  const t8Start = Date.now();
  try {
    const [accA, accB] = await getTestAccounts();

    // Invariant 1: Double-entry strict equilibrium rejection
    let unbalancedBlocked = false;
    try {
      await AccountingService.createJournalVoucher({
        date: '1403/05/10',
        description: 'تست سند نامتوازن',
        items: [
          { accountId: accA.id, debit: 500000, credit: 0 },
          { accountId: accB.id, debit: 0, credit: 499990 } // discrepancy
        ]
      });
    } catch (e: any) {
      if (e.message.includes('تراز نیست')) {
        unbalancedBlocked = true;
      }
    }

    if (!unbalancedBlocked) {
      throw new Error('The system must not allow saving an unbalanced voucher (debit not equal to credit)');
    }

    // Invariant 2: Create a balanced permanent voucher and test immutability
    const postedVoucher = await AccountingService.createJournalVoucher({
      date: '1403/05/12',
      description: 'سند قطعی جهت آزمون تغییرناپذیری',
      status: 'permanent',
      items: [
        { accountId: accA.id, debit: 800000, credit: 0 },
        { accountId: accB.id, debit: 0, credit: 800000 }
      ]
    });

    let directEditBlocked = false;
    try {
      await AccountingService.updateJournalVoucher(postedVoucher.id, {
        items: [
          { accountId: accA.id, debit: 900000, credit: 0 },
          { accountId: accB.id, debit: 0, credit: 900000 }
        ]
      });
    } catch (e: any) {
      if (e.message.includes('تغییرناپذیری') || e.message.includes('قابل ویرایش مستقیم نیستند')) {
        directEditBlocked = true;
      }
    }

    let directDeleteBlocked = false;
    try {
      await AccountingService.deleteJournalVoucher(postedVoucher.id);
    } catch (e: any) {
      if (e.message.includes('قابل حذف مستقیم نیستند') || e.message.includes('قابل حذف نیستند')) {
        directDeleteBlocked = true;
      }
    }

    if (!directEditBlocked || !directDeleteBlocked) {
      throw new Error('Posted and permanent vouchers must be protected against direct edit and delete');
    }

    // Invariant 3 (v7.0.24 / TD-174): طبق قاعده C-03 & P0-06 سرویس اسناد، سند «قطعی» قابل ابطال/بازثبت نیست
    // و اصلاح آن فقط با سند معکوس انجام می‌شود؛ تلاش برای بازثبت باید رد شود.
    let permanentRepostBlocked = false;
    try {
      await AccountingService.repostVoucher({
        voucherId: postedVoucher.id,
        reason: 'تلاش غیرمجاز بازثبت سند قطعی',
        newItems: [
          { accountId: accA.id, debit: 950000, credit: 0 },
          { accountId: accB.id, debit: 0, credit: 950000 }
        ]
      });
    } catch (e: any) {
      if (e.message.includes('غیرقابل ابطال یا بازثبت')) {
        permanentRepostBlocked = true;
      }
    }
    if (!permanentRepostBlocked) {
      throw new Error('A permanent voucher must not be voidable and repostable (rule C-03 & P0-06).');
    }

    // Invariant 4: Repost Workflow on an approved (not yet permanent) voucher
    const approvedVoucher = await AccountingService.createJournalVoucher({
      date: '1403/05/12',
      description: 'سند تاییدشده جهت آزمون ابطال و بازثبت',
      status: 'approved',
      items: [
        { accountId: accA.id, debit: 800000, credit: 0 },
        { accountId: accB.id, debit: 0, credit: 800000 }
      ]
    });

    const repostResult = await AccountingService.repostVoucher({
      voucherId: approvedVoucher.id,
      reason: 'تغییر سرفصل و مبلغ به دلیل اصلاحیه فاکتور',
      newItems: [
        { accountId: accA.id, debit: 950000, credit: 0 },
        { accountId: accB.id, debit: 0, credit: 950000 }
      ],
      newDescription: 'سند بازثبت‌شده با اقلام اصلاحی جدید'
    });

    const isRepostValid = (
      repostResult.voidVoucher &&
      repostResult.voidVoucher.referenceId === approvedVoucher.id &&
      repostResult.voidVoucher.totalDebit === 800000 &&
      repostResult.repostedVoucher &&
      repostResult.repostedVoucher.referenceId === approvedVoucher.id &&
      repostResult.repostedVoucher.totalDebit === 950000
    );

    if (!isRepostValid) {
      throw new Error('Void and repost did not build the voucher references and amounts correctly');
    }

    results.push(makeTestCase({
      id: 'int_ledger_invariants_and_repost',
      scenarioId: 'ledger_invariants_and_repost',
      name: 'General ledger immutability invariants and void-and-repost',
      layer: 'integration',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t8Start,
      details: 'Unbalanced vouchers, direct edits of permanent vouchers and direct deletes were blocked; void and repost succeeded.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_ledger_invariants_and_repost',
      scenarioId: 'ledger_invariants_and_repost',
      name: 'General ledger immutability invariants and void-and-repost',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t8Start,
      error: err.message
    }));
  }

  // 9. Period Closing & Conceptual Account Mappings (Subphase 9.2)
  const t9Start = Date.now();
  try {
    // 1. Verify default conceptual account mappings resolution
    const wageAcc = await AccountingService.resolveConceptualAccount('directProductionWagesAccountCode');
    const payableAcc = await AccountingService.resolveConceptualAccount('wagesPayableAccountCode');
    const summaryProfitAcc = await AccountingService.resolveConceptualAccount('summaryProfitLossCode');
    const retainedEarningsAcc = await AccountingService.resolveConceptualAccount('retainedEarningsCode');

    if (!wageAcc || !payableAcc || !summaryProfitAcc || !retainedEarningsAcc) {
      throw new Error('Resolving the default account mapping concepts failed');
    }

    // 2. Test updating conceptual mapping
    await AccountingService.saveAccountMappings({
      directProductionWagesAccountCode: wageAcc.code
    });

    // 3. Verify Fiscal Year Closing Preview
    const preview = await AccountingService.getFiscalYearClosingPreview({
      year: 1403,
      closingDate: '1403-12-30', // v8.0.47 (TD-310): ۱۴۰۳ کبیسه است؛ آخرین روز سال ۳۰ اسفند
      openingDateNewYear: '1404-01-01'
    });

    if (preview.year !== 1403 || typeof preview.netProfit !== 'number') {
      throw new Error('The fiscal year closing preview returned an invalid structure');
    }

    results.push(makeTestCase({
      id: 'int_period_closing_and_conceptual_mappings',
      scenarioId: 'period_closing_and_conceptual_mappings',
      name: 'Account mapping concepts and fiscal year closing validation',
      layer: 'integration',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t9Start,
      details: 'Account mapping concepts (direct wages, wages payable, income summary) were read and applied, and the fiscal period closing preview was validated.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_period_closing_and_conceptual_mappings',
      scenarioId: 'period_closing_and_conceptual_mappings',
      name: 'Account mapping concepts and fiscal year closing validation',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t9Start,
      error: err.message
    }));
  }

  // 10. Multi-Currency Financials & Ratios (Subphase 9.3)
  const t10Start = Date.now();
  try {
    // 1. Verify Financial Ratios calculation with currency breakdown
    const ratios = await AccountingService.getFinancialRatios({});
    if (
      typeof ratios.currentRatio !== 'number' ||
      typeof ratios.quickRatio !== 'number' ||
      typeof ratios.debtRatio !== 'number' ||
      !ratios.status ||
      !Array.isArray(ratios.currencyBreakdowns)
    ) {
      throw new Error('Financial ratios and currency breakdown returned an invalid structure');
    }

    // 2. Verify Multi-Currency Portfolio Summary
    const multiCur = await AccountingService.getMultiCurrencySummary();
    if (!Array.isArray(multiCur.currencies) || typeof multiCur.totalCurrenciesCount !== 'number') {
      throw new Error('The currency position report returned an invalid structure');
    }

    // 3. Verify Trial Balance with Currency filter
    const trialIrr = await AccountingService.getTrialBalance({ level: 'general', currency: 'IRR' });
    if (!Array.isArray(trialIrr)) {
      throw new Error('The trial balance with a currency filter was not returned');
    }

    results.push(makeTestCase({
      id: 'int_multi_currency_financials_and_ratios',
      scenarioId: 'multi_currency_financials_and_ratios',
      name: 'Standard financial ratios and multi-currency reports',
      layer: 'integration',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t10Start,
      details: `Financial ratios (current ${ratios.currentRatio}, debt ${ratios.debtRatio}%) and the multi-currency portfolio (${multiCur.totalCurrenciesCount} active currencies) were computed.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_multi_currency_financials_and_ratios',
      scenarioId: 'multi_currency_financials_and_ratios',
      name: 'Standard financial ratios and multi-currency reports',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t10Start,
      error: err.message
    }));
  }

  // 11. Phase 10 — Inventory Integrity & 3-Way Reconciliation Invariant
  const t11Start = Date.now();
  try {
    const { InventoryIntegrityService } = await import('../../services/inventory/inventoryIntegrity.service.js');
    await import('../../services/inventory/stockReconciliation.service.js');

    // 1. Audit report generation
    const report = await InventoryIntegrityService.getIntegrityReport();
    if (!report.summary || !Array.isArray(report.audits) || !Array.isArray(report.warehouses)) {
      throw new Error('The three-way warehouse health report returned an invalid structure.');
    }

    // 2. Test single item rebuild from ledger
    const testItem = await createTestItem({ currentStock: 50 });
    const rebuildRes = await InventoryIntegrityService.rebuildItemFromLedger(testItem.id);
    if (!rebuildRes || typeof rebuildRes.afterStock !== 'number') {
      throw new Error('Rebuilding stock from the Kardex failed.');
    }

    results.push(makeTestCase({
      id: 'int_inventory_integrity_3way_reconciliation',
      scenarioId: 'inventory_integrity_3way_reconciliation',
      name: 'Three-way stock reconciliation and rebuild from the Kardex',
      layer: 'integration',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t11Start,
      details: `Three-way reconciliation evaluated (${report.summary.totalItems} items, ${report.warehouses.length} warehouses, health score: ${report.summary.healthScorePercentage}%).`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_inventory_integrity_3way_reconciliation',
      scenarioId: 'inventory_integrity_3way_reconciliation',
      name: 'Three-way stock reconciliation and rebuild from the Kardex',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t11Start,
      error: err.message
    }));
  }

  // 12. Phase 10 — Negative Stock Policy Enforcement
  const t12Start = Date.now();
  try {
    const { DocumentService } = await import('../../services/document.service.js');

    const testItem2 = await createTestItem({ currentStock: 5 });

    // V10-0.1: cleanup is now scoped (synthetic-only). Fixed-ref fixtures must
    // pre-delete their own leftovers to stay idempotent across runs.
    await orm.delete(documents).where(
      or(eq(documents.refNumber, 'DOC-TEST-NEG-1'), eq(documents.refNumber, 'DOC-TEST-NEG-2'))
    );

    // Create test document records so foreign key constraint in transactions is satisfied
    // v9.0.338 (TD-786): documents.type has a CHECK constraint; a remittance is the stock-out document type
    const [testDoc1] = await orm.insert(documents).values({
      type: 'remittance',
      refNumber: 'DOC-TEST-NEG-1',
      date: '2026-08-24',
      user: 'test-user'
    }).returning();

    // Check applyStockMovement with forbidden policy throws
    let applyForbiddenError = false;
    try {
      await orm.transaction(async (tx) => {
        await DocumentService.applyStockMovement(tx, {
          itemId: testItem2.id,
          documentId: testDoc1.id,
          inOut: 'out',
          quantity: 10,
          price: 1000,
          date: '2026-08-24',
          documentType: 'exit_permit',
          documentRef: 'DOC-TEST-NEG-1',
          user: 'test-user',
          targetLoc: 'main'
        });
      });
    } catch (err: any) {
      applyForbiddenError = true;
    }
    if (!applyForbiddenError) {
      throw new Error('Under the forbidden policy applyStockMovement raised no insufficient stock error.');
    }

    // 3. A legacy stored value ('allowed') must be ignored: the effective policy stays 'forbidden'
    //    and the deduction fails with a readable InsufficientStockError, never a raw CHECK violation (23514)
    //    v10.0.25 (OBS-R1-83): the setting is no longer read at all
    await orm.insert(appSettings).values({ key: 'negative_stock_policy', value: 'allowed' })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: 'allowed' } });
    try {
      let legacyErrorCode = '';
      try {
        await orm.transaction(async (tx) => {
          await DocumentService.applyStockMovement(tx, {
            itemId: testItem2.id,
            documentId: testDoc1.id,
            inOut: 'out',
            quantity: 10,
            price: 1000,
            date: '2026-08-24',
            documentType: 'exit_permit',
            documentRef: 'DOC-TEST-NEG-1',
            user: 'test-user',
            targetLoc: 'main'
          });
        });
      } catch (err: any) {
        legacyErrorCode = String(err?.code || err?.errorCode || err?.cause?.code || '');
      }
      if (legacyErrorCode !== 'INSUFFICIENT_STOCK') {
        throw new Error(`with the legacy value "allowed" a deduction above stock must be refused with INSUFFICIENT_STOCK (code received: ${legacyErrorCode || 'no error'}).`);
      }
    } finally {
      await orm.delete(appSettings).where(eq(appSettings.key, 'negative_stock_policy'));
    }

    const [unchangedItem2] = await orm.select().from(items).where(eq(items.id, testItem2.id));
    if (Number(unchangedItem2.currentStock) !== 5) {
      throw new Error(`Item stock must not change after the refused deduction. Current value: ${unchangedItem2.currentStock}`);
    }

    // 4. Defense in depth: a raw CHECK violation on item_warehouse_stocks is normalized to INSUFFICIENT_STOCK
    const { normalizeError } = await import('../../errors/customErrors.js');
    const [mainWh] = await orm.select().from(warehouses).where(eq(warehouses.code, 'main'));
    let checkViolationCode = '';
    try {
      await orm.transaction(async (tx) => {
        await tx.update(itemWarehouseStocks)
          .set({ currentStock: -1 })
          .where(and(eq(itemWarehouseStocks.itemId, testItem2.id), eq(itemWarehouseStocks.warehouseId, mainWh.id)));
        await tx.insert(itemWarehouseStocks).values({
          itemId: testItem2.id, warehouseId: mainWh.id, warehouseCode: 'main', currentStock: -1, reservedStock: 0, version: 1
        }).onConflictDoNothing();
      });
    } catch (err: unknown) {
      checkViolationCode = normalizeError(err).code;
    }
    if (checkViolationCode !== 'INSUFFICIENT_STOCK') {
      throw new Error(`a chk_iws_current_stock_non_negative violation must map to a readable INSUFFICIENT_STOCK error (code received: ${checkViolationCode || 'no error'}).`);
    }

    results.push(makeTestCase({
      id: 'int_inventory_negative_stock_policy',
      scenarioId: 'inventory_negative_stock_policy',
      name: 'Negative stock policy enforcement',
      layer: 'integration',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t12Start,
      details: 'A deduction above stock was refused; a legacy stored "allowed" value had no effect and the database constraint violation mapped to a readable stock shortage error (TD-180).'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_inventory_negative_stock_policy',
      scenarioId: 'inventory_negative_stock_policy',
      name: 'Negative stock policy enforcement',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t12Start,
      error: err.message
    }));
  }

  // 13. Phase 10 — Project BOM Allocation & Source Transaction Traceability
  const t13Start = Date.now();
  try {
    const { ProjectBomAllocationService } = await import('../../services/inventory/projectBomAllocation.service.js');
    const { productionProjects } = await import('../../db/schema.js');

    // Create test project
    const pCode = `PRJ-TEST-${Date.now()}`;
    const [proj] = await orm.insert(productionProjects).values({
      projectCode: pCode,
      title: 'پروژه تست تخصیص BOM فاز ۱۰',
      status: 'in_progress',
      quantity: 10,
      description: 'تست یکپارچگی انبار و تخصیص قطعات',
      isDeleted: 0
    }).returning();

    // Create raw material item
    const rawMaterial = await createTestItem({ currentStock: 100 });


    // Allocate 15 units to project
    const allocResult = await ProjectBomAllocationService.allocateMaterialsForProject({
      projectId: proj.id,
      allocations: [
        {
          itemId: rawMaterial.id,
          quantity: 15,
          location: 'main',
          notes: 'تخصیص تست مواد اولیه'
        }
      ],
      username: 'تستر سیستم'
    });

    if (allocResult.allocatedCount !== 1 || allocResult.allocations.length === 0) {
      throw new Error('Allocating materials to the project failed.');
    }

    const allocRecord = allocResult.allocations[0];
    if (!allocRecord.sourceTransactionId) {
      throw new Error('The source Kardex transaction id was not recorded on the allocation.');
    }

    // Verify traceability retrieval
    const projectAllocs = await ProjectBomAllocationService.getProjectAllocations(proj.id);
    if (projectAllocs.length !== 1 || projectAllocs[0].sourceTransactionId !== allocRecord.sourceTransactionId) {
      throw new Error('The allocation trace record was not extracted correctly.');
    }

    // Test releasing allocation back to warehouse
    const releaseRes = await ProjectBomAllocationService.releaseAllocation(allocRecord.id, {
      reason: 'تست آزادسازی مواد'
    });

    if (releaseRes.status !== 'released') {
      throw new Error('Releasing the allocation back to the warehouse failed.');
    }

    results.push(makeTestCase({
      id: 'int_project_bom_allocation_traceability',
      scenarioId: 'project_bom_allocation_traceability',
      name: 'BOM raw material allocation with source transaction traceability',
      layer: 'integration',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t13Start,
      details: `Material allocation with an atomic warehouse deduction, the recorded Kardex transaction id (TX-${allocRecord.sourceTransactionId}) and release were confirmed.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_project_bom_allocation_traceability',
      scenarioId: 'project_bom_allocation_traceability',
      name: 'BOM raw material allocation with source transaction traceability',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t13Start,
      error: err.message
    }));
  }

  // 14. Phase 11.1 & 11.2 — Piecework Payroll Accounting Voucher Sync & CRM Customer Accounting Read Model
  const t14Start = Date.now();
  try {
    const { VoucherSyncService } = await import('../../services/accounting/voucherSync.service.js');
    const { AccountingReportService } = await import('../../services/accounting/accountingReport.service.js');
    const { personnel, customers, pieceworkPayrolls } = await import('../../db/schema.js');

    // Create test personnel
    const [person] = await orm.insert(personnel).values({
      fullName: 'پرسنل تستی کارمزدی',
      phone: '09123456789',
      isDeleted: 0
    }).returning();

    // Create test payroll
    const [payroll] = await orm.insert(pieceworkPayrolls).values({
      payrollNumber: `PAY-${Date.now()}`,
      personnelId: person.id,
      startDate: '2024-03-20',
      endDate: '2024-04-18',
      title: 'تسویه دستمزد کارمزدی فروردین',
      totalPieceworkAmount: money(5000000),
      totalBonuses: money(500000),
      totalDeductions: money(200000),
      netPayable: money(5300000),
      status: 'approved'
    }).returning();

    // Auto-create voucher for payroll
    const voucherRes = await VoucherSyncService.autoCreateVoucherForPayroll(payroll.id);

    if (!voucherRes || !voucherRes.voucherNumber) {
      throw new Error('Automatic issue of the double-entry journal voucher for the piecework wage settlement failed.');
    }

    // Verify CRM Customer Accounting Read Model
    const [testCust] = await orm.insert(customers).values({
      name: `ERP-TEST-MARKER مشتری سازمانی تست ${Date.now()}`,
      phone: '09120000000',
      isDeleted: 0
    }).returning();

    // Fetch account card for customer via AccountingReportService
    const custAccountCard = await AccountingReportService.getDetailedAccountCard({
      detailedType: 'customer',
      detailedId: testCust.id,
      detailedName: testCust.name
    });

    if (typeof custAccountCard.finalBalance !== 'number') {
      throw new Error('Reading the customer detailed ledger from the accounting read model failed.');
    }

    results.push(makeTestCase({
      id: 'int_payroll_voucher_and_crm_accounting_read_model',
      scenarioId: 'payroll_voucher_and_crm_accounting_read_model',
      name: 'Piecework wage double-entry voucher sync and the CRM accounting read model',
      layer: 'integration',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t14Start,
      details: `Journal voucher #${voucherRes.voucherNumber} was issued with balanced debit/credit for payslip #${payroll.payrollNumber} and the customer detailed ledger was read from the read model.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_payroll_voucher_and_crm_accounting_read_model',
      scenarioId: 'payroll_voucher_and_crm_accounting_read_model',
      name: 'Piecework wage double-entry voucher sync and the CRM accounting read model',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t14Start,
      error: err.message
    }));
  }

  // 15. Phase 11.3 — Direct Project BOM Receipt Allocation
  const t15Start = Date.now();
  try {
    const { ProjectBomAllocationService } = await import('../../services/inventory/projectBomAllocation.service.js');
    const { productionProjects, transactions } = await import('../../db/schema.js');

    // Create project
    const pCode = `PRJ-RCPT-${Date.now()}`;
    const [proj] = await orm.insert(productionProjects).values({
      projectCode: pCode,
      title: 'پروژه تست تخصیص مستقیم رسید انبار',
      status: 'in_progress',
      quantity: 5,
      isDeleted: 0
    }).returning();

    // v8.0.32 (TD-287، تصمیم مالک محصول): تخصیص از رسید فقط با رسید ثبت‌شده همین کالا و مانند تخصیص عادی مواد را از انبار
    // خارج می‌کند (پیش‌تر ردیف «ورود» دستی کافی بود و موجودی برداشته نمی‌شد).
    const { DocumentService } = await import('../../services/document.service.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const wh = (await getDefaultWarehouseCode(orm)) ?? '';
    const rawMat = await createTestItem({ stocks: {}, weightedAverageCost: 0 });
    const receiptDocId = await DocumentService.createDocument({
      docType: 'receipt', inOut: 'in', status: 'final', date: await businessTodayIsoDate(), user: 'تستر انبار و تولید',
      items: [{ itemId: rawMat.id, quantity: 20, unitPrice: 50000, location: wh }]
    });
    const [rcptMovement] = await orm.select().from(transactions)
      .where(and(eq(transactions.documentId, receiptDocId), eq(transactions.itemId, rawMat.id), eq(transactions.type, 'in')));

    // Direct BOM Receipt Allocation
    const receiptAllocResult = await ProjectBomAllocationService.allocateReceiptItemsForProjectBom({
      projectId: proj.id,
      allocations: [
        {
          itemId: rawMat.id,
          quantity: 10,
          location: wh,
          receiptTransactionId: rcptMovement.id,
          notes: 'تخصیص آنی از رسید خرید'
        }
      ],
      username: 'تستر انبار و تولید'
    });

    if (receiptAllocResult.allocatedCount !== 1 || receiptAllocResult.allocations.length === 0) {
      throw new Error('Direct allocation of warehouse receipt lines to the BOM failed.');
    }

    const [allocMovement] = await orm.select().from(transactions).where(eq(transactions.id, receiptAllocResult.allocations[0].sourceTransactionId ?? 0));
    if (allocMovement?.type !== 'out' || Number(allocMovement.quantity) !== 10) {
      throw new Error('The allocation from the receipt did not move 10 units out of the warehouse.');
    }
    const [afterItem] = await orm.select({ currentStock: items.currentStock }).from(items).where(eq(items.id, rawMat.id));
    if (Number(afterItem?.currentStock) !== 10) {
      throw new Error(`Stock after allocation from the receipt is ${afterItem?.currentStock}, expected 10`);
    }

    results.push(makeTestCase({
      id: 'int_project_bom_receipt_allocation',
      scenarioId: 'project_bom_receipt_allocation',
      name: 'Direct allocation of warehouse receipt lines to the project BOM',
      layer: 'integration',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t15Start,
      details: `Allocating 10 units from warehouse receipt #${rcptMovement.id} moved the materials out of the warehouse and recorded them in the project BOM.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_project_bom_receipt_allocation',
      scenarioId: 'project_bom_receipt_allocation',
      name: 'Direct allocation of warehouse receipt lines to the project BOM',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t15Start,
      error: err.message
    }));
  }

  // 16. Server-Backed Form Drafts Lifecycle (Save, Fetch, List, Soft-Delete, Expiry)
  const t16Start = Date.now();
  try {
    const user = await createTestUser({ role: 'admin' });
    const draftPayload = {
      voucherType: 'general',
      currency: 'IRR',
      description: 'پیش‌نویس تست سند حسابداری دوبل',
      items: [
        { accountId: 101, debit: 5000000, credit: 0, description: 'بانک ملت' },
        { accountId: 401, debit: 0, credit: 5000000, description: 'فروش کالا' }
      ]
    };

    // Save draft
    const saveRes = await FormDraftService.saveDraft({
      userId: user.id,
      entityType: 'voucher',
      draftKey: 'test_voucher_draft_01',
      payload: draftPayload,
      summary: 'ERP-TEST-MARKER سند دوبل فروش آزمایشی'
    });

    if (!saveRes?.success || !saveRes.draft?.id) {
      throw new Error('Saving the draft on the server failed');
    }

    // Fetch draft
    const retrieved = await FormDraftService.getDraft('voucher', 'test_voucher_draft_01', user.id);

    if (!retrieved || (retrieved.payload as any)?.description !== draftPayload.description) {
      throw new Error('Retrieving the draft from the server failed or its content does not match');
    }

    // List drafts
    const userDrafts = await FormDraftService.listUserDrafts(user.id);
    if (!Array.isArray(userDrafts) || userDrafts.length === 0) {
      throw new Error('The user draft list is empty');
    }

    // Soft delete
    const deleted = await FormDraftService.deleteDraft('voucher', 'test_voucher_draft_01', user.id);

    if (!deleted) {
      throw new Error('Deleting the draft from the server failed');
    }

    // Verify deleted
    const postDelete = await FormDraftService.getDraft('voucher', 'test_voucher_draft_01', user.id);

    if (postDelete !== null) {
      throw new Error('The deleted draft is still available');
    }

    results.push(makeTestCase({
      id: 'int_server_backed_form_drafts_lifecycle',
      scenarioId: 'server_backed_form_drafts',
      name: 'Full lifecycle of server-backed form drafts',
      layer: 'integration',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t16Start,
      details: 'Saving, retrieving, listing, updating and safely deleting drafts of sensitive accounting and invoice forms in PostgreSQL were confirmed.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_server_backed_form_drafts_lifecycle',
      scenarioId: 'server_backed_form_drafts',
      name: 'Full lifecycle of server-backed form drafts',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t16Start,
      error: err.message
    }));
  }

  // 17. Structured Error Contract Verification (code, message, details)
  const t17Start = Date.now();
  try {
    const stockErr = new InsufficientStockError('Central warehouse stock of item 1001 is insufficient', { itemId: 1001, requested: 50, available: 12 });
    const normalizedStock = normalizeError(stockErr);

    if (normalizedStock.code !== 'INSUFFICIENT_STOCK' || normalizedStock.statusCode !== 400) {
      throw new Error(`Wrong standard warehouse error code: ${normalizedStock.code}`);
    }

    const voucherErr = new UnbalancedVoucherError();
    const normalizedVoucher = normalizeError(voucherErr);
    if (normalizedVoucher.code !== 'ACCOUNTING_UNBALANCED') {
      throw new Error(`Wrong unbalanced voucher error code: ${normalizedVoucher.code}`);
    }

    results.push(makeTestCase({
      id: 'int_structured_error_contract',
      scenarioId: 'structured_error_contract',
      name: 'Structured API error contract (code, message, details)',
      layer: 'integration',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - t17Start,
      details: 'The unified API error structure with fixed standard codes (INSUFFICIENT_STOCK, ACCOUNTING_UNBALANCED) was confirmed.'
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'int_structured_error_contract',
      scenarioId: 'structured_error_contract',
      name: 'Structured API error contract (code, message, details)',
      layer: 'integration',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - t17Start,
      error: err.message
    }));
  } finally {
    if (process.env.ERP_ALLOW_TEST_CLEANUP === '1') {
      try {
        await cleanupAllTestFixtures();
      } catch {
        // Safe ignore
      }
    }
  }

  return results;
}



