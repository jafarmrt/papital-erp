import { Form, Link, useLocation } from 'react-router';
import { Menu, Search, ShoppingBag, UserRound, X } from 'lucide-react';
import type { StorefrontFacet } from '@erp/storefront/storefrontContracts';
import { BRAND, categoryPath } from '../lib/brand';
import { faNumber } from '../lib/format';

/**
 * The header works without JavaScript: the phone menu is a <details>, the search a GET form to /products. The account
 * link (8.4b) is in the phone menu, and an icon beside the search from the desktop width up. While the site takes orders
 * (8.2) the cart icon, with how many items it holds, stays in sight at every width.
 * v12 phase 7 (site review 1.1, 1.2): on a phone (below `sm`) the search is an icon that opens a full-width search row, so
 * menu, logo, search and cart fit a 360 px screen; the menu and the search row are keyed to the address, so they close on
 * every page change (a <details> kept its open state across client navigation and covered the new page).
 */
export function SiteHeader({ categories, logoUrl, ordering, cartCount, signedIn }: {
  categories: StorefrontFacet[]; logoUrl: string; ordering: boolean; cartCount: number; signedIn: boolean;
}) {
  const accountTo = signedIn ? '/account' : '/account/sign-in';
  const accountLabel = signedIn ? 'حساب من' : 'ورود به حساب';
  const nav = [{ to: '/products', label: 'همهٔ محصولات' }, ...categories.map(c => ({ to: categoryPath(c.name), label: c.name }))];
  // every link here is /products with or without ?category=, so the path alone cannot tell which one is open
  const location = useLocation();
  const category = location.pathname === '/products' ? new URLSearchParams(location.search).get('category') : null;
  const activeTo = location.pathname !== '/products' ? '' : category ? categoryPath(category) : '/products';
  const navKey = `${location.pathname}${location.search}`;
  const searchForm = (wide: boolean) => (
    <Form method="get" action="/products" role="search" className={wide ? 'w-full' : 'ms-auto hidden sm:block lg:ms-2'}>
      <label className="relative flex items-center">
        <span className="sr-only">جست‌وجو در محصولات</span>
        <input
          type="search"
          name="q"
          placeholder="جست‌وجو"
          className={wide
            ? 'h-12 w-full rounded-control border border-border bg-card pe-3 ps-10 text-base text-foreground placeholder:text-muted-foreground'
            : 'h-11 w-44 rounded-control border border-border bg-card pe-3 ps-10 text-sm text-foreground transition-[width] duration-(--motion) placeholder:text-muted-foreground focus:w-56'}
        />
        <Search className="pointer-events-none absolute start-3 size-5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
      </label>
    </Form>
  );
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-chrome text-chrome-foreground">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-4 lg:h-20 lg:px-8">
        <details key={`menu-${navKey}`} className="group relative lg:hidden" data-header-panel="menu">
          <summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-control hover:bg-chrome-foreground/10 [&::-webkit-details-marker]:hidden" aria-label="فهرست">
            <Menu className="size-6 group-open:hidden" strokeWidth={1.75} aria-hidden />
            <X className="hidden size-6 group-open:block" strokeWidth={1.75} aria-hidden />
          </summary>
          <nav className="fixed inset-x-0 top-16 border-b border-border bg-chrome px-4 pb-6 pt-2 shadow-lg" aria-label="دسته‌ها">
            <ul className="divide-y divide-border">
              {nav.map(item => (
                <li key={item.to}><Link to={item.to} className="flex min-h-12 items-center text-lg font-medium">{item.label}</Link></li>
              ))}
              <li><Link to={accountTo} className="flex min-h-12 items-center gap-2 text-lg font-medium"><UserRound className="size-5" strokeWidth={1.75} aria-hidden />{accountLabel}</Link></li>
              {ordering ? <li><Link to="/orders/track" className="flex min-h-12 items-center text-lg font-medium">پیگیری سفارش</Link></li> : null}
            </ul>
          </nav>
        </details>

        <Link to="/" className="flex items-center gap-3" aria-label={`${BRAND.fullName}، صفحهٔ اصلی`}>
          {logoUrl
            ? <img src={logoUrl} alt={BRAND.fullName} className="h-9 w-auto max-w-28 object-contain sm:h-10 sm:max-w-40 lg:h-12 lg:max-w-52" />
            : <span className="text-xl font-extrabold sm:text-2xl lg:text-3xl">{BRAND.name}</span>}
          <span className="hidden text-sm opacity-70 sm:inline">{BRAND.tagline}</span>
        </Link>

        <nav className="ms-auto hidden lg:block" aria-label="دسته‌ها">
          <ul className="flex items-center gap-1">
            {nav.map(item => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  aria-current={activeTo === item.to ? 'page' : undefined}
                  className={`flex min-h-11 items-center rounded-control px-3 font-medium transition-colors duration-(--motion) hover:bg-chrome-foreground/10 ${activeTo === item.to ? 'underline decoration-tile decoration-2 underline-offset-8' : ''}`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <details key={`search-${navKey}`} className="group ms-auto sm:hidden" data-header-panel="search">
          <summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-control hover:bg-chrome-foreground/10 [&::-webkit-details-marker]:hidden" aria-label="جست‌وجو">
            <Search className="size-6 group-open:hidden" strokeWidth={1.75} aria-hidden />
            <X className="hidden size-6 group-open:block" strokeWidth={1.75} aria-hidden />
          </summary>
          <div className="fixed inset-x-0 top-16 border-b border-border bg-chrome px-4 py-3 shadow-lg">{searchForm(true)}</div>
        </details>
        {searchForm(false)}
        <Link to={accountTo} aria-label={accountLabel} className="hidden size-11 items-center justify-center rounded-control hover:bg-chrome-foreground/10 lg:flex">
          <UserRound className="size-6" strokeWidth={1.75} aria-hidden />
        </Link>
        {ordering ? (
          <Link to="/cart" aria-label={cartCount ? `سبد خرید، ${faNumber(cartCount)} کالا` : 'سبد خرید'} className="relative flex size-11 shrink-0 items-center justify-center rounded-control hover:bg-chrome-foreground/10">
            <ShoppingBag className="size-6" strokeWidth={1.75} aria-hidden />
            {cartCount ? <span aria-hidden className="absolute -top-0.5 -end-0.5 flex min-w-5 items-center justify-center rounded-full bg-brand px-1 text-xs font-bold text-brand-foreground">{faNumber(cartCount)}</span> : null}
          </Link>
        ) : null}
      </div>
    </header>
  );
}
