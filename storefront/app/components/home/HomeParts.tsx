import { Link } from 'react-router';
import { ArrowLeft, Building2, Clock, Gift, Hand, Handshake, Heart, Leaf, Mail, MapPin, Phone, ShieldCheck, Sparkles, Star, Truck, type LucideIcon } from 'lucide-react';
import type { StorefrontFacet, StorefrontImage, StorefrontProductCard } from '@erp/storefront/storefrontContracts';
import type { PageIcon } from '@erp/storefront/storefrontPageParts';
import type { SiteHomeOwnSection } from '../../lib/home';
import { categoryPath, collectionPath, productPath } from '../../lib/brand';
import { faNumber, formatPrice } from '../../lib/format';
import { whatsappLink } from '../../lib/whatsapp';
import { ProductGrid, ProductImage } from '../ProductCard';

/**
 * v12 phase 10e: the seven parts the home page has always had, each drawn from its words (the shop's, once it publishes
 * its home page in the ERP; the site's own until then) and from the catalog. The markup is what `routes/home.tsx` drew
 * before the words could be written in the ERP, so a home page started «از صفحهٔ اصلی امروز» looks the same.
 */
type Part<K extends SiteHomeOwnSection['kind']> = Extract<SiteHomeOwnSection, { kind: K }>;
export interface HomeCategory extends StorefrontFacet { cover: StorefrontImage | null }

const ICONS: Readonly<Record<PageIcon, LucideIcon>> = {
  leaf: Leaf, handshake: Handshake, truck: Truck, gift: Gift, heart: Heart, sparkles: Sparkles, clock: Clock, map: MapPin, phone: Phone, mail: Mail,
  shield: ShieldCheck, star: Star, hand: Hand, building: Building2,
};

/** A link of a part's words: a path of this site moves inside it, an https address leaves it */
export function PartLink({ to, className, children }: { to: string; className: string; children: React.ReactNode }) {
  return to.startsWith('/') ? <Link to={to} className={className}>{children}</Link> : <a href={to} rel="noopener noreferrer" className={className}>{children}</a>;
}

export function SectionTitle({ id, title, href, cta }: { id: string; title: string; href?: string; cta?: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 id={id} className="text-xl font-extrabold break-words lg:text-3xl">{title}</h2>
        <div className="tile-rule mt-2 w-20 lg:mt-3 lg:w-24" aria-hidden />
      </div>
      {href && cta ? (
        <PartLink to={href} className="inline-flex min-h-11 shrink-0 items-center gap-1 font-medium text-brand hover:underline">
          {cta}<ArrowLeft className="size-4" aria-hidden />
        </PartLink>
      ) : null}
    </div>
  );
}

export function HomeIntro({ part, product, heading }: { part: Part<'homeIntro'>; product: StorefrontProductCard | null; heading: boolean }) {
  const Title = heading ? 'h1' : 'h2';
  return (
    <section className="border-b border-border bg-brand-soft" data-home-part="homeIntro">
      <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-7 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-16">
        <div>
          {part.kicker ? <p className="text-sm font-medium text-brand lg:text-base">{part.kicker}</p> : null}
          <Title className="mt-2 text-3xl font-extrabold leading-tight text-balance break-words sm:text-5xl lg:mt-3 lg:text-6xl">{part.title}</Title>
          {part.text ? <p className="mt-3 max-w-lg leading-8 text-muted-foreground break-words lg:mt-5 lg:text-lg lg:leading-9">{part.text}</p> : null}
          {part.buttonLabel ? (
            <div className="mt-5 flex gap-3 lg:mt-8">
              <PartLink to={part.buttonHref} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control bg-primary px-6 text-lg font-bold text-primary-foreground hover:bg-primary/90 sm:flex-none">
                {part.buttonLabel}<ArrowLeft className="size-5" aria-hidden />
              </PartLink>
            </div>
          ) : null}
        </div>
        {product ? (
          <Link to={productPath(product.slug)} className="group hidden lg:block">
            <figure className="relative overflow-hidden rounded-surface border border-border bg-card">
              <ProductImage image={product.cover} eager sizes="600px" className="transition-transform duration-700 ease-motion group-hover:scale-[1.02]" />
              <figcaption className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3 rounded-control bg-card/90 px-4 py-3 backdrop-blur">
                <span className="line-clamp-1 font-medium">{product.name}</span>
                <span className="shrink-0 font-bold">{formatPrice(product.retailPrice)}</span>
              </figcaption>
            </figure>
          </Link>
        ) : null}
      </div>
    </section>
  );
}

export function HomeCategories({ part, categories }: { part: Part<'homeCategories'>; categories: readonly HomeCategory[] }) {
  if (categories.length === 0) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 pt-10 lg:px-8 lg:pt-16" aria-labelledby="cats" data-home-part="homeCategories">
      <SectionTitle id="cats" title={part.title} />
      <ul className="scrollbar-none -mx-4 mt-5 flex snap-x gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:mt-8 lg:grid lg:grid-cols-4 lg:gap-5 lg:overflow-visible lg:px-0">
        {categories.map(c => (
          <li key={c.name} className="w-[36%] shrink-0 snap-start sm:w-[28%] lg:w-auto">
            <Link to={categoryPath(c.name)} className="group block">
              <div className="overflow-hidden rounded-surface border border-border bg-card">
                <ProductImage image={c.cover} eager sizes="(min-width: 1024px) 300px, 36vw" className="transition-transform duration-500 ease-motion group-hover:scale-[1.03]" />
              </div>
              <p className="mt-2 flex flex-col lg:mt-3 lg:flex-row lg:items-baseline lg:justify-between">
                <span className="font-bold lg:text-lg">{c.name}</span>
                <span className="text-xs text-muted-foreground lg:text-sm">{`${faNumber(c.count)} محصول`}</span>
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HomeWhy({ part, freeShippingThreshold }: { part: Part<'homeWhy'>; freeShippingThreshold: string }) {
  // the delivery point with no words of its own is the shop's live rule: free from its threshold, or to all of Iran
  const delivery = freeShippingThreshold ? `ارسال رایگان از ${formatPrice(freeShippingThreshold)}` : 'ارسال به سراسر ایران';
  return (
    <section aria-label="چرا پاپیتال" className="mt-10 border-y border-border bg-muted lg:mt-16" data-home-part="homeWhy">
      <ul className={`mx-auto grid max-w-7xl grid-cols-2 gap-x-3 gap-y-3 px-4 py-4 text-xs leading-6 sm:text-sm lg:py-6 lg:px-8 ${part.points.length === 3 ? 'lg:grid-cols-3' : part.points.length === 2 ? '' : 'lg:grid-cols-4'}`}>
        {part.points.map((point, index) => {
          const Icon = ICONS[point.icon];
          return (
            <li key={index} className="flex items-center gap-3">
              <Icon className="size-5 shrink-0 text-brand lg:size-6" strokeWidth={1.5} aria-hidden />
              <span className="min-w-0 break-words">{point.text || delivery}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function HomeProducts({ part, products }: { part: Part<'homeFeatured' | 'homeNewest'>; products: readonly StorefrontProductCard[] }) {
  if (products.length === 0) return null;
  const id = part.kind === 'homeFeatured' ? 'featured' : 'newest';
  return (
    <section className="mx-auto max-w-7xl px-4 pt-12 lg:px-8 lg:pt-20" aria-labelledby={id} data-home-part={part.kind}>
      <SectionTitle id={id} title={part.title} href={part.buttonHref} cta={part.buttonLabel} />
      <div className="mt-5 lg:mt-8"><ProductGrid products={[...products]} /></div>
    </section>
  );
}

export function HomeCollections({ part, collections }: { part: Part<'homeCollections'>; collections: readonly StorefrontFacet[] }) {
  if (collections.length === 0) return null;
  return (
    <section className="mt-12 bg-brand-soft lg:mt-20" aria-labelledby="collections" data-home-part="homeCollections">
      <div className="mx-auto max-w-7xl px-4 py-10 lg:px-8 lg:py-14">
        <SectionTitle id="collections" title={part.title} />
        {part.text ? <p className="mt-4 max-w-2xl text-muted-foreground break-words">{part.text}</p> : null}
        <ul className="mt-6 flex flex-wrap gap-2">
          {collections.map(c => (
            <li key={c.name}>
              <Link to={collectionPath(c.name)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-brand/20 bg-card px-5 font-medium hover:border-brand">
                {c.name}<span className="text-sm text-muted-foreground">{faNumber(c.count)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function HomeWholesale({ part, whatsapp }: { part: Part<'homeWholesale'>; whatsapp: string }) {
  return (
    <section className="mx-auto max-w-7xl px-4 pt-12 lg:px-8 lg:pt-20" aria-labelledby="b2b" data-home-part="homeWholesale">
      <div className="grid gap-6 rounded-surface bg-primary px-6 py-10 text-primary-foreground lg:grid-cols-3 lg:items-center lg:px-12 lg:py-14">
        <div className="lg:col-span-2">
          <h2 id="b2b" className="text-2xl font-extrabold break-words lg:text-3xl">{part.title}</h2>
          {part.text ? <p className="mt-3 max-w-2xl leading-8 text-primary-foreground/80 break-words">{part.text}</p> : null}
        </div>
        {/* v12 phase 8a (site review 2.3): the wholesale request and the corporate gift form, then a chat for questions */}
        <div className="flex flex-col gap-3">
          {part.buttonLabel ? (
            <PartLink to={part.buttonHref} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-primary-foreground px-6 text-lg font-bold text-primary">
              {part.buttonLabel}<ArrowLeft className="size-5" aria-hidden />
            </PartLink>
          ) : null}
          {part.secondLabel ? <PartLink to={part.secondHref} className="inline-flex min-h-12 items-center justify-center rounded-control border border-primary-foreground/40 px-6 font-bold">{part.secondLabel}</PartLink> : null}
          {whatsapp ? (
            <a href={whatsappLink(whatsapp, 'سلام، دربارهٔ خرید سازمانی و عمده سؤال دارم.')} rel="noopener" className="inline-flex min-h-11 items-center justify-center font-medium underline-offset-4 hover:underline">
              پرسش در واتس‌اپ
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
