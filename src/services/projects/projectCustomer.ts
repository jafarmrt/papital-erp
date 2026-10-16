import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { customers } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { normalizeDecimalString } from '../../lib/numericInput.js';

/**
 * OBS-R2-43: a project's customer link. A positive customer id is a live party read `FOR SHARE` in the project's
 * transaction, else 422 `PROJECT_CUSTOMER_INVALID`, and the stored customer name is that party's current name. Before,
 * an unknown id silently became no customer, a deleted party was linked and the name sent was stored whatever party
 * the id named. A project keeps the party it already holds even after that party was deleted (a completed or cancelled
 * project's customer may be deleted, TD-431), so editing such a project is not refused.
 */
export const PROJECT_CUSTOMER_INVALID = 'PROJECT_CUSTOMER_INVALID';

export interface ProjectCustomer {
  id: number;
  name: string;
}

/** Empty, null and zero mean «no customer»; anything else must be a positive whole id. */
function customerIdOf(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const text = normalizeDecimalString(String(value)).trim();
  if (text === '' || text === '0') return null;
  const id = Number(text);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`شناسه مشتری پروژه نامعتبر است (مقدار دریافتی: ${String(value)}).`, { customerId: value }, PROJECT_CUSTOMER_INVALID);
  }
  return id;
}

/**
 * The party a project links to, or null for none. `currentCustomerId` is the project's stored link (edit only): that
 * party is accepted even when it was deleted later.
 */
export async function resolveProjectCustomer(
  executor: DbExecutor,
  value: unknown,
  currentCustomerId: number | null = null,
): Promise<ProjectCustomer | null> {
  const id = customerIdOf(value);
  if (id === null) return null;
  const [row] = await executor.select({ id: customers.id, name: customers.name, isDeleted: customers.isDeleted })
    .from(customers).where(eq(customers.id, id)).for('share');
  const live = row !== undefined && (row.isDeleted ?? 0) === 0;
  if (!row || (!live && row.id !== currentCustomerId)) {
    throw new ValidationError(
      'مشتری انتخاب‌شده برای پروژه یافت نشد یا حذف شده است؛ مشتری را دوباره از فهرست انتخاب کنید.',
      { customerId: id },
      PROJECT_CUSTOMER_INVALID,
    );
  }
  return { id: row.id, name: row.name };
}

/** The current name of the party a project already links to (deleted parties too), or null when it has none. */
export async function linkedCustomerName(executor: DbExecutor, customerId: number | null): Promise<string | null> {
  if (!customerId) return null;
  const [row] = await executor.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId));
  return row ? row.name : null;
}
