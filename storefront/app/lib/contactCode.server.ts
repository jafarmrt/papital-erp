import { accountCall, cookieOf, normalizePhone, secure } from './account.server';

/**
 * v12 phase 8e (start plan §5, owner's decision 7): a buyer is reached by a phone or an email. The site asks for one
 * field, «شمارهٔ همراه یا ایمیل», and sends the code the way the ERP can prove that contact: an SMS while `smsLogin` is
 * on, an email while `emailLogin` is on («حالت بی پیامک» leads with email). The ERP decides every rule; this file only
 * reads what the buyer typed and calls the right code route.
 */
export type Contact = { kind: 'phone'; value: string } | { kind: 'email'; value: string };

const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

/** What the buyer typed as a phone (Persian digits and +98 too) or an email; null for neither */
export function contactOf(raw: unknown): Contact | null {
  const text = String(raw ?? '').trim().slice(0, 254);
  if (text.includes('@')) return EMAIL.test(text) ? { kind: 'email', value: text } : null;
  const phone = normalizePhone(text);
  return phone ? { kind: 'phone', value: phone } : null;
}

export const contactWrong = (sms: boolean, email: boolean) => sms && email
  ? 'شمارهٔ همراه یا ایمیل را درست بنویسید (مانند ۰۹۱۲۱۲۳۴۵۶۷ یا name@example.com).'
  : email ? 'نشانی ایمیل را درست بنویسید (مانند name@example.com).' : 'شمارهٔ همراه را درست بنویسید (مانند ۰۹۱۲۱۲۳۴۵۶۷).';

export { contactLabel } from './contactLabel';

const SMS_OFF_EMAIL = 'کد پیامکی اکنون فرستاده نمی‌شود؛ با ایمیل ادامه دهید.';
const SMS_OFF = 'کد پیامکی اکنون فرستاده نمی‌شود؛ کمی بعد دوباره امتحان کنید.';
const EMAIL_OFF = 'کد ایمیلی اکنون فرستاده نمی‌شود؛ با شمارهٔ همراه ادامه دهید.';

/**
 * Sends a code to the contact. The site's settings may be a minute old, so the ERP decides: a way it has off answers
 * 404, said here as that way being off now (pointing to email only while the email is on). `wait` = the ERP asked to
 * wait a little (429): a code sent a moment ago still works, so the code field stays.
 */
export async function sendCode(
  request: Request, contact: Contact, ways: { sms: boolean; email: boolean }, smsOff = SMS_OFF,
): Promise<{ error: string; wait: boolean }> {
  const answer = contact.kind === 'phone'
    ? await accountCall(request, 'POST', '/auth/otp/request', { phone: contact.value })
    : await accountCall(request, 'POST', '/auth/email-code/request', { email: contact.value });
  if (answer.status === (contact.kind === 'phone' ? 202 : 200)) return { error: '', wait: false };
  const off = answer.status === 404 || answer.code === 'STOREFRONT_SMS_PAUSED';
  if (off) return { error: contact.kind === 'phone' ? (ways.email ? SMS_OFF_EMAIL : smsOff) : EMAIL_OFF, wait: false };
  return { error: answer.error, wait: answer.status === 429 };
}

export const isOffRefusal = (error: string) => error === EMAIL_OFF || error === SMS_OFF || error === SMS_OFF_EMAIL;

/** Checks the code the buyer typed: the single-use proof it gives, or the words to show */
export async function verifyCode(request: Request, contact: Contact, rawCode: unknown): Promise<{ proof: string; error: string }> {
  const code = String(rawCode ?? '').slice(0, 12);
  if (contact.kind === 'phone') {
    const answer = await accountCall<{ phoneProof: string }>(request, 'POST', '/auth/otp/verify', { phone: contact.value, code });
    return answer.data ? { proof: answer.data.phoneProof, error: '' } : { proof: '', error: answer.error };
  }
  const answer = await accountCall<{ emailProof: string }>(request, 'POST', '/auth/email-code/verify', { email: contact.value, code });
  return answer.data ? { proof: answer.data.emailProof, error: '' } : { proof: '', error: answer.error };
}

/** The body fields a contact and its proof go in */
export const proofFields = (contact: Contact, proof: string) => contact.kind === 'phone'
  ? { phone: contact.value, phoneProof: proof } : { email: contact.value, emailProof: proof };

/**
 * A proven contact kept between the code and the form that uses it, for ten minutes, in an httpOnly cookie of its own
 * page (as the phone proofs of 7 and 8a): the contact and its proof, split at the last dot (an email has dots, a proof has
 * none).
 */
/** the email proof of the sign-in and sign-up pages (the phone keeps its 8.4b cookie) */
export const EMAIL_PROOF_COOKIE = 'sf_email_proof';
const TOKEN = /^[A-Za-z0-9_-]{8,200}$/;
/** 8e4 review: every proof cookie is on `/` with a name of its own, so the pages' data requests (`/checkout.data`) carry it */
export const PROOF_PATH = '/';
export function keptProofOf(request: Request, name: string): { contact: Contact; proof: string } | null {
  const raw = cookieOf(request, name);
  const at = raw.lastIndexOf('.');
  if (at < 1) return null;
  const contact = contactOf(raw.slice(0, at));
  const proof = raw.slice(at + 1);
  return contact && TOKEN.test(proof) ? { contact, proof } : null;
}
export const keptProofCookie = (name: string, path: string, contact: Contact, proof: string) =>
  `${name}=${encodeURIComponent(`${contact.value}.${proof}`)}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=600${secure()}`;
export const clearKeptProofCookie = (name: string, path: string) => `${name}=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;
