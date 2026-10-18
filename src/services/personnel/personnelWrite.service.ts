import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { personnel } from '../../db/schema.js';
import { birthdayShownToColleagues, withdrawBirthdayNotifications } from '../social/birthdayNotificationWithdraw.js';

/**
 * v10.0.265 (TD-960, OBS-R2-01): the personnel table is written only here, never from `personnel.routes.ts`. The route
 * keeps its checks, locks, transactions and audit rows and passes its own executor (`tx` inside a transaction).
 */
export type PersonnelRow = typeof personnel.$inferSelect;
export type PersonnelValues = typeof personnel.$inferInsert;

export async function insertPersonnel(db: DbExecutor, values: PersonnelValues): Promise<PersonnelRow> {
  const [row] = await db.insert(personnel).values(values).returning();
  return row;
}

/**
 * Writes a live personnel row only at the version it was read with; `undefined` when it changed or was deleted meanwhile.
 * A row whose birthday colleagues no longer see (turned off or left) takes its birthday notifications out of every bell
 * in the same executor (v10.2 package 9, review M-1).
 */
export async function updatePersonnelAtVersion(
  db: DbExecutor,
  id: number,
  version: number,
  values: Partial<PersonnelValues>,
): Promise<PersonnelRow | undefined> {
  const [row] = await db
    .update(personnel)
    .set(values)
    .where(and(eq(personnel.id, id), eq(personnel.version, version), eq(personnel.isDeleted, 0)))
    .returning();
  if (row && !birthdayShownToColleagues(row)) await withdrawBirthdayNotifications(db, id);
  return row;
}

/** Soft-deletes a personnel and takes its birthday notifications out of every bell in the same executor */
export async function softDeletePersonnel(db: DbExecutor, id: number, updatedAt: string): Promise<void> {
  await db.update(personnel).set({ isDeleted: 1, updatedAt }).where(eq(personnel.id, id));
  await withdrawBirthdayNotifications(db, id);
}
