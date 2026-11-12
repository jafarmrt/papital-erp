import { Form, Link, data, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/orderTrack';
import type { BuyerOrder, OrderAccessAnswer } from '@erp/storefront/storefrontOrderContracts';
import { publicSettings } from '../lib/api.server';
import {
  accountCall, clearTrackProofCookie, crossSite, normalizePhone, sameSite, trackProofCookie, trackProofOf,
} from '../lib/account.server';
import { isOrderKey, isOrderNumber, rememberOrderCookie } from '../lib/orderKeys.server';
import { siteEnv } from '../lib/site.server';
import { pageMeta } from '../lib/meta';
import { AccountShell, CodeField, Field, FormError, FormNote, PhoneField, SubmitButton } from '../components/AccountForm';

/**
 * v11 phase 8.2: «پیگیری سفارش» on a phone that did not place the order. The number and the tracking key are typed (a
 * POST, so the key stays out of addresses and logs); a right pair is kept in `sf_orders` and the order page opens.
 *
 * v12 phase 8d (site review 2.2): without the key, while the site signs in by SMS, the order's number and the buyer's
 * phone: a code goes to the phone (the login code, which goes to any phone alike), and the ERP answers the order's key
 * for a live proof of the phone the order was placed with (`POST /orders/:number/access`). A wrong number, another
 * phone and a wrong code all read the same; the proof waits ten minutes in an httpOnly cookie, so a mistyped number is
 * fixed without a new code. The ERP limits the tries per visitor and per order.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const number = new URL(request.url).searchParams.get('number') ?? '';
  return {
    number: isOrderNumber(number) ? number : '', siteUrl: siteEnv().siteUrl,
    smsLogin: (await publicSettings()).smsLogin === true, provenPhone: trackProofOf(request).phone,
  };
}

/** the buyer's own cart, address or order: never kept by a browser or a cache in between */
export const headers = () => ({ 'Cache-Control': 'no-store' });

export function meta({ data: loaded }: Route.MetaArgs) {
  return [...pageMeta({ title: 'پیگیری سفارش', description: 'پیگیری سفارش پاپیتال', path: '/orders/track', siteUrl: loaded?.siteUrl ?? '' }), { name: 'robots', content: 'noindex' }];
}

const latin = (value: string) => value.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\s+/g, '');
const NOT_FOUND = 'سفارشی با این شماره و کد پیدا نشد؛ هر دو را دوباره نگاه کنید.';
const NOT_FOUND_BY_PHONE = 'سفارشی با این شماره برای این شمارهٔ همراه پیدا نشد؛ شمارهٔ سفارش را دوباره نگاه کنید.';
const PHONE_WRONG = 'شمارهٔ همراه را درست بنویسید (مانند ۰۹۱۲۱۲۳۴۵۶۷).';
const NO_SMS = 'پیگیری با کد پیامکی اکنون در دسترس نیست؛ با کد پیگیری سفارش یا از «حساب من» پیگیری کنید.';

interface Answer {
  number: string;
  error?: string;
  /** which form the answer is about: the tracking key, or the buyer's phone */
  by?: 'key' | 'phone';
  /** the phone a code was sent to; the phone form then asks for the code */
  codeFor?: string;
}

/** The order's key for a proven phone: the order page opens with it kept, or the same refusal for any wrong pair */
async function openByPhone(request: Request, number: string, phone: string, proof: string, keepProof: boolean) {
  const opened = await accountCall<OrderAccessAnswer>(request, 'POST', `/orders/${number}/access`, { phone, phoneProof: proof });
  if (opened.data) {
    const headers = new Headers();
    headers.append('Set-Cookie', rememberOrderCookie(request, number, opened.data.accessKey));
    headers.append('Set-Cookie', clearTrackProofCookie());
    return redirect(`/orders/${number}`, { headers });
  }
  const answer: Answer = { number, by: 'phone', error: opened.status === 404 ? NOT_FOUND_BY_PHONE : opened.error };
  return keepProof ? data(answer, { headers: { 'Set-Cookie': trackProofCookie(phone, proof) } }) : answer;
}

export async function action({ request }: Route.ActionArgs) {
  if (!sameSite(request)) return crossSite();
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const number = latin(String(form.get('number') ?? '')).slice(0, 20);

  if (intent === 'another-phone') return data({ number, by: 'phone' } satisfies Answer, { headers: { 'Set-Cookie': clearTrackProofCookie() } });
  if (intent === 'send-code' || intent === 'verify-code' || intent === 'by-phone') {
    if (!isOrderNumber(number)) return { number, by: 'phone', error: NOT_FOUND_BY_PHONE } satisfies Answer;
    if (intent === 'by-phone') {
      const kept = trackProofOf(request);
      if (!kept.proof) return { number, by: 'phone' } satisfies Answer;
      return openByPhone(request, number, kept.phone, kept.proof, false);
    }
    const phone = normalizePhone(form.get('phone'));
    if (!phone) return { number, by: 'phone', error: PHONE_WRONG } satisfies Answer;
    if (intent === 'send-code') {
      const sent = await accountCall(request, 'POST', '/auth/otp/request', { phone });
      if (sent.status === 404) return { number, by: 'phone', error: NO_SMS } satisfies Answer;
      // a code sent a moment ago (429, «wait a little») still works: the code field stays
      if (sent.status !== 202) return { number, by: 'phone', codeFor: sent.status === 429 ? phone : undefined, error: sent.error } satisfies Answer;
      return { number, by: 'phone', codeFor: phone } satisfies Answer;
    }
    const code = String(form.get('code') ?? '').trim().slice(0, 12);
    const verified = await accountCall<{ phoneProof: string }>(request, 'POST', '/auth/otp/verify', { phone, code });
    if (!verified.data) return { number, by: 'phone', codeFor: phone, error: verified.error } satisfies Answer;
    return openByPhone(request, number, phone, verified.data.phoneProof, true);
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
  // a phone proven a moment ago (its cookie, read again after every form) unless a code is being asked for another
  const proven = answer?.codeFor ? '' : loaderData.provenPhone;
  return (
    <AccountShell title="پیگیری سفارش" intro="شمارهٔ سفارش و کد پیگیری‌ای را که پس از ثبت سفارش نشان داده شد بنویسید.">
      <Form method="post" className="space-y-5" replace>
        <FormError message={answer?.by !== 'phone' ? answer?.error : undefined} />
        <Field label="شمارهٔ سفارش" name="number" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={20} defaultValue={number} />
        <Field label="کد پیگیری" name="key" autoComplete="off" dir="ltr" maxLength={100} hint="با ok_ آغاز می‌شود" />
        <SubmitButton busy={busy}>دیدن سفارش</SubmitButton>
      </Form>

      {loaderData.smsLogin || proven || answer?.by === 'phone' ? (
        <section aria-labelledby="track-by-phone" className="space-y-4 border-t border-border pt-6" data-track-by-phone>
          <h2 id="track-by-phone" className="text-lg font-bold">کد پیگیری را ندارید؟</h2>
          <Form method="post" className="space-y-5" replace>
            <FormError message={answer?.by === 'phone' ? answer.error : undefined} />
            <Field label="شمارهٔ سفارش" name="number" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={20} defaultValue={number} />
            {proven ? (
              <>
                <FormNote>شمارهٔ <span dir="ltr">{proven}</span> تأیید شد؛ شمارهٔ سفارشی را که با آن ثبت کرده‌اید بنویسید.</FormNote>
                <SubmitButton intent="by-phone" busy={busy}>دیدن سفارش</SubmitButton>
                <SubmitButton intent="another-phone" busy={busy} secondary>شمارهٔ همراه دیگر</SubmitButton>
              </>
            ) : answer?.codeFor ? (
              <>
                <FormNote>کد تأیید به <span dir="ltr">{answer.codeFor}</span> پیامک شد. آن را بنویسید.</FormNote>
                <input type="hidden" name="phone" value={answer.codeFor} />
                <CodeField />
                <SubmitButton intent="verify-code" busy={busy}>دیدن سفارش</SubmitButton>
                <SubmitButton intent="send-code" busy={busy} secondary>فرستادن دوبارهٔ کد</SubmitButton>
              </>
            ) : (
              <>
                <p className="text-base leading-8 text-muted-foreground">شمارهٔ همراهی را که سفارش با آن ثبت شد بنویسید تا کدی به آن پیامک شود.</p>
                <PhoneField invalid={answer?.error === PHONE_WRONG} />
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
