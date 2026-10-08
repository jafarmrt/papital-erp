import { fin } from '../../lib/financialDecimal.js';
import { isProjectFinalized, storedReservationRows } from '../../lib/projects/projectReservationState.js';
import { ItemStockReservationService } from '../../services/items/itemStockReservation.service.js';
import type { InvariantViolation } from './businessInvariants.js';
import { QTY_TOLERANCE, rows } from './ledgerRows.js';

/**
 * v10.0.10 (TD-982, I-01) — reservation invariants, read-only:
 *
 * I7 (V8 catalogue, V8_MASTER_ROADMAP.md §4) for the given projects:
 * - no stored reservation row holds a negative quantity (TD-233);
 * - only a finalized project holds a stored reservation (TD-306 / TD-817);
 * - `project_reservation_releases` agrees with its sources: a deduction of a voided document or of a released
 *   allocation is restored, and one of a live document or an open allocation is not (TD-237 / TD-918).
 * I19 for the given items: the reservations of an item (sales proformas and finalized projects, the report every
 *   sellable check reads) do not exceed its stock. A stock count or a void may still lower stock below a reservation
 *   (TD-819), so the simulator reports I19 only after the steps whose path is guarded (`overReservedItems`).
 */

const QTY_FIELDS = ['convertedReservedQty', 'convertedQty', 'reservedQty', 'warehouseStockQty', 'stockQty'] as const;

export async function checkProjectReservations(projectIds: number[] | undefined): Promise<InvariantViolation[]> {
  if (!projectIds || projectIds.length === 0) return [];
  const violations: InvariantViolation[] = [];
  const projects = await rows<{ id: number; project_code: string; inventory_control: unknown }>(
    `SELECT id, project_code, inventory_control FROM production_projects WHERE id = ANY($1::int[]) AND is_deleted = 0 ORDER BY id`,
    [projectIds]
  );
  for (const p of projects) {
    const stored = storedReservationRows<Record<string, unknown>>(p.inventory_control);
    const negative = stored.filter(r => QTY_FIELDS.some(f => r[f] !== undefined && r[f] !== null && Number(r[f]) < -QTY_TOLERANCE));
    if (negative.length > 0) {
      violations.push({
        invariant: 'I7_project_reservation',
        key: `project:${p.id}:negative`,
        message: `Project ${p.project_code} has ${negative.length} reservation rows with a negative quantity`,
        expected: '0',
        actual: String(negative.length),
      });
    }
    if (stored.length > 0 && !isProjectFinalized(p.inventory_control)) {
      violations.push({
        invariant: 'I7_project_reservation',
        key: `project:${p.id}:unfinalized`,
        message: `Project ${p.project_code} is not finalized but holds ${stored.length} reservation rows`,
      });
    }
  }
  const releases = await rows<{ id: number; project_id: number; source: string; restored: boolean; source_closed: boolean }>(
    `SELECT r.id, r.project_id,
            CASE WHEN r.document_id IS NOT NULL THEN 'document ' || r.document_id ELSE 'allocation ' || r.bom_allocation_id END AS source,
            r.restored_at IS NOT NULL AS restored,
            CASE WHEN r.document_id IS NOT NULL
                 THEN COALESCE((SELECT d.is_deleted = 1 FROM documents d WHERE d.id = r.document_id), true)
                 ELSE COALESCE((SELECT a.status = 'released' OR a.is_deleted = 1 FROM project_bom_allocations a WHERE a.id = r.bom_allocation_id), true)
            END AS source_closed
       FROM project_reservation_releases r
      WHERE r.project_id = ANY($1::int[])
      ORDER BY r.id`,
    [projectIds]
  );
  for (const r of releases) {
    if (r.restored !== r.source_closed) {
      violations.push({
        invariant: 'I7_project_reservation',
        key: `release:${r.id}`,
        message: `Reservation deduction ${r.id} of project ${r.project_id} by ${r.source} is ${r.restored ? 'restored' : 'not restored'} while its source is ${r.source_closed ? 'voided or released' : 'live'}`,
      });
    }
  }
  return violations;
}

export interface OverReservedItem { itemId: number; stock: string; reserved: string }

/** I19: items of the list whose reservations exceed their stock */
export async function overReservedItems(itemIds: number[]): Promise<OverReservedItem[]> {
  if (itemIds.length === 0) return [];
  const reserved = await ItemStockReservationService.getReservedStocksMap({ itemIds });
  const stock = await rows<{ id: number; stock: string }>(
    `SELECT id, COALESCE(current_stock, 0)::text AS stock FROM items WHERE id = ANY($1::int[]) ORDER BY id`, [itemIds]);
  return stock.flatMap(s => {
    const qty = fin(reserved[String(s.id)]?.totalReserved ?? 0);
    return qty.subtract(fin(s.stock)).greaterThan(QTY_TOLERANCE) ? [{ itemId: s.id, stock: s.stock, reserved: qty.toString() }] : [];
  });
}

export async function checkReservationWithinStock(itemIds: number[]): Promise<InvariantViolation[]> {
  return (await overReservedItems(itemIds)).map(o => ({
    invariant: 'I19_reservation_within_stock' as const,
    key: `item:${o.itemId}`,
    message: `Reservations of item ${o.itemId} exceed its stock`,
    expected: `<= ${o.stock}`,
    actual: o.reserved,
  }));
}
