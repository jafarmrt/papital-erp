import type { DbExecutor } from '../../db/drizzle.js';
import { BusinessLogicError } from '../../errors/customErrors.js';

/**
 * v10.0.250 (OBS-R2-02، تصمیم ت۳ الف فاز ۲): بسته‌های هسته (حسابداری، خزانه، کالا) گردش کار موجودیت خود را از این درگاه
 * آغاز می‌کنند یا می‌بندند و موتور گردش کار (بسته ۱۴، لایه بالاتر) را import نمی‌کنند. ریشه ترکیب
 * (`registerWorkflowDomainActions`) پیاده‌سازی موتور را ثبت می‌کند. پیش‌تر حساب خزانه موتور را با `import()` پویا می‌خواند
 * که وابستگی را از دید ratchet مرز بسته‌ها پنهان نمی‌کرد ولی جهت لایه‌ها را می‌شکست.
 */
export interface EntityWorkflowStart {
  entityType: string;
  entityId: string | number;
  userId?: number;
  userName?: string;
  /** تراکنش فراخواننده؛ گردش کار درون savepoint همان تراکنش آغاز می‌شود (v8.0.77، TD-324) */
  tx?: DbExecutor;
}

export interface EntityWorkflowTermination {
  entityType: string;
  entityId: string | number;
  /** کلید و عنوان ردیف تاریخچه */
  actionKey: string;
  actionTitle: string;
  comment: string;
  userId?: number | null;
  userName?: string | null;
}

export interface EntityWorkflowPort {
  /** نمونه آغازشده، یا null وقتی نوع موجودیت تعریف فعالی ندارد */
  maybeStart(params: EntityWorkflowStart): Promise<{ id: number } | null>;
  /** شناسه نمونه‌های بسته‌شده */
  terminateOpen(tx: DbExecutor, params: EntityWorkflowTermination): Promise<number[]>;
}

const notWired = (): never => {
  throw new BusinessLogicError('گردش کار در دسترس نیست؛ سامانه کامل راه‌اندازی نشده است.');
};

let port: EntityWorkflowPort = { maybeStart: async () => notWired(), terminateOpen: async () => notWired() };

export function registerEntityWorkflowPort(impl: EntityWorkflowPort): void {
  port = impl;
}

export const maybeStartEntityWorkflow = (params: EntityWorkflowStart) => port.maybeStart(params);

export const terminateEntityWorkflows = (tx: DbExecutor, params: EntityWorkflowTermination) => port.terminateOpen(tx, params);
