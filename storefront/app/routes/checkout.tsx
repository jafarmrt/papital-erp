import { randomUUID } from 'node:crypto';
import { useState } from 'react';
import { Form, Link, data, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/checkout';
import type { BuyerAddress, BuyerAddressBook, PlacedOrder, QuotedLine, ShippingOption, ShippingQuoteAnswer } from '@erp/storefront/storefrontOrderContracts';
import type { AppliedDiscount } from '@erp/storefront/storefrontDiscountContracts';
import type { StorefrontAccountView } from '@erp/storefront/storefrontBuyerContracts';
import { ADDRESS_MAX, BUYER_NOTE_MAX, CITY_MAX, GIFT_MESSAGE_MAX, RECIPIENT_NAME_MAX, payableWith } from '@erp/storefront/storefrontOrderRules';
import { IRAN_PROVINCES } from '@erp/storefront/storefrontRules';
import { product as productBySlug, publicSettings } from '../lib/api.server';
import {
  accountCall, checkoutProofCookie, checkoutProofOf, clearCheckoutProofCookie, crossSite, normalizePhone, sameSite, sessionOf,
} from '../lib/account.server';
import { cartOf, clearCartCookie } from '../lib/cart.server';
import { rememberOrderCookie } from '../lib/orderKeys.server';
import { placeWithEmail } from '../lib/checkoutEmail.server';
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
 * - v12 phase 8a (site review 2.4): once the methods are quoted, a summary right above «ثبت سفارش» names the items with
 *   their quantities and amounts and says the shipping and, large, «مبلغ قابل پرداخت»: the ERP's own sums (the quote)
 *   with the ERP's own rule (`payableWith`). It follows the method the buyer picks; without JavaScript, the one picked
 *   last time. The form carries the payable it showed, and «ثبت سفارش» places nothing when the fresh quote makes another
 *   (the province, the code or the cart changed since): the form comes back with the new summary, so the order is placed
 *   at the amount the buyer saw.
 * - v12 phase 8c (site review 2.5, owner's decision 13): «خریدار» (name and mobile: the ERP's customer, the texts and the
 *   code go by it) apart from «گیرنده» (name, own mobile and the address), with «گیرنده خودم هستم» on by default: while
 *   it is on the recipient's two fields are hidden by the page's own CSS (no script needed) and not sent. «هدیه است» is
 *   free and takes a short message for its card. A signed-in buyer fills the recipient from the address book (the
 *   default comes ready; «پر کردن از این نشانی» takes another) and may keep a new address in it.
 */
const FIELDS = ['buyerName', 'phone', 'email', 'recipientName', 'recipientPhone', 'province', 'city', 'address', 'postalCode', 'giftMessage', 'note'] as const;
type Fields = Record<typeof FIELDS[number], string>;
const FIELD_MAX: Record<typeof FIELDS[number], number> = {
  buyerName: RECIPIENT_NAME_MAX, phone: 20, email: 254, recipientName: RECIPIENT_NAME_MAX, recipientPhone: 20, province: 60, city: CITY_MAX, address: ADDRESS_MAX,
  postalCode: 20, giftMessage: GIFT_MESSAGE_MAX, note: BUYER_NOTE_MAX,
};
/** v12 phase 8c: the form's three boxes */
interface Checks { sameRecipient: boolean; gift: boolean; saveAddress: boolean }

interface ActionAnswer {
  fields: Fields;
  checks: Checks;
  requestKey: string;
  shippingMethod: string;
  paymentMethod: string;
  options: ShippingOption[] | null;
  itemsAmount: string;
  /** v12 phase 8a review: the quoted lines with this buyer's amounts, for the summary */
  lines: QuotedLine[];
  discountCode: string;
  discount: AppliedDiscount | null;
  error?: string;
  field?: string;
  /** v12 phase 7: the phone a code was sent to; the form then asks for the code before placing */
  codeFor?: string;
  /** v12 phase 8e: the code went to the buyer's email («حالت بی پیامک»), so `codeFor` is that email */
  codeVia?: 'email';
  /** v12 phase 8c: the kept address the recipient was just filled from; the form is drawn afresh with it */
  filled?: number;
}

async function accountOf(request: Request): Promise<StorefrontAccountView | null> {
  if (!sessionOf(request)) return null;
  return (await accountCall<StorefrontAccountView>(request, 'GET', '/account')).data;
}

/** v12 phase 8c: a signed-in buyer's address book, or none (a guest, or the ERP could not be read: the form still works) */
async function bookOf(request: Request): Promise<BuyerAddressBook | null> {
  if (!sessionOf(request)) return null;
  return (await accountCall<BuyerAddressBook>(request, 'GET', '/account/addresses')).data;
}

/** The recipient part of the form from a kept address; «خودم» when it is the account's own name with no other phone */
const fromAddress = (a: BuyerAddress, ownName: string) => ({
  fields: { recipientName: a.recipientName, recipientPhone: a.recipientPhone, province: a.province, city: a.city, address: a.address, postalCode: a.postalCode },
  sameRecipient: a.recipientName === ownName && !a.recipientPhone,
});

export async function loader({ request }: Route.LoaderArgs) {
  const settings = await publicSettings();
  if (!settings.ordering) throw new Response('پیدا نشد', { status: 404 });
  const lines = cartOf(request);
  if (!lines.length) throw redirect('/cart');
  const [account, book, products] = await Promise.all([accountOf(request), bookOf(request), Promise.all(lines.map(l => productBySlug(l.slug)))]);
  const addresses = account ? book?.data ?? [] : [];
  const kept = addresses[0] ? fromAddress(addresses[0], account?.name ?? '') : null;
  return {
    items: lines.map((l, i) => ({ slug: l.slug, name: products[i]?.name ?? '', quantity: l.quantity })),
    requestKey: randomUUID(),
    count: lines.reduce((sum, l) => sum + l.quantity, 0),
    prefill: {
      buyerName: account?.name ?? '', phone: account?.phone ?? '', city: account?.city ?? '', ...kept?.fields,
    } as Partial<Fields>,
    sameRecipient: kept?.sameRecipient ?? true,
    addresses,
    canSaveAddress: Boolean(account) && addresses.length < (book?.max ?? 0),
    paymentMethods: account?.group?.paymentMethods ?? ['card'],
    groupTitle: account?.group?.title ?? '',
    signedIn: Boolean(account),
    smsLogin: settings.smsLogin === true,
    // v12 phase 8e: a guest proves an email while the texts cannot prove a phone and the site's email is on
    emailProof: !account && settings.smsLogin !== true && settings.emailLogin === true,
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
const PAYABLE_CHANGED = 'مبلغ قابل پرداخت عوض شد؛ خلاصهٔ تازهٔ سفارش را ببینید و دوباره «ثبت سفارش» را بزنید.';

export async function action({ request }: Route.ActionArgs) {
  if (!sameSite(request)) return crossSite();
  const form = await request.formData();
  const lines = cartOf(request);
  if (!lines.length) return redirect('/cart');
  let fields = fieldsOf(form);
  let filled: number | undefined;
  const checks: Checks = { sameRecipient: form.get('sameRecipient') === 'on', gift: form.get('gift') === 'on', saveAddress: form.get('saveAddress') === 'on' };
  const intent = String(form.get('intent') ?? '');
  // v12 phase 8c: «پر کردن از این نشانی» puts a kept address in the recipient's fields, then the methods are quoted for it
  if (intent === 'use-address') {
    const chosen = (await bookOf(request))?.data.find(a => a.id === Number(form.get('savedAddress')));
    if (chosen) {
      const kept = fromAddress(chosen, fields.buyerName);
      fields = { ...fields, ...kept.fields };
      checks.sameRecipient = kept.sameRecipient;
      checks.saveAddress = false;
      filled = chosen.id;
    }
  }
  const typedKey = String(form.get('requestKey') ?? '');
  const requestKey = /^[A-Za-z0-9_-]{16,80}$/.test(typedKey) ? typedKey : randomUUID();
  const shippingMethod = String(form.get('shippingMethod') ?? '').slice(0, 60);
  const paymentMethod = String(form.get('paymentMethod') ?? 'card') === 'on_account' ? 'on_account' : 'card';
  const discountCode = String(form.get('discountCode') ?? '').trim().slice(0, 40);
  const answer = (rest: Partial<ActionAnswer>): ActionAnswer => ({
    fields, checks, requestKey, shippingMethod, paymentMethod, options: null, itemsAmount: '', lines: [], discountCode, discount: null, filled, ...rest,
  });

  const quoteOf = (code: string) => accountCall<ShippingQuoteAnswer>(request, 'POST', '/shipping/quote', { province: fields.province, lines, ...(code ? { discountCode: code } : {}) });
  let quote = await quoteOf(discountCode);
  if (!quote.data && discountCode && quote.field === 'discountCode') {
    const refused = quote.error;
    quote = await quoteOf('');
    if (quote.data) return answer({ options: quote.data.options, itemsAmount: quote.data.itemsAmount, lines: quote.data.lines ?? [], error: refused, field: 'discountCode' });
  }
  if (!quote.data) return answer({ error: quote.error, field: quote.field === 'province' || quote.field === 'lines' ? quote.field : '' });
  const quoted = { options: quote.data.options, itemsAmount: quote.data.itemsAmount, lines: quote.data.lines ?? [], discount: quote.data.discount };
  if (intent !== 'place' && intent !== 'send-code') return answer(quoted);
  // v12 phase 8a review: «ثبت سفارش» places the order at the amount the buyer saw. The form carries the payable its
  // summary showed; when the fresh quote makes another (the province, the code or the cart changed since), the order is
  // not placed and the form comes back with the new summary
  const shown = String(form.get('shownPayable') ?? '');
  const method = quote.data.options.find(o => o.code === shippingMethod);
  if (intent === 'place' && shown && method && shown !== payableWith(quote.data.itemsAmount, quote.data.discount?.amount ?? '0', method)) {
    const codeFor = String(form.get('codeFor') ?? '') ? normalizePhone(fields.phone) || undefined : undefined;
    return answer({ ...quoted, codeFor, error: PAYABLE_CHANGED });
  }

  // v12 phase 7: a guest's phone proof while the ERP signs in by SMS. The page's settings may be a minute old, so the
  // ERP has the last word: an order it refuses for a missing proof sends a code and the form then carries `codeFor`,
  // after which the proof is asked whatever the settings or a session cookie say. A proof kept from an earlier tap is
  // always sent (the ERP ignores it for a signed-in buyer or while the texts are off).
  const phone = normalizePhone(fields.phone);
  /** v12 phase 8e: the order as the form says, with the proof the path gathered (a phone's or an email's) */
  const placeOrder = (proofs: Record<string, string>) => accountCall<PlacedOrder>(request, 'POST', '/orders', {
    // v12 phase 8c: the buyer (whom the phone and the customer are) and the recipient, who is the buyer while the box is on
    requestKey, phone: fields.phone, buyerName: fields.buyerName, recipientName: checks.sameRecipient ? fields.buyerName : fields.recipientName,
    ...(!checks.sameRecipient && fields.recipientPhone.trim() ? { recipientPhone: fields.recipientPhone } : {}),
    province: fields.province, city: fields.city, address: fields.address, postalCode: fields.postalCode, note: fields.note,
    ...(checks.gift ? { gift: true, ...(fields.giftMessage.trim() ? { giftMessage: fields.giftMessage } : {}) } : {}),
    ...(checks.saveAddress && sessionOf(request) ? { saveAddress: true } : {}),
    shippingMethod, lines, ...(paymentMethod === 'on_account' ? { paymentMethod } : {}), ...(discountCode ? { discountCode } : {}),
    ...proofs,
  });
  // v12 phase 8e («حالت بی پیامک»): the guest proves an email instead; the ERP's refusal for a missing email proof turns
  // the form to it too (the settings may be a minute old)
  const settingsNow = await publicSettings();
  const viaEmail = String(form.get('codeVia') ?? '') === 'email'
    || (!sessionOf(request) && settingsNow.smsLogin !== true && settingsNow.emailLogin === true);
  if (viaEmail) return placeWithEmail({ request, form, fields, quoted, answer, requestKey, placeOrder });
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

  const placed = await placeOrder(proof ? { phoneProof: proof } : {});
  if (!placed.data && placed.code === 'STOREFRONT_EMAIL_PROOF_REQUIRED') {
    return answer({ ...quoted, error: placed.error, field: 'email', codeVia: 'email', requestKey: placed.status >= 500 ? requestKey : randomUUID() });
  }
  if (!placed.data) {
    const nextKey = placed.status >= 500 ? requestKey : randomUUID();
    // the ERP wants a proof (a guest while the texts are on, a session it no longer knows, a proof that ran out): a fresh
    // code goes out at once, and the old proof cookie goes
    if (placed.code === 'STOREFRONT_PHONE_PROOF_REQUIRED' && phone) {
      const asked = (await sendCode(placed.error)) ?? answer({ ...quoted, error: placed.error });
      return data({ ...asked, requestKey: nextKey }, { headers: { 'Set-Cookie': clearCheckoutProofCookie() } });
    }
    // the recipient's name is the buyer's while the box is on, so its refusal belongs to the buyer's field
    const field = placed.field === 'recipientName' && checks.sameRecipient ? 'buyerName' : placed.field ?? '';
    const refused = answer({ ...quoted, error: placed.error, field, requestKey: nextKey, codeFor: undefined });
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
  const { prefill, paymentMethods, groupTitle, signedIn, smsLogin, emailProof, count, reservationHours, items, addresses, canSaveAddress } = loaderData;
  const answer = actionData as ActionAnswer | undefined;
  const busy = useNavigation().state === 'submitting';
  const sameRecipient = answer?.checks.sameRecipient ?? loaderData.sameRecipient;
  const value = (f: typeof FIELDS[number]) => answer?.fields[f] ?? (f in prefill ? prefill[f as keyof typeof prefill] : '');
  const bad = (f: string) => answer?.field === f;
  const options = answer?.options ?? null;
  const chosen = options?.some(o => o.code === answer?.shippingMethod) ? answer?.shippingMethod : options?.[0]?.code;
  const onAccount = paymentMethods.includes('on_account');
  const cardAllowed = paymentMethods.includes('card');
  const discount = answer?.discount ?? null;
  // the method the summary reckons with: the one tapped on this page, else the one the form came back with
  const [picked, setPicked] = useState('');
  const method = options?.find(o => o.code === picked) ?? options?.find(o => o.code === chosen) ?? null;
  const payable = method && answer?.itemsAmount ? payableWith(answer.itemsAmount, discount?.amount ?? '0', method) : '';
  const lineAmounts = new Map((answer?.lines ?? []).map(l => [l.slug, l.amount]));

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
          {smsLogin ? ' هنگام ثبت سفارش، شمارهٔ همراه با یک کد پیامکی تأیید می‌شود.' : emailProof ? ' هنگام ثبت سفارش، ایمیل شما با یک کد تأیید می‌شود.' : null}
        </p>
      ) : null}

      <Form key={`checkout-${answer?.filled ?? 0}`} method="post" className="mt-6 space-y-5" replace>
        <input type="hidden" name="requestKey" value={answer?.requestKey ?? loaderData.requestKey} />
        <FormError message={answer?.error} />
        {answer?.field === 'lines' ? (
          <p className="text-base leading-8"><Link to="/cart" className="font-bold text-brand hover:underline">بازگشت به سبد خرید</Link> و تغییر تعداد</p>
        ) : null}
        {/* v12 phase 8c (site review 2.5): the buyer, whom the ERP's customer, the texts and the code are for */}
        <fieldset className="space-y-5">
          <legend className="text-base font-bold">خریدار</legend>
          <Field label="نام و نام خانوادگی" name="buyerName" autoComplete="name" maxLength={RECIPIENT_NAME_MAX} defaultValue={value('buyerName')} invalid={bad('buyerName')} />
          <PhoneField defaultValue={value('phone')} invalid={bad('phone')} />
          {/* v12 phase 8e («حالت بی پیامک»): a guest's email, proven with a code at «ثبت سفارش» */}
          {(emailProof || answer?.codeVia === 'email') && !signedIn ? (
            <Field label="ایمیل" name="email" type="email" inputMode="email" autoComplete="email" dir="ltr" maxLength={254} defaultValue={value('email')}
              invalid={bad('email')} hint="کد تأیید سفارش به این ایمیل فرستاده می‌شود." />
          ) : null}
          {answer?.codeVia === 'email' ? <input type="hidden" name="codeVia" value="email" /> : null}
        </fieldset>

        {/* the recipient's two fields hide while «گیرنده خودم هستم» is on, by CSS alone, and are not sent then */}
        <fieldset className="group space-y-5 border-t border-border pt-5">
          <legend className="sr-only">گیرنده و نشانی</legend>
          <p className="text-base font-bold" aria-hidden>گیرنده و نشانی</p>
          {addresses.length ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-0 flex-1 space-y-2">
                <span className="block text-base font-medium">از دفترچهٔ نشانی</span>
                <select name="savedAddress" defaultValue={addresses[0]?.id} className="h-12 w-full rounded-control border border-border bg-card px-3 text-base">
                  {addresses.map(a => <option key={a.id} value={a.id}>{`${a.recipientName}، ${a.city}${a.isDefault ? ' (پیش‌فرض)' : ''}`}</option>)}
                </select>
              </label>
              <SubmitButton intent="use-address" busy={busy} secondary>پر کردن از این نشانی</SubmitButton>
            </div>
          ) : null}
          <label className="flex min-h-12 cursor-pointer items-center gap-3">
            <input type="checkbox" id="same-recipient" name="sameRecipient" defaultChecked={sameRecipient} className="size-5 accent-[var(--color-brand)]" />
            <span className="font-medium">گیرنده خودم هستم</span>
          </label>
          <div className="space-y-5 group-has-[#same-recipient:checked]:hidden" data-recipient-fields>
            <Field label="نام و نام خانوادگی گیرنده" name="recipientName" autoComplete="off" maxLength={RECIPIENT_NAME_MAX} required={false} defaultValue={value('recipientName')} invalid={bad('recipientName')} />
            <Field label="شمارهٔ همراه گیرنده (اختیاری)" name="recipientPhone" type="tel" inputMode="tel" autoComplete="off" dir="ltr" maxLength={20} required={false}
              defaultValue={value('recipientPhone')} hint="برای هماهنگی پیک؛ پیامک و کد به آن نمی‌رود." invalid={bad('recipientPhone')} />
          </div>
          <SelectField label="استان" name="province" options={IRAN_PROVINCES} autoComplete="address-level1" defaultValue={value('province')} invalid={bad('province')} />
          <Field label="شهر" name="city" autoComplete="address-level2" maxLength={CITY_MAX} defaultValue={value('city')} invalid={bad('city')} />
          <TextAreaField label="نشانی" name="address" autoComplete="street-address" maxLength={ADDRESS_MAX} defaultValue={value('address')} hint="خیابان، کوچه، پلاک و واحد" invalid={bad('address')} />
          <Field label="کد پستی" name="postalCode" inputMode="numeric" autoComplete="postal-code" dir="ltr" maxLength={20} defaultValue={value('postalCode')} hint="ده رقم، بی خط تیره" invalid={bad('postalCode')} />
          {canSaveAddress ? (
            <label className="flex min-h-12 cursor-pointer items-center gap-3">
              <input type="checkbox" name="saveAddress" defaultChecked={answer?.checks.saveAddress ?? false} className="size-5 accent-[var(--color-brand)]" />
              <span className="font-medium">این نشانی را در دفترچهٔ نشانی نگه دار</span>
            </label>
          ) : null}
        </fieldset>

        {/* owner's decision 13: a gift is free, with a short message for its card and no price on the package */}
        <fieldset className="group space-y-3 border-t border-border pt-5">
          <legend className="sr-only">هدیه</legend>
          <label className="flex min-h-12 cursor-pointer items-start gap-3">
            <input type="checkbox" id="is-gift" name="gift" defaultChecked={answer?.checks.gift ?? false} className="mt-1 size-5 accent-[var(--color-brand)]" />
            <span className="space-y-1">
              <span className="block font-medium">هدیه است</span>
              <span className="block text-sm leading-6 text-muted-foreground">رایگان؛ قیمت روی بسته نمی‌آید.</span>
            </span>
          </label>
          <div className="hidden group-has-[#is-gift:checked]:block">
            <TextAreaField label="پیام کارت هدیه (اختیاری)" name="giftMessage" autoComplete="off" maxLength={GIFT_MESSAGE_MAX} required={false} defaultValue={value('giftMessage')} invalid={bad('giftMessage')} />
          </div>
        </fieldset>

        <TextAreaField label="توضیح (اختیاری)" name="note" autoComplete="off" maxLength={BUYER_NOTE_MAX} defaultValue={value('note')} required={false} invalid={bad('note')} />

        <Field label="کد تخفیف (اختیاری)" name="discountCode" autoComplete="off" dir="ltr" maxLength={40} required={false}
          defaultValue={answer?.discountCode ?? ''} invalid={bad('discountCode')} hint={discount ? `«${discount.title || discount.code}» روی این سبد نشست.` : 'اگر کدی دارید بنویسید؛ با «هزینهٔ ارسال» سنجیده می‌شود.'} />

        {options ? (
          <fieldset className="space-y-3" aria-invalid={bad('shippingMethod') || undefined} onChange={e => { if (e.target instanceof HTMLInputElement) setPicked(e.target.value); }}>
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

        {options && options.length && method ? (
          <section aria-labelledby="order-summary" className="space-y-3 rounded-control border border-border bg-card p-4" data-order-summary>
            <h2 id="order-summary" className="text-base font-bold">خلاصهٔ سفارش</h2>
            <ul className="space-y-1 text-sm leading-7">
              {items.map(i => (
                <li key={i.slug} className="flex justify-between gap-3" data-summary-line>
                  <span>{`${i.name || i.slug} × ${faNumber(i.quantity)}`}</span>
                  <span className="shrink-0">{lineAmounts.has(i.slug) ? formatPrice(lineAmounts.get(i.slug) ?? '') : `${faNumber(i.quantity)} عدد`}</span>
                </li>
              ))}
            </ul>
            <div className="space-y-2 border-t border-border pt-3 text-base">
              <p className="flex justify-between gap-3"><span>جمع کالاها</span><span className="font-bold">{formatPrice(answer?.itemsAmount ?? '')}</span></p>
              {discount ? (
                <p className="flex justify-between gap-3 text-brand"><span>تخفیف <span dir="ltr">{discount.code}</span></span><span className="font-bold">− {formatPrice(discount.amount)}</span></p>
              ) : null}
              <p className="flex justify-between gap-3">
                <span>{`ارسال (${method.title})`}</span>
                <span className="font-bold">{method.kind === 'on_delivery' ? 'هنگام تحویل' : method.free ? 'رایگان' : formatPrice(method.amount)}</span>
              </p>
            </div>
            <p className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
              <span className="text-lg font-bold">مبلغ قابل پرداخت</span>
              <span className="text-2xl font-extrabold" data-payable>{formatPrice(payable)}</span>
              <input type="hidden" name="shownPayable" value={payable} />
            </p>
            {method.kind === 'on_delivery' ? <p className="text-sm leading-7 text-muted-foreground">هزینهٔ ارسال این روش را هنگام تحویل به پیک می‌دهید.</p> : null}
            <p className="text-sm leading-7 text-muted-foreground">
              پس از ثبت، کالاها {faNumber(reservationHours)} ساعت برای شما کنار گذاشته می‌شوند تا پرداخت را انجام دهید.
            </p>
          </section>
        ) : null}

        {options && options.length && answer?.codeFor ? (
          <div className="space-y-3 border-t border-border pt-5">
            {answer.field !== 'code' ? <FormNote>کد تأیید {answer.codeVia === 'email' ? 'به ایمیل' : 'با پیامک به'} <span dir="ltr">{answer.codeFor}</span> فرستاده شد. آن را بنویسید و سفارش را ثبت کنید.</FormNote> : null}
            <input type="hidden" name="codeFor" value={answer.codeFor} />
            <CodeField />
          </div>
        ) : null}

        {options && options.length ? (
          <>
            <SubmitButton intent="place" busy={busy}>{answer?.codeFor ? (answer.codeVia === 'email' ? 'تأیید ایمیل و ثبت سفارش' : 'تأیید شماره و ثبت سفارش') : 'ثبت سفارش'}</SubmitButton>
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
