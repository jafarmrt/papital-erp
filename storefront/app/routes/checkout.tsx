import { randomUUID } from 'node:crypto';
import { Form, Link, data, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/checkout';
import type { PlacedOrder, ShippingOption, ShippingQuoteAnswer } from '@erp/storefront/storefrontOrderContracts';
import type { AppliedDiscount } from '@erp/storefront/storefrontDiscountContracts';
import type { StorefrontAccountView } from '@erp/storefront/storefrontBuyerContracts';
import { ADDRESS_MAX, BUYER_NOTE_MAX, CITY_MAX, RECIPIENT_NAME_MAX } from '@erp/storefront/storefrontOrderRules';
import { IRAN_PROVINCES } from '@erp/storefront/storefrontRules';
import { publicSettings } from '../lib/api.server';
import {
  accountCall, checkoutProofCookie, checkoutProofOf, clearCheckoutProofCookie, crossSite, normalizePhone, sameSite, sessionOf,
} from '../lib/account.server';
import { cartOf, clearCartCookie } from '../lib/cart.server';
import { rememberOrderCookie } from '../lib/orderKeys.server';
import { siteEnv } from '../lib/site.server';
import { faNumber, formatPrice } from '../lib/format';
import { pageMeta } from '../lib/meta';
import { CodeField, Field, FormError, FormNote, PhoneField, SelectField, SubmitButton, TextAreaField } from '../components/AccountForm';

/**
 * v11 phase 8.2: the checkout, one form for the phone. The buyer writes the address, «هزینهٔ ارسال» asks the ERP which
 * methods this cart and province can use and what each costs, then «ثبت سفارش» places the order. Every step is the same
 * plain form posted here, so it works without JavaScript, and nothing in it carries a price: the ERP prices the cart.
 *
 * - The request key is made here once per checkout and sent back with the form, so a second tap (or a lost answer) gives
 *   the same order and key again instead of a second order. It is renewed only after the ERP refused the order (a
 *   refused key never made an order); when the ERP could not be reached the same key is kept, since the order may exist.
 * - A signed-in buyer's details fill the form, and a buyer of a group that may order «به حساب» chooses how to pay.
 * - A discount code (8.2c) goes with the quote and the order; the ERP checks it and answers its amount. A code that does
 *   not apply is said under its field and the quote is asked again without it, so the buyer still sees the methods.
 * - The placed order's tracking key goes in the `sf_orders` cookie and the buyer lands on its page; the cart is emptied.
 * - v12 phase 7 (site review 1.3): while the ERP signs in by SMS, a guest proves the phone at «ثبت سفارش»: the first tap
 *   sends a code and the same form shows a code field; the second tap verifies it and places the order with the proof.
 *   The proof waits in an httpOnly cookie for this page only, so an order the ERP refused (an item short) is placed again
 *   without a new code. A signed-in buyer, and every buyer while the texts are off, orders as before.
 */
const FIELDS = ['recipientName', 'phone', 'province', 'city', 'address', 'postalCode', 'note'] as const;
type Fields = Record<typeof FIELDS[number], string>;
const FIELD_MAX: Record<typeof FIELDS[number], number> = {
  recipientName: RECIPIENT_NAME_MAX, phone: 20, province: 60, city: CITY_MAX, address: ADDRESS_MAX, postalCode: 20, note: BUYER_NOTE_MAX,
};

interface ActionAnswer {
  fields: Fields;
  requestKey: string;
  shippingMethod: string;
  paymentMethod: string;
  options: ShippingOption[] | null;
  itemsAmount: string;
  discountCode: string;
  discount: AppliedDiscount | null;
  error?: string;
  field?: string;
  /** v12 phase 7: the phone a code was sent to; the form then asks for the code before placing */
  codeFor?: string;
}

async function accountOf(request: Request): Promise<StorefrontAccountView | null> {
  if (!sessionOf(request)) return null;
  return (await accountCall<StorefrontAccountView>(request, 'GET', '/account')).data;
}

export async function loader({ request }: Route.LoaderArgs) {
  const settings = await publicSettings();
  if (!settings.ordering) throw new Response('پیدا نشد', { status: 404 });
  const lines = cartOf(request);
  if (!lines.length) throw redirect('/cart');
  const account = await accountOf(request);
  return {
    requestKey: randomUUID(),
    count: lines.reduce((sum, l) => sum + l.quantity, 0),
    prefill: { recipientName: account?.name ?? '', phone: account?.phone ?? '', city: account?.city ?? '' },
    paymentMethods: account?.group?.paymentMethods ?? ['card'],
    groupTitle: account?.group?.title ?? '',
    signedIn: Boolean(account),
    smsLogin: settings.smsLogin === true,
    reservationHours: settings.reservationHours,
    siteUrl: siteEnv().siteUrl,
  };
}

/** the buyer's own cart, address or order: never kept by a browser or a cache in between */
export const headers = () => ({ 'Cache-Control': 'no-store' });

export function meta({ data }: Route.MetaArgs) {
  return [...pageMeta({ title: 'ثبت سفارش', description: 'نشانی و روش ارسال سفارش پاپیتال', path: '/checkout', siteUrl: data?.siteUrl ?? '' }), { name: 'robots', content: 'noindex' }];
}

const fieldsOf = (form: FormData) => Object.fromEntries(FIELDS.map(f => [f, String(form.get(f) ?? '').slice(0, FIELD_MAX[f] + 1)])) as Fields;

const PHONE_WRONG = 'شمارهٔ همراه را درست بنویسید (مانند ۰۹۱۲۱۲۳۴۵۶۷).';

export async function action({ request }: Route.ActionArgs) {
  if (!sameSite(request)) return crossSite();
  const form = await request.formData();
  const lines = cartOf(request);
  if (!lines.length) return redirect('/cart');
  const fields = fieldsOf(form);
  const typedKey = String(form.get('requestKey') ?? '');
  const requestKey = /^[A-Za-z0-9_-]{16,80}$/.test(typedKey) ? typedKey : randomUUID();
  const shippingMethod = String(form.get('shippingMethod') ?? '').slice(0, 60);
  const paymentMethod = String(form.get('paymentMethod') ?? 'card') === 'on_account' ? 'on_account' : 'card';
  const discountCode = String(form.get('discountCode') ?? '').trim().slice(0, 40);
  const answer = (rest: Partial<ActionAnswer>): ActionAnswer => ({
    fields, requestKey, shippingMethod, paymentMethod, options: null, itemsAmount: '', discountCode, discount: null, ...rest,
  });

  const quoteOf = (code: string) => accountCall<ShippingQuoteAnswer>(request, 'POST', '/shipping/quote', { province: fields.province, lines, ...(code ? { discountCode: code } : {}) });
  let quote = await quoteOf(discountCode);
  if (!quote.data && discountCode && quote.field === 'discountCode') {
    const refused = quote.error;
    quote = await quoteOf('');
    if (quote.data) return answer({ options: quote.data.options, itemsAmount: quote.data.itemsAmount, error: refused, field: 'discountCode' });
  }
  if (!quote.data) return answer({ error: quote.error, field: quote.field === 'province' || quote.field === 'lines' ? quote.field : '' });
  const quoted = { options: quote.data.options, itemsAmount: quote.data.itemsAmount, discount: quote.data.discount };
  const intent = String(form.get('intent') ?? '');
  if (intent !== 'place' && intent !== 'send-code') return answer(quoted);

  // v12 phase 7: a guest's phone proof while the ERP signs in by SMS. The page's settings may be a minute old, so the
  // ERP has the last word: an order it refuses for a missing proof sends a code and the form then carries `codeFor`,
  // after which the proof is asked whatever the settings or a session cookie say. A proof kept from an earlier tap is
  // always sent (the ERP ignores it for a signed-in buyer or while the texts are off).
  const phone = normalizePhone(fields.phone);
  const askedBefore = String(form.get('codeFor') ?? '') !== '';
  const needsProof = askedBefore || ((await publicSettings()).smsLogin === true && !sessionOf(request));
  /** a code for the phone; `null` when the ERP no longer signs in by SMS (its code route is 404), so no proof is needed */
  const sendCode = async (said?: string): Promise<ActionAnswer | null> => {
    const sent = await accountCall(request, 'POST', '/auth/otp/request', { phone });
    if (sent.status === 404 && !askedBefore) return null;
    // a code sent a moment ago (429, «wait a little») still works: the code field stays
    if (sent.status !== 202) return answer({ ...quoted, codeFor: askedBefore || sent.status === 429 ? phone : undefined, error: sent.error, field: sent.field === 'phone' ? 'phone' : '' });
    return answer({ ...quoted, codeFor: phone, ...(said ? { error: said } : {}) });
  };
  if (needsProof && !phone) return answer({ ...quoted, error: PHONE_WRONG, field: 'phone' });
  if (intent === 'send-code') return (needsProof && await sendCode()) || answer(quoted);
  let proof = phone ? checkoutProofOf(request, phone) : '';
  let freshProof = false;
  const typedCode = String(form.get('code') ?? '').trim().slice(0, 12);
  if (needsProof && !proof) {
    if (typedCode) {
      const verified = await accountCall<{ phoneProof: string }>(request, 'POST', '/auth/otp/verify', { phone, code: typedCode });
      if (!verified.data) return answer({ ...quoted, codeFor: phone, error: verified.error, field: 'code' });
      proof = verified.data.phoneProof;
      freshProof = true;
    } else {
      const asked = await sendCode();
      if (asked) return asked;
    }
  }

  const placed = await accountCall<PlacedOrder>(request, 'POST', '/orders', {
    requestKey, ...fields, shippingMethod, lines, ...(paymentMethod === 'on_account' ? { paymentMethod } : {}), ...(discountCode ? { discountCode } : {}),
    ...(proof ? { phoneProof: proof } : {}),
  });
  if (!placed.data) {
    const nextKey = placed.status >= 500 ? requestKey : randomUUID();
    // the ERP wants a proof (a guest while the texts are on, a session it no longer knows, a proof that ran out): a fresh
    // code goes out at once, and the old proof cookie goes
    if (placed.code === 'STOREFRONT_PHONE_PROOF_REQUIRED' && phone) {
      const asked = (await sendCode(placed.error)) ?? answer({ ...quoted, error: placed.error });
      return data({ ...asked, requestKey: nextKey }, { headers: { 'Set-Cookie': clearCheckoutProofCookie() } });
    }
    const refused = answer({ ...quoted, error: placed.error, field: placed.field ?? '', requestKey: nextKey, codeFor: undefined });
    // any other refusal rolled the order back, so a proof made just now is still good for the next tap
    return freshProof ? data(refused, { headers: { 'Set-Cookie': checkoutProofCookie(phone, proof) } }) : refused;
  }
  const headers = new Headers();
  headers.append('Set-Cookie', rememberOrderCookie(request, placed.data.order.number, placed.data.accessKey));
  headers.append('Set-Cookie', clearCartCookie());
  if (proof) headers.append('Set-Cookie', clearCheckoutProofCookie());
  return redirect(`/orders/${placed.data.order.number}?placed=1`, { headers });
}

export default function CheckoutPage({ loaderData, actionData }: Route.ComponentProps) {
  const { prefill, paymentMethods, groupTitle, signedIn, smsLogin, count, reservationHours } = loaderData;
  const answer = actionData as ActionAnswer | undefined;
  const busy = useNavigation().state === 'submitting';
  const value = (f: typeof FIELDS[number]) => answer?.fields[f] ?? (f in prefill ? prefill[f as keyof typeof prefill] : '');
  const bad = (f: string) => answer?.field === f;
  const options = answer?.options ?? null;
  const chosen = options?.some(o => o.code === answer?.shippingMethod) ? answer?.shippingMethod : options?.[0]?.code;
  const onAccount = paymentMethods.includes('on_account');
  const cardAllowed = paymentMethods.includes('card');
  const discount = answer?.discount ?? null;
  const afterDiscount = discount && answer ? (BigInt(answer.itemsAmount || '0') - BigInt(discount.amount)).toString() : '';

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 pb-16 lg:pt-10">
      <nav aria-label="مسیر" className="text-sm text-muted-foreground">
        <Link to="/cart" className="hover:text-foreground">سبد خرید ({faNumber(count)} کالا)</Link>
      </nav>
      <h1 className="mt-3 text-2xl font-extrabold lg:text-3xl">ثبت سفارش</h1>
      <div className="tile-rule mt-4 w-24" aria-hidden />
      {!signedIn ? (
        <p className="mt-4 text-base leading-8 text-muted-foreground">
          بی حساب هم می‌توانید سفارش دهید. <Link to="/account/sign-in?next=%2Fcheckout" className="font-bold text-brand hover:underline">ورود به حساب</Link> سفارش را در حساب شما نگه می‌دارد.
          {smsLogin ? ' هنگام ثبت سفارش، شمارهٔ همراه با یک کد پیامکی تأیید می‌شود.' : null}
        </p>
      ) : null}

      <Form method="post" className="mt-6 space-y-5" replace>
        <input type="hidden" name="requestKey" value={answer?.requestKey ?? loaderData.requestKey} />
        <FormError message={answer?.error} />
        {answer?.field === 'lines' ? (
          <p className="text-base leading-8"><Link to="/cart" className="font-bold text-brand hover:underline">بازگشت به سبد خرید</Link> و تغییر تعداد</p>
        ) : null}
        <Field label="نام و نام خانوادگی گیرنده" name="recipientName" autoComplete="name" maxLength={RECIPIENT_NAME_MAX} defaultValue={value('recipientName')} invalid={bad('recipientName')} />
        <PhoneField defaultValue={value('phone')} invalid={bad('phone')} />
        <SelectField label="استان" name="province" options={IRAN_PROVINCES} autoComplete="address-level1" defaultValue={value('province')} invalid={bad('province')} />
        <Field label="شهر" name="city" autoComplete="address-level2" maxLength={CITY_MAX} defaultValue={value('city')} invalid={bad('city')} />
        <TextAreaField label="نشانی" name="address" autoComplete="street-address" maxLength={ADDRESS_MAX} defaultValue={value('address')} hint="خیابان، کوچه، پلاک و واحد" invalid={bad('address')} />
        <Field label="کد پستی" name="postalCode" inputMode="numeric" autoComplete="postal-code" dir="ltr" maxLength={20} defaultValue={value('postalCode')} hint="ده رقم، بی خط تیره" invalid={bad('postalCode')} />
        <TextAreaField label="توضیح (اختیاری)" name="note" autoComplete="off" maxLength={BUYER_NOTE_MAX} defaultValue={value('note')} required={false} invalid={bad('note')} />

        <Field label="کد تخفیف (اختیاری)" name="discountCode" autoComplete="off" dir="ltr" maxLength={40} required={false}
          defaultValue={answer?.discountCode ?? ''} invalid={bad('discountCode')} hint={discount ? `«${discount.title || discount.code}» روی این سبد نشست.` : 'اگر کدی دارید بنویسید؛ با «هزینهٔ ارسال» سنجیده می‌شود.'} />

        {options ? (
          <fieldset className="space-y-3" aria-invalid={bad('shippingMethod') || undefined}>
            <legend className="text-base font-bold">روش ارسال</legend>
            {options.length === 0 ? (
              <p className="text-sm leading-7 text-destructive">برای این استان و این سبد روش ارسالی نیست؛ با فروشگاه تماس بگیرید.</p>
            ) : options.map(o => (
              <label key={o.code} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-control border border-border bg-card p-4 has-[:checked]:border-brand">
                <input type="radio" name="shippingMethod" value={o.code} defaultChecked={o.code === chosen} className="mt-1.5 size-5 accent-[var(--color-brand)]" />
                <span className="flex-1 space-y-1">
                  <span className="flex flex-wrap justify-between gap-2 font-bold">
                    <span>{o.title}</span>
                    <span>{o.kind === 'on_delivery' ? 'پرداخت هنگام تحویل' : o.free ? 'رایگان' : formatPrice(o.amount)}</span>
                  </span>
                  {o.description ? <span className="block text-sm leading-6 text-muted-foreground">{o.description}</span> : null}
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {options && onAccount ? (
          <fieldset className="space-y-3">
            <legend className="text-base font-bold">روش پرداخت</legend>
            {cardAllowed ? (
              <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-control border border-border bg-card p-4 has-[:checked]:border-brand">
                <input type="radio" name="paymentMethod" value="card" defaultChecked={answer?.paymentMethod !== 'on_account'} className="size-5" />
                <span className="font-bold">کارت‌به‌کارت</span>
              </label>
            ) : null}
            <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-control border border-border bg-card p-4 has-[:checked]:border-brand">
              <input type="radio" name="paymentMethod" value="on_account" defaultChecked={!cardAllowed || answer?.paymentMethod === 'on_account'} className="mt-1.5 size-5" />
              <span className="space-y-1">
                <span className="block font-bold">به حساب{groupTitle ? ` (${groupTitle})` : ''}</span>
                <span className="block text-sm leading-6 text-muted-foreground">سفارش پس از تأیید فروشگاه فرستاده می‌شود و مبلغ آن به حساب شما نوشته می‌شود.</span>
              </span>
            </label>
          </fieldset>
        ) : null}

        {options ? (
          <div className="space-y-2 border-t border-border pt-5">
            <p className="flex justify-between text-lg"><span>جمع کالاها</span><span className="font-extrabold">{formatPrice(answer?.itemsAmount ?? '')}</span></p>
            {discount ? (
              <>
                <p className="flex justify-between text-base text-brand"><span>تخفیف <span dir="ltr">{discount.code}</span></span><span className="font-bold">− {formatPrice(discount.amount)}</span></p>
                <p className="flex justify-between text-lg"><span>پس از تخفیف</span><span className="font-extrabold">{formatPrice(afterDiscount)}</span></p>
              </>
            ) : null}
            <p className="text-sm leading-7 text-muted-foreground">
              هزینهٔ ارسال روش انتخابی به این مبلغ افزوده می‌شود. پس از ثبت، کالاها {faNumber(reservationHours)} ساعت برای شما کنار گذاشته می‌شوند تا پرداخت را انجام دهید.
            </p>
          </div>
        ) : null}

        {options && options.length && answer?.codeFor ? (
          <div className="space-y-3 border-t border-border pt-5">
            {answer.field !== 'code' ? <FormNote>کد تأیید به <span dir="ltr">{answer.codeFor}</span> پیامک شد. آن را بنویسید و سفارش را ثبت کنید.</FormNote> : null}
            <input type="hidden" name="codeFor" value={answer.codeFor} />
            <CodeField />
          </div>
        ) : null}

        {options && options.length ? (
          <>
            <SubmitButton intent="place" busy={busy}>{answer?.codeFor ? 'تأیید شماره و ثبت سفارش' : 'ثبت سفارش'}</SubmitButton>
            {answer?.codeFor ? <SubmitButton intent="send-code" busy={busy} secondary>کد نرسید؟ دوباره بفرست</SubmitButton> : null}
            <SubmitButton intent="quote" busy={busy} secondary>نشانی را عوض کردم؛ هزینهٔ ارسال دوباره</SubmitButton>
          </>
        ) : (
          <SubmitButton intent="quote" busy={busy}>دیدن روش‌ها و هزینهٔ ارسال</SubmitButton>
        )}
      </Form>
    </div>
  );
}
