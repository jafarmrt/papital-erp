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

const SMS_OFF = 'کد پیامکی اکنون فرستاده نمی‌شود؛ با ایمیل ادامه دهید.';
const EMAIL_OFF = 'کد ایمیلی اکنون فرستاده نمی‌شود؛ با شمارهٔ همراه ادامه دهید.';

/** Sends a code to the contact; '' when it went, else the words to show */
export async function sendCode(request: Request, contact: Contact, ways: { sms: boolean; email: boolean }): Promise<string> {
  if (contact.kind === 'phone') {
    if (!ways.sms) return SMS_OFF;
    const answer = await accountCall(request, 'POST', '/auth/otp/request', { phone: contact.value });
    return answer.status === 202 ? '' : answer.error;
  }
  if (!ways.email) return EMAIL_OFF;
  const answer = await accountCall(request, 'POST', '/auth/email-code/request', { email: contact.value });
  return answer.status === 200 ? '' : answer.error;
}

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
