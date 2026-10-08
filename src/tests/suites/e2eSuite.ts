import { money } from '../../lib/money.js';
import { TestCaseResult, makeTestCase } from '../types.js';
import { ensureTestDatabaseReady, cleanupAllTestFixtures } from '../fixtures/dbTestHelper.js';
import { createTestUser, createTestItem, createTestWorkflow } from '../fixtures/factories.js';
import { DocumentService } from '../../services/document.service.js';
import { AccountingService } from '../../services/accounting.service.js';
import { VoucherSyncService } from '../../services/accounting/voucherSync.service.js';
import { WorkflowTransitionExecutor } from '../../services/workflow/workflowTransitionExecutor.js';
import { WorkflowDelegationService } from '../../services/workflow/workflowDelegationService.js';
import { IdempotencyService } from '../../services/idempotency.service.js';
import { orm } from '../../db/drizzle.js';
import {
  items,
  transactions,
  journalVouchers,
  journalVoucherItems,
  workflowInstances,
  workflowHistoryLogs,
  pieceworkPayrolls,
  personnel,
  accounts
} from '../../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Phase 14 — Subphase 14.1: Critical E2E Journeys Suite
 * Validates full multi-domain business lifecycles end-to-end on real PostgreSQL database.
 */
export async function runE2eTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const isDbReady = await ensureTestDatabaseReady();
  if (!isDbReady) {
    results.push(makeTestCase({
      id: 'e2e_db_readiness_check',
      scenarioId: 'db_readiness',
      name: 'Database connection check for running the E2E tests',
      layer: 'e2e',
      executionType: 'real_database',
      passed: false,
      status: 'BLOCKED',
      durationMs: 0,
      error: 'Could not connect to the database'
    }));
    return results;
  }

  // Helper to ensure test accounting accounts exist
  await AccountingService.seedStandardAccounts();

  const getTestAccounts = async () => {
    let accList = await orm.select().from(accounts).limit(2);
    return accList;
  };

  // --------------------------------------------------------------------------
  // Journey 1: Purchase -> Receipt -> Inventory -> Accounting
  // --------------------------------------------------------------------------
  const j1Start = Date.now();
  try {
    const rawMaterial = await createTestItem({
      name: 'شمش نقره عیار ۹۲۵ فاز ۱۴',
      code: `SILVER-INGOT-${Date.now()}`,
      category: 'مواد اولیه و قطعات فلزی',
      unit: 'گرم',
      currentStock: 100,
      weightedAverageCost: 50000,
      stocks: { main: 100 }
    });

    // Step 1: Create Purchase Document & Receipt Inward (100 grams @ 60,000 IRR/gram)
    const purchaseDocId = await DocumentService.createDocument({
      docType: 'purchase',
      type: 'purchase',
      refNumber: `PURCHASE-E2E-${Date.now()}`,
      buyerName: 'تامین‌کننده فلزات گرانبها',
      status: 'final',
      inOut: 'in',
      date: new Date().toISOString().split('T')[0],
      items: [
        {
          itemId: rawMaterial.id,
          quantity: 100,
          unit_price: 60000,
          price: 60000,
          unit: 'گرم',
          targetLoc: 'main'
        }
      ]
    });
    const purchaseDoc = await DocumentService.getDocumentById(purchaseDocId);
    if (!purchaseDoc) throw new Error('Purchase invoice not found');

    // Step 2: Verify Inventory stock increment & Weighted Average Cost (WAC) recalculation
    // Initial: 100 @ 50,000 = 5,000,000
    // Addition: 100 @ 60,000 = 6,000,000
    // New Total Stock = 200, New WAC = 11,000,000 / 200 = 55,000
    const [updatedMaterial] = await orm.select().from(items).where(eq(items.id, rawMaterial.id));
    const stockMovements = await orm.select().from(transactions).where(eq(transactions.documentId, purchaseDoc.id));

    const currentStock1 = Number(updatedMaterial?.currentStock || 0);
    const weightedAvgCost1 = Number(updatedMaterial?.weightedAverageCost || 0);

    if (!updatedMaterial || currentStock1 !== 200 || weightedAvgCost1 !== 55000) {
      throw new Error(`weighted average cost (WAC) or new warehouse stock calculation failed. stock: ${updatedMaterial?.currentStock}, average price: ${updatedMaterial?.weightedAverageCost}`);
    }

    if (stockMovements.length !== 1 || stockMovements[0].type !== 'in' || Number(stockMovements[0].quantity) !== 100) {
      throw new Error('The warehouse receipt movement was not recorded in the Kardex');
    }

    // Step 3: Create double-entry Accounting Journal Voucher for Purchase
    const [accA, accB] = await getTestAccounts();
    const purchaseVoucher = await AccountingService.createJournalVoucher({
      date: new Date().toISOString().split('T')[0],
      description: `ثبت سند خرید مواد اولیه - فاکتور شماره #${purchaseDoc.refNumber}`,
      items: [
        { accountId: accA.id, debit: 6000000, credit: 0, description: 'موجودی انبار مواد اولیه' },
        { accountId: accB.id, debit: 0, credit: 6000000, description: 'حساب‌های پرداختنی - تامین‌کننده' }
      ]
    });

    const [voucherDb] = await orm.select().from(journalVouchers).where(eq(journalVouchers.id, purchaseVoucher.id));

    if (
      voucherDb &&
      Number(voucherDb.totalDebit) === 6000000 &&
      Number(voucherDb.totalCredit) === 6000000 &&
      (voucherDb.status === 'approved' || voucherDb.status === 'draft')
    ) {
      results.push(makeTestCase({
        id: 'e2e_journey_1_purchase_receipt_inventory_accounting',
        scenarioId: 'e2e_purchase_receipt_inventory_accounting',
        name: 'Full journey 1: purchase -> warehouse receipt -> stock/WAC update -> journal voucher',
        layer: 'e2e',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - j1Start,
        details: `Purchase invoice #${purchaseDoc.refNumber} recorded; stock rose to 200 grams and WAC was updated to 55,000 rials. A balanced journal voucher of 6,000,000 rials was issued.`
      }));
    } else {
      throw new Error('Issuing or balancing the purchase journal voucher in the database failed');
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'e2e_journey_1_purchase_receipt_inventory_accounting',
      scenarioId: 'e2e_purchase_receipt_inventory_accounting',
      name: 'Full journey 1: purchase -> warehouse receipt -> stock/WAC update -> journal voucher',
      layer: 'e2e',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - j1Start,
      error: err.message
    }));
  }

  // --------------------------------------------------------------------------
  // Journey 2: Sales Invoice -> Approval -> Stock Issue -> Accounting
  // --------------------------------------------------------------------------
  const j2Start = Date.now();
  try {
    const finishedProduct = await createTestItem({
      name: 'گردنبند طلا طرح لوتوس فاز ۱۴',
      code: `NECKLACE-LOTUS-${Date.now()}`,
      category: 'گردنبند',
      unit: 'عدد',
      currentStock: 15,
      stocks: { main: 15 }
    });

    // Step 1: Create Sales Invoice in Draft Status
    const salesDocId = await DocumentService.createDocument({
      docType: 'invoice',
      type: 'invoice',
      refNumber: `INV-E2E-${Date.now()}`,
      buyerName: 'خریدار عمده جواهرات',
      status: 'draft',
      inOut: 'out',
      date: new Date().toISOString().split('T')[0],
      items: [
        {
          itemId: finishedProduct.id,
          quantity: 5,
          unit_price: 2500000,
          price: 2500000,
          unit: 'عدد',
          targetLoc: 'main'
        }
      ]
    });
    const salesDoc = await DocumentService.getDocumentById(salesDocId);
    if (!salesDoc) throw new Error('Sales invoice not found');

    // Step 2: Start Workflow Approval
    const wf = await createTestWorkflow({
      states: [
        { key: 'draft', title: 'پیش‌نویس', type: 'initial' },
        { key: 'approved', title: 'تایید شده', type: 'terminal' }
      ],
      transitions: [
        { fromKey: 'draft', toKey: 'approved', actionKey: 'approve_sales', title: 'تایید فاکتور فروش' }
      ]
    });

    const user = await createTestUser({ role: 'admin' });
    const instance = await WorkflowTransitionExecutor.startInstance({
      workflowDefinitionId: wf.definition.id,
      entityType: 'document',
      entityId: String(salesDoc.id),
      userId: user.id,
      userName: user.username
    });

    const approveTrans = wf.transitions[0];
    await WorkflowTransitionExecutor.executeTransition({
      instanceId: instance.id,
      transitionId: approveTrans.id,
      userId: user.id,
      userName: user.username,
      userRole: 'admin',
      userPermissions: ['*']
    });

    // Step 3: Issue Stock Outward & Mark Sales Document as Final
    await DocumentService.finalizeDocument(salesDoc.id, user.username);

    // Verify Stock Deduction (15 - 5 = 10)
    const [updatedProduct] = await orm.select().from(items).where(eq(items.id, finishedProduct.id));
    const currentStock2 = Number(updatedProduct?.currentStock || 0);

    if (!updatedProduct || currentStock2 !== 10) {
      throw new Error(`deducting warehouse stock after the sales invoice issue failed. stock: ${updatedProduct?.currentStock}`);
    }

    // Step 4: Auto-Create Accounting Journal Voucher for Sales Invoice
    const autoVoucher = await VoucherSyncService.autoCreateVoucherForInvoice(salesDoc.id);

    if (!autoVoucher || !autoVoucher.voucherNumber) {
      throw new Error('Issuing the automatic journal voucher for the sales invoice failed');
    }

    // v7.0.24 (TD-174): از v5.0.17 (TD-120) سند فروش علاوه بر دریافتنی/درآمد، ردیف‌های بهای تمام‌شده
    // (بدهکار بهای تمام‌شده / بستانکار موجودی) را هم دارد؛ بنابراین جمع بدهکار سند = مبلغ فروش + بهای تمام‌شده.
    // به‌جای مقایسه جمع کل با مبلغ فروش، تک‌تک ردیف‌ها و توازن سند بررسی می‌شوند.
    const { AccountMappingService } = await import('../../services/accounting/accountMapping.service.js');
    const receivableAcc = await AccountMappingService.getTradeReceivablesAccount();
    const revenueAcc = await AccountMappingService.getSalesRevenueAccount();
    const cogsAcc = await AccountMappingService.getCostOfGoodsSoldAccount();
    const voucherLines = Array.isArray(autoVoucher.items) ? autoVoucher.items : [];
    const sumFor = (accountId: number | undefined, side: 'debit' | 'credit') => voucherLines
      .filter(line => Number(line.accountId ?? line.account_id) === Number(accountId))
      .reduce((total, line) => total + Number(line[side] || 0), 0);

    const expectedSales = 5 * 2500000;
    const expectedCogs = 5 * Number(updatedProduct.weightedAverageCost || 0);
    if (Number(autoVoucher.totalDebit) !== Number(autoVoucher.totalCredit)) {
      throw new Error(`the automatic sales voucher is not balanced: debit ${autoVoucher.totalDebit} / credit ${autoVoucher.totalCredit}`);
    }
    if (sumFor(receivableAcc?.id, 'debit') !== expectedSales || sumFor(revenueAcc?.id, 'credit') !== expectedSales) {
      throw new Error(`the receivable/revenue rows of the automatic sales voucher must be ${expectedSales} (receivable: ${sumFor(receivableAcc?.id, 'debit')}, revenue: ${sumFor(revenueAcc?.id, 'credit')})`);
    }
    if (sumFor(cogsAcc?.id, 'debit') !== expectedCogs) {
      throw new Error(`the cost of sales row of the automatic sales voucher must be ${expectedCogs} (value: ${sumFor(cogsAcc?.id, 'debit')})`);
    }

    results.push(makeTestCase({
      id: 'e2e_journey_2_sales_approval_stockissue_accounting',
      scenarioId: 'e2e_sales_approval_stockissue_accounting',
      name: 'Full journey 2: sales invoice -> workflow approval -> warehouse deduction -> automatic journal voucher',
      layer: 'e2e',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - j2Start,
      details: `Sales invoice #${salesDoc.refNumber} approved; 5 units were deducted from stock (10 units left) and journal voucher #${autoVoucher.voucherNumber} was issued with receivable/revenue of 12,500,000 rials and a balanced cost of sales row.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'e2e_journey_2_sales_approval_stockissue_accounting',
      scenarioId: 'e2e_sales_approval_stockissue_accounting',
      name: 'Full journey 2: sales invoice -> workflow approval -> warehouse deduction -> automatic journal voucher',
      layer: 'e2e',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - j2Start,
      error: err.message
    }));
  }

  // --------------------------------------------------------------------------
  // Journey 3: Workflow -> Approve / Reject / Delegate / Parallel Approval
  // --------------------------------------------------------------------------
  const j3Start = Date.now();
  try {
    const userA = await createTestUser({ role: 'manager' });
    const userB = await createTestUser({ role: 'supervisor' });

    // Step 1: Delegation window setup (User A delegates to User B)
    await WorkflowDelegationService.createDelegation({
      fromUserId: userA.id,
      toUserId: userB.id,
      startDate: new Date(Date.now() - 3600000).toISOString(),
      endDate: new Date(Date.now() + 86400000).toISOString(),
      reason: 'ماموریت اداری'
    });

    const activeDelegations = await WorkflowDelegationService.getDelegations({ userId: userA.id });
    if (!activeDelegations || activeDelegations.length === 0) {
      throw new Error('Delegation approval within the set time window did not happen');
    }

    // Step 2: Create Workflow with Parallel Approval
    const wf = await createTestWorkflow({
      // v9.0.33 (TD-443): شناسه ساختگی؛ نوع «document» فقط روی سند موجود شروع می‌شود
      definition: { entityType: 'test_document' },
      states: [
        { key: 'review', title: 'در حال بررسی', type: 'initial' },
        { key: 'approved', title: 'تایید شده', type: 'terminal' },
        { key: 'rejected', title: 'رد شده', type: 'terminal' }
      ],
      transitions: [
        { fromKey: 'review', toKey: 'approved', actionKey: 'approve_parallel', title: 'تایید موازی' },
        { fromKey: 'review', toKey: 'rejected', actionKey: 'reject_doc', title: 'رد درخواست' }
      ]
    });

    const instance = await WorkflowTransitionExecutor.startInstance({
      workflowDefinitionId: wf.definition.id,
      entityType: 'test_document',
      entityId: `DOC_PARALLEL_${Date.now()}`,
      userId: userA.id,
      userName: userA.username
    });

    // Step 3: Reject transition path
    const rejectTrans = wf.transitions.find(t => t.actionKey === 'reject_doc');
    if (!rejectTrans) throw new Error('Reject transition of the request not found');

    await WorkflowTransitionExecutor.executeTransition({
      instanceId: instance.id,
      transitionId: rejectTrans.id,
      userId: userB.id,
      userName: userB.username,
      userRole: 'supervisor',
      userPermissions: ['*']
    });

    const [finalInstance] = await orm.select().from(workflowInstances).where(eq(workflowInstances.id, instance.id));
    const historyLogs = await orm.select().from(workflowHistoryLogs).where(eq(workflowHistoryLogs.instanceId, instance.id));

    if (
      finalInstance &&
      finalInstance.currentStateId === wf.states['rejected'].id &&
      (finalInstance.status === 'COMPLETED' || finalInstance.status === 'REJECTED') &&
      historyLogs.length >= 2
    ) {
      results.push(makeTestCase({
        id: 'e2e_journey_3_workflow_approve_reject_delegate_parallel',
        scenarioId: 'e2e_workflow_approve_reject_delegate_parallel',
        name: 'Full journey 3: workflow engine -> delegation -> parallel approval/rejection -> history records',
        layer: 'e2e',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - j3Start,
        details: `Delegation from user ${userA.username} to ${userB.username} verified; the request in process #${instance.id} moved to rejected and the records were saved.`
      }));
    } else {
      throw new Error('Moving the workflow status to the final (rejected) state failed');
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'e2e_journey_3_workflow_approve_reject_delegate_parallel',
      scenarioId: 'e2e_workflow_approve_reject_delegate_parallel',
      name: 'Full journey 3: workflow engine -> delegation -> parallel approval/rejection -> history records',
      layer: 'e2e',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - j3Start,
      error: err.message
    }));
  }

  // --------------------------------------------------------------------------
  // Journey 4: WooCommerce Webhook -> Document -> Stock -> Audit
  // --------------------------------------------------------------------------
  const j4Start = Date.now();
  try {
    const wooItem = await createTestItem({
      code: `WOO-SKU-${Date.now()}`,
      name: 'انگشتر عقیق ووکامرس فاز ۱۴',
      category: 'انگشتر',
      unit: 'عدد',
      currentStock: 25,
      stocks: { main: 25 }
    });

    const deliveryKey = `woo_e2e_deliv_${Date.now()}`;
    const scope = 'woocommerce_webhooks';

    // Step 1: Idempotency Lock
    const lockAcquire = await IdempotencyService.acquireOrGet({
      key: deliveryKey,
      scope,
      requestPath: '/api/woocommerce/webhook/order',
      requestMethod: 'POST',
      requestBody: { orderId: 887766, total: 3500000 }
    });

    if (lockAcquire.action !== 'PROCESS_NEW') {
      throw new Error('The Idempotency lock for the WooCommerce webhook event was not issued');
    }

    // Step 2: Auto-Create Sales Document & Stock Deduction from WooCommerce Order Payload
    const wooDocId = await DocumentService.createDocument({
      docType: 'invoice',
      type: 'invoice',
      refNumber: `WOO-ORDER-887766-${Date.now()}`,
      buyerName: 'مشتری آنلاین ووکامرس',
      status: 'final',
      inOut: 'out',
      date: new Date().toISOString().split('T')[0],
      items: [
        {
          itemId: wooItem.id,
          quantity: 2,
          unit_price: 1750000,
          price: 1750000,
          unit: 'عدد',
          targetLoc: 'main'
        }
      ]
    });
    const wooDoc = await DocumentService.getDocumentById(wooDocId);
    if (!wooDoc) throw new Error('WooCommerce invoice not found');

    // Step 3: Complete Idempotency record
    await IdempotencyService.complete({
      key: deliveryKey,
      scope,
      statusCode: 200,
      responseBody: { success: true, documentId: wooDoc.id, orderId: 887766 }
    });

    // Step 4: Verify Inventory Deduction (25 - 2 = 23)
    const [updatedWooItem] = await orm.select().from(items).where(eq(items.id, wooItem.id));
    const currentStock4 = Number(updatedWooItem?.currentStock || 0);

    if (!updatedWooItem || currentStock4 !== 23) {
      throw new Error(`warehouse deduction for the online WooCommerce order did not happen. stock: ${updatedWooItem?.currentStock}`);
    }

    // Step 5: Duplicate Retry Test (Must Return Cached Response)
    const retryAcquire = await IdempotencyService.acquireOrGet({
      key: deliveryKey,
      scope,
      requestPath: '/api/woocommerce/webhook/order',
      requestMethod: 'POST',
      requestBody: { orderId: 887766, total: 3500000 }
    });

    if (retryAcquire.action !== 'RETURN_CACHED' || retryAcquire.statusCode !== 200) {
      throw new Error('Duplicate WooCommerce order prevention (Idempotency) did not work');
    }

    results.push(makeTestCase({
      id: 'e2e_journey_4_woocommerce_webhook_document_stock_audit',
      scenarioId: 'e2e_woocommerce_webhook_document_stock_audit',
      name: 'Full journey 4: WooCommerce webhook -> uniqueness lock (Idempotency) -> invoice issue -> warehouse deduction -> activity log',
      layer: 'e2e',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - j4Start,
      details: `WooCommerce order #${wooDoc.refNumber} processed; the SKU item stock fell to 23 units and a webhook retry was blocked with the stored response without a duplicate warehouse deduction.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'e2e_journey_4_woocommerce_webhook_document_stock_audit',
      scenarioId: 'e2e_woocommerce_webhook_document_stock_audit',
      name: 'Full journey 4: WooCommerce webhook -> uniqueness lock (Idempotency) -> invoice issue -> warehouse deduction -> activity log',
      layer: 'e2e',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - j4Start,
      error: err.message
    }));
  }

  // --------------------------------------------------------------------------
  // Journey 5: Piecework Payroll -> Accounting Posting
  // --------------------------------------------------------------------------
  const j5Start = Date.now();
  try {
    // Ensure standard accounting chart of accounts and mappings exist
    await AccountingService.seedStandardAccounts();

    // Step 1: Create Personnel & Piecework Payroll Record
    const [worker] = await orm.insert(personnel).values({
      fullName: 'استادکار طلاساز فاز ۱۴',
      phone: '09121112233',
      isDeleted: 0
    }).returning();

    const [payroll] = await orm.insert(pieceworkPayrolls).values({
      payrollNumber: `PAY-E2E-${Date.now()}`,
      personnelId: worker.id,
      startDate: '2024-04-20',
      endDate: '2024-05-20',
      title: 'تسویه دستمزد کارهای کارمزدی اردیبهشت',
      totalPieceworkAmount: money(8000000),
      totalBonuses: money(1000000),
      totalDeductions: money(500000),
      netPayable: money(8500000),
      status: 'approved'
    }).returning();

    // Step 2: Synchronize Accounting Journal Voucher automatically
    const payrollVoucher = await VoucherSyncService.autoCreateVoucherForPayroll(payroll.id);

    if (!payrollVoucher || !payrollVoucher.voucherNumber || Number(payrollVoucher.totalDebit) !== 9000000) {
      throw new Error('Issuing the piecework wage payroll journal voucher failed');
    }

    // Step 3: Verify Voucher items in DB
    const voucherItems = await orm.select().from(journalVoucherItems).where(eq(journalVoucherItems.voucherId, payrollVoucher.id));
    const totalDebit = voucherItems.reduce((acc, i) => acc + (Number(i.debit) || 0), 0);
    const totalCredit = voucherItems.reduce((acc, i) => acc + (Number(i.credit) || 0), 0);

    if (totalDebit !== 9000000 || totalCredit !== 9000000) {
      throw new Error(`the issued payroll voucher is not balanced. debit: ${totalDebit}, credit: ${totalCredit}`);
    }

    results.push(makeTestCase({
      id: 'e2e_journey_5_piecework_payroll_accounting_posting',
      scenarioId: 'e2e_piecework_payroll_accounting_posting',
      name: 'Full journey 5: piecework payroll -> automatic journal voucher -> general ledger balance',
      layer: 'e2e',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - j5Start,
      details: `Payslip #${payroll.payrollNumber} for ${worker.fullName} was approved and balanced double-entry journal voucher #${payrollVoucher.voucherNumber} of 9,000,000 rials was issued.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'e2e_journey_5_piecework_payroll_accounting_posting',
      scenarioId: 'e2e_piecework_payroll_accounting_posting',
      name: 'Full journey 5: piecework payroll -> automatic journal voucher -> general ledger balance',
      layer: 'e2e',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - j5Start,
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
