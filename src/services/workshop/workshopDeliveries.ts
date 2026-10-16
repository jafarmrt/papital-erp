import { and, asc, desc, eq, inArray, ne, or, isNull, gte, sql } from 'drizzle-orm';
import type { DbExecutor, DbTransaction } from '../../db/drizzle.js';
import { documentItems, documents, items, productionProjects, projectBomAllocations, stockReceiptConfirmations, users } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import type { MyWorkshopDeliveries, WorkshopDelivery } from '../../lib/workshop/workshopContract.js';
import { DELIVERY_CONFIRMATION_LABELS, WORKSHOP_ERRORS, WORKSHOP_NOTE_MAX, type DeliveryConfirmationStatus } from '../../lib/workshop/workshopSchedule.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { liveUserIds, notifyUsers, permissionHolderIds, requireLinkedPersonnel, type WorkshopActor } from './workshopAccess.js';

/**
 * v10.1.39 (N-01 part 2, plan §4.3 «حواله‌های من», decision ت۱ الف): the final remittances and the material allocations
 * whose recipient is the user's personnel. The worker answers each once, «تحویل گرفتم» or «مغایرت دارد» with a note;
 * stock never changes here (a correction is a separate warehouse document). A discrepancy notifies the remittance's
 * recorder (the allocation's user) and the holders of `warehouse.out`.
 */

const CONFIRMED_WINDOW_DAYS = 30;
const DELIVERY_LIMIT = 100;
const WAREHOUSE_OUT = 'warehouse.out';

type Confirmation = typeof stockReceiptConfirmations.$inferSelect;
const confirmationView = (c: Confirmation | undefined) => c
  ? { status: c.status as DeliveryConfirmationStatus, note: c.note, confirmedAt: c.confirmedAt }
  : null;
/** Unanswered first, then newest. */
const byOpenThenDate = (a: WorkshopDelivery, b: WorkshopDelivery) =>
  Number(a.confirmation !== null) - Number(b.confirmation !== null) || b.date.localeCompare(a.date) || b.id - a.id;

export async function listMyDeliveries(executor: DbExecutor, userId: number): Promise<MyWorkshopDeliveries> {
  const me = await requireLinkedPersonnel(executor, userId);
  const recent = sql`now() - make_interval(days => ${CONFIRMED_WINDOW_DAYS})`;

  const docs = await executor.select({ doc: documents, confirmation: stockReceiptConfirmations, projectTitle: productionProjects.title })
    .from(documents)
    .leftJoin(stockReceiptConfirmations, eq(stockReceiptConfirmations.documentId, documents.id))
    .leftJoin(productionProjects, eq(productionProjects.id, documents.projectId))
    .where(and(
      eq(documents.recipientPersonnelId, me.id), eq(documents.type, 'remittance'), eq(documents.status, 'final'), eq(documents.isDeleted, 0),
      or(isNull(stockReceiptConfirmations.id), gte(stockReceiptConfirmations.confirmedAt, recent)),
    ))
    .orderBy(desc(documents.date), desc(documents.id)).limit(DELIVERY_LIMIT);
  const lines = docs.length === 0 ? [] : await executor.select({
    documentId: documentItems.documentId, itemCode: items.code, itemName: items.name, unit: items.unit, quantity: documentItems.quantity,
  }).from(documentItems).innerJoin(items, eq(items.id, documentItems.itemId))
    .where(and(inArray(documentItems.documentId, docs.map(d => d.doc.id)), eq(documentItems.isDeleted, 0)))
    .orderBy(asc(documentItems.id));

  const allocations = await executor.select({ allocation: projectBomAllocations, confirmation: stockReceiptConfirmations, projectTitle: productionProjects.title })
    .from(projectBomAllocations)
    .leftJoin(stockReceiptConfirmations, eq(stockReceiptConfirmations.bomAllocationId, projectBomAllocations.id))
    .leftJoin(productionProjects, eq(productionProjects.id, projectBomAllocations.projectId))
    .where(and(
      eq(projectBomAllocations.recipientPersonnelId, me.id), ne(projectBomAllocations.status, 'released'), eq(projectBomAllocations.isDeleted, 0),
      or(isNull(stockReceiptConfirmations.id), gte(stockReceiptConfirmations.confirmedAt, recent)),
    ))
    .orderBy(desc(projectBomAllocations.allocatedAt), desc(projectBomAllocations.id)).limit(DELIVERY_LIMIT);

  const deliveries: WorkshopDelivery[] = [
    ...docs.map(({ doc, confirmation, projectTitle }) => ({
      kind: 'document' as const,
      id: doc.id,
      reference: doc.refNumber,
      date: doc.date,
      projectTitle: projectTitle ?? null,
      lines: lines.filter(l => l.documentId === doc.id).map(l => ({ itemCode: l.itemCode, itemName: l.itemName, quantity: Number(l.quantity), unit: l.unit })),
      confirmation: confirmationView(confirmation ?? undefined),
    })),
    ...allocations.map(({ allocation, confirmation, projectTitle }) => ({
      kind: 'allocation' as const,
      id: allocation.id,
      reference: allocation.projectCode,
      date: allocation.allocatedAt ?? '',
      projectTitle: projectTitle ?? null,
      lines: [{ itemCode: allocation.itemCode, itemName: allocation.itemName, quantity: Number(allocation.quantity), unit: allocation.unit || 'عدد' }],
      confirmation: confirmationView(confirmation ?? undefined),
    })),
  ].sort(byOpenThenDate);
  return { personnel: me, deliveries };
}

export interface ConfirmDeliveryInput {
  kind: 'document' | 'allocation';
  id: number;
  status: DeliveryConfirmationStatus;
  note?: string;
}

const notFound = () => new NotFoundError(WORKSHOP_ERRORS.deliveryNotFound.message, undefined, WORKSHOP_ERRORS.deliveryNotFound.code);

/** One answer per remittance or allocation, by its recipient; the row is read `FOR SHARE` so a void waits for it. */
export async function confirmDelivery(tx: DbTransaction, actor: WorkshopActor, input: ConfirmDeliveryInput): Promise<WorkshopDelivery['confirmation']> {
  const note = String(input.note ?? '').trim().slice(0, WORKSHOP_NOTE_MAX);
  if (input.status === 'discrepancy' && !note) {
    throw new ValidationError(WORKSHOP_ERRORS.discrepancyNoteRequired.message, undefined, WORKSHOP_ERRORS.discrepancyNoteRequired.code);
  }
  const me = await requireLinkedPersonnel(tx, actor.user.id, true);

  let reference: string;
  let recorderIds: number[];
  if (input.kind === 'document') {
    const [doc] = await tx.select({ id: documents.id, refNumber: documents.refNumber, user: documents.user }).from(documents)
      .where(and(
        eq(documents.id, input.id), eq(documents.recipientPersonnelId, me.id), eq(documents.type, 'remittance'),
        eq(documents.status, 'final'), eq(documents.isDeleted, 0),
      )).for('share');
    if (!doc) throw notFound();
    reference = `حواله شماره ${toPersianDigits(doc.refNumber)}`;
    const recorder = doc.user ? await tx.select({ id: users.id }).from(users).where(and(eq(users.username, doc.user), eq(users.isDeleted, 0))) : [];
    recorderIds = recorder.map(r => r.id);
  } else {
    const [allocation] = await tx.select({ id: projectBomAllocations.id, projectCode: projectBomAllocations.projectCode, itemName: projectBomAllocations.itemName, userId: projectBomAllocations.userId })
      .from(projectBomAllocations)
      .where(and(
        eq(projectBomAllocations.id, input.id), eq(projectBomAllocations.recipientPersonnelId, me.id),
        ne(projectBomAllocations.status, 'released'), eq(projectBomAllocations.isDeleted, 0),
      )).for('share');
    if (!allocation) throw notFound();
    reference = `تخصیص ${allocation.itemName} به پروژه ${allocation.projectCode}`;
    recorderIds = await liveUserIds(tx, allocation.userId ? [allocation.userId] : []);
  }

  const [saved] = await tx.insert(stockReceiptConfirmations).values({
    documentId: input.kind === 'document' ? input.id : null,
    bomAllocationId: input.kind === 'allocation' ? input.id : null,
    personnelId: me.id,
    status: input.status,
    note,
    confirmedById: actor.user.id,
  }).onConflictDoNothing().returning();
  if (!saved) throw new ConflictError(WORKSHOP_ERRORS.deliveryConfirmed.message, undefined, WORKSHOP_ERRORS.deliveryConfirmed.code);

  if (input.status === 'discrepancy') {
    await notifyUsers(tx, [...recorderIds, ...await permissionHolderIds(tx, WAREHOUSE_OUT)], actor.user, {
      type: 'workshop_delivery_discrepancy',
      title: 'مغایرت در تحویل کالا',
      message: `${me.fullName} برای ${reference} «مغایرت دارد» زد: ${note}`,
      link: '/transactions',
    });
  }
  await logActivity({
    tx,
    req: actor.req as never,
    userId: actor.user.id,
    username: actor.user.username,
    userFullName: actor.user.fullName,
    action: 'CREATE',
    entity: 'تأیید دریافت کالای کارگاه',
    entityId: String(saved.id),
    description: `${DELIVERY_CONFIRMATION_LABELS[input.status]} برای ${reference}`,
    details: { kind: input.kind, sourceId: input.id, personnelId: me.id, after: { status: DELIVERY_CONFIRMATION_LABELS[input.status], note } },
  });
  return confirmationView(saved);
}
