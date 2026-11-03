import { Link } from 'react-router';
import { Instagram, MessageCircle } from 'lucide-react';
import type { RootData } from '../root';
import { BRAND, categoryPath, collectionPath } from '../lib/brand';
import { formatPrice } from '../lib/format';
import { whatsappLink } from '../lib/whatsapp';
import { INFO_PAGES } from '../content/pages';

export function SiteFooter({ data }: { data: RootData | undefined }) {
  return (
    <footer className="mt-24 border-t border-border bg-chrome text-chrome-foreground">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-5 lg:px-8">
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
        </div>
        <nav aria-label="دسته‌ها">
          <p className="font-bold">خرید</p>
          <ul className="mt-3 space-y-1">
            <li><Link to="/products" className="inline-flex min-h-10 items-center hover:underline">همهٔ محصولات</Link></li>
            {(data?.categories ?? []).map(c => (
              <li key={c.name}><Link to={categoryPath(c.name)} className="inline-flex min-h-10 items-center hover:underline">{c.name}</Link></li>
            ))}
          </ul>
        </nav>
        <nav aria-label="کالکشن‌ها">
          <p className="font-bold">کالکشن‌ها</p>
          <ul className="mt-3 grid grid-cols-2 gap-x-4">
            {(data?.collections ?? []).slice(0, 12).map(c => (
              <li key={c.name}><Link to={collectionPath(c.name)} className="inline-flex min-h-10 items-center hover:underline">{c.name}</Link></li>
            ))}
          </ul>
        </nav>
        <div>
          <p className="font-bold">ارسال و پرداخت</p>
          <ul className="mt-3 space-y-2 opacity-75">
            {data?.shippingTitles.length ? <li>ارسال با {data.shippingTitles.join('، ')}</li> : null}
            {data?.freeShippingThreshold ? <li>ارسال رایگان برای خرید از {formatPrice(data.freeShippingThreshold)} به بالا</li> : null}
            <li>پرداخت کارت‌به‌کارت</li>
            <li>هدیهٔ سازمانی و خرید عمده با فاکتور رسمی</li>
          </ul>
        </div>
        <nav aria-label="پاپیتال">
          <p className="font-bold">پاپیتال</p>
          <ul className="mt-3 space-y-1">
            {INFO_PAGES.map(p => (
              <li key={p.slug}><Link to={`/${p.slug}`} className="inline-flex min-h-10 items-center hover:underline">{p.title}</Link></li>
            ))}
          </ul>
        </nav>
      </div>
      <p className="border-t border-border px-4 py-5 text-center text-sm opacity-75">همهٔ حقوق برای {BRAND.fullName} محفوظ است.</p>
    </footer>
  );
}
