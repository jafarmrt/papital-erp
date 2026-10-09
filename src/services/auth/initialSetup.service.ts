import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { users, appSettings, warehouses } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { BadRequestError, ConflictError } from '../../errors/customErrors.js';
import { notSyntheticTestUsername } from '../../lib/syntheticUsers.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';
import { SETUP_ALREADY_DONE_MESSAGE, SETUP_IN_PROGRESS_MESSAGE } from '../../lib/auth/setupRules.js';

/** Advisory lock key of the initial setup (SEC-012); taken for the transaction only */
export const SETUP_ADVISORY_LOCK_KEY = 79234;

export interface InitialSetupInput {
  username: string;
  password: string;
  fullName: string;
  companyName: string;
  warehouseName?: string;
  phone?: string;
  address?: string;
  logo?: string;
  currency?: string;
  ipAddress?: string;
}

export type SetupAdmin = typeof users.$inferSelect;

/**
 * v10.0.46 (series 10 phase 3, L5 E7; part of TD-960): the initial setup writes the first system admin, the default
 * warehouse and the company settings in ONE transaction under the transaction advisory lock 79234, with its audit row.
 * Before, the route wrote them one by one on the pool: a failed settings write left an admin behind, so the setup could
 * not be run again, and the session lock could be taken and released on two different pool connections.
 */
/** The setup is done once a real (non-synthetic) user exists; read inside the setup transaction too */
async function setupAlreadyDone(db: Pick<typeof orm, 'select'>): Promise<boolean> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(users).where(notSyntheticTestUsername(users.username));
  return Number(count) > 0;
}

export async function runInitialSetup(input: InitialSetupInput): Promise<SetupAdmin> {
  const hash = await bcrypt.hash(input.password, 10);
  return orm.transaction(async (tx) => {
    const lockResult = (await tx.execute(sql`SELECT pg_try_advisory_xact_lock(${SETUP_ADVISORY_LOCK_KEY}) AS acquired`)) as unknown as
      { rows?: Array<{ acquired?: boolean | string }> } | Array<{ acquired?: boolean | string }>;
    const rows = (lockResult as { rows?: Array<{ acquired?: boolean | string }> })?.rows || (Array.isArray(lockResult) ? lockResult : []);
    if (!(rows[0]?.acquired === true || rows[0]?.acquired === 't')) {
      throw new ConflictError(SETUP_IN_PROGRESS_MESSAGE, undefined, 'SETUP_IN_PROGRESS');
    }

    if (await setupAlreadyDone(tx)) throw new BadRequestError(SETUP_ALREADY_DONE_MESSAGE);

    const [user] = await tx.insert(users).values({
      username: input.username,
      password: hash,
      fullName: input.fullName,
      role: SYSTEM_ADMIN_ROLE,
    }).returning();

    await tx.insert(warehouses).values({ name: input.warehouseName || 'انبار مرکزی', code: 'main', isActive: 1 }).onConflictDoNothing();

    const companySettings = [
      { key: 'company_name', value: input.companyName },
      { key: 'company_phone', value: input.phone || '' },
      { key: 'company_address', value: input.address || '' },
      { key: 'company_logo', value: input.logo || '' },
      { key: 'currency', value: input.currency || 'IRR' },
      { key: 'display_timezone', value: process.env.DISPLAY_TIMEZONE || 'Asia/Tehran' },
    ];
    for (const item of companySettings) {
      await tx.insert(appSettings).values(item).onConflictDoUpdate({ target: appSettings.key, set: { value: item.value } });
    }

    await logActivity({
      tx,
      userId: user.id,
      username: user.username,
      userFullName: user.fullName,
      action: 'CREATE',
      entity: 'کاربران سیستم',
      entityId: user.id,
      description: `راه‌اندازی اولیه سامانه و ساخت مدیر سامانه «${user.username}»`,
      details: { after: { username: user.username, fullName: user.fullName, role: user.role }, companyName: input.companyName },
      ipAddress: input.ipAddress,
    });
    return user;
  });
}

/**
 * v10.0.46 (L5 E7): logout ends every session of the user by raising the token version, read and written under the
 * user row lock in one transaction (AGENTS.md §1.2-1.3); a user that is gone is skipped.
 */
export async function revokeUserSessions(userId: number): Promise<{ username: string; fullName: string } | null> {
  return orm.transaction(async (tx) => {
    const [row] = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for('update');
    if (!row) return null;
    await tx.update(users).set({ tokenVersion: (row.tokenVersion || 0) + 1 }).where(eq(users.id, userId));
    return { username: row.username, fullName: row.fullName || row.username };
  });
}
