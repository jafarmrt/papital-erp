import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { workflowInstances, workflowStates } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { isUsableSnapshot } from '../workflow/workflowSnapshot.js';
import type { WorkflowSnapshotDsl } from '../workflow/workflowTransitionExecutor.js';

/**
 * v10.0.86 (TD-1138، تصمیم مالک محصول ت۱۳ «قفل شود»): سندی که گردش کار تأییدش در جریان است و از گام آغاز گذشته (مثلاً
 * بازبینی انبار یا مالی) تا پایان بازبینی ویرایش نمی‌شود: `updateDocument` زیر قفل ردیف سند ۴۰۹ `DOCUMENT_IN_REVIEW` با نام
 * گام می‌دهد. در گام آغاز (پیش‌نویس، پیش از ارسال)، پس از رد (فرایند `REJECTED`) و بی فرایند ویرایش آزاد است. گام از تصویر
 * خود فرایند خوانده می‌شود، و اگر تصویر قابل استفاده نباشد از جدول جاری. پیش‌تر پیش‌فاکتور در گام بازبینی ویرایش می‌شد و
 * تأییدکننده سندی را تأیید می‌کرد که پس از بررسی او عوض شده بود.
 */
export const DOCUMENT_IN_REVIEW = 'DOCUMENT_IN_REVIEW';

interface ReviewStep {
  title: string;
  isInitial: boolean;
}

async function currentStepOf(tx: DbExecutor, snapshot: unknown, stateId: number): Promise<ReviewStep | null> {
  const dsl = snapshot as WorkflowSnapshotDsl | null | undefined;
  if (isUsableSnapshot(dsl)) {
    const state = dsl.states!.find(s => s.id === stateId);
    return state ? { title: String(state.title ?? ''), isInitial: state.stateType === 'initial' } : null;
  }
  const [state] = await tx.select({ title: workflowStates.title, stateType: workflowStates.stateType })
    .from(workflowStates).where(eq(workflowStates.id, stateId));
  return state ? { title: String(state.title ?? ''), isInitial: state.stateType === 'initial' } : null;
}

export async function assertDocumentNotInReview(tx: DbExecutor, documentId: number): Promise<void> {
  const [instance] = await tx.select({ snapshotDsl: workflowInstances.snapshotDsl, currentStateId: workflowInstances.currentStateId })
    .from(workflowInstances)
    .where(and(
      eq(workflowInstances.entityType, 'document'),
      eq(workflowInstances.entityId, String(documentId)),
      eq(workflowInstances.status, 'IN_PROGRESS'),
    ));
  if (!instance) return;
  const step = await currentStepOf(tx, instance.snapshotDsl, instance.currentStateId);
  if (!step || step.isInitial) return;
  const stepName = step.title.trim() ? `«${step.title.trim()}»` : 'بازبینی';
  throw new ConflictError(
    `این سند در گام ${stepName} گردش کار است و تا پایان بازبینی ویرایش نمی‌شود. اگر باید اصلاح شود، از تأییدکننده بخواهید آن را رد کند.`,
    { documentId },
    DOCUMENT_IN_REVIEW,
  );
}
