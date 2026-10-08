import { asc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { purchaseRequisitions } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import {
  canConsolidateRequisition, CONSOLIDATED_REQUISITION_STATUS, REQUISITION_PRIORITIES, type RequisitionPriority,
} from '../../lib/procurement/requisitionFields.js';
import type { PurchaseRequisitionItemRow } from '../../types.js';
import { terminateOpenWorkflows } from '../workflow/workflowTermination.js';
import type { RequisitionItemWithReceipt } from './requisitionReceipt.js';
import { requisitionOrderDocuments } from './requisitionReceiveAction.js';
import type { RequisitionRowFields } from './requisitionRows.js';

type RequisitionRecord = typeof purchaseRequisitions.$inferSelect;

const toPersianDigits = (n: number): string => String(n).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const rowsOf = (req: RequisitionRecord): PurchaseRequisitionItemRow[] => (Array.isArray(req.items) ? req.items as PurchaseRequisitionItemRow[] : []);

/**
 * v9.0.349 (TD-694، B10-07، تصمیم ت۳ الف بسته ۱۰): درخواست‌های منبع تجمیع در یک تراکنش و به ترتیب شناسه قفل می‌شوند.
 * شناسه‌ای که نباشد یا حذف شده باشد کل تجمیع را رد می‌کند (پیش‌تر بی‌صدا کنار گذاشته می‌شد)، و فقط درخواست تأییدنشده و
 * بی سفارش تجمیع می‌شود (پیش‌تر درخواستِ دریافت‌شده هم تجمیع می‌شد و نیاز ۸ واحدی ۱۸ واحد سفارش می‌گرفت).
 */
export async function lockConsolidationSources(tx: DbExecutor, requisitionIds: number[]): Promise<RequisitionRecord[]> {
  const ids = [...new Set(requisitionIds.map(Number))].filter(id => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
  if (ids.length < 2) {
    throw new ValidationError('برای تجمیع دست‌کم دو درخواست خرید جدا انتخاب کنید.');
  }
  const locked = await tx.select().from(purchaseRequisitions)
    .where(inArray(purchaseRequisitions.id, ids))
    .orderBy(asc(purchaseRequisitions.id))
    .for('update');
  const live = locked.filter(req => Number(req.isDeleted ?? 0) === 0);
  const missing = ids.filter(id => !live.some(req => req.id === id));
  if (missing.length > 0) {
    throw new NotFoundError(
      `درخواست خرید با شناسه ${missing.map(toPersianDigits).join('، ')} یافت نشد یا حذف شده است؛ تجمیع انجام نشد.`,
      { requisitionIds: missing }, 'REQUISITION_NOT_FOUND',
    );
  }
  const refused: string[] = [];
  for (const req of live) {
    const orders = await requisitionOrderDocuments(tx, { id: req.id, items: req.items as RequisitionItemWithReceipt[] });
    if (!canConsolidateRequisition({ status: req.status, items: rowsOf(req) }) || orders.length > 0) refused.push(req.code);
  }
  if (refused.length > 0) {
    throw new ConflictError(
      `فقط درخواست خرید تأییدنشده و بی سفارش تجمیع می‌شود؛ درخواست ${refused.join('، ')} تأیید، سفارش، دریافت، رد یا پیش‌تر تجمیع شده است.`,
      { codes: refused }, 'REQUISITION_NOT_CONSOLIDATABLE',
    );
  }
  return live;
}

/**
 * ردیف‌های درخواست تجمیعی: ردیف‌های یک کالای فهرست (یا یک نام و واحد بیرون از فهرست) یکی می‌شوند، مقدارشان جمع می‌شود و
 * برآورد قیمت واحد میانگین وزنی برآوردهاست، پس جمع برآورد درخواست تجمیعی همان جمع برآورد منبع‌هاست.
 */
export function mergeConsolidationRows(sources: RequisitionRecord[]): RequisitionRowFields[] {
  const merged = new Map<string, { row: RequisitionRowFields; qty: FinancialDecimal; total: FinancialDecimal; codes: string[] }>();
  for (const source of sources) {
    for (const row of rowsOf(source)) {
      const qty = fin(row.requestedQty ?? 0);
      if (!qty.isPositive()) continue;
      const key = row.itemId
        ? `item:${row.itemId}`
        : `name:${String(row.itemName ?? '').trim().toLowerCase()}|${String(row.unit ?? '').trim()}`;
      const amount = qty.multiply(fin(row.unitPriceEstimate ?? 0));
      const entry = merged.get(key);
      if (entry) {
        entry.qty = entry.qty.add(qty);
        entry.total = entry.total.add(amount);
        if (!entry.codes.includes(source.code)) entry.codes.push(source.code);
        continue;
      }
      merged.set(key, {
        row: {
          itemId: row.itemId ?? null, itemCode: row.itemCode, itemName: row.itemName, category: row.category, unit: row.unit,
          targetSupplierId: row.targetSupplierId ?? null, targetSupplierName: row.targetSupplierName, requestedQty: undefined,
        },
        qty, total: amount, codes: [source.code],
      });
    }
  }
  return [...merged.values()].map(({ row, qty, total, codes }) => ({
    ...row,
    requestedQty: qty.toNumber(),
    unitPriceEstimate: total.divide(qty).toNumber(),
    notes: `تجمیع از ${codes.join('، ')}`,
  }));
}

/** سرآیند درخواست تجمیعی از منبع‌ها: فوری‌ترین اولویت، زودترین تاریخ نیاز و پروژه مشترک (اگر همه یک پروژه دارند) */
export function consolidationHeader(sources: RequisitionRecord[]): { priority: RequisitionPriority; requiredDate?: string; projectId: number | null } {
  const rank = (p: string | null) => {
    const index = (REQUISITION_PRIORITIES as readonly string[]).indexOf(String(p));
    return index < 0 ? REQUISITION_PRIORITIES.indexOf('normal') : index;
  };
  const priority = REQUISITION_PRIORITIES[Math.min(...sources.map(s => rank(s.priority)))];
  const dates = sources.map(s => String(s.requiredDate ?? '')).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const projects = new Set(sources.map(s => s.projectId ?? null));
  return { priority, requiredDate: dates[0], projectId: projects.size === 1 ? [...projects][0] : null };
}

/**
 * منبع‌ها در همان تراکنش «تجمیع‌شده» می‌شوند، با پیوند به درخواست تازه، و گردش کار باز هر یک با موتور خاتمه می‌یابد
 * (TERMINATED، کارهای منتظر لغو و ردیف تاریخچه)؛ برای هر منبع یک ردیف ممیزی با وضعیت پیش و پس.
 */
export async function closeConsolidationSources(
  tx: DbExecutor,
  sources: RequisitionRecord[],
  target: { id: number; code: string },
  user: { id?: number; username?: string },
): Promise<void> {
  for (const source of sources) {
    await tx.update(purchaseRequisitions).set({
      status: CONSOLIDATED_REQUISITION_STATUS,
      consolidatedIntoId: target.id,
      updatedAt: new Date().toISOString(),
    }).where(eq(purchaseRequisitions.id, source.id));
    await terminateOpenWorkflows(tx, {
      entityType: 'purchase_requisition', entityId: source.id, actionKey: 'terminate',
      actionTitle: 'بستن فرایند با تجمیع درخواست خرید', comment: `تجمیع در درخواست خرید ${target.code}`,
      userId: user.id, userName: user.username,
    });
    await logActivity({
      tx,
      userId: user.id,
      username: user.username || 'سیستم',
      action: 'UPDATE',
      entity: 'درخواست خرید',
      entityId: source.id,
      description: `تجمیع درخواست خرید ${source.code} در ${target.code}`,
      details: {
        code: source.code,
        before: { status: source.status },
        after: { status: CONSOLIDATED_REQUISITION_STATUS, consolidatedIntoId: target.id, consolidatedIntoCode: target.code },
      },
    });
  }
}

/** درخواستِ تجمیع‌شده بسته است: نه اقدام گردش کار، نه سفارش، نه ویرایش و نه حذف؛ کار با درخواست تجمیعی ادامه می‌یابد */
export function assertRequisitionNotConsolidated(req: { code: string; status: string | null }): void {
  if (req.status === CONSOLIDATED_REQUISITION_STATUS) {
    throw new ConflictError(
      `درخواست خرید ${req.code} در درخواست دیگری تجمیع شده است و اقدامی روی آن انجام نمی‌شود؛ کار را با درخواست تجمیعی ادامه دهید.`,
      undefined, 'REQUISITION_CONSOLIDATED',
    );
  }
}

/** کد درخواست تجمیعی هر درخواستِ تجمیع‌شده، برای فهرست و جزئیات درخواست‌ها */
export async function consolidatedIntoCodes(db: DbExecutor, rows: Array<{ consolidatedIntoId?: number | null }>): Promise<Map<number, string>> {
  const ids = [...new Set(rows.map(r => Number(r.consolidatedIntoId)).filter(id => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return new Map();
  const targets = await db.select({ id: purchaseRequisitions.id, code: purchaseRequisitions.code })
    .from(purchaseRequisitions).where(inArray(purchaseRequisitions.id, ids));
  return new Map(targets.map(t => [t.id, t.code]));
}
