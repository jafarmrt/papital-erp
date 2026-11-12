import { and, eq, isNull } from 'drizzle-orm';
import { orm, type DbTransaction } from '../../db/drizzle.js';
import { storefrontBuyerAccounts, storefrontPasswordTokens } from '../../db/schema.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { nextVersion } from '../../lib/occHelper.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';
import { passwordError } from '../../lib/storefront/storefrontBuyerRules.js';
import { emailMatchKey, maskedEmail, normalizeEmail } from '../../lib/storefront/storefrontEmailRules.js';
import { normalizeMobile } from '../../lib/storefront/storefrontOrderRules.js';
import type {
  AccountEmailRequest, AccountPhoneRequest, EmailLoginRequest, ResetPasswordRequest, StorefrontAccountView, StorefrontSessionAnswer,
} from '../../lib/storefront/storefrontBuyerContracts.js';
import { STOREFRONT_BOT_USER } from './storefrontCustomer.js';
import {
  DROP_EMAIL, type AccountRecord, accountByPhoneKey, accountExists, accountFieldError, accountView, assertAccountsOpen, confirmAccountPassword,
  currentSessionId, lockPhone, newSession, phoneProofInvalid, provenPhoneAt, requireAccount, revokeSessions, signInNeeded, suspendedAccount,
} from './storefrontBuyerAuth.service.js';
import { accountByEmailKey, emailProofInvalid, emailTaken, lockEmail, provenEmailAt } from './storefrontBuyerEmailKeys.js';
import { hashPassword } from './storefrontBuyerSecrets.js';
import { emailCodesOn } from './storefrontEmailOtp.service.js';
import { smsLoginOn } from './storefrontSmsSettings.service.js';

/**
 * v12 phase 8e (start plan §5, owner's decision 7): the email side of buyer accounts, and a forgotten password.
 *
 * - `POST /auth/email-login` signs in with an email proof, as `POST /auth/sms-login` does with a phone proof; no account
 *   for the proven email is a 404 thrown inside the transaction, so the proof is not used up and the sign-up that follows
 *   can present it.
 * - `POST /auth/reset-password` sets a new password with a proof of the account's phone (SMS) or email: every session
 *   and set-password link of the account ends, and the buyer is signed in. A phone nobody had proved is marked proven, as
 *   at the SMS sign-in. No account for the proven phone or email is the same 404 as above.
 * - `POST /account/email` and `POST /account/phone` add (or change) a proven email or phone on a signed-in account; one
 *   held by another account is 409 inside the transaction (the proof is not used up).
 * - Each change writes its audit row; an email appears in it masked.
 */
const notFound = () => new NotFoundError('حسابی با این نشانی نیست؛ حساب تازه بسازید.', undefined, 'STOREFRONT_ACCOUNT_NOT_FOUND');

function assertCanSignIn(account: AccountRecord): void {
  if (account.status === 'suspended') throw suspendedAccount();
  if (account.status !== 'active') {
    throw new ForbiddenError('درخواست خرید عمدهٔ شما در دست بررسی است؛ پس از تأیید وارد شوید.', undefined, 'STOREFRONT_ACCOUNT_PENDING');
  }
}

async function emailOnOr404(): Promise<void> {
  if (!(await emailCodesOn(orm))) throw new NotFoundError('پیدا نشد');
}

/** `POST /auth/email-login` */
export async function emailSignIn(input: EmailLoginRequest): Promise<StorefrontSessionAnswer> {
  await assertAccountsOpen(orm);
  await emailOnOr404();
  const email = normalizeEmail(input.email);
  if (!email) throw emailProofInvalid();
  const emailKey = emailMatchKey(email);
  return orm.transaction(async (tx) => {
    await lockEmail(tx, emailKey);
    const now = await provenEmailAt(tx, email, input.emailProof);
    const account = await accountByEmailKey(tx, emailKey, { lock: true });
    if (!account) throw notFound();
    assertCanSignIn(account);
    const updated = { failedLogins: 0, lockedUntil: null, lastLoginAt: now };
    await tx.update(storefrontBuyerAccounts).set(updated).where(eq(storefrontBuyerAccounts.id, account.id));
    return newSession(tx, { ...account, ...updated });
  });
}

/** `POST /auth/reset-password` */
export async function resetPassword(input: ResetPasswordRequest): Promise<StorefrontSessionAnswer> {
  await assertAccountsOpen(orm);
  const byPhone = Boolean(input.phone);
  const phone = byPhone ? normalizeMobile(String(input.phone)) ?? '' : '';
  const email = byPhone ? '' : normalizeEmail(input.email);
  if (byPhone ? !(await smsLoginOn(orm)) : !(await emailCodesOn(orm))) throw new NotFoundError('پیدا نشد');
  if (byPhone ? !phone : !email) throw byPhone ? phoneProofInvalid() : emailProofInvalid();
  const password = String(input.password ?? '');
  const weak = passwordError(password, phone);
  if (weak) throw accountFieldError('password', weak);
  const passwordHash = await hashPassword(password);
  return orm.transaction(async (tx) => {
    let now: string;
    let account: AccountRecord | undefined;
    if (byPhone) {
      const phoneKey = phoneMatchKey(phone);
      await lockPhone(tx, phoneKey);
      now = await provenPhoneAt(tx, phone, input.phoneProof, true) as string;
      account = await accountByPhoneKey(tx, phoneKey, { lock: true });
    } else {
      const emailKey = emailMatchKey(email);
      await lockEmail(tx, emailKey);
      now = await provenEmailAt(tx, email, input.emailProof);
      account = await accountByEmailKey(tx, emailKey, { lock: true });
    }
    if (!account) throw notFound();
    assertCanSignIn(account);
    // review: a reset by email checks the password against the account's own phone too
    const weakForAccount = !byPhone && account.phone ? passwordError(password, account.phone) : null;
    if (weakForAccount) throw accountFieldError('password', weakForAccount);
    // review: the owner of a phone nobody had proved takes the account over, so an email its maker added goes too
    const takeover = byPhone && !account.phoneVerifiedAt;
    const updated = {
      passwordHash, failedLogins: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now, updatedBy: STOREFRONT_BOT_USER,
      version: nextVersion(account.version), ...(takeover ? { phoneVerifiedAt: now, ...DROP_EMAIL } : {}),
    };
    await tx.update(storefrontBuyerAccounts).set(updated).where(eq(storefrontBuyerAccounts.id, account.id));
    // whoever knew the old password, held a session or a set-password link loses them
    await revokeSessions(tx, account.id);
    await tx.update(storefrontPasswordTokens).set({ usedAt: now })
      .where(and(eq(storefrontPasswordTokens.accountId, account.id), isNull(storefrontPasswordTokens.usedAt)));
    await logActivity({
      tx, username: STOREFRONT_BOT_USER, action: 'UPDATE', entity: 'حساب خریدار سایت', entityId: account.id,
      description: `رمز حساب خریدار سایت با کد ${byPhone ? 'پیامکی' : 'ایمیلی'} تازه شد؛ نشست‌های پیشین بسته شد`,
      details: {
        before: { passwordSet: Boolean(account.passwordHash), ...(takeover ? { emailSet: Boolean(account.emailKey) } : {}) },
        after: { passwordSet: true, by: byPhone ? 'sms' : 'email', ...(takeover ? { emailSet: false } : {}) },
      },
    });
    return newSession(tx, { ...account, ...updated });
  });
}

/**
 * v12 phase 8e review: adding a first email or phone needs only the session and the new address's proof; replacing one
 * the account already has needs the account's password too, so a stolen session cannot move the account to an address
 * of the thief's. A replacement ends every other session and set-password link. The account is re-read under its lock.
 */
async function assertMayChange(tx: DbTransaction, rawToken: unknown, account: AccountRecord, replacing: boolean, passwordConfirmed: boolean): Promise<void> {
  // the session and the account are checked again under the account's lock (a takeover may have ended the session)
  if (!(await currentSessionId(tx, rawToken))) throw signInNeeded();
  if (account.status !== 'active') throw suspendedAccount();
  if (replacing && !passwordConfirmed) throw accountFieldError('password', 'برای عوض کردن آن، رمز حساب را هم بنویسید.');
}

async function endOtherSessions(tx: DbTransaction, accountId: number, rawToken: unknown, now: string): Promise<void> {
  await revokeSessions(tx, accountId, await currentSessionId(tx, rawToken));
  await tx.update(storefrontPasswordTokens).set({ usedAt: now })
    .where(and(eq(storefrontPasswordTokens.accountId, accountId), isNull(storefrontPasswordTokens.usedAt)));
}

/** `POST /account/email`: a proven email on the signed-in account */
export async function setAccountEmail(rawToken: unknown, input: AccountEmailRequest): Promise<StorefrontAccountView> {
  const signedIn = await requireAccount(rawToken);
  await emailOnOr404();
  const email = normalizeEmail(input.email);
  if (!email) throw accountFieldError('email', 'نشانی ایمیل را درست بنویسید (مانند name@example.com).');
  const emailKey = emailMatchKey(email);
  // a replacement asks the password first, counted and committed before any proof is used
  const confirmed = Boolean(signedIn.emailKey) && signedIn.emailKey !== emailKey;
  if (confirmed) await confirmAccountPassword(signedIn.id, input.password);
  return orm.transaction(async (tx) => {
    await lockEmail(tx, emailKey);
    const now = await provenEmailAt(tx, email, input.emailProof);
    const holder = await accountByEmailKey(tx, emailKey);
    if (holder && holder.id !== signedIn.id) throw emailTaken();
    const [account] = await tx.select().from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.id, signedIn.id)).for('update');
    if (account.emailKey === emailKey && account.email === email) return accountView(tx, account);
    const replacing = Boolean(account.emailKey) && account.emailKey !== emailKey;
    await assertMayChange(tx, rawToken, account, replacing, confirmed);
    const updated = { email, emailKey, emailVerifiedAt: now, updatedAt: now, updatedBy: STOREFRONT_BOT_USER, version: nextVersion(account.version) };
    await tx.update(storefrontBuyerAccounts).set(updated).where(eq(storefrontBuyerAccounts.id, account.id));
    if (replacing) await endOtherSessions(tx, account.id, rawToken, now);
    await logActivity({
      tx, username: STOREFRONT_BOT_USER, action: 'UPDATE', entity: 'حساب خریدار سایت', entityId: account.id,
      description: 'ایمیل حساب خریدار سایت با کد ایمیلی تأیید و ثبت شد',
      details: { before: { email: account.email ? maskedEmail(account.email) : '' }, after: { email: maskedEmail(email) }, otherSessionsEnded: replacing },
    });
    return accountView(tx, { ...account, ...updated });
  });
}

/** `POST /account/phone`: a proven phone on the signed-in account (a first one, the account's own proven, or a replacement) */
export async function setAccountPhone(rawToken: unknown, input: AccountPhoneRequest): Promise<StorefrontAccountView> {
  const signedIn = await requireAccount(rawToken);
  if (!(await smsLoginOn(orm))) throw new NotFoundError('پیدا نشد');
  const phone = normalizeMobile(input.phone);
  if (!phone) throw accountFieldError('phone', 'شمارهٔ همراه باید ۱۱ رقم و با ۰۹ آغاز شود.');
  const phoneKey = phoneMatchKey(phone);
  const confirmed = Boolean(signedIn.phoneKey) && signedIn.phoneKey !== phoneKey;
  if (confirmed) await confirmAccountPassword(signedIn.id, input.password);
  return orm.transaction(async (tx) => {
    await lockPhone(tx, phoneKey);
    const now = await provenPhoneAt(tx, phone, input.phoneProof, true) as string;
    const holder = await accountByPhoneKey(tx, phoneKey);
    if (holder && holder.id !== signedIn.id) throw accountExists();
    const [account] = await tx.select().from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.id, signedIn.id)).for('update');
    // an approved account's phone is the one a colleague linked to its customer: it changes in the ERP, not here
    if (account.phone && account.applicationStatus !== 'none') {
      throw new ValidationError('شمارهٔ حساب خرید عمده را فروشگاه عوض می‌کند؛ با فروشگاه تماس بگیرید.', { field: 'phone' }, 'STOREFRONT_ACCOUNT_PHONE_LOCKED');
    }
    if (account.phoneKey === phoneKey && account.phone === phone && account.phoneVerifiedAt) return accountView(tx, account);
    // proving the account's own unproven phone is not a replacement
    const replacing = Boolean(account.phoneKey) && account.phoneKey !== phoneKey;
    await assertMayChange(tx, rawToken, account, replacing, confirmed);
    const updated = { phone, phoneKey, phoneVerifiedAt: now, updatedAt: now, updatedBy: STOREFRONT_BOT_USER, version: nextVersion(account.version) };
    await tx.update(storefrontBuyerAccounts).set(updated).where(eq(storefrontBuyerAccounts.id, account.id));
    if (replacing) await endOtherSessions(tx, account.id, rawToken, now);
    await logActivity({
      tx, username: STOREFRONT_BOT_USER, action: 'UPDATE', entity: 'حساب خریدار سایت', entityId: account.id,
      description: `شمارهٔ ${phone} با کد پیامکی تأیید و روی حساب خریدار سایت ثبت شد`,
      details: { before: { phone: account.phone }, after: { phone }, otherSessionsEnded: replacing },
    });
    return accountView(tx, { ...account, ...updated });
  });
}
