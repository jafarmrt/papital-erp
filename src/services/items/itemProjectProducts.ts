import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';

/**
 * v11 phase 6.1j (N1): the codes of the open production projects (not completed or canceled) that plan the item as their
 * product, in their product list or, for a project without one, as its main item (the rule of `plannedProjectProducts`).
 * A deleted item could not be received from such a project: its production receipt would be refused.
 */
export async function openProjectsProducingItem(tx: DbExecutor, itemId: number): Promise<string[]> {
  const res = await tx.execute(sql`
    SELECT p.project_code FROM production_projects p
     WHERE COALESCE(p.is_deleted, 0) = 0
       AND COALESCE(p.status, 'planned') NOT IN ('completed', 'cancelled')
       AND (
         EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.products) = 'array' THEN p.products ELSE '[]'::jsonb END) e
                  WHERE COALESCE(e ->> 'item_id', e ->> 'itemId') = ${String(itemId)})
         OR (p.item_id = ${itemId} AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(p.products) = 'array' THEN p.products ELSE '[]'::jsonb END), 0) = 0)
       )
     ORDER BY p.project_code`);
  return ((res.rows ?? []) as Array<{ project_code: string }>).map(r => String(r.project_code));
}
