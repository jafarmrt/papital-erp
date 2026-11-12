import { Form, Link, redirect, useNavigation } from 'react-router';
import { CheckCircle2 } from 'lucide-react';
import type { Route } from './+types/order';
import type { BuyerOrder } from '@erp/storefront/storefrontOrderContracts';
import { RECEIPT_IMAGE_BYTES_MAX } from '@erp/storefront/storefrontOrderRules';
import { accountCall, crossSite, sameSite, sessionOf, type ApiAnswer } from '../lib/account.server';
import { isOrderNumber, orderKeyOf, paidAtIso } from '../lib/orderKeys.server';
import { siteEnv } from '../lib/site.server';
import { faDateTime, faDigits, faNumber, formatPrice, grouped4, recentDays } from '../lib/format';
import { pageMeta } from '../lib/meta';
import { Field, FormError, FormNote, SubmitButton } from '../components/AccountForm';
import { ReceiptImageField } from '../components/ReceiptImageField';

/**
 * v11 phase 8.2: one order, as its buyer sees it. The page reads the order with the tracking key this browser kept when
 * it placed the order (`sf_orders`), or, for a signed-in buyer, as one of the account's own orders. Without either it
 * goes to «پیگیری سفارش», where the number and key are typed.
 *
 * - While the order waits for payment it shows where to pay and takes the card-to-card receipt (a plain multipart form;
 *   the photo is optional). An account's own order takes the receipt through the account, so any phone it is signed in
 *   on can send it.
 * - A signed-in buyer looking at a guest order with its key can add it to the account.
 */
type Source = 'account' | 'key';

async function readOrder(request: Request, number: string): Promise<{ order: BuyerOrder; source: Source; key: string } | null> {
  if (sessionOf(request)) {
    const mine = await accountCall<BuyerOrder>(request, 'GET', `/account/orders/${number}`);
    if (mine.data) return { order: mine.data, source: 'account', key: orderKeyOf(request, number) };
    if (mine.status >= 500) throw new Response('در دسترس نیست', { status: 503 });
  }
  const key = orderKeyOf(request, number);
  if (!key) return null;
  const keyed = await accountCall<BuyerOrder>(request, 'GET', `/orders/${number}`, undefined, { orderKey: key });
  if (keyed.status >= 500) throw new Response('در دسترس نیست', { status: 503 });
  return keyed.data ? { order: keyed.data, source: 'key', key } : null;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const number = params.number;
  if (!isOrderNumber(number)) throw new Response('پیدا نشد', { status: 404 });
  const found = await readOrder(request, number);
  if (!found) throw redirect(`/orders/track?number=${number}`);
  return {
    ...found,
    signedIn: Boolean(sessionOf(request)),
    placed: new URL(request.url).searchParams.get('placed') === '1',
    days: recentDays(7),
    siteUrl: siteEnv().siteUrl,
  };
}

export const headers = () => ({ 'Cache-Control': 'no-store' });

export function meta({ data }: Route.MetaArgs) {
  return [...pageMeta({ title: `سفارش ${faDigits(data?.order.number ?? '')}`, description: 'وضعیت سفارش پاپیتال', path: '/orders', siteUrl: data?.siteUrl ?? '' }), { name: 'robots', content: 'noindex' }];
}

interface ActionAnswer { error?: string; field?: string; done?: 'receipt' | 'claim' }

/** A multipart post a little above the photo limit is refused before it is read */
const POST_BYTES_MAX = Math.ceil(RECEIPT_IMAGE_BYTES_MAX * 1.1) + 64 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const latin = (value: string) => value.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

async function imageDataUrl(entry: FormDataEntryValue | null): Promise<string | ActionAnswer> {
  if (!entry || typeof entry === 'string' || entry.size === 0) return '';
  if (!IMAGE_TYPES.has(entry.type)) return { error: 'عکس رسید باید JPEG، PNG یا WEBP باشد.', field: 'image' };
  if (entry.size > RECEIPT_IMAGE_BYTES_MAX) return { error: 'عکس رسید بزرگ است؛ تصویر صفحه (اسکرین‌شات) یا عکس کوچک‌تری بفرستید.', field: 'image' };
  return `data:${entry.type};base64,${Buffer.from(await entry.arrayBuffer()).toString('base64')}`;
}

export async function action({ request, params }: Route.ActionArgs): Promise<ActionAnswer | Response> {
  if (!sameSite(request)) return crossSite();
  const number = params.number;
  if (!isOrderNumber(number)) throw new Response('پیدا نشد', { status: 404 });
  if (Number(request.headers.get('content-length') ?? 0) > POST_BYTES_MAX) return { error: 'عکس رسید بزرگ است؛ عکس کوچک‌تری بفرستید.', field: 'image' };
  const found = await readOrder(request, number);
  if (!found) return redirect(`/orders/track?number=${number}`);
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');

  if (intent === 'claim') {
    if (found.source !== 'key' || !found.key) return { error: 'این سفارش در حساب شماست.' };
    const claimed = await accountCall<BuyerOrder>(request, 'POST', '/account/orders/claim', { number, accessKey: found.key });
    return claimed.data ? { done: 'claim' } : { error: claimed.error };
  }
  if (intent !== 'receipt') return {};

  const image = await imageDataUrl(form.get('image'));
  if (typeof image !== 'string') return image;
  const toman = latin(String(form.get('amount') ?? '')).replace(/[\s,٬،]/g, '');
  const paidAt = paidAtIso(Number(form.get('day') ?? -1), String(form.get('time') ?? ''));
  if (!paidAt) return { error: 'ساعت واریز را مانند ۱۴:۳۰ بنویسید.', field: 'time' };
  const body = {
    reference: String(form.get('reference') ?? '').slice(0, 80),
    cardLast4: String(form.get('cardLast4') ?? '').slice(0, 20),
    amount: /^\d{1,15}$/.test(toman) ? `${toman}0` : toman.slice(0, 30),
    paidAt,
    ...(image ? { image } : {}),
  };
  const sent: ApiAnswer<BuyerOrder> = found.source === 'account'
    ? await accountCall<BuyerOrder>(request, 'POST', `/account/orders/${number}/receipts`, body)
    : await accountCall<BuyerOrder>(request, 'POST', `/orders/${number}/receipts`, body, { orderKey: found.key });
  return sent.data ? { done: 'receipt' } : { error: sent.error, field: sent.field ?? '' };
}

export default function OrderPage({ loaderData, actionData }: Route.ComponentProps) {
  const { order, source, key, signedIn, placed, days } = loaderData;
  const answer = actionData as ActionAnswer | undefined;
  const busy = useNavigation().state === 'submitting';
  const bad = (f: string) => answer?.field === f;
  const shippingAmount = order.shipping.kind === 'cost' ? order.shipping.amount : '';

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 pb-16 lg:pt-10">
      {signedIn ? (
        <nav aria-label="مسیر" className="text-sm text-muted-foreground"><Link to="/account" className="hover:text-foreground">حساب من</Link></nav>
      ) : null}
      {placed ? (
        <p role="status" className="mt-3 flex items-center gap-2 rounded-control border border-brand/40 bg-card px-4 py-3 font-bold text-brand">
          <CheckCircle2 className="size-5" aria-hidden />سفارش شما ثبت شد.
        </p>
      ) : null}
      <h1 className="mt-3 text-2xl font-extrabold lg:text-3xl">سفارش {faDigits(order.number)}</h1>
      <div className="tile-rule mt-4 w-24" aria-hidden />
      <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        <dt className="text-muted-foreground">وضعیت</dt><dd className="font-bold">{order.statusTitle}</dd>
        <dt className="text-muted-foreground">زمان ثبت</dt><dd>{faDateTime(order.createdAt)}</dd>
        <dt className="text-muted-foreground">پرداخت</dt><dd>{order.paymentMethodTitle}</dd>
        {order.trackingCode ? (<><dt className="text-muted-foreground">کد رهگیری مرسوله</dt><dd dir="ltr" className="text-start font-bold">{faDigits(order.trackingCode)}</dd></>) : null}
        {order.cancelReasonTitle ? (<><dt className="text-muted-foreground">دلیل لغو</dt><dd>{order.cancelReasonTitle}</dd></>) : null}
      </dl>

      {answer?.done === 'receipt' ? <div className="mt-6"><FormNote>رسید شما رسید. پس از تأیید فروشگاه، سفارش آماده و فرستاده می‌شود.</FormNote></div> : null}
      {answer?.done === 'claim' ? <div className="mt-6"><FormNote>سفارش به حساب شما افزوده شد.</FormNote></div> : null}
      {order.status === 'awaiting_approval' ? <div className="mt-6"><FormNote>سفارش «به حساب» شما پس از تأیید فروشگاه آماده و فرستاده می‌شود.</FormNote></div> : null}

      {order.payment ? (
        <section className="mt-8 space-y-4 rounded-surface border border-brand/40 bg-card p-5" aria-labelledby="pay">
          <h2 id="pay" className="text-lg font-extrabold">پرداخت کارت‌به‌کارت</h2>
          <p className="text-lg">مبلغ: <span className="font-extrabold">{formatPrice(order.payableAmount)}</span></p>
          {order.payBefore ? <p className="text-sm leading-7 text-muted-foreground">کالاها تا {faDateTime(order.payBefore)} برای شما کنار گذاشته شده‌اند؛ تا آن زمان پرداخت کنید و رسید را بفرستید.</p> : null}
          <dl className="space-y-3">
            {order.payment.cardNumber ? (<div><dt className="text-sm text-muted-foreground">شمارهٔ کارت</dt><dd dir="ltr" className="select-all text-start text-xl font-extrabold tracking-wide">{grouped4(order.payment.cardNumber)}</dd></div>) : null}
            {order.payment.iban ? (<div><dt className="text-sm text-muted-foreground">شمارهٔ شبا</dt><dd dir="ltr" className="select-all text-start font-bold break-all">{grouped4(order.payment.iban)}</dd></div>) : null}
            {order.payment.cardHolder ? (<div><dt className="text-sm text-muted-foreground">به نام</dt><dd className="font-bold">{order.payment.cardHolder}{order.payment.bankName ? `، ${order.payment.bankName}` : ''}</dd></div>) : null}
          </dl>
        </section>
      ) : null}

      {order.canSendReceipt && answer?.done !== 'receipt' ? (
        <section className="mt-8" aria-labelledby="receipt">
          <h2 id="receipt" className="text-lg font-extrabold">فرستادن رسید</h2>
          <Form method="post" encType="multipart/form-data" className="mt-4 space-y-5" replace preventScrollReset>
            <FormError message={answer?.error} />
            <Field label="شمارهٔ پیگیری یا ارجاع" name="reference" autoComplete="off" dir="ltr" maxLength={40} invalid={bad('reference')} hint="همان شماره‌ای که بانک پس از واریز نشان داد" />
            <Field label="چهار رقم آخر کارت شما" name="cardLast4" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={8} invalid={bad('cardLast4')} />
            <Field label="مبلغ واریزی (تومان)" name="amount" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={20} defaultValue={order.payableToman} invalid={bad('amount')} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label htmlFor="field-day" className="block text-base font-bold">روز واریز</label>
                <select id="field-day" name="day" defaultValue="0" aria-invalid={bad('paidAt') || undefined} className="block min-h-12 w-full rounded-control border border-border bg-card px-3 text-base">
                  {days.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <Field label="ساعت" name="time" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={5} invalid={bad('time') || bad('paidAt')} hint="مانند ۱۴:۳۰" />
            </div>
            <ReceiptImageField />
            <SubmitButton intent="receipt" busy={busy}>فرستادن رسید</SubmitButton>
          </Form>
        </section>
      ) : null}

      <section className="mt-10" aria-labelledby="items">
        <h2 id="items" className="text-lg font-extrabold">کالاها</h2>
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {order.lines.map(line => (
            <li key={line.slug} className="flex justify-between gap-4 py-3">
              <span className="leading-7">{line.name} <span className="text-muted-foreground">× {faNumber(line.quantity)}</span></span>
              {/* before the discount code: the code's amount is its own row below (the ERP line carries it as its discount) */}
              <span className="shrink-0 font-bold">{formatPrice(order.discount ? (BigInt(line.unitPrice) * BigInt(line.quantity)).toString() : line.lineAmount)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-2">
          <div className="flex justify-between"><dt>جمع کالاها</dt><dd>{formatPrice(order.itemsAmount)}</dd></div>
          {order.discount ? (
            <div className="flex justify-between text-brand"><dt>تخفیف <span dir="ltr">{order.discount.code}</span></dt><dd>− {formatPrice(order.discount.amount)}</dd></div>
          ) : null}
          <div className="flex justify-between"><dt>ارسال: {order.shipping.title}</dt><dd>{shippingAmount ? (shippingAmount === '0' ? 'رایگان' : formatPrice(shippingAmount)) : 'هنگام تحویل'}</dd></div>
          <div className="flex justify-between text-lg font-extrabold"><dt>مبلغ قابل پرداخت</dt><dd>{formatPrice(order.payableAmount)}</dd></div>
        </dl>
      </section>

      {order.receipts.length ? (
        <section className="mt-10" aria-labelledby="receipts">
          <h2 id="receipts" className="text-lg font-extrabold">رسیدهای فرستاده</h2>
          <ul className="mt-3 space-y-3">
            {order.receipts.map(r => (
              <li key={`${r.reference}-${r.createdAt}`} className="rounded-control border border-border bg-card p-4 text-sm leading-7">
                <p className="font-bold">{r.statusTitle}</p>
                <p>{formatPrice(r.amount)}، کارت ...{faDigits(r.cardLast4)}، {faDateTime(r.paidAt)}</p>
                {r.rejectReason ? <p className="text-destructive">{r.rejectReason}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-10 space-y-2 text-sm leading-7" aria-labelledby="ship-to">
        <h2 id="ship-to" className="text-lg font-extrabold">گیرنده</h2>
        <p>{order.recipient.name}، <bdi dir="ltr">{faDigits(order.recipient.phone)}</bdi></p>
        <p>{order.recipient.province}، {order.recipient.city}، {order.recipient.address}</p>
        <p>کد پستی <bdi dir="ltr">{faDigits(order.recipient.postalCode)}</bdi></p>
        {/* v12 phase 8c: the buyer, when someone else receives it, and a gift with its card's message */}
        {order.orderedBy && (order.orderedBy.name !== order.recipient.name || order.orderedBy.phone !== order.recipient.phone) ? (
          <p data-ordered-by>{`خریدار: ${order.orderedBy.name}، `}<bdi dir="ltr">{faDigits(order.orderedBy.phone)}</bdi></p>
        ) : null}
        {order.gift ? <p data-gift className="font-bold">{order.gift.message ? `هدیه است؛ پیام کارت: ${order.gift.message}` : 'هدیه است'}</p> : null}
      </section>

      {source === 'key' && signedIn && answer?.done !== 'claim' ? (
        <Form method="post" className="mt-10" replace preventScrollReset>
          <SubmitButton intent="claim" busy={busy} secondary>افزودن این سفارش به حساب من</SubmitButton>
        </Form>
      ) : null}

      {source === 'key' && key ? (
        <details className="mt-10 rounded-control border border-border bg-card p-4 text-sm leading-7">
          <summary className="min-h-11 cursor-pointer py-2 font-bold">پیگیری از گوشی دیگر</summary>
          <p>این سفارش روی همین مرورگر نگه داشته شده است. برای دیدن آن از جای دیگر، شمارهٔ سفارش و این کد را نگه دارید و در «پیگیری سفارش» بنویسید:</p>
          <p dir="ltr" className="mt-2 select-all break-all text-start font-mono">{key}</p>
        </details>
      ) : null}
    </div>
  );
}
