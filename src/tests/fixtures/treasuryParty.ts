import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { accounts } from '../../db/schema.js';

/**
 * v9.0.72 (TD-507): a receipt or payment of party type «other» (or personnel «other») needs a counter account the user
 * chose. Tests that only need a bank movement use 7009 «other workshop expenses», a standard subsidiary account that the
 * rule accepts.
 */
export async function miscContraAccountId(): Promise<number> {
  const [row] = await orm.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.code, '7009'), eq(accounts.isDeleted, 0)));
  if (!row) throw new Error('standard account 7009 is missing from the test chart of accounts');
  return row.id;
}
