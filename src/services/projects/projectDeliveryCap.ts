import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentItems, documents, type productionProjects } from '../../db/schema.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';

/** v8.0.52 (TD-327): کالای محصول پروژه که بیش از مقدار برنامه‌ریزی‌شده به انبار تحویل می‌شود */
export interface ProjectOverDelivery {
  itemId: number;
  itemName: string;
  unit: string;
  planned: number;
  delivered: number;
  requested: number;
  excess: number;
}

interface PlannedProduct {
  quantity: FinancialDecimal;
  itemName: string;
  unit: string;
}

type ProjectRow = Pick<typeof productionProjects.$inferSelect, 'products' | 'itemId' | 'itemName' | 'quantity' | 'unit'>;

/**
 * مقدار برنامه‌ریزی‌شده هر کالای محصول پروژه: جمع ردیف‌های products با همان کالا، وگرنه کالای اصلی پروژه با مقدار پروژه
 * (همان قاعده‌ای که برگه «ورود به انبار» و ماتریس پیشرفت به کار می‌برند).
 */
export function plannedProjectProducts(project: ProjectRow): Map<number, PlannedProduct> {
  const planned = new Map<number, PlannedProduct>();
  const rows = Array.isArray(project.products) ? project.products as Array<Record<string, unknown>> : [];
  for (const row of rows) {
    const itemId = Number(row.item_id ?? row.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) continue;
    const prev = planned.get(itemId);
    planned.set(itemId, {
      quantity: (prev?.quantity ?? fin(0)).add(fin(Number(row.quantity) || 0)),
      itemName: prev?.itemName || String(row.item_name ?? row.itemName ?? ''),
      unit: prev?.unit || String(row.unit ?? ''),
    });
  }
  if (planned.size === 0 && project.itemId) {
    planned.set(project.itemId, { quantity: fin(project.quantity || 0), itemName: project.itemName || '', unit: project.unit || '' });
  }
  return planned;
}

/**
 * مقدار تحویل‌شده هر کالا به انبار از همین پروژه: سطرهای فعال اسناد قطعی «رسید تولید» پروژه (v8.0.35 به بعد). فراخواننده
 * ردیف پروژه را پیش‌تر در همان تراکنش قفل کرده است، پس دو تحویل هم‌زمان پشت هم شمرده می‌شوند.
 */
export async function deliveredProjectQuantities(tx: DbExecutor, projectId: number, itemIds: number[]): Promise<Map<number, FinancialDecimal>> {
  const delivered = new Map<number, FinancialDecimal>();
  if (itemIds.length === 0) return delivered;
  const rows = await tx
    .select({ itemId: documentItems.itemId, quantity: sql<string>`SUM(${documentItems.quantity})::text` })
    .from(documentItems)
    .innerJoin(documents, eq(documents.id, documentItems.documentId))
    .where(and(
      eq(documents.projectId, projectId),
      eq(documents.type, 'production_receipt'),
      eq(documents.status, 'final'),
      eq(documents.isDeleted, 0),
      eq(documentItems.isDeleted, 0),
      inArray(documentItems.itemId, itemIds)
    ))
    .groupBy(documentItems.itemId);
  for (const row of rows) {
    if (row.itemId) delivered.set(row.itemId, fin(row.quantity ?? 0));
  }
  return delivered;
}

/** کالاهایی که با این تحویل از مقدار برنامه‌ریزی‌شده پروژه بیشتر می‌شوند */
export function findOverDeliveries(
  planned: Map<number, PlannedProduct>,
  delivered: Map<number, FinancialDecimal>,
  lines: Array<{ itemId: number; quantity: number }>
): ProjectOverDelivery[] {
  const requested = new Map<number, FinancialDecimal>();
  for (const line of lines) requested.set(line.itemId, (requested.get(line.itemId) ?? fin(0)).add(fin(line.quantity)));
  const over: ProjectOverDelivery[] = [];
  for (const [itemId, quantity] of requested) {
    const plan = planned.get(itemId);
    if (!plan) continue;
    const before = delivered.get(itemId) ?? fin(0);
    const excess = before.add(quantity).subtract(plan.quantity);
    if (!excess.isPositive()) continue;
    over.push({
      itemId, itemName: plan.itemName, unit: plan.unit,
      planned: plan.quantity.toNumber(), delivered: before.toNumber(), requested: quantity.toNumber(), excess: excess.toNumber(),
    });
  }
  return over;
}

export function describeOverDeliveries(over: ProjectOverDelivery[]): string {
  return over.map(o => `«${o.itemName || o.itemId}» ${o.excess} ${o.unit} بیش از برنامه (برنامه ${o.planned}، تحویل‌شده ${o.delivered}، این تحویل ${o.requested})`).join('؛ ');
}
