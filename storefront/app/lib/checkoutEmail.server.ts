import { randomUUID } from 'node:crypto';
import { data, redirect } from 'react-router';
import type { PlacedOrder } from '@erp/storefront/storefrontOrderContracts';
import type { ApiAnswer } from './account.server';
import { PROOF_PATH, clearKeptProofCookie, contactOf, isOffRefusal, keptProofCookie, keptProofOf, sendCode, verifyCode } from './contactCode.server';
import { clearCartCookie } from './cart.server';
import { rememberOrderCookie } from './orderKeys.server';

/**
 * v12 phase 8e (start plan §5, «حالت بی پیامک»): a guest's checkout proven by an email code while the texts cannot prove
 * a phone and the site's email is on. As with the phone (phase 7): the first «ثبت سفارش» sends the code to the email
 * and the form shows a code field; the second checks it and places the order with the email proof, which waits in an
 * httpOnly cookie of this page so an order the ERP refused (an item short) is placed again without a new code. The
 * order then goes on the customer with that email, and no text goes to its phone (the ERP's rule).
 */
const COOKIE = 'sf_checkout_email_proof';
// 8e4 review: on `/`, with its own name, so the page's data requests (`/checkout.data`) carry it
const PATH = PROOF_PATH;
const EMAIL_WRONG = 'ایمیل را درست بنویسید (مانند name@example.com)؛ کد تأیید سفارش به آن فرستاده می‌شود.';

interface Answerable { codeFor?: string; codeVia?: 'email'; error?: string; field?: string; requestKey?: string }

export async function placeWithEmail<A extends Answerable>(input: {
  request: Request; form: FormData; fields: { email: string }; quoted: Partial<A>; answer: (rest: Partial<A>) => A; requestKey: string;
  placeOrder: (proofs: Record<string, string>) => Promise<ApiAnswer<PlacedOrder>>;
}): Promise<A | Response | ReturnType<typeof data>> {
  const { request, form, fields, quoted, answer, requestKey, placeOrder } = input;
  const ways = { sms: false, email: true };
  const contact = contactOf(fields.email);
  if (!contact || contact.kind !== 'email') return answer({ ...quoted, error: EMAIL_WRONG, field: 'email', codeVia: 'email' } as Partial<A>);
  const email = contact.value;
  const intent = String(form.get('intent') ?? '');
  const ask = async (said?: string): Promise<A> => {
    const sent = await sendCode(request, contact, ways);
    const codeKept = !sent.error || sent.wait;
    // review: an email the ERP no longer takes leaves the email path, so the next tap goes by the phone again
    const via = isOffRefusal(sent.error) ? undefined : 'email';
    return answer({ ...quoted, codeFor: codeKept ? email : undefined, codeVia: via, error: sent.error || said, field: codeKept ? '' : 'email' } as Partial<A>);
  };
  if (intent === 'send-code') return ask();
  const kept = keptProofOf(request, COOKIE);
  let proof = kept && kept.contact.value === email ? kept.proof : '';
  let fresh = false;
  if (!proof) {
    const typed = String(form.get('code') ?? '').trim();
    if (!typed) return ask();
    const verified = await verifyCode(request, contact, typed);
    if (!verified.proof) return answer({ ...quoted, codeFor: email, codeVia: 'email', error: verified.error, field: 'code' } as Partial<A>);
    proof = verified.proof;
    fresh = true;
  }
  const placed = await placeOrder({ email, emailProof: proof });
  if (!placed.data) {
    const nextKey = placed.status >= 500 ? requestKey : randomUUID();
    if (placed.code === 'STOREFRONT_EMAIL_PROOF_REQUIRED') {
      const asked = await ask(placed.error);
      return data({ ...asked, requestKey: nextKey }, { headers: { 'Set-Cookie': clearKeptProofCookie(COOKIE, PATH) } });
    }
    const refused = answer({ ...quoted, error: placed.error, field: placed.field ?? '', requestKey: nextKey, codeFor: undefined, codeVia: 'email' } as Partial<A>);
    // the refusal rolled the order back, so a proof made just now is still good for the next tap
    return fresh ? data(refused, { headers: { 'Set-Cookie': keptProofCookie(COOKIE, PATH, contact, proof) } }) : refused;
  }
  const headers = new Headers();
  headers.append('Set-Cookie', rememberOrderCookie(request, placed.data.order.number, placed.data.accessKey));
  headers.append('Set-Cookie', clearCartCookie());
  headers.append('Set-Cookie', clearKeptProofCookie(COOKIE, PATH));
  return redirect(`/orders/${placed.data.order.number}?placed=1`, { headers });
}
