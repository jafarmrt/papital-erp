import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { fin } from '../../lib/financialDecimal.js';
import type { DbClient } from './types.js';
import { projectReservationReleases } from '../../db/schema.js';
import { ItemStockReservationService, type InventoryControlItem, type ReservationQtyField } from '../items/itemStockReservation.service.js';

/** نتیجه کسر رزرو پروژه در ثبت/نهایی‌سازی حواله خروج (v7.0.102، TD-233) */
export interface ProjectReservationRelease {
  projectId: number;
  releasedQuantity: number;
  releasedItemIds: number[];
}

/**
 * v7.0.102 (TD-233): کسر رزرو پروژه بابت اقلام یک حواله خروج نهایی، داخل تراکنش فراخواننده (قفل سطری و OCC پروژه
 * در ItemStockReservationService.releaseProjectReservations). مسیر ثبت و مسیر نهایی‌سازی هر دو از همین تابع استفاده می‌کنند.
 * v7.0.105 (TD-237): هر کسر در project_reservation_releases ثبت می‌شود تا ابطال حواله آن را برگرداند.
 */
export async function releaseReservationsForDocument(
  tx: DbClient,
  projectId: number,
  docId: number,
  docLines: Array<{ itemId: unknown; quantity: unknown }>,
  username: string | undefined,
  userId?: number
): Promise<ProjectReservationRelease> {
  return releaseReservations(tx, projectId, { documentId: docId }, docLines, username, userId);
}

/**
 * v9.0.452 (TD-918، یافته P5-M02/M01 فاز ۵): تخصیص مواد به پروژه، مانند حواله خروج همان پروژه (TD-233)، رزرو پروژه را در
 * تراکنش تخصیص کم می‌کند و هر کسر را با شماره تخصیص در project_reservation_releases ثبت می‌کند تا آزادسازی آن برگرداند.
 */
export async function releaseReservationsForAllocation(
  tx: DbClient,
  projectId: number,
  allocationId: number,
  lines: Array<{ itemId: unknown; quantity: unknown }>,
  username: string | undefined,
  userId?: number
): Promise<ProjectReservationRelease> {
  return releaseReservations(tx, projectId, { bomAllocationId: allocationId }, lines, username, userId);
}

/** منبع یک کسر رزرو: سند خروج یا تخصیص مواد (قید chk_project_reservation_releases_source) */
type ReleaseSource = { documentId: number; bomAllocationId?: undefined } | { bomAllocationId: number; documentId?: undefined };

async function releaseReservations(
  tx: DbClient,
  projectId: number,
  source: ReleaseSource,
  lines: Array<{ itemId: unknown; quantity: unknown }>,
  username: string | undefined,
  userId?: number
): Promise<ProjectReservationRelease> {
  const result = await ItemStockReservationService.releaseProjectReservations(tx, {
    projectId,
    docItems: lines
      .map(l => ({ itemId: l.itemId, quantity: Number(l.quantity || 0) }))
      .filter(l => l.quantity > 0),
    docId: source.documentId ?? null,
    bomAllocationId: source.bomAllocationId ?? null,
    userId,
    username: username || undefined,
  });
  if (result.deductions.length > 0) {
    await tx.insert(projectReservationReleases).values(result.deductions.map(d => ({
      documentId: source.documentId ?? null,
      bomAllocationId: source.bomAllocationId ?? null,
      projectId,
      itemId: d.itemId,
      qtyField: d.qtyField,
      quantity: d.quantity,
      reservationRow: d.row,
    })));
  }
  return { projectId, releasedQuantity: result.releasedQuantity, releasedItemIds: result.releasedItemIds };
}

/**
 * v7.0.105 (TD-237، تصمیم مالک محصول «برگردد»): ابطال/حذف حواله خروج نهایی، رزروهای کسرشده همان حواله را (طبق
 * project_reservation_releases) به همان پروژه برمی‌گرداند و restored_at را ثبت می‌کند؛ داخل تراکنش ابطال.
 * حواله‌هایی که پیش از v7.0.105 کسر شده‌اند سابقه‌ای ندارند و چیزی برنمی‌گردانند.
 */
export async function restoreReservationsForDocument(
  tx: DbClient,
  docId: number,
  username: string | undefined,
  userId?: number
): Promise<number> {
  return restoreReservations(tx, { documentId: docId }, username, userId);
}

/**
 * v9.0.452 (TD-918): آزادسازی تخصیص مواد، رزرو کسرشده همان تخصیص را (طبق project_reservation_releases) به همان پروژه
 * برمی‌گرداند؛ تخصیص‌های پیش از v9.0.452 رزروی کم نکرده‌اند و چیزی برنمی‌گردانند.
 */
export async function restoreReservationsForAllocation(
  tx: DbClient,
  allocationId: number,
  username: string | undefined,
  userId?: number
): Promise<number> {
  return restoreReservations(tx, { bomAllocationId: allocationId }, username, userId);
}

async function restoreReservations(
  tx: DbClient,
  source: ReleaseSource,
  username: string | undefined,
  userId?: number
): Promise<number> {
  const sourceCondition = source.documentId !== undefined
    ? eq(projectReservationReleases.documentId, source.documentId)
    : eq(projectReservationReleases.bomAllocationId, source.bomAllocationId);
  const records = await tx.select().from(projectReservationReleases)
    .where(and(sourceCondition, isNull(projectReservationReleases.restoredAt)))
    .orderBy(asc(projectReservationReleases.id))
    .for('update');
  if (records.length === 0) return 0;

  let restoredQuantity = fin(0);
  const projectIds = Array.from(new Set(records.map(r => r.projectId))).sort((a, b) => a - b);
  for (const projectId of projectIds) {
    const result = await ItemStockReservationService.restoreProjectReservations(tx, {
      projectId,
      deductions: records.filter(r => r.projectId === projectId).map(r => ({
        itemId: r.itemId,
        qtyField: r.qtyField as ReservationQtyField,
        quantity: Number(r.quantity),
        row: r.reservationRow as InventoryControlItem,
      })),
      docId: source.documentId ?? null,
      bomAllocationId: source.bomAllocationId ?? null,
      userId,
      username,
    });
    restoredQuantity = restoredQuantity.add(result.restoredQuantity);
  }
  await tx.update(projectReservationReleases)
    .set({ restoredAt: sql`now()` })
    .where(inArray(projectReservationReleases.id, records.map(r => r.id)));
  return restoredQuantity.toNumber();
}
