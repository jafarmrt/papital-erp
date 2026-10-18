import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items, productionProjects } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import type { DeliveryCostReport } from '../../lib/projects/deliveryCostSuggestion.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { projectWipBalances } from '../accounting/projectWipBalance.js';
import { deliveredProjectQuantities, plannedProjectProducts } from './projectDeliveryCap.js';

/**
 * v10.2.1 (TD-1290، یافتهٔ D2): ورودی‌های بهای پیشنهادی «ورود به انبار» پروژه: مقدار برنامه و تحویل‌شدهٔ هر محصول
 * (`plannedProjectProducts` / `deliveredProjectQuantities`، همان قاعدهٔ سقف تحویل) و، فقط برای خوانندهٔ مجاز به دیدن بها، ماندهٔ
 * ۱۴۰۲ پروژه (`projectWipBalances`: همهٔ وضعیت‌های سند، پیش‌نویس هم) و میانگین موزون بهای جاری هر محصول. فقط خواندن است؛ سند و
 * مانده‌ای دست نمی‌خورد و بهای ثبت‌شدهٔ رسید همان است که کاربر می‌فرستد.
 */
export async function projectDeliveryCost(executor: DbExecutor, projectId: number, costVisible: boolean): Promise<DeliveryCostReport> {
  const [project] = await executor
    .select({
      products: productionProjects.products, itemId: productionProjects.itemId, itemName: productionProjects.itemName,
      quantity: productionProjects.quantity, unit: productionProjects.unit,
    })
    .from(productionProjects)
    .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));
  if (!project) throw new NotFoundError('پروژه مورد نظر یافت نشد', undefined, 'PROJECT_NOT_FOUND');

  const planned = plannedProjectProducts(project);
  const itemIds = [...planned.keys()].sort((a, b) => a - b);
  const delivered = await deliveredProjectQuantities(executor, projectId, itemIds);
  const costs = new Map<number, number>();
  if (costVisible && itemIds.length > 0) {
    const rows = await executor.select({ id: items.id, wac: items.weightedAverageCost }).from(items).where(inArray(items.id, itemIds));
    for (const r of rows) costs.set(r.id, fin(r.wac ?? 0).toNumber());
  }
  const wip = costVisible ? (await projectWipBalances(executor, [projectId])).get(projectId) ?? '0' : null;

  return {
    projectId,
    costVisible,
    wipBalance: wip === null ? null : fin(wip).toNumber(),
    products: itemIds.map(itemId => ({
      itemId,
      plannedQty: planned.get(itemId)!.quantity.toNumber(),
      deliveredQty: (delivered.get(itemId) ?? fin(0)).toNumber(),
      weightedAverageCost: costVisible ? costs.get(itemId) ?? 0 : null,
    })),
  };
}
