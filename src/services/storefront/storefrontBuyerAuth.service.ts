import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { storefrontBuyerAccounts, storefrontBuyerGroups, storefrontBuyerSessions, storefrontPasswordTokens } from '../../db/schema.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { nextVersion } from '../../lib/occHelper.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';
import { cleanText, normalizeMobile } from '../../lib/storefront/storefrontOrderRules.js';
import { emailMatchKey, maskedEmail, normalizeEmail } from '../../lib/storefront/storefrontEmailRules.js';
import { accountByEmailKey, emailProofInvalid, emailTaken, lockEmail, provenEmailAt } from './storefrontBuyerEmailKeys.js';
import {
  BUYER_NAME_MAX, LOGIN_FAILURES_MAX, LOGIN_LOCK_MINUTES, SESSION_DAYS, isApplicationStatus, passwordError,
} from '../../lib/storefront/storefrontBuyerRules.js';
import type {
  LoginRequest, RegisterRequest, SetPasswordRequest, SmsLoginRequest, StorefrontAccountView, StorefrontGroupPrices, StorefrontSessionAnswer,
} from '../../lib/storefront/storefrontBuyerContracts.js';
import { STOREFRONT_BOT_USER } from './storefrontCustomer.js';
import { catalogItems } from './storefrontCatalog.service.js';
import { pricesOf } from './storefrontItemData.js';
import { rialText } from './storefrontShipping.service.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';
import { smsLoginConfigured, smsLoginOn } from './storefrontSmsSettings.service.js';
import { emailCodesOn } from './storefrontEmailOtp.service.js';
import { consumePhoneProof } from './storefrontSmsOtp.service.js';
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
 *
 * v11 phase 8.4b (start plan docs/roadmap/V11_STOREFRONT_8_4B_SMS_LOGIN_START_PLAN.md): while the site signs in by SMS
 * (`smsLoginOn`), a sign-up and an anonymous wholesale form need a phone proof (`POST /auth/otp/verify`), used up in their
 * own transaction, and `POST /auth/sms-login` signs in with one. A proven phone is marked (`phone_verified_at`). A phone
 * held by an account nobody proved (made before SMS, perhaps with another person's number) is taken by its SMS sign-in:
 * the old password and sessions end, with an audit row.
 */
const LAST_SEEN_STEP_MS = 10 * 60_000;

export type AccountRecord = typeof storefrontBuyerAccounts.$inferSelect;
export type GroupRecord = typeof storefrontBuyerGroups.$inferSelect;

export const accountFieldError = (field: string, message: string) => new ValidationError(message, { field }, 'STOREFRONT_ACCOUNT_FIELD_INVALID');
/** A missing, wrong, used or expired phone proof: one answer */
export const phoneProofInvalid = () => new ValidationError(
  'شمارهٔ همراه را با کد پیامکی تأیید کنید؛ اگر کد گرفته‌اید و مهلتش گذشته، کد تازه بخواهید.', { field: 'phoneProof' }, 'STOREFRONT_PHONE_PROOF_REQUIRED',
);

/**
 * Inside the caller's transaction: the time to record as the phone's proof, or null when none is needed and none was
 * given. A proof is needed while the site signs in by SMS; a proof given is always checked.
 */
export async function provenPhoneAt(tx: DbExecutor, phone: string, rawProof: unknown, needed: boolean): Promise<string | null> {
  const proof = String(rawProof ?? '');
  if (!proof && !needed) return null;
  if (!proof || !(await consumePhoneProof(tx, phone, proof))) throw phoneProofInvalid();
  return systemNowUtcIso();
}
export const suspendedAccount = () => new ForbiddenError('این حساب معلق است؛ لطفاً با فروشگاه تماس بگیرید.', undefined, 'STOREFRONT_ACCOUNT_SUSPENDED');
const wrongSignIn = () => new AppError('شمارهٔ همراه، ایمیل یا رمز درست نیست.', 401, 'STOREFRONT_SIGN_IN_FAILED');

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
    name: account.name, phone: account.phone, email: account.email, city: account.city, kind: group ? 'wholesale' : 'retail', application,
    companyName: account.companyName, phoneVerified: Boolean(account.phoneVerifiedAt), emailVerified: Boolean(account.emailVerifiedAt),
    group: group ? {
      code: group.code, title: group.title, minOrderAmount: rialText(group.minOrderAmount), minLineQuantity: group.minLineQuantity,
      paymentMethods: [...(group.allowCard === 1 ? ['card' as const] : []), ...(group.allowOnAccount === 1 ? ['on_account' as const] : [])],
    } : null,
  };
}

/** Ends every live session of an account (inside the caller's transaction) */
/**
 * v12 phase 8e review: whoever made an account with a phone nobody proved may not own that phone; an email they added
 * would outlive the phone owner taking the account over (an SMS sign-in, an SMS password reset, a colleague's approval),
 * so every takeover drops it too, with the password and the sessions.
 */
export const DROP_EMAIL = { email: '', emailKey: '', emailVerifiedAt: null } as const;

/** v12 phase 8e review: the id of the live session a token names (0 = none), to keep it while the others end */
export async function currentSessionId(executor: DbExecutor, rawToken: unknown): Promise<number> {
  const token = presentedToken(rawToken, SESSION_TOKEN_PREFIX);
  if (!token) return 0;
  const [row] = await executor.select({ id: storefrontBuyerSessions.id }).from(storefrontBuyerSessions)
    .where(and(eq(storefrontBuyerSessions.tokenHash, tokenHash(token)), isNull(storefrontBuyerSessions.revokedAt)));
  return row?.id ?? 0;
}

export async function revokeSessions(tx: DbExecutor, accountId: number, exceptId?: number): Promise<void> {
  const conditions = [eq(storefrontBuyerSessions.accountId, accountId), isNull(storefrontBuyerSessions.revokedAt)];
  if (exceptId !== undefined) conditions.push(sql`${storefrontBuyerSessions.id} <> ${exceptId}`);
  await tx.update(storefrontBuyerSessions).set({ revokedAt: systemNowUtcIso() }).where(and(...conditions));
}

export async function newSession(tx: DbExecutor, account: AccountRecord): Promise<StorefrontSessionAnswer> {
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
  // v12 phase 8e: an account without a phone has the key '' and is never found by one
  if (!phoneKey) return undefined;
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
  // v12 phase 8e: a phone, an email or both; an email is always proven with its code
  const phone = input.phone ? normalizeMobile(input.phone) ?? '' : '';
  if (input.phone && !phone) throw accountFieldError('phone', 'شمارهٔ همراه باید ۱۱ رقم و با ۰۹ آغاز شود.');
  const email = input.email ? normalizeEmail(input.email) : '';
  if (input.email && !email) throw accountFieldError('email', 'نشانی ایمیل را درست بنویسید (مانند name@example.com).');
  if (!phone && !email) throw accountFieldError('phone', 'شمارهٔ همراه یا ایمیل را بنویسید.');
  const password = String(input.password ?? '');
  const weak = passwordError(password, phone);
  if (weak) throw accountFieldError('password', weak);
  const smsOn = Boolean(phone) && await smsLoginOn(orm);
  // v12 phase 8e3 («حالت بی پیامک»): while no SMS code can prove the phone but an email code can, the account proves an
  // email instead, so no account is made of a phone nobody proved while a proof is at hand
  if (phone && !email && !smsOn && await emailCodesOn(orm)) {
    throw accountFieldError('email', 'ورود با پیامک اکنون ممکن نیست؛ ایمیل خود را هم بنویسید و با کدی که به آن می‌رسد تأیید کنید.');
  }
  // 8e3 review: with the texts set up but paused and no email beside it, the phone still needs its proof (so the
  // account waits); a phone beside a proven email stays unproven, and orders then go by the email
  const proofNeeded = smsOn || (Boolean(phone) && !email && await smsLoginConfigured(orm));
  if (proofNeeded && !input.phoneProof) throw phoneProofInvalid();
  if (email && !input.emailProof) throw emailProofInvalid();
  const passwordHash = await hashPassword(password);
  const phoneKey = phone ? phoneMatchKey(phone) : '';
  const emailKey = email ? emailMatchKey(email) : '';
  return orm.transaction(async (tx) => {
    if (phoneKey) await lockPhone(tx, phoneKey);
    if (emailKey) await lockEmail(tx, emailKey);
    // the proofs first: without them the answer must not say whether the phone or email has an account (a 409 below
    // rolls the transaction back, so the proofs are not used up)
    const phoneVerifiedAt = phone ? await provenPhoneAt(tx, phone, input.phoneProof, proofNeeded) : null;
    const emailVerifiedAt = email ? await provenEmailAt(tx, email, input.emailProof) : null;
    if (await accountByPhoneKey(tx, phoneKey)) throw accountExists();
    if (await accountByEmailKey(tx, emailKey)) throw emailTaken();
    const [account] = await tx.insert(storefrontBuyerAccounts).values({
      name, phone, phoneKey, email, emailKey, status: 'active', passwordHash, lastLoginAt: systemNowUtcIso(), phoneVerifiedAt, emailVerifiedAt,
      updatedBy: STOREFRONT_BOT_USER,
    }).returning();
    await logActivity({
      tx, username: STOREFRONT_BOT_USER, action: 'CREATE', entity: 'حساب خریدار سایت', entityId: account.id,
      description: `حساب خریدار تکی برای ${phone ? `شمارهٔ ${phone}` : `ایمیل ${maskedEmail(email)}`} در سایت ساخته شد`,
      details: { after: { id: account.id, name, kind: 'retail', withPhone: Boolean(phone), withEmail: Boolean(email) } },
    });
    return newSession(tx, account);
  });
}

/**
 * v12 phase 8e review: the password of a signed-in account, asked again before its email or phone is replaced. It counts
 * against the same lock as a sign-in (`LOGIN_FAILURES_MAX` wrong tries lock it for `LOGIN_LOCK_MINUTES`), each wrong try
 * committed on its own, before any proof is used, so a stolen session cannot guess the password without limit.
 */
export async function confirmAccountPassword(accountId: number, rawPassword: unknown): Promise<void> {
  const password = String(rawPassword ?? '');
  const [found] = await orm.select().from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.id, accountId));
  if (!found) throw signInNeeded();
  if (found.lockedUntil && Date.parse(found.lockedUntil) > Date.now()) {
    throw new AppError(`تلاش‌های نادرست زیاد بود؛ ${LOGIN_LOCK_MINUTES.toLocaleString('fa-IR')} دقیقهٔ دیگر دوباره امتحان کنید.`, 429, 'STOREFRONT_SIGN_IN_LOCKED');
  }
  if (!found.passwordHash) throw accountFieldError('password', 'برای عوض کردن آن، اول با «فراموشی رمز» برای حساب رمز بگذارید.');
  const matches = Boolean(password) && await verifyPassword(password, found.passwordHash);
  await orm.transaction(async (tx) => {
    const [account] = await tx.select().from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.id, accountId)).for('update');
    if (matches && account.passwordHash === found.passwordHash) {
      if (account.failedLogins !== 0) await tx.update(storefrontBuyerAccounts).set({ failedLogins: 0 }).where(eq(storefrontBuyerAccounts.id, accountId));
      return;
    }
    const failures = account.failedLogins + 1;
    const locks = failures >= LOGIN_FAILURES_MAX;
    await tx.update(storefrontBuyerAccounts).set({
      failedLogins: locks ? 0 : failures, lockedUntil: locks ? nowPlus(LOGIN_LOCK_MINUTES * 60_000) : account.lockedUntil,
    }).where(eq(storefrontBuyerAccounts.id, accountId));
  });
  if (!matches) throw accountFieldError('password', 'رمز حساب درست نیست.');
}

/** `POST /auth/login` */
export async function signIn(input: LoginRequest): Promise<StorefrontSessionAnswer> {
  await assertAccountsOpen(orm);
  // v12 phase 8e: by the phone or by the email; one answer for a wrong one and a wrong password
  const phone = input.phone ? normalizeMobile(input.phone) ?? '' : '';
  const email = !phone && input.email ? normalizeEmail(input.email) : '';
  const password = String(input.password ?? '');
  const found = phone ? await accountByPhoneKey(orm, phoneMatchKey(phone)) : email ? await accountByEmailKey(orm, emailMatchKey(email)) : undefined;
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
    if ('suspended' in result) throw suspendedAccount();
    return result.session;
  });
}

/**
 * `POST /auth/sms-login` (8.4b): signs in with a phone proof. A wrong proof is the same 422 as on sign-up. No account for
 * the proven phone is a 404 thrown inside the transaction, so the proof is not used up and the sign-up that follows can
 * present it (the buyer proved the phone, so saying it has no account tells a stranger nothing). An account nobody had
 * proved is taken: its password and sessions end, and its phone is marked proven.
 */
export async function smsSignIn(input: SmsLoginRequest): Promise<StorefrontSessionAnswer> {
  await assertAccountsOpen(orm);
  if (!(await smsLoginOn(orm))) throw new NotFoundError('پیدا نشد');
  const phone = normalizeMobile(input.phone);
  if (!phone) throw phoneProofInvalid();
  const phoneKey = phoneMatchKey(phone);
  return orm.transaction(async (tx) => {
    await lockPhone(tx, phoneKey);
    const now = await provenPhoneAt(tx, phone, input.phoneProof, true) as string;
    const account = await accountByPhoneKey(tx, phoneKey, { lock: true });
    if (!account) throw new NotFoundError('حسابی با این شمارهٔ همراه نیست؛ حساب تازه بسازید.', { field: 'phone' }, 'STOREFRONT_ACCOUNT_NOT_FOUND');
    if (account.status === 'suspended') throw suspendedAccount();
    if (account.status !== 'active') {
      throw new ForbiddenError('درخواست خرید عمدهٔ شما در دست بررسی است؛ پس از تأیید وارد شوید.', undefined, 'STOREFRONT_ACCOUNT_PENDING');
    }
    const takeover = !account.phoneVerifiedAt;
    const updated = {
      phoneVerifiedAt: account.phoneVerifiedAt ?? now, failedLogins: 0, lockedUntil: null, lastLoginAt: now,
      ...(takeover ? { passwordHash: '', ...DROP_EMAIL, updatedAt: now, updatedBy: STOREFRONT_BOT_USER, version: nextVersion(account.version) } : {}),
    };
    await tx.update(storefrontBuyerAccounts).set(updated).where(eq(storefrontBuyerAccounts.id, account.id));
    if (takeover) {
      // whoever made the account may not own the phone: what they knew (the password, a session, a set-password link
      // a colleague sent) stops working
      await revokeSessions(tx, account.id);
      await tx.update(storefrontPasswordTokens).set({ usedAt: now })
        .where(and(eq(storefrontPasswordTokens.accountId, account.id), isNull(storefrontPasswordTokens.usedAt)));
      await logActivity({
        tx, username: STOREFRONT_BOT_USER, action: 'UPDATE', entity: 'حساب خریدار سایت', entityId: account.id,
        description: `شمارهٔ ${account.phone} با پیامک تأیید شد؛ رمز، ایمیل و نشست‌های پیشین حساب پاک شد`,
        details: { before: { passwordSet: Boolean(account.passwordHash), emailSet: Boolean(account.emailKey) }, after: { passwordSet: false, emailSet: false } },
      });
    }
    return newSession(tx, { ...account, ...updated });
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

export const signInNeeded = () => new AppError('برای این کار وارد حساب خود شوید.', 401, 'STOREFRONT_SESSION_REQUIRED');

/**
 * The account of the request's session, or 401. v12 phase 7 (site review 1.5): `ordersOff` (the account's own orders and
 * their receipts) needs only the site on, so a signed-in buyer who paid still sends the receipt while «ثبت سفارش» is off.
 */
export async function requireAccount(rawToken: unknown, options: { ordersOff?: boolean } = {}): Promise<AccountRecord> {
  if (options.ordersOff) {
    if (!(await storefrontSettingValues(orm)).enabled) throw new NotFoundError('پیدا نشد');
  } else {
    await assertAccountsOpen(orm);
  }
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
      description: `خریدار رمز حساب ${account.phone || maskedEmail(account.email)} را با پیوند تعیین رمز گذاشت`, details: { linkId: row.id },
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
