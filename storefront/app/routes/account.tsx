import { Form, Link, redirect } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import type { Route } from './+types/account';
import type { AccountOrderPage } from '@erp/storefront/storefrontOrderContracts';
import type { StorefrontAccountView } from '@erp/storefront/storefrontBuyerContracts';
import { accountCall, clearSessionCookie, sessionOf } from '../lib/account.server';
import { siteEnv } from '../lib/site.server';
import { faDateTime, faDigits, faNumber, formatPrice } from '../lib/format';
import { pageMeta } from '../lib/meta';
import { Pagination } from '../components/Pagination';

/**
 * v11 phase 8.2b part 2: «حساب من». A signed-out visitor (or an expired session) goes to the sign-in and comes back here.
 * The page shows the account, its buyer group and the wholesale request as the buyer may see them, and the account's own
 * orders, newest first, ten to a page.
 */
const PAGE_SIZE = 10;
const APPLICATION_TITLES: Record<StorefrontAccountView['application'], string> = {
  none: '', pending: 'درخواست خرید عمدهٔ شما در دست بررسی است.', approved: '', declined: 'درخواست خرید عمدهٔ شما پذیرفته نشد؛ برای پرسش با فروشگاه تماس بگیرید.',
};

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const signIn = () => redirect(`/account/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`, { headers: { 'Set-Cookie': clearSessionCookie() } });
  if (!sessionOf(request)) throw redirect(`/account/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`);
  const page = Math.max(1, Math.min(100_000, Number(url.searchParams.get('page')) || 1));
  const [account, orders] = await Promise.all([
    accountCall<StorefrontAccountView>(request, 'GET', '/account'),
    accountCall<AccountOrderPage>(request, 'GET', `/account/orders?page=${page}&limit=${PAGE_SIZE}`),
  ]);
  if (account.status === 401 || orders.status === 401) throw signIn();
  if (!account.data || !orders.data) throw new Response('در دسترس نیست', { status: 503 });
  return { account: account.data, orders: orders.data, siteUrl: siteEnv().siteUrl };
}

export const headers = () => ({ 'Cache-Control': 'no-store' });

export function meta({ data }: Route.MetaArgs) {
  return [...pageMeta({ title: 'حساب من', description: 'حساب خرید شما در پاپیتال', path: '/account', siteUrl: data?.siteUrl ?? '' }), { name: 'robots', content: 'noindex' }];
}

export default function AccountPage({ loaderData }: Route.ComponentProps) {
  const { account, orders } = loaderData;
  const pages = Math.max(1, Math.ceil(orders.total / orders.limit));
  const application = APPLICATION_TITLES[account.application];

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 pb-16 lg:pt-10">
      <h1 className="text-2xl font-extrabold lg:text-3xl">حساب من</h1>
      <div className="tile-rule mt-4 w-24" aria-hidden />

      <section className="mt-6 space-y-2 rounded-surface border border-border bg-card p-5 leading-7">
        <p className="text-lg font-bold">{account.name}</p>
        <p dir="ltr" className="text-start text-muted-foreground">{faDigits(account.phone)}</p>
        {account.companyName ? <p>{account.companyName}</p> : null}
        {account.group ? (
          <div className="mt-3 border-t border-border pt-3 text-sm">
            <p className="font-bold">گروه خرید: {account.group.title}</p>
            {account.group.minOrderAmount !== '0' ? <p>کمترین مبلغ هر سفارش: {formatPrice(account.group.minOrderAmount)}</p> : null}
            {account.group.minLineQuantity > 1 ? <p>کمترین تعداد هر کالا: {faNumber(account.group.minLineQuantity)}</p> : null}
            <p>پرداخت: {account.group.paymentMethods.map(m => (m === 'on_account' ? 'به حساب' : 'کارت‌به‌کارت')).join('، ')}</p>
          </div>
        ) : null}
        {application ? <p className="mt-3 border-t border-border pt-3 text-sm">{application}</p> : null}
        {/* v12 phase 8a (site review 2.3): a retail account sends its wholesale request from here */}
        {account.kind === 'retail' && (account.application === 'none' || account.application === 'declined') ? (
          <Link to="/wholesale" data-wholesale-request className="mt-3 inline-flex min-h-11 items-center border-t border-border pt-3 text-sm font-bold text-brand hover:underline">درخواست خرید عمده</Link>
        ) : null}
      </section>

      <section className="mt-10" aria-labelledby="orders">
        <h2 id="orders" className="text-lg font-extrabold">سفارش‌های من</h2>
        {orders.total === 0 ? (
          <p className="mt-3 text-muted-foreground">هنوز سفارشی در این حساب نیست. سفارشی که بی حساب ثبت کرده‌اید، از صفحهٔ همان سفارش به حساب افزوده می‌شود.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {orders.data.map(o => (
              <li key={o.number}>
                <Link to={`/orders/${o.number}`} className="flex min-h-16 items-center gap-3 py-3">
                  <span className="flex-1 space-y-1">
                    <span className="block font-bold">سفارش {faDigits(o.number)} <span className="font-normal text-muted-foreground">، {faNumber(o.itemCount)} کالا</span></span>
                    <span className="block text-sm text-muted-foreground">{faDateTime(o.createdAt)}</span>
                  </span>
                  <span className="space-y-1 text-end">
                    <span className="block text-sm font-bold">{o.statusTitle}</span>
                    <span className="block text-sm">{formatPrice(o.payableAmount)}</span>
                  </span>
                  <ChevronLeft className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 ? <Pagination page={orders.page} pages={pages} hrefOf={p => (p === 1 ? '/account' : `/account?page=${p}`)} /> : null}
      </section>

      <div className="mt-10 space-y-3">
        <Link to="/orders/track" className="flex min-h-12 items-center justify-center rounded-control border border-border bg-card px-6 font-bold hover:border-brand">پیگیری سفارش با شماره و کد</Link>
        <Form method="post" action="/account/sign-out">
          <button type="submit" className="flex min-h-12 w-full items-center justify-center rounded-control px-6 font-bold text-muted-foreground hover:text-destructive">خروج از حساب</button>
        </Form>
      </div>
    </div>
  );
}
