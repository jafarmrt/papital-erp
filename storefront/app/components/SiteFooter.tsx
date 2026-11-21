import { Link } from 'react-router';
import { Instagram, MessageCircle } from 'lucide-react';
import type { RootData } from '../root';
import { BRAND, categoryPath, collectionPath } from '../lib/brand';
import { formatPrice } from '../lib/format';
import { whatsappLink } from '../lib/whatsapp';
import { INFO_PAGES } from '../content/pages';
import { InstallButton } from './InstallButton';
import { outsideLink, type SiteMenuItem } from '../lib/menus';

const footerLink = 'inline-flex min-h-10 items-center hover:underline';
/** the brand and «ارسال و پرداخت» columns plus the link columns, side by side from the desktop width */
const FOOTER_GRID: Readonly<Record<number, string>> = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' };

/** v12 phase 9c: a column of the ERP's «پاورقی» (a heading and its links) */
function MenuColumn({ column }: { column: SiteMenuItem }) {
  const links = column.href ? [column, ...column.children] : column.children;
  return (
    <nav aria-label={column.label}>
      <p className="font-bold">{column.label}</p>
      <ul className="mt-3 space-y-1">
        {links.map((item, i) => (
          <li key={`${i}-${item.label}`}>
            {item.external
              ? <a href={item.href} className={footerLink} {...outsideLink(item)}>{item.label}</a>
              : <Link to={item.href} className={footerLink}>{item.label}</Link>}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The footer: the brand column and «ارسال و پرداخت» are fixed; the link columns are «خرید», «کالکشن‌ها» and «پاپیتال»,
 * or (v12 phase 9c) the columns of the ERP's «پاورقی» while it is on
 */
export function SiteFooter({ data }: { data: RootData | undefined }) {
  const columns = data?.menus?.footer ?? null;
  return (
    <footer className="mt-24 border-t border-border bg-chrome text-chrome-foreground">
      <div className={`mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 ${FOOTER_GRID[2 + (columns?.length ?? 3)] ?? 'lg:grid-cols-5'} lg:px-8`}>
        <div>
          {data?.logoUrl
            ? <img src={data.logoUrl} alt={BRAND.fullName} loading="lazy" className="h-12 w-auto max-w-48 object-contain" />
            : <p className="text-2xl font-extrabold">{BRAND.name}</p>}
          <p className="mt-2 opacity-75">{BRAND.tagline}. ساخت دست، در کارگاه پاپیتال در تهران.</p>
          <div className="mt-4 flex gap-2">
            <a href={BRAND.instagram} className="flex size-11 items-center justify-center rounded-control border border-current/20" aria-label="اینستاگرام پاپیتال" rel="noopener">
              <Instagram className="size-5" strokeWidth={1.75} aria-hidden />
            </a>
            {data?.whatsapp ? (
              <a href={whatsappLink(data.whatsapp)} className="flex size-11 items-center justify-center rounded-control border border-current/20" aria-label="گفت‌وگو در واتس‌اپ" rel="noopener">
                <MessageCircle className="size-5" strokeWidth={1.75} aria-hidden />
              </a>
            ) : null}
          </div>
          {data?.pwa ? <InstallButton /> : null}
        </div>
        {columns ? columns.slice(0, 2).map((column, i) => <MenuColumn key={`${i}-${column.label}`} column={column} />) : null}
        {columns ? null : <nav aria-label="دسته‌ها">
          <p className="font-bold">خرید</p>
          <ul className="mt-3 space-y-1">
            <li><Link to="/products" className="inline-flex min-h-10 items-center hover:underline">همهٔ محصولات</Link></li>
            {(data?.categories ?? []).map(c => (
              <li key={c.name}><Link to={categoryPath(c.name)} className="inline-flex min-h-10 items-center hover:underline">{c.name}</Link></li>
            ))}
          </ul>
        </nav>}
        {columns ? null : <nav aria-label="کالکشن‌ها">
          <p className="font-bold">کالکشن‌ها</p>
          <ul className="mt-3 grid grid-cols-2 gap-x-4">
            {(data?.collections ?? []).slice(0, 12).map(c => (
              <li key={c.name}><Link to={collectionPath(c.name)} className="inline-flex min-h-10 items-center hover:underline">{c.name}</Link></li>
            ))}
          </ul>
        </nav>}
        <div>
          <p className="font-bold">ارسال و پرداخت</p>
          <ul className="mt-3 space-y-2 opacity-75">
            {data?.shippingTitles.length ? <li>ارسال با {data.shippingTitles.join('، ')}</li> : null}
            {data?.freeShippingThreshold ? <li>ارسال رایگان برای خرید از {formatPrice(data.freeShippingThreshold)} به بالا</li> : null}
            <li>پرداخت کارت‌به‌کارت</li>
            <li><Link to="/corporate-gift" className="inline-flex min-h-10 items-center underline-offset-4 hover:underline">هدیهٔ سازمانی</Link> با فاکتور رسمی</li>
            <li><Link to="/wholesale" className="inline-flex min-h-10 items-center underline-offset-4 hover:underline">درخواست خرید عمده</Link></li>
          </ul>
        </div>
        {columns ? columns.slice(2).map((column, i) => <MenuColumn key={`${i}-${column.label}`} column={column} />) : (
          <nav aria-label="پاپیتال">
            <p className="font-bold">پاپیتال</p>
            <ul className="mt-3 space-y-1">
              {INFO_PAGES.map(p => (
                <li key={p.slug}><Link to={`/${p.slug}`} className={footerLink}>{p.title}</Link></li>
              ))}
            </ul>
          </nav>
        )}
      </div>
      <p className="border-t border-border px-4 py-5 text-center text-sm opacity-75">همهٔ حقوق برای {BRAND.fullName} محفوظ است.</p>
    </footer>
  );
}
