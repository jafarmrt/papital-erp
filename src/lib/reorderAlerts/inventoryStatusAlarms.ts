import { canOpenPage, type ViewerAccess } from '../permissions/pageAccess';
import { freeStockOf, type ReorderItem } from './reorderItems';

/**
 * v10.0.42 (TD-1158): the reorder alarm of the «وضعیت انبار» page is the reorder page's own list (GET /items/reorder-alerts:
 * free stock = stock − reservations against the reorder point, TD-843), so both pages show the same items. It is shown only
 * to a viewer who may open the reorder page (`products.view` / `warehouse.view`); a `reports.view`-only viewer sees the
 * page without the alarm, never a refused request.
 */
export const canSeeInventoryStatusAlarms = (viewer: ViewerAccess | null | undefined): boolean =>
  canOpenPage('/reorder-alerts', viewer);

export interface InventoryStatusAlarm {
  id: number;
  code: string;
  name: string;
  type: ReorderItem['type'];
  unit: string;
  freeStock: number;
  reorderPoint: number;
}

export function inventoryStatusAlarmsOf(items: readonly ReorderItem[] | null | undefined): InventoryStatusAlarm[] {
  const safeItems = Array.isArray(items) ? items : [];
  return safeItems.map(item => ({
    id: item.id,
    code: item.code,
    name: item.name,
    type: item.type,
    unit: item.unit,
    freeStock: freeStockOf(item),
    reorderPoint: Number(item.reorder_point),
  }));
}
