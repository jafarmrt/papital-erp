import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents } from '../../db/schema.js';

/** سطر سفارش پیش و پس از ویرایش، برای قاعده «سفارش بیش از درخواست» */
export interface LinkedOrderLine { itemId: number; quantity: number | string }

export interface LinkedOrderEdit {
  documentId: number;
  requisitionId: number;
  oldLines: LinkedOrderLine[];
  newLines: LinkedOrderLine[];
  overOrderReason?: string;
  user: string;
}

/**
 * v10.0.39 / v10.0.40 (TD-912 / TD-913، تصمیم ت۹ الف): کاری که ابطال یا ویرایش سند سفارشِ وصل به درخواست خرید
 * (`documents.procurement_requisition_id`) با خود درخواست می‌کند. بسته اسناد بسته تدارکات را import نمی‌کند (مرز بسته‌ها،
 * تصمیم ت۳ الف فاز ۲)؛ ریشه ترکیب (`registerWorkflowDomainActions`) پیاده‌سازی تدارکات (`procurementOrderHooks`) را ثبت می‌کند.
 */
export interface LinkedOrderHooks {
  /** قفل ردیف درخواست، پیش از قفل کالاها و ردیف سند (همان ترتیب تحویل و تبدیل به سفارش) */
  lockRequisition(tx: DbExecutor, requisitionId: number): Promise<void>;
  /** ویرایش سطرهای سفارش: سفارش بیش از درخواست بی دلیل ۴۲۲؛ یادداشتی که به سند افزوده می‌شود */
  editOrder(tx: DbExecutor, edit: LinkedOrderEdit): Promise<{ note: string }>;
  /** پس از ابطال سفارش: مقدار سفارش‌شده و دریافتی درخواست از اسناد زنده دوباره ساخته می‌شود */
  voidOrder(tx: DbExecutor, voided: { documentId: number; requisitionId: number; user: string }): Promise<void>;
}

let hooks: LinkedOrderHooks | null = null;

export function registerLinkedOrderHooks(next: LinkedOrderHooks): void {
  hooks = next;
}

/** درخواست خرید سند (بی قفل خوانده می‌شود) و قفل ردیف آن؛ `null` برای سندی که سفارش تدارکات نیست */
export async function lockLinkedRequisition(tx: DbExecutor, documentId: number): Promise<number | null> {
  if (!hooks) return null;
  const [row] = await tx.select({ requisitionId: documents.procurementRequisitionId }).from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.isDeleted, 0)));
  const requisitionId = row?.requisitionId ?? null;
  if (requisitionId !== null) await hooks.lockRequisition(tx, requisitionId);
  return requisitionId;
}

/** ویرایش سطرهای سفارش وصل؛ سطرهای ذخیره‌شده پیش از نوشتن سطرهای تازه خوانده می‌شوند */
export async function editLinkedOrder(
  tx: DbExecutor,
  edit: Omit<LinkedOrderEdit, 'oldLines'>,
): Promise<{ note: string }> {
  if (!hooks) return { note: '' };
  const oldLines = await tx.select({ itemId: documentItems.itemId, quantity: documentItems.quantity }).from(documentItems)
    .where(and(eq(documentItems.documentId, edit.documentId), eq(documentItems.isDeleted, 0)));
  return hooks.editOrder(tx, { ...edit, oldLines: oldLines.map(l => ({ itemId: l.itemId, quantity: l.quantity.toString() })) });
}

export async function voidLinkedOrder(tx: DbExecutor, voided: { documentId: number; requisitionId: number | null; user: string }): Promise<void> {
  if (!hooks || voided.requisitionId === null) return;
  await hooks.voidOrder(tx, { ...voided, requisitionId: voided.requisitionId });
}
