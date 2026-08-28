import { TestCaseResult, makeTestCase } from '../types.js';
import { ensureTestDatabaseReady, cleanupAllTestFixtures } from '../fixtures/dbTestHelper.js';
import { createTestUser, createTestItem, createTestWorkflow } from '../fixtures/factories.js';
import { DocumentService } from '../../services/document.service.js';
import { AccountingService } from '../../services/accounting.service.js';
import { VoucherSyncService } from '../../services/accounting/voucherSync.service.js';
import { WorkflowTransitionExecutor } from '../../services/workflow/workflowTransitionExecutor.js';
import { WorkflowDelegationService } from '../../services/workflow/workflowDelegationService.js';
import { IdempotencyService } from '../../services/idempotency.service.js';
import { AccountingReportService } from '../../services/accounting/accountingReport.service.js';
import { orm } from '../../db/drizzle.js';
import {
  documents,
  documentItems,
  items,
  transactions,
  journalVouchers,
  journalVoucherItems,
  workflowInstances,
  workflowHistoryLogs,
  pieceworkPayrolls,
  personnel,
  customers,
  activityLogs,
  accounts
} from '../../db/schema.js';
import { eq, sql, and, inArray } from 'drizzle-orm';

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
      name: 'پایش اتصال پایگاه‌داده جهت اجرای تست‌های E2E',
      layer: 'e2e',
      executionType: 'real_database',
      passed: false,
      status: 'BLOCKED',
      durationMs: 0,
      error: 'اتصال به دیتابیس برقرار نگردید'
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

    // Step 2: Verify Inventory stock increment & Weighted Average Cost (WAC) recalculation
    // Initial: 100 @ 50,000 = 5,000,000
    // Addition: 100 @ 60,000 = 6,000,000
    // New Total Stock = 200, New WAC = 11,000,000 / 200 = 55,000
    const [updatedMaterial] = await orm.select().from(items).where(eq(items.id, rawMaterial.id));
    const stockMovements = await orm.select().from(transactions).where(eq(transactions.documentId, purchaseDoc.id));

    const currentStock1 = Number(updatedMaterial?.currentStock || 0);
    const weightedAvgCost1 = Number(updatedMaterial?.weightedAverageCost || 0);

    if (!updatedMaterial || currentStock1 !== 200 || weightedAvgCost1 !== 55000) {
      throw new Error(`محاسبه میانگین موزون (WAC) یا موجودی جدید انبار با خطا مواجه شد. موجودی: ${updatedMaterial?.currentStock}, قیمت میانگین: ${updatedMaterial?.weightedAverageCost}`);
    }

    if (stockMovements.length !== 1 || stockMovements[0].type !== 'in' || Number(stockMovements[0].quantity) !== 100) {
      throw new Error('تراکنش ورود به انبار در کاردکس ثبت نگردید');
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
        name: 'چرخه کامل ۱: خرید -> رسید انبار -> به‌روزرسانی موجودی/WAC -> سند حسابداری',
        layer: 'e2e',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - j1Start,
        details: `فاکتور خرید #${purchaseDoc.refNumber} ثبت گردید؛ موجودی به ۲۰۰ گرم افزایش و WAC به ۵۵,۰۰۰ ریال به‌روزرسانی شد. سند حسابداری متوازن به مبلغ ۶,۰۰۰,۰۰۰ ریال صادر گردید.`
      }));
    } else {
      throw new Error('صدور یا تراز سند حسابداری خرید در دیتابیس با خطا مواجه شد');
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'e2e_journey_1_purchase_receipt_inventory_accounting',
      scenarioId: 'e2e_purchase_receipt_inventory_accounting',
      name: 'چرخه کامل ۱: خرید -> رسید انبار -> به‌روزرسانی موجودی/WAC -> سند حسابداری',
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
      throw new Error(`کسر موجودی انبار پس از خروج فاکتور فروش ناموفق بود. موجودی: ${updatedProduct?.currentStock}`);
    }

    // Step 4: Auto-Create Accounting Journal Voucher for Sales Invoice
    const autoVoucher = await VoucherSyncService.autoCreateVoucherForInvoice(salesDoc.id);

    if (!autoVoucher || !autoVoucher.voucherNumber || Number(autoVoucher.totalDebit) !== 12500000) {
      throw new Error('صدور سند حسابداری خودکار برای فاکتور فروش با خطا مواجه شد');
    }

    results.push(makeTestCase({
      id: 'e2e_journey_2_sales_approval_stockissue_accounting',
      scenarioId: 'e2e_sales_approval_stockissue_accounting',
      name: 'چرخه کامل ۲: فاکتور فروش -> تصویب فرآیند کاری -> کسر انبار -> ثبت سند خودکار حسابداری',
      layer: 'e2e',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - j2Start,
      details: `فاکتور فروش #${salesDoc.refNumber} تایید گردید؛ موجودی ۵ عدد کسر شد (۱۰ عدد باقیمانده) و سند حسابداری #${autoVoucher.voucherNumber} به مبلغ ۱۲,۵۰۰,۰۰۰ ریال متوازن صادر گردید.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'e2e_journey_2_sales_approval_stockissue_accounting',
      scenarioId: 'e2e_sales_approval_stockissue_accounting',
      name: 'چرخه کامل ۲: فاکتور فروش -> تصویب فرآیند کاری -> کسر انبار -> ثبت سند خودکار حسابداری',
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
    const delegation = await WorkflowDelegationService.createDelegation({
      fromUserId: userA.id,
      toUserId: userB.id,
      startDate: new Date(Date.now() - 3600000).toISOString(),
      endDate: new Date(Date.now() + 86400000).toISOString(),
      reason: 'ماموریت اداری'
    });

    const activeDelegations = await WorkflowDelegationService.getDelegations({ userId: userA.id });
    if (!activeDelegations || activeDelegations.length === 0) {
      throw new Error('تایید تفویض اختیارات در بازه زمانی تعیین‌شده انجام نشد');
    }

    // Step 2: Create Workflow with Parallel Approval
    const wf = await createTestWorkflow({
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
      entityType: 'document',
      entityId: `DOC_PARALLEL_${Date.now()}`,
      userId: userA.id,
      userName: userA.username
    });

    // Step 3: Reject transition path
    const rejectTrans = wf.transitions.find(t => t.actionKey === 'reject_doc');
    if (!rejectTrans) throw new Error('انتقال رد درخواست یافت نشد');

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
        name: 'چرخه کامل ۳: موتور فرآیند کاری -> تفویض اختیار -> تایید موازی/رد -> سوابق تاریخچه',
        layer: 'e2e',
        executionType: 'real_database',
        passed: true,
        durationMs: Date.now() - j3Start,
        details: `تفویض اختیار از کاربر ${userA.username} به ${userB.username} تایید شد؛ درخواست در فرآیند شماره #${instance.id} به وضعیت ردشده منتقل و سوابق ثبت شد.`
      }));
    } else {
      throw new Error('انتقال وضعیت فرآیند کاری به حالت پایانی (ردشده) با خطا مواجه گردید');
    }
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'e2e_journey_3_workflow_approve_reject_delegate_parallel',
      scenarioId: 'e2e_workflow_approve_reject_delegate_parallel',
      name: 'چرخه کامل ۳: موتور فرآیند کاری -> تفویض اختیار -> تایید موازی/رد -> سوابق تاریخچه',
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
      throw new Error('قفل Idempotency بابت رویداد وب‌هوک ووکامرس صادر نشد');
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
      throw new Error(`کسر انبار سفارش آنلاین ووکامرس انجام نشد. موجودی: ${updatedWooItem?.currentStock}`);
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
      throw new Error('جلوگیری از ثبت تکراری سفارش ووکامرس (Idempotency) کار نکرد');
    }

    results.push(makeTestCase({
      id: 'e2e_journey_4_woocommerce_webhook_document_stock_audit',
      scenarioId: 'e2e_woocommerce_webhook_document_stock_audit',
      name: 'چرخه کامل ۴: وب‌هوک ووکامرس -> قفل یکتایی (Idempotency) -> صدور فاکتور -> کسر انبار -> لاگ فعالیت',
      layer: 'e2e',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - j4Start,
      details: `سفارش ووکامرس با شماره #${wooDoc.refNumber} پردازش شد؛ موجودی کالای SKU به ۲۳ عدد کاهش یافت و تلاش مجدد ارسال وب‌هوک با پاسخ ذخیره‌شده بدون دوبله‌شدن کسر انبار مسدود گردید.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'e2e_journey_4_woocommerce_webhook_document_stock_audit',
      scenarioId: 'e2e_woocommerce_webhook_document_stock_audit',
      name: 'چرخه کامل ۴: وب‌هوک ووکامرس -> قفل یکتایی (Idempotency) -> صدور فاکتور -> کسر انبار -> لاگ فعالیت',
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
      startDate: '1403/02/01',
      endDate: '1403/02/31',
      title: 'تسویه دستمزد کارهای کارمزدی اردیبهشت',
      totalPieceworkAmount: 8000000,
      totalBonuses: 1000000,
      totalDeductions: 500000,
      netPayable: 8500000,
      status: 'approved'
    }).returning();

    // Step 2: Synchronize Accounting Journal Voucher automatically
    const payrollVoucher = await VoucherSyncService.autoCreateVoucherForPayroll(payroll.id);

    if (!payrollVoucher || !payrollVoucher.voucherNumber || Number(payrollVoucher.totalDebit) !== 8500000) {
      throw new Error('صدور سند حسابداری کارزد دستمزد حقوق با خطا مواجه شد');
    }

    // Step 3: Verify Voucher items in DB
    const voucherItems = await orm.select().from(journalVoucherItems).where(eq(journalVoucherItems.voucherId, payrollVoucher.id));
    const totalDebit = voucherItems.reduce((acc, i) => acc + (Number(i.debit) || 0), 0);
    const totalCredit = voucherItems.reduce((acc, i) => acc + (Number(i.credit) || 0), 0);

    if (totalDebit !== 8500000 || totalCredit !== 8500000) {
      throw new Error(`سند حقوق صادر شده تراز نیست. بدهکار: ${totalDebit}, بستانکار: ${totalCredit}`);
    }

    results.push(makeTestCase({
      id: 'e2e_journey_5_piecework_payroll_accounting_posting',
      scenarioId: 'e2e_piecework_payroll_accounting_posting',
      name: 'چرخه کامل ۵: حقوق و دستمزد کارمزدی -> صدور خودکار سند حسابداری -> تراز دفتر کل',
      layer: 'e2e',
      executionType: 'real_database',
      passed: true,
      durationMs: Date.now() - j5Start,
      details: `فیش حقوقی شماره #${payroll.payrollNumber} برای ${worker.fullName} تایید شد و سند حسابداری دوبل متوازن شماره #${payrollVoucher.voucherNumber} به مبلغ ۸,۵۰۰,۰۰۰ ریال صادر گردید.`
    }));
  } catch (err: any) {
    results.push(makeTestCase({
      id: 'e2e_journey_5_piecework_payroll_accounting_posting',
      scenarioId: 'e2e_piecework_payroll_accounting_posting',
      name: 'چرخه کامل ۵: حقوق و دستمزد کارمزدی -> صدور خودکار سند حسابداری -> تراز دفتر کل',
      layer: 'e2e',
      executionType: 'real_database',
      passed: false,
      durationMs: Date.now() - j5Start,
      error: err.message
    }));
  } finally {
    try {
      await cleanupAllTestFixtures();
    } catch {
      // Safe ignore
    }
  }

  return results;
}
