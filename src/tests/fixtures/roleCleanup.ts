import { inArray, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { roles, users } from '../../db/schema.js';

/**
 * v10.0.164 (TD-962): users.role references roles.code, so a test role is deleted only after its test users let go of
 * it. The users holding the roles are soft-deleted and left without a role (an active user must hold one), then the
 * roles are deleted. For test cleanup only.
 */
export async function deleteTestRoles(where: SQL | undefined): Promise<void> {
  const rows = await orm.select({ code: roles.code }).from(roles).where(where);
  const codes = rows.map(r => r.code);
  if (codes.length === 0) return;
  await orm.update(users).set({ isDeleted: 1, role: null }).where(inArray(users.role, codes));
  await orm.delete(roles).where(inArray(roles.code, codes));
}
