import { Form, Link, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/orderTrack';
import type { BuyerOrder } from '@erp/storefront/storefrontOrderContracts';
import { accountCall, crossSite, sameSite } from '../lib/account.server';
import { isOrderKey, isOrderNumber, rememberOrderCookie } from '../lib/orderKeys.server';
import { siteEnv } from '../lib/site.server';
import { pageMeta } from '../lib/meta';
import { AccountShell, Field, FormError, SubmitButton } from '../components/AccountForm';

/**
 * v11 phase 8.2: «پیگیری سفارش» on a phone that did not place the order. The number and the tracking key are typed (a
 * POST, so the key stays out of addresses and logs); a right pair is kept in `sf_orders` and the order page opens.
 */
export function loader({ request }: Route.LoaderArgs) {
  const number = new URL(request.url).searchParams.get('number') ?? '';
  return { number: isOrderNumber(number) ? number : '', siteUrl: siteEnv().siteUrl };
}

/** the buyer's own cart, address or order: never kept by a browser or a cache in between */
export const headers = () => ({ 'Cache-Control': 'no-store' });

export function meta({ data }: Route.MetaArgs) {
  return [...pageMeta({ title: 'پیگیری سفارش', description: 'پیگیری سفارش پاپیتال', path: '/orders/track', siteUrl: data?.siteUrl ?? '' }), { name: 'robots', content: 'noindex' }];
}

const latin = (value: string) => value.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\s+/g, '');
const NOT_FOUND = 'سفارشی با این شماره و کد پیدا نشد؛ هر دو را دوباره نگاه کنید.';

export async function action({ request }: Route.ActionArgs) {
  if (!sameSite(request)) return crossSite();
  const form = await request.formData();
  const number = latin(String(form.get('number') ?? '')).slice(0, 20);
  const key = String(form.get('key') ?? '').trim().slice(0, 100);
  if (!isOrderNumber(number) || !isOrderKey(key)) return { number, error: NOT_FOUND };
  const found = await accountCall<BuyerOrder>(request, 'GET', `/orders/${number}`, undefined, { orderKey: key });
  if (!found.data) return { number, error: found.status === 404 ? NOT_FOUND : found.error };
  return redirect(`/orders/${number}`, { headers: { 'Set-Cookie': rememberOrderCookie(request, number, key) } });
}

export default function OrderTrackPage({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state === 'submitting';
  return (
    <AccountShell title="پیگیری سفارش" intro="شمارهٔ سفارش و کد پیگیری‌ای را که پس از ثبت سفارش نشان داده شد بنویسید.">
      <Form method="post" className="space-y-5" replace>
        <FormError message={actionData?.error} />
        <Field label="شمارهٔ سفارش" name="number" inputMode="numeric" autoComplete="off" dir="ltr" maxLength={20} defaultValue={actionData?.number ?? loaderData.number} />
        <Field label="کد پیگیری" name="key" autoComplete="off" dir="ltr" maxLength={100} hint="با ok_ آغاز می‌شود" />
        <SubmitButton busy={busy}>دیدن سفارش</SubmitButton>
      </Form>
      <p className="text-base leading-8 text-muted-foreground">
        اگر هنگام سفارش وارد حساب بودید، <Link to="/account" className="font-bold text-brand hover:underline">حساب من</Link> همهٔ سفارش‌هایتان را نشان می‌دهد.
      </p>
    </AccountShell>
  );
}
