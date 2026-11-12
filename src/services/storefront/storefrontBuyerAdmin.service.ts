import type { Request } from 'express';
import { and, asc, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { customers, storefrontBuyerAccounts, storefrontBuyerGroups, storefrontPasswordTokens } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { OptimisticLockError, nextVersion } from '../../lib/occHelper.js';
import { phoneSearchKey } from '../../lib/search/phoneMatchKey.js';
import { foldedContains } from '../../lib/search/searchSql.js';
import {
  PASSWORD_LINK_HOURS, isApplicationStatus, isBuyerAccountStatus, type BuyerListFilter,
} from '../../lib/storefront/storefrontBuyerRules.js';
import type {
  ApproveBuyerRequest, BuyerAccountDetail, BuyerAccountPage, BuyerAccountRow, PasswordLinkAnswer,
} from '../../lib/storefront/storefrontBuyerContracts.js';
import { findActiveCustomerByPhone } from '../customers/customerIdentity.js';
import { resolveSiteCustomer } from './storefrontCustomer.js';
import { nowPlus, revokeSessions, type AccountRecord } from './storefrontBuyerAuth.service.js';
import { PASSWORD_TOKEN_PREFIX, newToken, tokenHash } from './storefrontBuyerSecrets.js';

/**
 * v11 phase 8.2b (package 18, start plan §6): the «خریداران عمده» page. `site_buyers.view` reads; `site_buyers.manage`
 * approves a request into a buyer group (linking an existing customer or making one), declines it, suspends and
 * reactivates an account, and makes a set-password link. Approving clears any password the account had and ends its
 * sessions: until SMS arrives in 8.4 the phone was never proven, so whoever made the account may not be the buyer the
 * colleague spoke with; the buyer sets a new password with the link the colleague sends to the confirmed number. Every
 * write runs under the account's version with an audit row in the same transaction.
 */
export const BUYER_PAGE_MAX = 100;

const actorOf = (req: Request) => String(req.user?.fullName || req.user?.username || 'کاربر');

type Joined = { account: AccountRecord; groupTitle: string | null; customerName: string | null };

function rowOf({ account, groupTitle, customerName }: Joined): BuyerAccountRow {
  return {
    id: account.id, name: account.name, phone: account.phone, email: account.email, city: account.city, companyName: account.companyName,
    status: isBuyerAccountStatus(account.status) ? account.status : 'suspended',
    applicationStatus: isApplicationStatus(account.applicationStatus) ? account.applicationStatus : 'none',
    groupId: account.groupId, groupTitle: groupTitle ?? '', customerId: account.customerId, customerName: customerName ?? '',
    hasPassword: Boolean(account.passwordHash), phoneVerified: Boolean(account.phoneVerifiedAt), emailVerified: Boolean(account.emailVerifiedAt), appliedAt: account.appliedAt, createdAt: account.createdAt, version: account.version,
  };
}

const joinedSelect = (executor: DbExecutor) => executor.select({
  account: storefrontBuyerAccounts, groupTitle: storefrontBuyerGroups.title, customerName: customers.name,
}).from(storefrontBuyerAccounts)
  .leftJoin(storefrontBuyerGroups, eq(storefrontBuyerGroups.id, storefrontBuyerAccounts.groupId))
  .leftJoin(customers, eq(customers.id, storefrontBuyerAccounts.customerId));

function filterCondition(filter: BuyerListFilter): SQL | undefined {
  if (filter === 'all') return undefined;
  if (filter === 'suspended') return eq(storefrontBuyerAccounts.status, 'suspended');
  if (filter === 'retail') return eq(storefrontBuyerAccounts.applicationStatus, 'none');
  return eq(storefrontBuyerAccounts.applicationStatus, filter);
}

export async function listBuyerAccounts(query: { page: number; limit: number; q: string; filter: BuyerListFilter }): Promise<BuyerAccountPage> {
  const page = Math.max(1, query.page);
  const limit = Math.min(BUYER_PAGE_MAX, Math.max(1, query.limit));
  const conditions: SQL[] = [];
  const filter = filterCondition(query.filter);
  if (filter) conditions.push(filter);
  const q = query.q.trim();
  if (q) {
    const matches: SQL[] = [];
    const text = foldedContains([storefrontBuyerAccounts.name, storefrontBuyerAccounts.companyName, storefrontBuyerAccounts.city], q);
    if (text) matches.push(text);
    const phoneKey = phoneSearchKey(q);
    if (phoneKey) matches.push(foldedContains([storefrontBuyerAccounts.phoneKey], phoneKey)!);
    if (matches.length > 0) conditions.push(or(...matches)!);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await orm.select({ total: sql<number>`count(*)::int` }).from(storefrontBuyerAccounts).where(where);
  const rows = await joinedSelect(orm).where(where)
    .orderBy(desc(sql`coalesce(${storefrontBuyerAccounts.appliedAt}, ${storefrontBuyerAccounts.createdAt})`), desc(storefrontBuyerAccounts.id))
    .limit(limit).offset((page - 1) * limit);
  return { data: rows.map(rowOf), total: Number(total), page, limit };
}

export async function buyerAccountDetail(executor: DbExecutor, id: number): Promise<BuyerAccountDetail> {
  const [row] = await joinedSelect(executor).where(eq(storefrontBuyerAccounts.id, id));
  if (!row) throw new NotFoundError('حساب خریدار پیدا نشد.', undefined, 'STOREFRONT_BUYER_NOT_FOUND');
  const { account } = row;
  const [link] = await executor.select({ expiresAt: storefrontPasswordTokens.expiresAt }).from(storefrontPasswordTokens)
    .where(and(eq(storefrontPasswordTokens.accountId, id), isNull(storefrontPasswordTokens.usedAt), sql`${storefrontPasswordTokens.expiresAt} > now()`))
    .orderBy(desc(storefrontPasswordTokens.id)).limit(1);
  const match = await findActiveCustomerByPhone(account.phone, executor);
  const groupOptions = await executor.select({ id: storefrontBuyerGroups.id, title: storefrontBuyerGroups.title, isActive: storefrontBuyerGroups.isActive })
    .from(storefrontBuyerGroups).where(eq(storefrontBuyerGroups.isDeleted, 0)).orderBy(asc(storefrontBuyerGroups.sortOrder), asc(storefrontBuyerGroups.id));
  return {
    ...rowOf(row), nationalId: account.nationalId, economicCode: account.economicCode, applicationNote: account.applicationNote,
    reviewedBy: account.reviewedBy, reviewedAt: account.reviewedAt, lastLoginAt: account.lastLoginAt,
    lockedUntil: account.lockedUntil && Date.parse(account.lockedUntil) > Date.now() ? account.lockedUntil : null,
    passwordLinkExpiresAt: link?.expiresAt ?? null,
    customerMatches: match ? [{ id: match.id, name: match.name, city: String((match as { city?: string | null }).city ?? '') }] : [],
    groupOptions: groupOptions.map(g => ({ id: g.id, title: g.title, isActive: g.isActive === 1 })),
  };
}

async function lockedAccount(tx: DbExecutor, id: number, expectedVersion: number): Promise<AccountRecord> {
  const [account] = await tx.select().from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.id, id)).for('update');
  if (!account) throw new NotFoundError('حساب خریدار پیدا نشد.', undefined, 'STOREFRONT_BUYER_NOT_FOUND');
  if (account.version !== expectedVersion) {
    throw new OptimisticLockError({ entityType: 'StorefrontBuyerAccount', entityId: id, expectedVersion, currentVersion: account.version });
  }
  return account;
}

/** A new one-time set-password link; the account's earlier unused links stop working */
/** Closes the account's unused set-password links */
async function closePasswordLinks(tx: DbExecutor, accountId: number): Promise<void> {
  await tx.update(storefrontPasswordTokens).set({ usedAt: systemNowUtcIso() })
    .where(and(eq(storefrontPasswordTokens.accountId, accountId), isNull(storefrontPasswordTokens.usedAt)));
}

async function issuePasswordLink(tx: DbExecutor, accountId: number, actor: string): Promise<{ token: string; expiresAt: string }> {
  await closePasswordLinks(tx, accountId);
  const token = newToken(PASSWORD_TOKEN_PREFIX);
  const expiresAt = nowPlus(PASSWORD_LINK_HOURS * 3600_000);
  await tx.insert(storefrontPasswordTokens).values({ accountId, tokenHash: tokenHash(token), createdBy: actor, expiresAt });
  return { token, expiresAt };
}

async function groupForApproval(tx: DbExecutor, groupId: number): Promise<typeof storefrontBuyerGroups.$inferSelect> {
  const [group] = await tx.select().from(storefrontBuyerGroups).where(and(eq(storefrontBuyerGroups.id, groupId), eq(storefrontBuyerGroups.isDeleted, 0)));
  if (!group) throw new ValidationError('گروه خریدار را انتخاب کنید.', { field: 'groupId' }, 'STOREFRONT_GROUP_NOT_FOUND');
  return group;
}

async function customerForApproval(tx: DbExecutor, account: AccountRecord, customerId: number): Promise<{ id: number; name: string }> {
  if (customerId === 0) {
    return resolveSiteCustomer(tx, `تأیید حساب خریدار عمدهٔ سایت ${account.id}`, {
      name: account.companyName || account.name, phone: account.phone, city: account.city, address: '',
    });
  }
  const [customer] = await tx.select({ id: customers.id, name: customers.name }).from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.isDeleted, 0)));
  if (!customer) throw new ValidationError('طرف حساب انتخاب‌شده پیدا نشد یا حذف شده است.', { field: 'customerId' }, 'STOREFRONT_BUYER_CUSTOMER_INVALID');
  return customer;
}

/** Approves a request into a group; answers the set-password link once, to be sent to the buyer */
export async function approveBuyer(req: Request, id: number, input: ApproveBuyerRequest): Promise<PasswordLinkAnswer> {
  const actor = actorOf(req);
  const link = await orm.transaction(async (tx) => {
    const account = await lockedAccount(tx, id, input.version);
    if (account.applicationStatus !== 'pending' && account.applicationStatus !== 'declined') {
      throw new ConflictError('فقط درخواست خرید عمدهٔ بررسی‌نشده یا ردشده تأیید می‌شود؛ برای این حساب گروه را عوض کنید.', undefined, 'STOREFRONT_BUYER_NOT_PENDING');
    }
    const group = await groupForApproval(tx, input.groupId);
    const customer = await customerForApproval(tx, account, input.customerId);
    const now = systemNowUtcIso();
    // 8.4b: an SMS-proven phone keeps its password and sessions; an unproven one may not be the buyer the colleague spoke to
    const proven = Boolean(account.phoneVerifiedAt);
    await tx.update(storefrontBuyerAccounts).set({
      groupId: group.id, customerId: customer.id, applicationStatus: 'approved', status: 'active', ...(proven ? {} : { passwordHash: '' }), failedLogins: 0,
      lockedUntil: null, reviewedBy: actor, reviewedAt: now, updatedAt: now, updatedBy: actor, version: nextVersion(account.version),
    }).where(eq(storefrontBuyerAccounts.id, id));
    if (!proven) await revokeSessions(tx, id);
    const issued = await issuePasswordLink(tx, id, actor);
    await logActivity({
      req, tx, action: 'UPDATE', entity: 'حساب خریدار سایت', entityId: id,
      description: `درخواست خرید عمدهٔ «${account.companyName || account.name}» در گروه «${group.title}» تأیید شد`,
      details: { before: { applicationStatus: account.applicationStatus, status: account.status }, after: { groupId: group.id, customerId: customer.id }, passwordLink: true },
    });
    return issued;
  });
  return { ...link, account: await buyerAccountDetail(orm, id) };
}

/** Moves an approved buyer to another group (and customer); the password and sessions stay */
export async function changeBuyerGroup(req: Request, id: number, input: ApproveBuyerRequest): Promise<BuyerAccountDetail> {
  const actor = actorOf(req);
  await orm.transaction(async (tx) => {
    const account = await lockedAccount(tx, id, input.version);
    if (account.applicationStatus !== 'approved') throw new ConflictError('این حساب هنوز برای خرید عمده تأیید نشده است.', undefined, 'STOREFRONT_BUYER_NOT_APPROVED');
    const group = await groupForApproval(tx, input.groupId);
    const customer = await customerForApproval(tx, account, input.customerId);
    await tx.update(storefrontBuyerAccounts).set({
      groupId: group.id, customerId: customer.id, updatedAt: systemNowUtcIso(), updatedBy: actor, version: nextVersion(account.version),
    }).where(eq(storefrontBuyerAccounts.id, id));
    await logActivity({
      req, tx, action: 'UPDATE', entity: 'حساب خریدار سایت', entityId: id, description: `گروه خریدار «${account.companyName || account.name}» به «${group.title}» تغییر کرد`,
      details: { before: { groupId: account.groupId, customerId: account.customerId }, after: { groupId: group.id, customerId: customer.id } },
    });
  });
  return buyerAccountDetail(orm, id);
}

type SimpleAction = 'decline' | 'suspend' | 'reactivate';

const ACTION_TEXT: Readonly<Record<SimpleAction, string>> = {
  decline: 'درخواست خرید عمده رد شد', suspend: 'حساب خریدار معلق شد', reactivate: 'حساب خریدار دوباره فعال شد',
};

/** Declines a request, suspends an account (its sessions and unused links end) or reactivates it */
export async function buyerAction(req: Request, id: number, action: SimpleAction, version: number): Promise<BuyerAccountDetail> {
  const actor = actorOf(req);
  await orm.transaction(async (tx) => {
    const account = await lockedAccount(tx, id, version);
    let change: Partial<typeof storefrontBuyerAccounts.$inferInsert>;
    if (action === 'decline') {
      if (account.applicationStatus !== 'pending') throw new ConflictError('این حساب درخواست بررسی‌نشده ندارد.', undefined, 'STOREFRONT_BUYER_NOT_PENDING');
      // an account the form made has never been usable: declined, it stays closed
      change = { applicationStatus: 'declined', status: account.status === 'pending' ? 'suspended' : account.status, reviewedBy: actor, reviewedAt: systemNowUtcIso() };
    } else if (action === 'suspend') {
      if (account.status !== 'active') throw new ConflictError('فقط حساب فعال معلق می‌شود.', undefined, 'STOREFRONT_BUYER_NOT_ACTIVE');
      change = { status: 'suspended' };
    } else {
      if (account.status !== 'suspended') throw new ConflictError('فقط حساب معلق دوباره فعال می‌شود.', undefined, 'STOREFRONT_BUYER_NOT_SUSPENDED');
      change = { status: 'active', failedLogins: 0, lockedUntil: null };
    }
    await tx.update(storefrontBuyerAccounts).set({ ...change, updatedAt: systemNowUtcIso(), updatedBy: actor, version: nextVersion(account.version) })
      .where(eq(storefrontBuyerAccounts.id, id));
    if (action !== 'reactivate') {
      // a link sent before suspension must not work again if the account is reactivated later
      await revokeSessions(tx, id);
      await closePasswordLinks(tx, id);
    }
    await logActivity({
      req, tx, action: 'UPDATE', entity: 'حساب خریدار سایت', entityId: id, description: `${ACTION_TEXT[action]}: «${account.companyName || account.name}»`,
      details: { before: { status: account.status, applicationStatus: account.applicationStatus }, after: change },
    });
  });
  return buyerAccountDetail(orm, id);
}

/** A new set-password link for an active account (a lost password, an expired link) */
export async function newPasswordLink(req: Request, id: number, version: number): Promise<PasswordLinkAnswer> {
  const actor = actorOf(req);
  const link = await orm.transaction(async (tx) => {
    const account = await lockedAccount(tx, id, version);
    if (account.status !== 'active') throw new ConflictError('پیوند تعیین رمز فقط برای حساب فعال ساخته می‌شود.', undefined, 'STOREFRONT_BUYER_NOT_ACTIVE');
    const issued = await issuePasswordLink(tx, id, actor);
    await tx.update(storefrontBuyerAccounts).set({ updatedAt: systemNowUtcIso(), updatedBy: actor, version: nextVersion(account.version) })
      .where(eq(storefrontBuyerAccounts.id, id));
    await logActivity({
      req, tx, action: 'UPDATE', entity: 'حساب خریدار سایت', entityId: id, description: `پیوند تعیین رمز برای «${account.companyName || account.name}» ساخته شد`,
      details: { expiresAt: issued.expiresAt },
    });
    return issued;
  });
  return { ...link, account: await buyerAccountDetail(orm, id) };
}
