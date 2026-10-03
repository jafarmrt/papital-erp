import fs from 'fs';
import path from 'path';
import { sql, eq, and } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { outboxEvents, deadLetterEvents, journalVouchers, journalVoucherItems, workflowInstances, workflowTasks } from '../../db/schema.js';
import { unresolvedDeadLetterCondition } from '../events/deadLetterQueueService.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import { logger } from '../../middleware/logger.js';
import { errorMessageOf } from '../../utils.js';

/**
 * V3.0.7 (TD-065): بررسی سلامت زیرساخت برای صفحه وضعیت سیستم (GET /system/health، فقط ادمین):
 * اتصال و تأخیر پایگاه‌داده، قابلیت نوشتن پوشه uploads، شاخص‌های صف رویداد / اسناد / فرآیند و حافظه.
 * شمارنده‌های DLQ و وظایف معوق SLA با ممیزی یکپارچگی (SystemReconciliationService) مشترک‌اند.
 */

export interface DatabaseHealth {
  status: string;
  latencyMs: number;
  message: string;
}

export interface StorageHealth {
  status: string;
  writable: boolean;
  uploadsPath: string;
  message: string;
}

export interface SubsystemHealth {
  outbox: { pendingCount: number; dlqCount: number; status: string };
  accounting: { totalVouchers: number; unbalancedVouchers: number; status: string };
  workflow: { activeInstances: number; overdueSlaTasks: number; status: string };
}

export class SystemHealthService {
  /** تعداد رویدادهای حل‌نشده صف قرنطینه DLQ (TD-245: ردیف‌های replayed / dismissed شمرده نمی‌شوند) */
  static async countDeadLetterEvents(): Promise<number> {
    const [dlqRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(deadLetterEvents)
      .where(unresolvedDeadLetterCondition());
    return dlqRes?.count || 0;
  }

  /**
   * TD-245: اسناد حسابداری فعال که قدر مطلق اختلاف جمع بدهکار و بستانکار ردیف‌های فعالشان از
   * VOUCHER_BALANCE_TOLERANCE (۰٫۰۱، همان آستانه ثبت سند) بیشتر است. سند و ردیف حذف‌شده نرم کنار گذاشته می‌شوند.
   * مشترک میان صفحه سلامت سیستم و ممیزی یکپارچگی.
   */
  static async findUnbalancedVouchers(): Promise<Array<{ id: number; voucherNumber: number }>> {
    return orm.select({ id: journalVouchers.id, voucherNumber: journalVouchers.voucherNumber })
      .from(journalVouchers)
      .innerJoin(journalVoucherItems, and(eq(journalVoucherItems.voucherId, journalVouchers.id), eq(journalVoucherItems.isDeleted, 0)))
      .where(eq(journalVouchers.isDeleted, 0))
      .groupBy(journalVouchers.id, journalVouchers.voucherNumber)
      .having(sql`ABS(SUM(${journalVoucherItems.debit}) - SUM(${journalVoucherItems.credit})) > ${String(VOUCHER_BALANCE_TOLERANCE)}::numeric`)
      .orderBy(journalVouchers.id);
  }

  /** تعداد وظایف در انتظاری که مهلت SLA آن‌ها گذشته است */
  static async countOverdueSlaTasks(): Promise<number> {
    const [overdueRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(workflowTasks)
      .where(and(eq(workflowTasks.status, 'pending'), sql`due_at IS NOT NULL AND due_at < now()`));
    return overdueRes?.count || 0;
  }

  /** 1. Check DB Connection & Latency */
  static async checkDatabase(): Promise<DatabaseHealth> {
    const dbStatus = { status: 'ok', latencyMs: 0, message: 'پایگاه‌داده PostgreSQL متصل و آماده است' };
    try {
      const dbStart = Date.now();
      await orm.execute(sql`SELECT 1`);
      dbStatus.latencyMs = Date.now() - dbStart;
    } catch (e) {
      dbStatus.status = 'error';
      dbStatus.message = `خطا در اتصال به پایگاه‌داده: ${errorMessageOf(e)}`;
    }
    return dbStatus;
  }

  /** 2. Check Write Permissions on public/uploads */
  static checkStorage(): StorageHealth {
    const storageStatus = { status: 'ok', writable: true, uploadsPath: '', message: 'پوشه ذخیره‌سازی تصاویر قابل نوشتن است' };
    try {
      const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
      storageStatus.uploadsPath = uploadsDir;
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const testFile = path.join(uploadsDir, `.test-write-${Date.now()}`);
      fs.writeFileSync(testFile, 'write-test');
      fs.unlinkSync(testFile);
    } catch (e) {
      storageStatus.status = 'error';
      storageStatus.writable = false;
      storageStatus.message = `خطای دسترسی نوشتن به پوشه تصاویر: ${errorMessageOf(e)}`;
    }
    return storageStatus;
  }

  /** 3. Subsystem Health Checks (Outbox, DLQ, Vouchers, Workflow) */
  static async collectSubsystemMetrics(): Promise<SubsystemHealth> {
    const outboxMetrics = { pendingCount: 0, dlqCount: 0, status: 'ok' };
    const accountingMetrics = { totalVouchers: 0, unbalancedVouchers: 0, status: 'ok' };
    const workflowMetrics = { activeInstances: 0, overdueSlaTasks: 0, status: 'ok' };

    try {
      const [pendingRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(outboxEvents).where(eq(outboxEvents.status, 'pending'));
      const dlqCount = await this.countDeadLetterEvents();
      outboxMetrics.pendingCount = pendingRes?.count || 0;
      outboxMetrics.dlqCount = dlqCount;
      if (outboxMetrics.dlqCount > 0) outboxMetrics.status = 'warning';

      const [vouchersRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(journalVouchers)
        .where(eq(journalVouchers.isDeleted, 0));
      accountingMetrics.totalVouchers = vouchersRes?.count || 0;
      accountingMetrics.unbalancedVouchers = (await this.findUnbalancedVouchers()).length;
      if (accountingMetrics.unbalancedVouchers > 0) accountingMetrics.status = 'error';

      const [wfRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(workflowInstances).where(eq(workflowInstances.status, 'IN_PROGRESS'));
      const overdueSlaTasks = await this.countOverdueSlaTasks();
      workflowMetrics.activeInstances = wfRes?.count || 0;
      workflowMetrics.overdueSlaTasks = overdueSlaTasks;
      if (workflowMetrics.overdueSlaTasks > 0) workflowMetrics.status = 'warning';
    } catch (err) {
      logger.warn({ message: 'Health Check Subsystems Warning', error: err });
    }

    return { outbox: outboxMetrics, accounting: accountingMetrics, workflow: workflowMetrics };
  }

  /** 5. Memory & Runtime */
  static getServerRuntime() {
    const mem = process.memoryUsage();
    const memoryUsageMb = {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      rss: Math.round(mem.rss / 1024 / 1024),
    };
    return {
      nodeVersion: process.version,
      platform: process.platform,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsageMb
    };
  }
}
