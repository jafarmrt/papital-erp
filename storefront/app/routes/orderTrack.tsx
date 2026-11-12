import { Form, Link, data, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/orderTrack';
import type { BuyerOrder, OrderAccessAnswer } from '@erp/storefront/storefrontOrderContracts';
import { publicSettings } from '../lib/api.server';
import { accountCall, clearTrackProofCookie, crossSite, sameSite, trackProofCookie, trackProofOf } from '../lib/account.server';
import {
  type Contact, clearKeptProofCookie, contactOf, contactWrong, keptProofCookie, keptProofOf, proofFields, sendCode, verifyCode,
} from '../lib/contactCode.server';
import { isOrderKey, isOrderNumber, rememberOrderCookie } from '../lib/orderKeys.server';
import { siteEnv } from '../lib/site.server';
import { pageMeta } from '../lib/meta';
import { contactLabel } from '../lib/contactLabel';
import { AccountShell, CodeField, ContactField, Field, FormError, FormNote, SubmitButton } from '../components/AccountForm';

/**
 * v11 phase 8.2: «پیگیری سفارش» on a phone that did not place the order. The number and the tracking key are typed (a
 * POST, so the key stays out of addresses and logs); a right pair is kept in `sf_orders` and the order page opens.
 *
 * v12 phase 8d (site review 2.2): without the key, while the site signs in by SMS, the order's number and the buyer's
 * phone: a code goes to the phone (the login code, which goes to any phone alike), and the ERP answers the order's key
 * for a live proof of the phone the order was placed with (`POST /orders/:number/access`). A wrong number, another
 * phone and a wrong code all read the same; the proof waits ten minutes in an httpOnly cookie, so a mistyped number is
 * fixed without a new code. The ERP limits the tries per visitor and per order.
 *
 * v12 phase 8e: or the buyer's email and an email code, for an order placed with a proven email (the field takes either,
 * as the ERP can send its code now); its proof waits in a cookie of its own.
 */
const EMAIL_COOKIE = 'sf_track_email_proof';
const EMAIL_PATH = '/orders/track';
const keptContactProof = (request: Request): { contact: Contact; proof: string } | null => {
  const phone = trackProofOf(request);
  if (phone.proof) return { contact: { kind: 'phone', value: phone.phone }, proof: phone.proof };
  return keptProofOf(request, EMAIL_COOKIE);
};
export async function loader({ request }: Route.LoaderArgs) {
  const number = new URL(request.url).searchParams.get('number') ?? '';
  const settings = await publicSettings();
  return {
    number: isOrderNumber(number) ? number : '', siteUrl: siteEnv().siteUrl,
    smsLogin: settings.smsLogin === true, emailLogin: settings.emailLogin === true, proven: keptContactProof(request)?.contact.value ?? '',
  };
}

/** the buyer's own cart, address or order: never kept by a browser or a cache in between */
export const headers = () => ({ 'Cache-Control': 'no-store' });

export function meta({ data: loaded }: Route.MetaArgs) {
  return [...pageMeta({ title: 'پیگیری سفارش', description: 'پیگیری سفارش پاپیتال', path: '/orders/track', siteUrl: loaded?.siteUrl ?? '' }), { name: 'robots', content: 'noindex' }];
}

const latin = (value: string) => value.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\s+/g, '');
const NOT_FOUND = 'سفارشی با این شماره و کد پیدا نشد؛ هر دو را دوباره نگاه کنید.';
const NOT_FOUND_BY_PHONE = 'سفارشی با این شماره برای این شمارهٔ همراه یا ایمیل پیدا نشد؛ شمارهٔ سفارش را دوباره نگاه کنید.';

interface Answer {
  number: string;
  error?: string;
  /** which form the answer is about: the tracking key, or the buyer's phone */
  by?: 'key' | 'phone';
  /** the phone a code was sent to; the phone form then asks for the code */
  codeFor?: string;
}

/** The order's key for a proven phone or email: the order page opens with it kept, or the same refusal for any wrong pair */
async function openByContact(request: Request, number: string, contact: Contact, proof: string, keepProof: boolean) {
  const opened = await accountCall<OrderAccessAnswer>(request, 'POST', `/orders/${number}/access`, proofFields(contact, proof));
  if (opened.data) {
    const headers = new Headers();
    headers.append('Set-Cookie', rememberOrderCookie(request, number, opened.data.accessKey));
    headers.append('Set-Cookie', clearTrackProofCookie());
    headers.append('Set-Cookie', clearKeptProofCookie(EMAIL_COOKIE, EMAIL_PATH));
    return redirect(`/orders/${number}`, { headers });
  }
  const answer: Answer = { number, by: 'phone', error: opened.status === 404 ? NOT_FOUND_BY_PHONE : opened.error };
  if (!keepProof) return answer;
  const kept = contact.kind === 'phone' ? trackProofCookie(contact.value, proof) : keptProofCookie(EMAIL_COOKIE, EMAIL_PATH, contact, proof);
  return data(answer, { headers: { 'Set-Cookie': kept } });
}

export async function action({ request }: Route.ActionArgs) {
  if (!sameSite(request)) return crossSite();
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const number = latin(String(form.get('number') ?? '')).slice(0, 20);

  if (intent === 'another-phone') {
    const headers = new Headers();
    headers.append('Set-Cookie', clearTrackProofCookie());
    headers.append('Set-Cookie', clearKeptProofCookie(EMAIL_COOKIE, EMAIL_PATH));
    return data({ number, by: 'phone' } satisfies Answer, { headers });
  }
  if (intent === 'send-code' || intent === 'verify-code' || intent === 'by-phone') {
    if (!isOrderNumber(number)) return { number, by: 'phone', error: NOT_FOUND_BY_PHONE } satisfies Answer;
    if (intent === 'by-phone') {
      const kept = keptContactProof(request);
      if (!kept) return { number, by: 'phone' } satisfies Answer;
      return openByContact(request, number, kept.contact, kept.proof, false);
    }
    const settings = await publicSettings();
    const ways = { sms: settings.smsLogin === true, email: settings.emailLogin === true };
    const contact = contactOf(form.get('contact'));
    if (!contact) return { number, by: 'phone', error: contactWrong(ways.sms, ways.email) } satisfies Answer;
    if (intent === 'send-code') {
      const refused = await sendCode(request, contact, ways);
      return refused ? { number, by: 'phone', error: refused } satisfies Answer : { number, by: 'phone', codeFor: contact.value } satisfies Answer;
    }
    const verified = await verifyCode(request, contact, form.get('code'));
    if (!verified.proof) return { number, by: 'phone', codeFor: contact.value, error: verified.error } satisfies Answer;
    return openByContact(request, number, contact, verified.proof, true);
  }

  const key = String(form.get('key') ?? '').trim().slice(0, 100);
  if (!isOrderNumber(number) || !isOrderKey(key)) return { number, by: 'key', error: NOT_FOUND } satisfies Answer;
  const found = await accountCall<BuyerOrder>(request, 'GET', `/orders/${number}`, undefined, { orderKey: key });
  if (!found.data) return { number, by: 'key', error: found.status === 404 ? NOT_FOUND : found.error } satisfies Answer;
  return redirect(`/orders/${number}`, { headers: { 'Set-Cookie': rememberOrderCookie(request, number, key) } });
}

export default function OrderTrackPage({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state === 'submitting';
  const answer = actionData as Answer | undefined;
  const number = answer?.number ?? loaderData.number;
  // a phone or email proven a moment ago (its cookie, read again after every form) unless a code is being asked for another
  const proven = answer?.codeFor ? '' : loaderData.proven;
  const { smsLogin, emailLogin } = loaderData;
  return (
    <AccountShell title="پیگیری سفارش" intro="شمارهٔ سفارش و کد پیگیری‌ای را که پس از ثبت سفارش نشان داده شد بنویسید.">
      <Form method="post" className="space-y-5" replace>
        <FormError message={answer?.by !== 'phone' ? answer?.error : undefined} />
        <Field label="شمارهٔ سفارش" name="number" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={20} defaultValue={number} />
        <Field label="کد پیگیری" name="key" autoComplete="off" dir="ltr" maxLength={100} hint="با ok_ آغاز می‌شود" />
        <SubmitButton busy={busy}>دیدن سفارش</SubmitButton>
      </Form>

      {smsLogin || emailLogin || proven || answer?.by === 'phone' ? (
        <section aria-labelledby="track-by-phone" className="space-y-4 border-t border-border pt-6" data-track-by-phone>
          <h2 id="track-by-phone" className="text-lg font-bold">کد پیگیری را ندارید؟</h2>
          <Form method="post" className="space-y-5" replace>
            <FormError message={answer?.by === 'phone' ? answer.error : undefined} />
            <Field label="شمارهٔ سفارش" name="number" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={20} defaultValue={number} />
            {proven ? (
              <>
                <FormNote>{proven.includes('@') ? 'ایمیل' : 'شمارهٔ'} <span dir="ltr">{proven}</span> تأیید شد؛ شمارهٔ سفارشی را که با آن ثبت کرده‌اید بنویسید.</FormNote>
                <SubmitButton intent="by-phone" busy={busy}>دیدن سفارش</SubmitButton>
                <SubmitButton intent="another-phone" busy={busy} secondary>شماره یا ایمیل دیگر</SubmitButton>
              </>
            ) : answer?.codeFor ? (
              <>
                <FormNote>کد تأیید {answer.codeFor.includes('@') ? 'به ایمیل' : 'با پیامک به'} <span dir="ltr">{answer.codeFor}</span> فرستاده شد. آن را بنویسید.</FormNote>
                <input type="hidden" name="contact" value={answer.codeFor} />
                <CodeField />
                <SubmitButton intent="verify-code" busy={busy}>دیدن سفارش</SubmitButton>
                <SubmitButton intent="send-code" busy={busy} secondary>فرستادن دوبارهٔ کد</SubmitButton>
              </>
            ) : (
              <>
                <p className="text-base leading-8 text-muted-foreground">{contactLabel(smsLogin, emailLogin)}ی را که سفارش با آن ثبت شد بنویسید تا کدی به آن فرستاده شود.</p>
                <ContactField label={contactLabel(smsLogin, emailLogin)} />
                <SubmitButton intent="send-code" busy={busy} secondary>فرستادن کد تأیید</SubmitButton>
              </>
            )}
          </Form>
        </section>
      ) : null}

      <p className="text-base leading-8 text-muted-foreground">
        اگر هنگام سفارش وارد حساب بودید، <Link to="/account" className="font-bold text-brand hover:underline">حساب من</Link> همهٔ سفارش‌هایتان را نشان می‌دهد.
      </p>
    </AccountShell>
  );
}
