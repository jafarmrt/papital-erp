import fs from 'fs';
import path from 'path';
import { sql, eq, and } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { outboxEvents, deadLetterEvents, journalVouchers, journalVoucherItems, workflowInstances, workflowTasks } from '../../db/schema.js';
import { unresolvedDeadLetterCondition } from '../events/deadLetterQueueService.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import { logger } from '../../middleware/logger.js';
import { errorMessageOf } from '../../utils.js';
import {
  SUBSYSTEM_UNKNOWN_MESSAGES, type SubsystemStatus, type OutboxHealth, type AccountingHealth, type WorkflowHealth,
  type SubsystemHealth,
} from '../../lib/system/subsystemHealth.js';
import {
  STORAGE_LOCATION_MESSAGES, STORAGE_SUMMARY_MESSAGES, type StorageHealth, type StorageLocationHealth, type StorageLocationKind,
} from '../../lib/system/storageHealth.js';
import { getAttachmentsRoot } from '../attachments/attachmentStorage.service.js';
import { getImageUploadsDir } from '../../lib/storage.js';

/**
 * V3.0.7 (TD-065): بررسی سلامت زیرساخت برای صفحه وضعیت سیستم (GET /system/health، فقط ادمین):
 * اتصال و تأخیر پایگاه‌داده، قابلیت نوشتن پوشه‌های پیوست و تصویر (v9.0.359)، شاخص‌های صف رویداد / اسناد / فرآیند و حافظه.
 * شمارنده‌های DLQ و وظایف معوق SLA با ممیزی یکپارچگی (SystemReconciliationService) مشترک‌اند.
 */

export interface DatabaseHealth {
  status: string;
  latencyMs: number;
  message: string;
}

export type { StorageHealth };

/**
 * v9.0.358 (TD-593): هر زیرسامانه جدا سنجیده می‌شود (قرارداد مشترک `src/lib/system/subsystemHealth.ts`)؛ پرس‌وجوی
 * شکست‌خورده `status: 'unknown'`، شمارنده‌های null و پیام فارسی می‌دهد، نه صفر و «سالم». متن خطا فقط در لاگ می‌آید.
 */
export type { SubsystemStatus, OutboxHealth, AccountingHealth, WorkflowHealth, SubsystemHealth };

/** Runs one subsystem check; a failed query becomes `unknown` with a Persian message, never zeros and `ok` */
async function measureSubsystem<T extends { status: SubsystemStatus }>(
  subsystem: string, check: () => Promise<T>, unknown: T
): Promise<T> {
  try {
    return await check();
  } catch (err) {
    logger.warn('Health check of a subsystem failed', { subsystem, error: errorMessageOf(err) });
    return unknown;
  }
}

/**
 * Whether the app can write into `dir`: the directory itself, or (when it does not exist yet, since the app creates it
 * with mkdir -p) its nearest existing ancestor must be a writable directory. Nothing is created or written.
 */
export function directoryWriteProblem(dir: string): string | null {
  let current = path.resolve(dir);
  for (;;) {
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return errorMessageOf(err);
    }
    if (stat) {
      if (!stat.isDirectory()) return `${current} is not a directory`;
      try {
        fs.accessSync(current, fs.constants.W_OK | fs.constants.X_OK);
        return null;
      } catch (err) {
        return errorMessageOf(err);
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return `no existing directory above ${dir}`;
    current = parent;
  }
}

function storageLocationHealth(kind: StorageLocationKind, dir: string): StorageLocationHealth {
  const problem = directoryWriteProblem(dir);
  if (problem) logger.warn('Storage directory is not writable', { kind, path: dir, error: problem });
  return { kind, path: dir, writable: !problem, message: STORAGE_LOCATION_MESSAGES[kind][problem ? 'error' : 'ok'] };
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

  /**
   * 2. Storage: the directories the app writes to (attachments root and image uploads), read-only.
   * v9.0.359 (TD-619): checked public/uploads only (not ATTACHMENTS_DIR) and wrote a test file on every call.
   */
  static checkStorage(): StorageHealth {
    const locations = ([
      ['attachments', getAttachmentsRoot()],
      ['images', getImageUploadsDir()],
    ] as Array<[StorageLocationKind, string]>).map(([kind, dir]) => storageLocationHealth(kind, dir));
    const writable = locations.every(l => l.writable);
    return {
      status: writable ? 'ok' : 'error',
      writable,
      locations,
      message: writable ? STORAGE_SUMMARY_MESSAGES.ok : STORAGE_SUMMARY_MESSAGES.error,
    };
  }

  /** 3. Subsystem Health Checks (Outbox, DLQ, Vouchers, Workflow), each with its own failure state */
  static async collectSubsystemMetrics(): Promise<SubsystemHealth> {
    const outbox = await measureSubsystem<OutboxHealth>('outbox', async () => {
      const [pendingRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(outboxEvents).where(eq(outboxEvents.status, 'pending'));
      const dlqCount = await this.countDeadLetterEvents();
      return { pendingCount: pendingRes?.count || 0, dlqCount, status: dlqCount > 0 ? 'warning' : 'ok' };
    }, { pendingCount: null, dlqCount: null, status: 'unknown', message: SUBSYSTEM_UNKNOWN_MESSAGES.outbox });

    const accounting = await measureSubsystem<AccountingHealth>('accounting', async () => {
      const [vouchersRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(journalVouchers)
        .where(eq(journalVouchers.isDeleted, 0));
      const unbalancedVouchers = (await this.findUnbalancedVouchers()).length;
      return { totalVouchers: vouchersRes?.count || 0, unbalancedVouchers, status: unbalancedVouchers > 0 ? 'error' : 'ok' };
    }, { totalVouchers: null, unbalancedVouchers: null, status: 'unknown', message: SUBSYSTEM_UNKNOWN_MESSAGES.accounting });

    const workflow = await measureSubsystem<WorkflowHealth>('workflow', async () => {
      const [wfRes] = await orm.select({ count: sql<number>`count(*)::int` }).from(workflowInstances).where(eq(workflowInstances.status, 'IN_PROGRESS'));
      const overdueSlaTasks = await this.countOverdueSlaTasks();
      return { activeInstances: wfRes?.count || 0, overdueSlaTasks, status: overdueSlaTasks > 0 ? 'warning' : 'ok' };
    }, { activeInstances: null, overdueSlaTasks: null, status: 'unknown', message: SUBSYSTEM_UNKNOWN_MESSAGES.workflow });

    return { outbox, accounting, workflow };
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
