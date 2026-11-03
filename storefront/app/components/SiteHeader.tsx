import { Form, Link, useLocation } from 'react-router';
import { Menu, Search, X } from 'lucide-react';
import type { StorefrontFacet } from '@erp/storefront/storefrontContracts';
import { BRAND, categoryPath } from '../lib/brand';

/**
 * The header works without JavaScript: the phone menu is a <details>, the search a GET form to /products.
 */
export function SiteHeader({ categories, logoUrl }: { categories: StorefrontFacet[]; logoUrl: string }) {
  const nav = [{ to: '/products', label: 'همهٔ محصولات' }, ...categories.map(c => ({ to: categoryPath(c.name), label: c.name }))];
  // every link here is /products with or without ?category=, so the path alone cannot tell which one is open
  const location = useLocation();
  const category = location.pathname === '/products' ? new URLSearchParams(location.search).get('category') : null;
  const activeTo = location.pathname !== '/products' ? '' : category ? categoryPath(category) : '/products';
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-chrome text-chrome-foreground">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 lg:h-20 lg:px-8">
        <details className="group relative lg:hidden">
          <summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-control hover:bg-chrome-foreground/10 [&::-webkit-details-marker]:hidden" aria-label="فهرست">
            <Menu className="size-6 group-open:hidden" strokeWidth={1.75} aria-hidden />
            <X className="hidden size-6 group-open:block" strokeWidth={1.75} aria-hidden />
          </summary>
          <nav className="fixed inset-x-0 top-16 border-b border-border bg-chrome px-4 pb-6 pt-2 shadow-lg" aria-label="دسته‌ها">
            <ul className="divide-y divide-border">
              {nav.map(item => (
                <li key={item.to}><Link to={item.to} className="flex min-h-12 items-center text-lg font-medium">{item.label}</Link></li>
              ))}
            </ul>
          </nav>
        </details>

        <Link to="/" className="flex items-center gap-3" aria-label={`${BRAND.fullName}، صفحهٔ اصلی`}>
          {logoUrl
            ? <img src={logoUrl} alt={BRAND.fullName} className="h-10 w-auto max-w-40 object-contain lg:h-12 lg:max-w-52" />
            : <span className="text-2xl font-extrabold lg:text-3xl">{BRAND.name}</span>}
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

        <Form method="get" action="/products" role="search" className="ms-auto lg:ms-2">
          <label className="relative flex items-center">
            <span className="sr-only">جست‌وجو در محصولات</span>
            <input
              type="search"
              name="q"
              placeholder="جست‌وجو"
              className="h-11 w-32 rounded-control border border-border bg-card pe-3 ps-10 text-sm text-foreground transition-[width] duration-(--motion) placeholder:text-muted-foreground focus:w-44 sm:w-44 sm:focus:w-56"
            />
            <Search className="pointer-events-none absolute start-3 size-5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          </label>
        </Form>
      </div>
    </header>
  );
}
