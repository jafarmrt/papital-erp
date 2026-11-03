import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { storefrontBuyerAccounts, storefrontBuyerGroups, storefrontBuyerSessions, storefrontPasswordTokens } from '../../db/schema.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { nextVersion } from '../../lib/occHelper.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';
import { cleanText, normalizeMobile } from '../../lib/storefront/storefrontOrderRules.js';
import {
  BUYER_NAME_MAX, LOGIN_FAILURES_MAX, LOGIN_LOCK_MINUTES, SESSION_DAYS, isApplicationStatus, passwordError,
} from '../../lib/storefront/storefrontBuyerRules.js';
import type {
  LoginRequest, RegisterRequest, SetPasswordRequest, StorefrontAccountView, StorefrontGroupPrices, StorefrontSessionAnswer,
} from '../../lib/storefront/storefrontBuyerContracts.js';
import { STOREFRONT_BOT_USER } from './storefrontCustomer.js';
import { catalogItems } from './storefrontCatalog.service.js';
import { pricesOf } from './storefrontItemData.js';
import { rialText } from './storefrontShipping.service.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';
import {
  PASSWORD_TOKEN_PREFIX, SESSION_TOKEN_PREFIX, hashPassword, newToken, presentedToken, tokenHash, verifyPassword,
} from './storefrontBuyerSecrets.js';

/**
 * v11 phase 8.2b (package 18, start plan §6 and §8): buyer accounts on the Storefront API. A retail buyer may make an
 * account with name, phone and password (decision 8); a wholesale buyer signs in after a colleague approved them and they
 * set their password with the one-time link (decision 4). Until SMS arrives in 8.4 the phone is not proven, so an account
 * sees only what it was given: its own orders and, once approved, its group's prices.
 *
 * Sign-in: a wrong phone and a wrong password are the same 401 and cost the same time (a decoy hash); 5 wrong passwords
 * in a row lock the account for 15 minutes; the route limits attempts per address. A session token is 256 random bits
 * and lasts 30 days; only its SHA-256 is kept. Suspending an account, approving it and setting a password end its other
 * sessions. Every route is 404 while the site or its orders are off.
 */
const LAST_SEEN_STEP_MS = 10 * 60_000;

export type AccountRecord = typeof storefrontBuyerAccounts.$inferSelect;
export type GroupRecord = typeof storefrontBuyerGroups.$inferSelect;

export const accountFieldError = (field: string, message: string) => new ValidationError(message, { field }, 'STOREFRONT_ACCOUNT_FIELD_INVALID');
const wrongSignIn = () => new AppError('شمارهٔ همراه یا رمز درست نیست.', 401, 'STOREFRONT_SIGN_IN_FAILED');

/** The site's accounts follow its orders switch: off, every account route is the same 404 */
export async function assertAccountsOpen(executor: DbExecutor): Promise<void> {
  const settings = await storefrontSettingValues(executor);
  if (!settings.enabled || !settings.ordersEnabled) throw new NotFoundError('پیدا نشد');
}

export const nowPlus = (ms: number): string => new Date(Date.now() + ms).toISOString();

/** A live group an account may price with: approved into it, the account active, the group active with a price list */
export async function activeGroupOf(executor: DbExecutor, account: AccountRecord): Promise<GroupRecord | null> {
  if (account.status !== 'active' || account.applicationStatus !== 'approved' || !account.groupId) return null;
  const [group] = await executor.select().from(storefrontBuyerGroups).where(and(
    eq(storefrontBuyerGroups.id, account.groupId), eq(storefrontBuyerGroups.isDeleted, 0), eq(storefrontBuyerGroups.isActive, 1),
  ));
  return group && group.priceList ? group : null;
}

export async function accountView(executor: DbExecutor, account: AccountRecord): Promise<StorefrontAccountView> {
  const group = await activeGroupOf(executor, account);
  const application = isApplicationStatus(account.applicationStatus) ? account.applicationStatus : 'none';
  return {
    name: account.name, phone: account.phone, city: account.city, kind: group ? 'wholesale' : 'retail', application,
    companyName: account.companyName,
    group: group ? {
      code: group.code, title: group.title, minOrderAmount: rialText(group.minOrderAmount), minLineQuantity: group.minLineQuantity,
      paymentMethods: [...(group.allowCard === 1 ? ['card' as const] : []), ...(group.allowOnAccount === 1 ? ['on_account' as const] : [])],
    } : null,
  };
}

/** Ends every live session of an account (inside the caller's transaction) */
export async function revokeSessions(tx: DbExecutor, accountId: number, exceptId?: number): Promise<void> {
  const conditions = [eq(storefrontBuyerSessions.accountId, accountId), isNull(storefrontBuyerSessions.revokedAt)];
  if (exceptId !== undefined) conditions.push(sql`${storefrontBuyerSessions.id} <> ${exceptId}`);
  await tx.update(storefrontBuyerSessions).set({ revokedAt: systemNowUtcIso() }).where(and(...conditions));
}

async function newSession(tx: DbExecutor, account: AccountRecord): Promise<StorefrontSessionAnswer> {
  const token = newToken(SESSION_TOKEN_PREFIX);
  const expiresAt = nowPlus(SESSION_DAYS * 24 * 3600_000);
  await tx.insert(storefrontBuyerSessions).values({ accountId: account.id, tokenHash: tokenHash(token), expiresAt });
  return { sessionToken: token, expiresAt, account: await accountView(tx, account) };
}

/** Serializes the writes of one phone (a register and a wholesale form at the same moment) */
export async function lockPhone(tx: DbExecutor, phoneKey: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`storefront-account:${phoneKey}`}))`);
}

export async function accountByPhoneKey(tx: DbExecutor, phoneKey: string, options: { lock?: boolean } = {}): Promise<AccountRecord | undefined> {
  const query = tx.select().from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.phoneKey, phoneKey));
  const [account] = options.lock ? await query.for('update') : await query;
  return account;
}

export const accountExists = () => new ConflictError(
  'برای این شمارهٔ همراه حساب ساخته شده است؛ وارد شوید، یا اگر رمز را ندارید با فروشگاه تماس بگیرید.', { field: 'phone' }, 'STOREFRONT_ACCOUNT_EXISTS',
);

/** `POST /auth/register`: a retail account (decision 8), signed in at once */
export async function registerAccount(input: RegisterRequest): Promise<StorefrontSessionAnswer> {
  await assertAccountsOpen(orm);
  const name = cleanText(input.name, BUYER_NAME_MAX);
  if (!name || name.length < 2) throw accountFieldError('name', 'نام و نام خانوادگی را بنویسید.');
  const phone = normalizeMobile(input.phone);
  if (!phone) throw accountFieldError('phone', 'شمارهٔ همراه باید ۱۱ رقم و با ۰۹ آغاز شود.');
  const password = String(input.password ?? '');
  const weak = passwordError(password, phone);
  if (weak) throw accountFieldError('password', weak);
  const passwordHash = await hashPassword(password);
  const phoneKey = phoneMatchKey(phone);
  return orm.transaction(async (tx) => {
    await lockPhone(tx, phoneKey);
    if (await accountByPhoneKey(tx, phoneKey)) throw accountExists();
    const [account] = await tx.insert(storefrontBuyerAccounts).values({
      name, phone, phoneKey, status: 'active', passwordHash, lastLoginAt: systemNowUtcIso(), updatedBy: STOREFRONT_BOT_USER,
    }).returning();
    await logActivity({
      tx, username: STOREFRONT_BOT_USER, action: 'CREATE', entity: 'حساب خریدار سایت', entityId: account.id,
      description: `حساب خریدار تکی برای شمارهٔ ${phone} در سایت ساخته شد`, details: { after: { id: account.id, name, kind: 'retail' } },
    });
    return newSession(tx, account);
  });
}

/** `POST /auth/login` */
export async function signIn(input: LoginRequest): Promise<StorefrontSessionAnswer> {
  await assertAccountsOpen(orm);
  const phone = normalizeMobile(input.phone);
  const password = String(input.password ?? '');
  const found = phone ? await accountByPhoneKey(orm, phoneMatchKey(phone)) : undefined;
  if (found?.lockedUntil && Date.parse(found.lockedUntil) > Date.now()) {
    throw new AppError(`تلاش‌های نادرست زیاد بود؛ ${LOGIN_LOCK_MINUTES.toLocaleString('fa-IR')} دقیقهٔ دیگر دوباره امتحان کنید.`, 429, 'STOREFRONT_SIGN_IN_LOCKED');
  }
  // the hash is checked even when no account matched, so an unknown phone answers in the same time
  const matches = await verifyPassword(password, found?.passwordHash ?? '');
  if (!found) throw wrongSignIn();
  return orm.transaction(async (tx) => {
    const [account] = await tx.select().from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.id, found.id)).for('update');
    if (!matches || account.passwordHash !== found.passwordHash) {
      const failures = account.failedLogins + 1;
      const locks = failures >= LOGIN_FAILURES_MAX;
      await tx.update(storefrontBuyerAccounts).set({
        failedLogins: locks ? 0 : failures, lockedUntil: locks ? nowPlus(LOGIN_LOCK_MINUTES * 60_000) : account.lockedUntil,
      }).where(eq(storefrontBuyerAccounts.id, account.id));
      return { failed: true as const };
    }
    if (account.status !== 'active') return { suspended: true as const };
    const now = systemNowUtcIso();
    await tx.update(storefrontBuyerAccounts).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: now }).where(eq(storefrontBuyerAccounts.id, account.id));
    return { session: await newSession(tx, { ...account, failedLogins: 0, lockedUntil: null, lastLoginAt: now }) };
  }).then((result) => {
    // the failure count is committed before the refusal is answered
    if ('failed' in result) throw wrongSignIn();
    if ('suspended' in result) throw new ForbiddenError('این حساب معلق است؛ لطفاً با فروشگاه تماس بگیرید.', undefined, 'STOREFRONT_ACCOUNT_SUSPENDED');
    return result.session;
  });
}

/** The account of a live session, or null; the session's last-seen time moves at most every ten minutes */
export async function sessionAccount(executor: DbExecutor, rawToken: unknown): Promise<AccountRecord | null> {
  const token = presentedToken(rawToken, SESSION_TOKEN_PREFIX);
  if (!token) return null;
  const [row] = await executor.select({ session: storefrontBuyerSessions, account: storefrontBuyerAccounts })
    .from(storefrontBuyerSessions).innerJoin(storefrontBuyerAccounts, eq(storefrontBuyerAccounts.id, storefrontBuyerSessions.accountId))
    .where(and(eq(storefrontBuyerSessions.tokenHash, tokenHash(token)), isNull(storefrontBuyerSessions.revokedAt), gt(storefrontBuyerSessions.expiresAt, systemNowUtcIso())));
  if (!row || row.account.status !== 'active') return null;
  if (Date.now() - Date.parse(row.session.lastSeenAt) > LAST_SEEN_STEP_MS) {
    await executor.update(storefrontBuyerSessions).set({ lastSeenAt: systemNowUtcIso() }).where(eq(storefrontBuyerSessions.id, row.session.id));
  }
  return row.account;
}

const signInNeeded = () => new AppError('برای این کار وارد حساب خود شوید.', 401, 'STOREFRONT_SESSION_REQUIRED');

/** The account of the request's session, or 401 */
export async function requireAccount(rawToken: unknown): Promise<AccountRecord> {
  await assertAccountsOpen(orm);
  const account = await sessionAccount(orm, rawToken);
  if (!account) throw signInNeeded();
  return account;
}

/** `POST /auth/logout`: ends this session only; an unknown token is answered the same */
export async function signOut(rawToken: unknown): Promise<void> {
  await assertAccountsOpen(orm);
  const token = presentedToken(rawToken, SESSION_TOKEN_PREFIX);
  if (!token) return;
  await orm.update(storefrontBuyerSessions).set({ revokedAt: systemNowUtcIso() })
    .where(and(eq(storefrontBuyerSessions.tokenHash, tokenHash(token)), isNull(storefrontBuyerSessions.revokedAt)));
}

/** `GET /account` */
export async function myAccount(rawToken: unknown): Promise<StorefrontAccountView> {
  return accountView(orm, await requireAccount(rawToken));
}

/**
 * `POST /auth/set-password`: the one-time link a colleague made. The link is used up, every other session of the account
 * ends and the buyer is signed in. A used, expired or unknown link is the same 404.
 */
export async function setPasswordWithLink(input: SetPasswordRequest): Promise<StorefrontSessionAnswer> {
  await assertAccountsOpen(orm);
  const token = presentedToken(input.token, PASSWORD_TOKEN_PREFIX);
  const gone = () => new NotFoundError('این پیوند تعیین رمز دیگر کار نمی‌کند؛ از فروشگاه پیوند تازه بخواهید.', undefined, 'STOREFRONT_PASSWORD_LINK_INVALID');
  if (!token) throw gone();
  const password = String(input.password ?? '');
  const [link] = await orm.select({ accountId: storefrontPasswordTokens.accountId }).from(storefrontPasswordTokens)
    .where(eq(storefrontPasswordTokens.tokenHash, tokenHash(token)));
  if (!link) throw gone();
  const [owner] = await orm.select({ phone: storefrontBuyerAccounts.phone }).from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.id, link.accountId));
  const weak = passwordError(password, owner?.phone ?? '');
  if (weak) throw accountFieldError('password', weak);
  const passwordHash = await hashPassword(password);
  return orm.transaction(async (tx) => {
    const [row] = await tx.select().from(storefrontPasswordTokens).where(eq(storefrontPasswordTokens.tokenHash, tokenHash(token))).for('update');
    if (!row || row.usedAt || Date.parse(row.expiresAt) <= Date.now()) throw gone();
    const [account] = await tx.select().from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.id, row.accountId)).for('update');
    if (!account || account.status !== 'active') throw gone();
    const now = systemNowUtcIso();
    await tx.update(storefrontPasswordTokens).set({ usedAt: now }).where(eq(storefrontPasswordTokens.id, row.id));
    const updated = { passwordHash, failedLogins: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now, version: nextVersion(account.version) };
    await tx.update(storefrontBuyerAccounts).set(updated).where(eq(storefrontBuyerAccounts.id, account.id));
    await revokeSessions(tx, account.id);
    await logActivity({
      tx, username: STOREFRONT_BOT_USER, action: 'UPDATE', entity: 'حساب خریدار سایت', entityId: account.id,
      description: `خریدار رمز حساب ${account.phone} را با پیوند تعیین رمز گذاشت`, details: { linkId: row.id },
    });
    return newSession(tx, { ...account, ...updated });
  });
}

/**
 * `GET /account/prices`: the prices of the account's own group, only for an active session of an approved account in an
 * active group (security review of 8.1: no other list leaves the server). Only products the site offers and the group may
 * see, priced in the group's list, are answered.
 */
export async function myGroupPrices(rawToken: unknown): Promise<StorefrontGroupPrices> {
  const account = await requireAccount(rawToken);
  const group = await activeGroupOf(orm, account);
  if (!group) throw new ForbiddenError('قیمت ویژه فقط برای حساب تأییدشدهٔ خرید عمده است.', undefined, 'STOREFRONT_GROUP_PRICES_FORBIDDEN');
  const settings = await storefrontSettingValues(orm);
  const visible = (await catalogItems(orm, settings))
    .filter(item => group.catalogScope !== 'collections' || item.collections.some(c => (group.collections ?? []).includes(c)));
  const prices = await pricesOf(orm, visible.map(i => i.itemId), group.priceList);
  return {
    group: group.code,
    prices: visible.flatMap(item => (prices.has(item.itemId) ? [{ slug: item.slug, price: prices.get(item.itemId) as string }] : [])),
  };
}
