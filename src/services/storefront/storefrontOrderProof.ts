import { ValidationError } from '../../errors/customErrors.js';
import type { DbTransaction } from '../../db/drizzle.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';
import { emailMatchKey, normalizeEmail } from '../../lib/storefront/storefrontEmailRules.js';
import { phoneProofInvalid, type AccountRecord } from './storefrontBuyerAuth.service.js';
import { emailProofInvalid } from './storefrontBuyerEmailKeys.js';
import { consumeEmailProof, emailCodesOn } from './storefrontEmailOtp.service.js';
import { consumePhoneProof } from './storefrontSmsOtp.service.js';
import { smsLoginConfigured, smsLoginOn } from './storefrontSmsSettings.service.js';

/**
 * Who stands behind a site order, decided inside the order's transaction before anything is locked, reserved or made, so
 * an order without its proof leaves no customer, proforma or text behind.
 *
 * - v12 phase 7 (site review 1.3): while the site signs in by SMS, a guest's phone proof is used up. A signed-in account
 *   ordering with its own proven phone needs none (8e3 review: an unproven account phone is no proof).
 * - v12 phase 8c review: a signed-in account that types another phone proves that phone like a guest.
 * - v12 phase 8e (start plan §5, owner's decision of 21 Aban 1405): an email code proves the buyer instead, whichever is
 *   at hand: the site asks for it while the texts cannot prove a phone («حالت بی پیامک»), and an account's own proven
 *   email needs none. Such an order's phone stays unproven: its customer goes by the email, its open-orders limit counts
 *   by the email, and no text goes to its phone. While a proof is possible by either way, an order without one is
 *   refused; only with the texts and the email both off does the order go as before (the start plan: today's behavior
 *   stays until a proof is possible).
 */
export interface OrderProof {
  /** the order's phone was proven (a proof used now, or the account's own proven phone) */
  phoneProven: boolean;
  /** the proven email ('' = none), and its matching key */
  email: string;
  emailKey: string;
}

export interface OrderProofInput {
  phone: string;
  /** the email the buyer typed ('' = none) */
  email: string;
  phoneProof: string;
  emailProof: string;
}

const NONE: OrderProof = { phoneProven: false, email: '', emailKey: '' };

export const emailProofRequired = () => new ValidationError(
  'نشانی ایمیل را با کدی که به آن فرستاده می‌شود تأیید کنید.', { field: 'email' }, 'STOREFRONT_EMAIL_PROOF_REQUIRED',
);

export async function proveOrderBuyer(tx: DbTransaction, account: AccountRecord | null, input: OrderProofInput): Promise<OrderProof> {
  const phoneKey = phoneMatchKey(input.phone);
  // 8e3 review: only an account's proven phone is a proof; an unproven one (made while the texts were off) proves
  // nothing, so the account's proven email or a guest's proof decides below
  if (account?.phoneKey && account.phoneKey === phoneKey && account.phoneVerifiedAt) return { ...NONE, phoneProven: true };
  const email = input.email ? normalizeEmail(input.email) : '';
  if (input.email && !email) throw new ValidationError('نشانی ایمیل را درست بنویسید (مانند name@example.com).', { field: 'email' }, 'STOREFRONT_ORDER_FIELD_INVALID');
  // an account's own proven email: the account is the proof (typed again or left out)
  if (account?.emailKey && account.emailVerifiedAt && (!email || emailMatchKey(email) === account.emailKey)) {
    return { phoneProven: false, email: account.email, emailKey: account.emailKey };
  }
  if (input.emailProof) {
    if (!email) throw emailProofRequired();
    if (!(await emailCodesOn(tx)) || !(await consumeEmailProof(tx, email, input.emailProof))) throw emailProofInvalid();
    return { phoneProven: false, email, emailKey: emailMatchKey(email) };
  }
  if (await smsLoginOn(tx)) {
    if (!input.phoneProof || !(await consumePhoneProof(tx, input.phone, input.phoneProof))) throw phoneProofInvalid();
    return { ...NONE, phoneProven: true };
  }
  if (await emailCodesOn(tx)) throw emailProofRequired();
  // 8e3 review: the texts are set up but paused and the email is off: no proof can be had now, so the order waits,
  // never goes without one (the account of an unproven phone included)
  if (await smsLoginConfigured(tx)) throw phoneProofInvalid();
  // only a site that never set the texts up: today's behavior (start plan), for a guest and for any account
  return { ...NONE, phoneProven: Boolean(account?.phoneKey && account.phoneKey === phoneKey && account.phoneVerifiedAt) };
}

/** A refused proof, for the order racing itself: the first try used it up and committed, the second answers that order */
export const isProofRefusal = (err: unknown): boolean => err instanceof ValidationError
  && (err.code === 'STOREFRONT_PHONE_PROOF_REQUIRED' || err.code === 'STOREFRONT_EMAIL_PROOF_INVALID' || err.code === 'STOREFRONT_EMAIL_PROOF_REQUIRED');
