import { randomUUID } from 'node:crypto';
import { Form, Link, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/checkout';
import type { PlacedOrder, ShippingOption, ShippingQuoteAnswer } from '@erp/storefront/storefrontOrderContracts';
import type { StorefrontAccountView } from '@erp/storefront/storefrontBuyerContracts';
import { ADDRESS_MAX, BUYER_NOTE_MAX, CITY_MAX, RECIPIENT_NAME_MAX } from '@erp/storefront/storefrontOrderRules';
import { IRAN_PROVINCES } from '@erp/storefront/storefrontRules';
import { publicSettings } from '../lib/api.server';
import { accountCall, crossSite, sameSite, sessionOf } from '../lib/account.server';
import { cartOf, clearCartCookie } from '../lib/cart.server';
import { rememberOrderCookie } from '../lib/orderKeys.server';
import { siteEnv } from '../lib/site.server';
import { faNumber, formatPrice } from '../lib/format';
import { pageMeta } from '../lib/meta';
import { Field, FormError, PhoneField, SelectField, SubmitButton, TextAreaField } from '../components/AccountForm';

/**
 * v11 phase 8.2: the checkout, one form for the phone. The buyer writes the address, «هزینهٔ ارسال» asks the ERP which
 * methods this cart and province can use and what each costs, then «ثبت سفارش» places the order. Every step is the same
 * plain form posted here, so it works without JavaScript, and nothing in it carries a price: the ERP prices the cart.
 *
 * - The request key is made here once per checkout and sent back with the form, so a second tap (or a lost answer) gives
 *   the same order and key again instead of a second order. It is renewed only after the ERP refused the order (a
 *   refused key never made an order); when the ERP could not be reached the same key is kept, since the order may exist.
 * - A signed-in buyer's details fill the form, and a buyer of a group that may order «به حساب» chooses how to pay.
 * - The placed order's tracking key goes in the `sf_orders` cookie and the buyer lands on its page; the cart is emptied.
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
  error?: string;
  field?: string;
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

export async function action({ request }: Route.ActionArgs): Promise<ActionAnswer | Response> {
  if (!sameSite(request)) return crossSite();
  const form = await request.formData();
  const lines = cartOf(request);
  if (!lines.length) return redirect('/cart');
  const fields = fieldsOf(form);
  const typedKey = String(form.get('requestKey') ?? '');
  const requestKey = /^[A-Za-z0-9_-]{16,80}$/.test(typedKey) ? typedKey : randomUUID();
  const shippingMethod = String(form.get('shippingMethod') ?? '').slice(0, 60);
  const paymentMethod = String(form.get('paymentMethod') ?? 'card') === 'on_account' ? 'on_account' : 'card';
  const answer = (rest: Partial<ActionAnswer>): ActionAnswer => ({ fields, requestKey, shippingMethod, paymentMethod, options: null, itemsAmount: '', ...rest });

  const quote = await accountCall<ShippingQuoteAnswer>(request, 'POST', '/shipping/quote', { province: fields.province, lines });
  if (!quote.data) return answer({ error: quote.error, field: quote.field === 'province' ? 'province' : '' });
  const quoted = { options: quote.data.options, itemsAmount: quote.data.itemsAmount };
  if (String(form.get('intent') ?? '') !== 'place') return answer(quoted);

  const placed = await accountCall<PlacedOrder>(request, 'POST', '/orders', {
    requestKey, ...fields, shippingMethod, lines, ...(paymentMethod === 'on_account' ? { paymentMethod } : {}),
  });
  if (!placed.data) {
    return answer({ ...quoted, error: placed.error, field: placed.field ?? '', requestKey: placed.status >= 500 ? requestKey : randomUUID() });
  }
  const headers = new Headers();
  headers.append('Set-Cookie', rememberOrderCookie(request, placed.data.order.number, placed.data.accessKey));
  headers.append('Set-Cookie', clearCartCookie());
  return redirect(`/orders/${placed.data.order.number}?placed=1`, { headers });
}

export default function CheckoutPage({ loaderData, actionData }: Route.ComponentProps) {
  const { prefill, paymentMethods, groupTitle, signedIn, count, reservationHours } = loaderData;
  const answer = actionData as ActionAnswer | undefined;
  const busy = useNavigation().state === 'submitting';
  const value = (f: typeof FIELDS[number]) => answer?.fields[f] ?? (f in prefill ? prefill[f as keyof typeof prefill] : '');
  const bad = (f: string) => answer?.field === f;
  const options = answer?.options ?? null;
  const chosen = options?.some(o => o.code === answer?.shippingMethod) ? answer?.shippingMethod : options?.[0]?.code;
  const onAccount = paymentMethods.includes('on_account');
  const cardAllowed = paymentMethods.includes('card');

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
        </p>
      ) : null}

      <Form method="post" className="mt-6 space-y-5" replace>
        <input type="hidden" name="requestKey" value={answer?.requestKey ?? loaderData.requestKey} />
        <FormError message={answer?.error} />
        <Field label="نام و نام خانوادگی گیرنده" name="recipientName" autoComplete="name" maxLength={RECIPIENT_NAME_MAX} defaultValue={value('recipientName')} invalid={bad('recipientName')} />
        <PhoneField defaultValue={value('phone')} invalid={bad('phone')} />
        <SelectField label="استان" name="province" options={IRAN_PROVINCES} autoComplete="address-level1" defaultValue={value('province')} invalid={bad('province')} />
        <Field label="شهر" name="city" autoComplete="address-level2" maxLength={CITY_MAX} defaultValue={value('city')} invalid={bad('city')} />
        <TextAreaField label="نشانی" name="address" autoComplete="street-address" maxLength={ADDRESS_MAX} defaultValue={value('address')} hint="خیابان، کوچه، پلاک و واحد" invalid={bad('address')} />
        <Field label="کد پستی" name="postalCode" inputMode="numeric" autoComplete="postal-code" dir="ltr" maxLength={20} defaultValue={value('postalCode')} hint="ده رقم، بی خط تیره" invalid={bad('postalCode')} />
        <TextAreaField label="توضیح (اختیاری)" name="note" autoComplete="off" maxLength={BUYER_NOTE_MAX} defaultValue={value('note')} required={false} invalid={bad('note')} />

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
            <p className="text-sm leading-7 text-muted-foreground">
              هزینهٔ ارسال روش انتخابی به این مبلغ افزوده می‌شود. پس از ثبت، کالاها {faNumber(reservationHours)} ساعت برای شما کنار گذاشته می‌شوند تا پرداخت را انجام دهید.
            </p>
          </div>
        ) : null}

        {options && options.length ? (
          <>
            <SubmitButton intent="place" busy={busy}>ثبت سفارش</SubmitButton>
            <SubmitButton intent="quote" busy={busy} secondary>نشانی را عوض کردم؛ هزینهٔ ارسال دوباره</SubmitButton>
          </>
        ) : (
          <SubmitButton intent="quote" busy={busy}>دیدن روش‌ها و هزینهٔ ارسال</SubmitButton>
        )}
      </Form>
    </div>
  );
}
