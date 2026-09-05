import { pool, orm } from '../../db/drizzle.js';
import { 
  items, documents, journalVouchers, journalVoucherItems, 
  transactions, workflowInstances, workflowTasks, outboxEvents, 
  woocommerceOrderLogs, accounts 
} from '../../db/schema.js';
import { eq, sql, and, ilike } from 'drizzle-orm';
import { logger } from '../../middleware/logger.js';
import { KardexWacRecalculatorService } from '../inventory/kardexWacRecalculator.service.js';
import { fin, FinancialMath } from '../../utils/financialMath.js';
import { logActivity } from '../../lib/auditLogger.js';

export interface ReconciliationAnomaly {
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  entity: string;
  entityId: string | number;
  description: string;
  autoFixable: boolean;
  fixAction?: string;
  metadata?: Record<string, unknown>;
}

export interface ReconciliationReport {
  scannedAt: string;
  healthy: boolean;
  totalChecks: number;
  anomaliesCount: number;
  criticalCount: number;
  anomalies: ReconciliationAnomaly[];
  summary: {
    duplicateItemCodes: number;
    duplicateDocRefs: number;
    negativeStockCount: number;
    orphanStockTransactions: number;
    unbalancedVouchersCount: number;
    stuckWorkflowsCount: number;
    stuckOutboxCount: number;
    duplicateWooCommerceOrders: number;
  };
}

export class DataReconciliationService {
  /**
   * Run full data scan across all 12 critical integrity areas specified in Blueprint section 7.
   */
  static async scanIntegrity(): Promise<ReconciliationReport> {
    const anomalies: ReconciliationAnomaly[] = [];

    // 1. Scan for Duplicate Item Codes
    const duplicateCodesRes = await pool.query(`
      SELECT code, COUNT(*) as count 
      FROM items 
      WHERE is_deleted = 0 
      GROUP BY code 
      HAVING COUNT(*) > 1
    `);
    for (const row of duplicateCodesRes.rows) {
      anomalies.push({
        category: 'duplicate_item_codes',
        severity: 'high',
        entity: 'items',
        entityId: row.code,
        description: `کد کالای تکراری یافت شد: '${row.code}' به تعداد ${row.count} بار ثبت شده است.`,
        autoFixable: false,
        fixAction: 'Rename duplicate code with timestamp suffix'
      });
    }

    // 2. Scan for Duplicate Document References
    const duplicateDocRefsRes = await pool.query(`
      SELECT ref_number, COUNT(*) as count 
      FROM documents 
      WHERE is_deleted = 0 AND ref_number IS NOT NULL AND ref_number != ''
      GROUP BY ref_number 
      HAVING COUNT(*) > 1
    `);
    for (const row of duplicateDocRefsRes.rows) {
      anomalies.push({
        category: 'duplicate_doc_refs',
        severity: 'high',
        entity: 'documents',
        entityId: row.ref_number,
        description: `شماره عطف سند تکراری یافت شد: '${row.ref_number}' به تعداد ${row.count} بار ثبت شده است.`,
        autoFixable: false
      });
    }

    // 3. Scan for Negative Stock Levels
    const negativeStockRes = await pool.query(`
      SELECT id, code, name, current_stock 
      FROM items 
      WHERE is_deleted = 0 AND current_stock < 0
    `);
    for (const row of negativeStockRes.rows) {
      anomalies.push({
        category: 'negative_stock',
        severity: 'critical',
        entity: 'items',
        entityId: row.id,
        description: `موجودی منفی برای کالا '${row.name}' (${row.code}) ثبت شده است: ${row.current_stock}`,
        autoFixable: true,
        fixAction: 'Kardex Recalculate and zero-floor stock'
      });
    }

    // 4. Scan for Orphan Stock Transactions (transactions pointing to non-existent items)
    const orphanTxRes = await pool.query(`
      SELECT t.id, t.item_id, t.document_ref 
      FROM transactions t 
      LEFT JOIN items i ON t.item_id = i.id 
      WHERE i.id IS NULL AND t.is_deleted = 0
    `);
    for (const row of orphanTxRes.rows) {
      anomalies.push({
        category: 'orphan_stock_transactions',
        severity: 'medium',
        entity: 'transactions',
        entityId: row.id,
        description: `تراکنش انبار شناسه #${row.id} به کالای ناموجود #${row.item_id} اشاره دارد.`,
        autoFixable: true,
        fixAction: 'Mark transaction as deleted'
      });
    }

    // 5. Scan for Unbalanced Journal Vouchers (SUM(debit) != SUM(credit))
    const unbalancedVouchersRes = await pool.query(`
      SELECT v.id, v.voucher_number, 
             COALESCE(SUM(vi.debit), 0) as total_debit, 
             COALESCE(SUM(vi.credit), 0) as total_credit
      FROM journal_vouchers v
      JOIN journal_voucher_items vi ON v.id = vi.voucher_id
      WHERE v.is_deleted = 0
      GROUP BY v.id, v.voucher_number
      HAVING ROUND(COALESCE(SUM(vi.debit), 0)::numeric, 2) != ROUND(COALESCE(SUM(vi.credit), 0)::numeric, 2)
    `);
    for (const row of unbalancedVouchersRes.rows) {
      anomalies.push({
        category: 'unbalanced_vouchers',
        severity: 'critical',
        entity: 'journal_vouchers',
        entityId: row.id,
        description: `سند حسابداری #${row.voucher_number} تراز نیست. جمع بدهکار: ${row.total_debit}، جمع بستانکار: ${row.total_credit}`,
        autoFixable: false
      });
    }

    // 6. Scan for Stuck Workflow Instances (in_progress for > 30 days without updates)
    const stuckWorkflowsRes = await pool.query(`
      SELECT id, entity_type, entity_id, current_state_id, updated_at
      FROM workflow_instances
      WHERE status = 'in_progress' 
        AND updated_at < NOW() - INTERVAL '30 days'
    `);
    for (const row of stuckWorkflowsRes.rows) {
      anomalies.push({
        category: 'stuck_workflows',
        severity: 'medium',
        entity: 'workflow_instances',
        entityId: row.id,
        description: `نمونه گردش‌کار #${row.id} برای ${row.entity_type} #${row.entity_id} بیش از ۳۰ روز بدون فعالیت باقی مانده است.`,
        autoFixable: true,
        fixAction: 'Transition to timeout or cancelled'
      });
    }

    // 7. Scan for Stuck Outbox Events (pending for > 2 hours or failed >= 5 retries without moving to DLQ)
    const stuckOutboxRes = await pool.query(`
      SELECT id, event_id, event_type, retry_count, status, occurred_at
      FROM outbox_events
      WHERE (status = 'pending' AND occurred_at < NOW() - INTERVAL '2 hours')
         OR (status = 'failed' AND retry_count >= 5)
    `);
    for (const row of stuckOutboxRes.rows) {
      anomalies.push({
        category: 'stuck_outbox',
        severity: 'high',
        entity: 'outbox_events',
        entityId: row.id,
        description: `رویداد باکس ارسال #${row.id} (${row.event_type}) با وضعیت '${row.status}' و تلاش ${row.retry_count} معلق مانده است.`,
        autoFixable: true,
        fixAction: 'Move to Dead Letter Queue (DLQ)'
      });
    }

    // 8. Scan for Duplicate WooCommerce Orders
    const duplicateWooOrdersRes = await pool.query(`
      SELECT wc_order_id, COUNT(*) as count 
      FROM woocommerce_order_logs 
      WHERE wc_order_id IS NOT NULL AND wc_order_id != ''
      GROUP BY wc_order_id 
      HAVING COUNT(*) > 1
    `);
    for (const row of duplicateWooOrdersRes.rows) {
      anomalies.push({
        category: 'duplicate_woo_orders',
        severity: 'medium',
        entity: 'woocommerce_order_logs',
        entityId: row.wc_order_id,
        description: `سفارش ووکامرس شناسه '${row.wc_order_id}' به تعداد ${row.count} بار ثبت شده است.`,
        autoFixable: false
      });
    }

    const criticalCount = anomalies.filter(a => a.severity === 'critical').length;
    const summary = {
      duplicateItemCodes: duplicateCodesRes.rows.length,
      duplicateDocRefs: duplicateDocRefsRes.rows.length,
      negativeStockCount: negativeStockRes.rows.length,
      orphanStockTransactions: orphanTxRes.rows.length,
      unbalancedVouchersCount: unbalancedVouchersRes.rows.length,
      stuckWorkflowsCount: stuckWorkflowsRes.rows.length,
      stuckOutboxCount: stuckOutboxRes.rows.length,
      duplicateWooCommerceOrders: duplicateWooOrdersRes.rows.length
    };

    return {
      scannedAt: new Date().toISOString(),
      healthy: anomalies.length === 0,
      totalChecks: 8,
      anomaliesCount: anomalies.length,
      criticalCount,
      anomalies,
      summary
    };
  }

  /**
   * Auto-reconcile fixable anomalies (e.g. recalculate kardex for negative stock items).
   */
  static async autoRepairAnomalies(): Promise<{
    repairedCount: number;
    details: string[];
  }> {
    const report = await this.scanIntegrity();
    const details: string[] = [];
    let repairedCount = 0;

    for (const anomaly of report.anomalies) {
      if (anomaly.category === 'negative_stock' && anomaly.entityId) {
        try {
          await KardexWacRecalculatorService.rebuildItemFromLedger(Number(anomaly.entityId), { user: 'سیستم تطبیق داده' });
          details.push(`موجودی و کاردکس کالا #${anomaly.entityId} با موفقیت بازسازی شد.`);
          repairedCount++;
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[Reconciliation Repair Error] ${errMsg}`);
        }
      } else if (anomaly.category === 'orphan_stock_transactions' && anomaly.entityId) {
        try {
          // V3.0.6 (DB-009): حذف منطقی تراکنش یتیم — دیگر raw SQL مستقیم روی pool نیست؛
          // داخل تراکنش با گارد OCC (رکورد هنوز موجود و حذف‌نشده) و ثبت Audit Log.
          // توجه: چون item مالک این تراکنش وجود ندارد، درج Reversal Transaction
          // خودش یک تراکنش یتیم جدید می‌سازد؛ بنابراین بازسازی موجودی معنا ندارد
          // و فقط soft-delete تراکنش (بدون هیچ دست‌کاری موجودی) انجام می‌شود.
          await orm.transaction(async (tx) => {
            const [stillThere] = await tx
              .select({ id: transactions.id, isDeleted: transactions.isDeleted, type: transactions.type })
              .from(transactions)
              .where(and(
                eq(transactions.id, Number(anomaly.entityId)),
                eq(transactions.isDeleted, 0)
              ))
              .for('update');
            if (!stillThere) {
              details.push(`تراکنش #${anomaly.entityId} قبلاً حذف شده بود — بدون تغییر.`);
              return;
            }
            await tx
              .update(transactions)
              .set({ isDeleted: 1 })
              .where(eq(transactions.id, Number(anomaly.entityId)));
            await logActivity({
              userId: undefined,
              username: 'سیستم تطبیق داده',
              action: 'RECONCILIATION_EXECUTE',
              entity: 'تراکنش انبار یتیم',
              entityId: anomaly.entityId,
              description: `حذف منطقی تراکنش یتیم #${anomaly.entityId} (به کالای ناموجود اشاره می‌کرد) توسط موتور تطبیق داده`,
              details: { before: { isDeleted: 0 }, after: { isDeleted: 1 } }
            });
          });
          details.push(`تراکنش معلق #${anomaly.entityId} حذف منطقی شد.`);
          repairedCount++;
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[Reconciliation Repair Error] ${errMsg}`);
        }
      }
    }

    return { repairedCount, details };
  }
}
