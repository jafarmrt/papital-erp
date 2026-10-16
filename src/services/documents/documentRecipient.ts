import { and, eq, isNull, ne, or } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { personnel } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import {
  RECIPIENT_INVALID, RECIPIENT_INVALID_MESSAGE, RECIPIENT_REMITTANCE_ONLY, RECIPIENT_REMITTANCE_ONLY_MESSAGE,
  RECIPIENT_TERMINATED_STATUS, parseRecipientPersonnelId,
} from '../../lib/workshop/recipient.js';

/**
 * v10.1.37 (N-01, TD-1283, decision ت۴ الف): the recipient of a remittance (`documents.recipient_personnel_id`). Only a
 * remittance takes one (422 `RECIPIENT_REMITTANCE_ONLY`), and it is a live personnel who has not left, read `FOR SHARE`
 * in the document's transaction (else 422 `RECIPIENT_PERSONNEL_INVALID`). Nothing sent means none.
 */
export function documentRecipientInput(docType: string, raw: unknown): number | null {
  const id = parseRecipientPersonnelId(raw);
  if (id === undefined || id === null) return null;
  if (Number.isNaN(id)) throw new ValidationError(RECIPIENT_INVALID_MESSAGE, undefined, RECIPIENT_INVALID);
  if (docType !== 'remittance') throw new ValidationError(RECIPIENT_REMITTANCE_ONLY_MESSAGE, undefined, RECIPIENT_REMITTANCE_ONLY);
  return id;
}

export async function assertLiveRecipient(tx: DbExecutor, personnelId: number | null): Promise<void> {
  if (personnelId === null) return;
  const [row] = await tx.select({ id: personnel.id }).from(personnel)
    .where(and(eq(personnel.id, personnelId), eq(personnel.isDeleted, 0), or(isNull(personnel.employmentStatus), ne(personnel.employmentStatus, RECIPIENT_TERMINATED_STATUS))))
    .for('share');
  if (!row) throw new ValidationError(RECIPIENT_INVALID_MESSAGE, { personnelId }, RECIPIENT_INVALID);
}
