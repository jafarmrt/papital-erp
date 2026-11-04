import { Form, Link, redirect, useNavigation } from 'react-router';
import { Minus, Plus, Trash2 } from 'lucide-react';
import type { Route } from './+types/cart';
import type { StorefrontGroupPrices } from '@erp/storefront/storefrontBuyerContracts';
import { product as productBySlug, publicSettings } from '../lib/api.server';
import { accountCall, crossSite, sameSite, sessionOf } from '../lib/account.server';
import { CART_FULL, cartCookie, cartOf, changeCart, formQuantity, type CartChange } from '../lib/cart.server';
import { siteEnv } from '../lib/site.server';
import { productPath } from '../lib/brand';
import { faNumber, formatPrice } from '../lib/format';
import { pageMeta } from '../lib/meta';
import { ProductImage } from '../components/ProductCard';
import { FormError } from '../components/AccountForm';

/**
 * v11 phase 8.2: the cart. Every change is a plain form posted here (the product page's «افزودن به سبد» too), so it
 * works without JavaScript. The prices shown are a guide: the ERP prices the cart again at the checkout. A signed-in
 * buyer of a group sees the group's price of each product the group may buy.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const settings = await publicSettings();
  if (!settings.ordering) throw new Response('پیدا نشد', { status: 404 });
  const lines = cartOf(request);
  const [items, prices] = await Promise.all([
    Promise.all(lines.map(l => productBySlug(l.slug))),
    sessionOf(request) ? accountCall<StorefrontGroupPrices>(request, 'GET', '/account/prices') : Promise.resolve(null),
  ]);
  const groupPrice = new Map((prices?.data?.prices ?? []).map(p => [p.slug, p.price]));
  const rows = lines.map((line, i) => {
    const item = items[i];
    const unit = item ? groupPrice.get(line.slug) ?? item.retailPrice : '';
    return {
      slug: line.slug,
      quantity: line.quantity,
      name: item?.name ?? '',
      sku: item?.sku ?? '',
      cover: item?.cover ?? null,
      stock: item?.stock ?? null,
      unit,
      amount: unit && /^\d+$/.test(unit) ? (BigInt(unit) * BigInt(line.quantity)).toString() : '',
      gone: !item,
      wholesale: groupPrice.has(line.slug),
    };
  });
  const total = rows.reduce((sum, r) => (r.amount ? sum + BigInt(r.amount) : sum), 0n).toString();
  return { rows, total, group: prices?.data?.group ?? '', siteUrl: siteEnv().siteUrl };
}

/** the buyer's own cart, address or order: never kept by a browser or a cache in between */
export const headers = () => ({ 'Cache-Control': 'no-store' });

export function meta({ data }: Route.MetaArgs) {
  return [...pageMeta({ title: 'سبد خرید', description: 'سبد خرید پاپیتال', path: '/cart', siteUrl: data?.siteUrl ?? '' }), { name: 'robots', content: 'noindex' }];
}

export async function action({ request }: Route.ActionArgs) {
  if (!sameSite(request)) return crossSite();
  const settings = await publicSettings();
  if (!settings.ordering) throw new Response('پیدا نشد', { status: 404 });
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const slug = String(form.get('slug') ?? '');
  const quantity = formQuantity(form.get('quantity'));
  let change: CartChange;
  if (intent === 'remove' || (intent === 'set' && quantity === 0)) change = { kind: 'remove', slug };
  else if ((intent === 'add' || intent === 'set') && quantity >= 1) change = { kind: intent, slug, quantity };
  else return { error: 'تعداد را درست بنویسید.' };
  // only a product the shop sells goes in (a missing one is still removable)
  if (change.kind !== 'remove' && !(await productBySlug(slug))) return { error: 'این محصول دیگر روی سایت نیست.' };
  const next = changeCart(cartOf(request), change);
  const cookie = next && cartCookie(next);
  if (!cookie) return { error: CART_FULL };
  return redirect('/cart', { headers: { 'Set-Cookie': cookie } });
}

export default function CartPage({ loaderData, actionData }: Route.ComponentProps) {
  const { rows, total, group } = loaderData;
  const busy = useNavigation().state === 'submitting';
  const blocked = rows.some(r => r.gone || r.stock?.status === 'out');

  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 pb-16 lg:pt-10">
      <h1 className="text-2xl font-extrabold lg:text-3xl">سبد خرید</h1>
      <div className="tile-rule mt-4 w-24" aria-hidden />
      <div className="mt-6"><FormError message={(actionData as { error?: string } | undefined)?.error} /></div>

      {rows.length === 0 ? (
        <div className="mt-8 space-y-6 text-center">
          <p className="text-lg text-muted-foreground">سبد خرید شما خالی است.</p>
          <Link to="/products" className="inline-flex min-h-12 items-center rounded-control bg-primary px-6 text-lg font-bold text-primary-foreground">دیدن محصولات</Link>
        </div>
      ) : (
        <>
          {group ? <p className="mt-6 rounded-control border border-border bg-card px-4 py-3 text-sm leading-7">قیمت‌ها با فهرست قیمت گروه شما («{group}») نشان داده شده‌اند.</p> : null}
          <ul className="mt-6 divide-y divide-border border-y border-border">
            {rows.map(row => (
              <li key={row.slug} className="flex gap-4 py-5">
                <div className="w-24 shrink-0 overflow-hidden rounded-surface border border-border sm:w-28">
                  <ProductImage image={row.cover} sizes="112px" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {row.gone ? (
                    <p className="font-bold text-destructive">این محصول دیگر روی سایت نیست؛ آن را از سبد بردارید.</p>
                  ) : (
                    <>
                      <Link to={productPath(row.slug)} className="line-clamp-2 font-bold leading-7 hover:underline">{row.name}</Link>
                      <p className="text-sm text-muted-foreground">{formatPrice(row.unit)}{row.wholesale ? ' (قیمت گروه شما)' : ''}</p>
                      {row.stock?.status === 'out' ? <p className="text-sm font-bold text-destructive">فعلاً ناموجود؛ آن را از سبد بردارید.</p> : null}
                    </>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    {!row.gone ? (
                      <Form method="post" className="flex items-center rounded-control border border-border" replace preventScrollReset>
                        <input type="hidden" name="slug" value={row.slug} />
                        <input type="hidden" name="intent" value="set" />
                        <button type="submit" name="quantity" value={row.quantity - 1} disabled={busy} aria-label="یکی کمتر" className="flex size-11 items-center justify-center disabled:opacity-50">
                          <Minus className="size-4" aria-hidden />
                        </button>
                        <span className="min-w-8 text-center font-bold" aria-label={`تعداد ${faNumber(row.quantity)}`}>{faNumber(row.quantity)}</span>
                        <button type="submit" name="quantity" value={row.quantity + 1} disabled={busy} aria-label="یکی بیشتر" className="flex size-11 items-center justify-center disabled:opacity-50">
                          <Plus className="size-4" aria-hidden />
                        </button>
                      </Form>
                    ) : null}
                    <Form method="post" replace preventScrollReset>
                      <input type="hidden" name="slug" value={row.slug} />
                      <button type="submit" name="intent" value="remove" disabled={busy} className="flex min-h-11 items-center gap-1 px-2 text-sm text-muted-foreground hover:text-destructive">
                        <Trash2 className="size-4" aria-hidden />برداشتن
                      </button>
                    </Form>
                    {row.amount ? <p className="ms-auto font-bold">{formatPrice(row.amount)}</p> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex items-center justify-between text-lg">
            <span>جمع کالاها</span>
            <span className="text-xl font-extrabold">{formatPrice(total)}</span>
          </div>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">هزینهٔ ارسال در مرحلهٔ بعد، با استان شما، حساب می‌شود. تا ثبت سفارش چیزی برای شما کنار گذاشته نمی‌شود.</p>
          {blocked ? (
            <p className="mt-6 text-center font-bold text-destructive">برای ادامه، کالای ناموجود را از سبد بردارید.</p>
          ) : (
            <Link to="/checkout" className="mt-6 flex min-h-13 w-full items-center justify-center rounded-control bg-primary px-6 text-lg font-bold text-primary-foreground hover:bg-primary/90">ادامهٔ خرید و ثبت نشانی</Link>
          )}
        </>
      )}
    </div>
  );
}
