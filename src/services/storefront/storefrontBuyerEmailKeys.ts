import { eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { storefrontBuyerAccounts } from '../../db/schema.js';
import { ConflictError, ValidationError } from '../../errors/customErrors.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { consumeEmailProof } from './storefrontEmailOtp.service.js';

/**
 * v12 phase 8e (start plan §5): finding and locking a buyer account by its email, and the email proof a step needs.
 * Every stored email is proven: a sign-up, a new email on an account and a sign-in by email all use up a proof of
 * `POST /auth/email-code/verify` in their own transaction.
 */
type AccountRecord = typeof storefrontBuyerAccounts.$inferSelect;

/** A missing, wrong, used or expired email proof: one answer */
export const emailProofInvalid = () => new ValidationError(
  'ایمیل را با کد ایمیلی تأیید کنید؛ اگر کد گرفته‌اید و مهلتش گذشته، کد تازه بخواهید.', { field: 'emailProof' }, 'STOREFRONT_EMAIL_PROOF_REQUIRED',
);

export const emailTaken = () => new ConflictError(
  'برای این ایمیل حساب ساخته شده است؛ وارد شوید، یا اگر رمز را ندارید «فراموشی رمز» را بزنید.', { field: 'email' }, 'STOREFRONT_EMAIL_TAKEN',
);

/** Serializes the writes of one email (two sign-ups or an added email at the same moment) */
export async function lockEmail(tx: DbExecutor, emailKey: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`storefront-account-email:${emailKey}`}))`);
}

export async function accountByEmailKey(tx: DbExecutor, emailKey: string, options: { lock?: boolean } = {}): Promise<AccountRecord | undefined> {
  if (!emailKey) return undefined;
  const query = tx.select().from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.emailKey, emailKey));
  const [account] = options.lock ? await query.for('update') : await query;
  return account;
}

/** Inside the caller's transaction: the email's proof used up and the time to record, or the one 422 */
export async function provenEmailAt(tx: DbExecutor, email: string, rawProof: unknown): Promise<string> {
  const proof = String(rawProof ?? '');
  if (!proof || !(await consumeEmailProof(tx, email, proof))) throw emailProofInvalid();
  return systemNowUtcIso();
}
