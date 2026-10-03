import type { DbClient } from './types.js';
import { ItemStockReservationService } from '../items/itemStockReservation.service.js';

/** نتیجه کسر رزرو پروژه در ثبت/نهایی‌سازی حواله خروج (v7.0.102، TD-233) */
export interface ProjectReservationRelease {
  projectId: number;
  releasedQuantity: number;
  releasedItemIds: number[];
}

/**
 * v7.0.102 (TD-233): کسر رزرو پروژه بابت اقلام یک حواله خروج نهایی، داخل تراکنش فراخواننده (قفل سطری و OCC پروژه
 * در ItemStockReservationService.releaseProjectReservations). مسیر ثبت و مسیر نهایی‌سازی هر دو از همین تابع استفاده می‌کنند.
 */
export async function releaseReservationsForDocument(
  tx: DbClient,
  projectId: number,
  docId: number,
  docLines: Array<{ itemId: unknown; quantity: unknown }>,
  username: string | undefined,
  userId?: number
): Promise<ProjectReservationRelease> {
  const result = await ItemStockReservationService.releaseProjectReservations(tx, {
    projectId,
    docItems: docLines
      .map(l => ({ itemId: l.itemId, quantity: Number(l.quantity || 0) }))
      .filter(l => l.quantity > 0),
    docId,
    userId,
    username: username || undefined,
  });
  return { projectId, releasedQuantity: result.releasedQuantity, releasedItemIds: result.releasedItemIds };
}
