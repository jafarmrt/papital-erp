import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { workflowInstances } from '../../db/schema.js';

/**
 * v9.0.2 (TD-415، یافته A02-01، تصمیم مالک محصول ت۱ «همگام در تراکنش تأیید»): اقدام خودکار پس از انتقال گردش‌کار.
 *
 * هر دامنه اقدام پس از انتقالِ موجودیت خودش را این‌جا ثبت می‌کند (ریشه ترکیب: registerWorkflowDomainActions) و موتور آن
 * را با همان تراکنش انتقال و پیش از commit صدا می‌زند؛ خطای اقدام کل انتقال را برمی‌گرداند و همان خطا به تأییدکننده
 * می‌رسد. پیش‌تر workflowEventBus رویداد را درون تراکنش و پیش از commit پرتاب می‌کرد و شنونده‌ها با اتصال جدای استخر
 * سند را قطعی و درخواست را دریافت می‌کردند و خطا را می‌بلعیدند: انتقالِ برگشت‌خورده کالا را وارد انبار می‌کرد و تأییدِ
 * سندی که قطعی نمی‌شد «می‌گذشت». موتور گردش‌کار دیگر دامنه‌ها را import نمی‌کند.
 */
export interface WorkflowTransitionEvent {
  instanceId: number;
  entityType: string;
  entityId: string;
  workflowCode: string;
  fromStateKey: string;
  toStateKey: string;
  actionKey: string;
  autoActionKey: string;
  performedBy?: number;
  performedByName?: string;
  /** مجوز «ثبت گردش کالا با تاریخ گذشته» که فراخواننده برای همین کاربر سنجیده است (v8.0.4، TD-257)؛ پیش‌فرض نه */
  allowBackdate: boolean;
}

/** گام مقصد یک انتقال، پیش از اجرای آن */
export interface WorkflowActionTarget {
  toStateKey: string;
  autoActionKey: string;
}

/** v9.0.125 (TD-541): موجودیت فرایند، برای مجوزی که به خود موجودیت بسته است (مثلاً نوع سند) */
export interface WorkflowActionEntity {
  tx: DbExecutor;
  entityId: string;
}

export interface WorkflowTransitionAction {
  /**
   * ردیف موجودیت را پیش از ردیف فرایند قفل می‌کند، به همان ترتیب مسیر خود دامنه (موجودیت ← فرایند)؛ بی آن، انتقال از
   * کارتابل و اقدام هم‌زمان صفحه دامنه دو قفل را وارونه می‌گیرند
   */
  lockEntity?: (tx: DbExecutor, entityId: string) => Promise<void>;
  /**
   * v9.0.33 (TD-443): موجودیت هست و حذف نشده است؛ فرایند فقط روی موجودیت موجود شروع می‌شود (پیش‌تر `/workflow/start`
   * فرایند را روی شناسه ناموجود هم می‌ساخت)
   */
  entityExists?: (tx: DbExecutor, entityId: string) => Promise<boolean>;
  /**
   * v9.0.35 (TD-445، تصمیم مالک محصول ت۳ الف): مجوزهای موجودیت (هر یک بس است) که امضاکننده گامی با این مقصد باید داشته
   * باشد، همان مجوزی که مسیر خود دامنه می‌خواهد؛ آرایه خالی یعنی این گام اقدام دامنه ندارد. گردش‌کار راه دور زدن مجوز
   * موجودیت نیست (لایه دوم B14-01).
   */
  requiredPermissions?: (target: WorkflowActionTarget, entity: WorkflowActionEntity) => string[] | Promise<string[]>;
  /** پس از جابه‌جایی گام، درون همان تراکنش؛ خطای آن انتقال را رد می‌کند */
  run: (tx: DbExecutor, event: WorkflowTransitionEvent) => Promise<void>;
}

const actions = new Map<string, WorkflowTransitionAction>();

/** ثبت دوباره همان نوع موجودیت جایگزین ثبت قبلی است (ریشه ترکیب در سرور و اجراکننده آزمون یک بار صدا زده می‌شود) */
export function registerWorkflowTransitionAction(entityTypes: string[], action: WorkflowTransitionAction): void {
  for (const entityType of entityTypes) actions.set(entityType, action);
}

export function hasWorkflowTransitionAction(entityType: string): boolean {
  return actions.has(entityType);
}

/** پیش از قفل ردیف فرایند: ردیف موجودیت آن را، اگر دامنه‌اش قفلی خواسته است */
export async function lockWorkflowEntity(tx: DbExecutor, instanceId: number): Promise<void> {
  if (actions.size === 0) return;
  const [ref] = await tx.select({ entityType: workflowInstances.entityType, entityId: workflowInstances.entityId })
    .from(workflowInstances).where(eq(workflowInstances.id, instanceId));
  const lock = ref ? actions.get(ref.entityType)?.lockEntity : undefined;
  if (ref && lock) await lock(tx, ref.entityId);
}

/** v9.0.33 (TD-443): موجودیتِ نوعی که دامنه‌اش بررسی وجود ثبت کرده باید باشد؛ نوع بی دامنه (طرح آزمایشی طراح) آزاد است */
export async function workflowEntityExists(tx: DbExecutor, entityType: string, entityId: string): Promise<boolean> {
  const exists = actions.get(entityType)?.entityExists;
  return exists ? exists(tx, entityId) : true;
}

/** v9.0.35 (TD-445): مجوزهای موجودیتِ اقدام دامنه این گام؛ نوع بی دامنه یا گام بی اقدام: خالی */
export async function workflowActionPermissions(entityType: string, target: WorkflowActionTarget, entity: WorkflowActionEntity): Promise<string[]> {
  return (await actions.get(entityType)?.requiredPermissions?.(target, entity)) ?? [];
}

/** شناسه عددی مثبت موجودیت، یا undefined */
export function workflowEntityNumericId(entityId: string): number | undefined {
  const id = Number(entityId);
  return /^\d+$/.test(String(entityId).trim()) && Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export async function runWorkflowTransitionAction(tx: DbExecutor, event: WorkflowTransitionEvent): Promise<void> {
  await actions.get(event.entityType)?.run(tx, event);
}
