import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Clock, Gift, Handshake, Heart, Leaf, Mail, MapPin, Phone, ShieldCheck, Sparkles, Star, Truck, type LucideIcon } from 'lucide-react';
import type { PageIcon, SectionBackground } from '@erp/storefront/storefrontPageParts';
import { collectionPath, mediaPath } from '../lib/brand';
import { formatPrice } from '../lib/format';
import { docIsBlank, isBlank, type SitePageImage, type SitePageSection } from '../lib/pages';
import { ProductGrid } from './ProductCard';
import { RichText } from './RichText';

/**
 * v12 phase 10c: the sections of a page of the ERP's «صفحه‌های سایت», each kind drawn by the site itself. A section is
 * a band as wide as the window with its content in the site's column; nothing in it is wider than a 360 px phone (an
 * image shrinks, a long word breaks, a table scrolls inside its own box). A section left with nothing to show (its
 * image left the library, none of its products is on the site now) is not drawn at all.
 */
export interface ShippingView {
  methods: Array<{ title: string; description: string; cost: string; free: boolean }>;
  freeShippingThreshold: string;
}

/**
 * The four grounds of a section, in the site's own palette («لاجورد»: white, the light sky tint, cobalt and navy). The
 * ERP keeps the names it was first given (`cream`, `brand`); `ui` titles there say what the site draws.
 */
const GROUNDS: Readonly<Record<SectionBackground, string>> = {
  white: 'bg-background text-foreground',
  cream: 'bg-brand-soft text-foreground',
  brand: 'bg-brand text-brand-foreground',
  dark: 'bg-primary text-primary-foreground',
};
const isDeep = (background: SectionBackground) => background === 'brand' || background === 'dark';

const ICONS: Readonly<Record<PageIcon, LucideIcon>> = {
  leaf: Leaf, handshake: Handshake, truck: Truck, gift: Gift, heart: Heart, sparkles: Sparkles, clock: Clock, map: MapPin, phone: Phone, mail: Mail,
  shield: ShieldCheck, star: Star,
};
const CARD_COLUMNS: Readonly<Record<number, string>> = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' };

function PageImg({ image, sizes, eager = false, className = '' }: { image: SitePageImage; sizes: string; eager?: boolean; className?: string }) {
  const width = image.width ?? 1600;
  return (
    <img
      src={mediaPath(image.sha256)}
      srcSet={image.thumb ? `${mediaPath(image.sha256, true)} 400w, ${mediaPath(image.sha256)} ${width}w` : undefined}
      sizes={image.thumb ? sizes : undefined}
      alt={image.alt}
      width={width}
      height={image.height ?? 1000}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : undefined}
      decoding="async"
      className={`h-auto max-w-full ${className}`}
    />
  );
}

/** A button of a page: a path of the site stays in the app; an outside address opens without telling it where the visitor came from */
function PageButton({ label, href, deep }: { label: string; href: string; deep: boolean }) {
  if (isBlank(label) || !href) return null;
  const className = `inline-flex min-h-11 max-w-full items-center wrap-anywhere justify-center rounded-control px-6 py-2 text-center font-bold transition-colors duration-(--motion) ${
    deep ? 'bg-background text-foreground hover:bg-brand-soft' : 'bg-primary text-primary-foreground hover:bg-brand'}`;
  return href.startsWith('/')
    ? <Link to={href} className={className}>{label}</Link>
    : <a href={href} rel="noopener noreferrer" className={className}>{label}</a>;
}

const Title = ({ children, lead = false }: { children: string; lead?: boolean }) => {
  if (isBlank(children)) return null;
  return lead
    ? <h1 className="text-3xl font-extrabold leading-tight text-balance break-words lg:text-5xl">{children}</h1>
    : <h2 className="text-2xl font-extrabold text-balance break-words lg:text-3xl">{children}</h2>;
};

/** `listClassName`: the list is a white card, so on a deep ground it is given the dark text of a card */
export function ShippingMethodsList({ shipping, listClassName = '' }: { shipping: ShippingView; listClassName?: string }) {
  const free = shipping.methods.filter(m => m.free);
  return (
    <>
      {shipping.methods.length ? (
        <ul className={`divide-y divide-border rounded-surface border border-border bg-card${listClassName ? ` ${listClassName}` : ''}`}>
          {shipping.methods.map(m => (
            <li key={m.title} className="space-y-1 px-4 py-4">
              <p className="font-bold text-foreground">{m.title}</p>
              {m.description ? <p className="text-muted-foreground">{m.description}</p> : null}
              {m.cost ? <p>{m.cost}</p> : null}
            </li>
          ))}
        </ul>
      ) : <p>روش‌های ارسال به‌زودی همین‌جا نوشته می‌شوند.</p>}
      {/^[1-9]\d*$/.test(shipping.freeShippingThreshold) && free.length ? (
        <p>برای خرید از {formatPrice(shipping.freeShippingThreshold)} به بالا، ارسال با {free.map(m => m.title).join('، ')} رایگان است.</p>
      ) : null}
    </>
  );
}

/** What a section holds, or null when it has nothing to show */
function body(section: SitePageSection, lead: boolean, shipping: ShippingView | null): ReactNode {
  const deep = isDeep(section.background);
  switch (section.kind) {
    case 'hero': {
      if (isBlank(section.title) && isBlank(section.text) && !section.image) return null;
      return (
        <div className={section.image ? 'grid items-center gap-8 lg:grid-cols-2 lg:gap-12' : 'max-w-3xl'}>
          <div className="min-w-0 space-y-4">
            <Title lead={lead}>{section.title}</Title>
            {!isBlank(section.text) ? <p className="text-lg leading-9 break-words whitespace-pre-line opacity-90">{section.text}</p> : null}
            <PageButton label={section.buttonLabel} href={section.buttonHref} deep={deep} />
          </div>
          {section.image ? <PageImg image={section.image} eager={lead} sizes="(min-width: 1024px) 480px, 100vw" className="w-full rounded-surface object-cover" /> : null}
        </div>
      );
    }
    case 'text':
      return docIsBlank(section.doc) ? null : <RichText doc={section.doc} className="max-w-3xl" />;
    case 'textImage': {
      if (isBlank(section.title) && docIsBlank(section.doc) && !section.image) return null;
      return (
        <div className={section.image ? 'grid items-center gap-8 lg:grid-cols-2 lg:gap-12' : 'max-w-3xl'}>
          {/* the page is right-to-left: the first column is the right one */}
          {section.image ? <PageImg image={section.image} sizes="(min-width: 1024px) 480px, 100vw" className={`w-full rounded-surface object-cover ${section.imageSide === 'left' ? 'lg:order-last' : ''}`} /> : null}
          <div className="min-w-0 space-y-4">
            <Title lead={lead}>{section.title}</Title>
            <RichText doc={section.doc} />
            <PageButton label={section.buttonLabel} href={section.buttonHref} deep={deep} />
          </div>
        </div>
      );
    }
    case 'iconCards': {
      if (section.cards.length === 0) return null;
      return (
        <div className="space-y-6">
          <Title lead={lead}>{section.title}</Title>
          <ul className={`grid gap-4 ${CARD_COLUMNS[Math.min(section.cards.length, 4)]}`}>
            {section.cards.map((card, i) => {
              const Icon = ICONS[card.icon];
              return (
                <li key={i} className={`min-w-0 space-y-2 rounded-surface border p-5 ${deep ? 'border-current/20' : 'border-border bg-card'}`}>
                  <Icon className={`size-8 ${deep ? '' : 'text-brand'}`} strokeWidth={1.5} aria-hidden />
                  {!isBlank(card.title) ? <h3 className="font-bold break-words">{card.title}</h3> : null}
                  {!isBlank(card.text) ? <p className="text-sm leading-7 break-words opacity-85">{card.text}</p> : null}
                </li>
              );
            })}
          </ul>
        </div>
      );
    }
    case 'gallery': {
      if (section.images.length === 0) return null;
      return (
        <div className="space-y-6">
          <Title lead={lead}>{section.title}</Title>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-4">
            {section.images.map((image, i) => (
              <li key={i} className="min-w-0">
                <PageImg image={image} sizes="(min-width: 1024px) 320px, (min-width: 640px) 32vw, 48vw" className="aspect-square w-full rounded-surface bg-card object-cover" />
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'people': {
      const people = section.people.filter(person => !isBlank(person.name));
      if (people.length === 0) return null;
      return (
        <div className="space-y-6">
          <Title lead={lead}>{section.title}</Title>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {people.map((person, i) => (
              <li key={i} className={`min-w-0 space-y-2 rounded-surface border p-5 text-center ${deep ? 'border-current/20' : 'border-border bg-card'}`}>
                {person.image ? <PageImg image={person.image} sizes="96px" className="mx-auto size-24 rounded-full bg-card object-cover" /> : null}
                <h3 className="font-bold break-words">{person.name}</h3>
                {!isBlank(person.role) ? <p className="text-sm break-words opacity-85">{person.role}</p> : null}
                {!isBlank(person.contact) ? <p className="text-sm break-all opacity-85"><bdi>{person.contact}</bdi></p> : null}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'map': {
      const links = [
        { href: section.neshanUrl, label: 'مسیریابی با نشان' }, { href: section.baladUrl, label: 'مسیریابی با بلد' }, { href: section.googleUrl, label: 'مسیریابی با نقشهٔ گوگل' },
      ].filter(link => link.href && !link.href.startsWith('/'));
      if (!section.image && isBlank(section.address) && links.length === 0) return null;
      return (
        <div className="space-y-6">
          <Title lead={lead}>{section.title}</Title>
          <div className={section.image ? 'grid items-center gap-8 lg:grid-cols-2' : 'max-w-3xl'}>
            {section.image ? <PageImg image={section.image} sizes="(min-width: 1024px) 480px, 100vw" className="w-full rounded-surface object-cover" /> : null}
            <div className="min-w-0 space-y-4">
              {!isBlank(section.address) ? <p className="leading-8 break-words whitespace-pre-line">{section.address}</p> : null}
              {links.length ? (
                <ul className="flex flex-wrap gap-3">
                  {links.map(link => (
                    <li key={link.label}>
                      <a href={link.href} rel="noopener noreferrer" className={`inline-flex min-h-11 items-center gap-2 rounded-control border px-4 font-medium ${deep ? 'border-current/40 hover:bg-background/10' : 'border-border bg-card hover:border-brand'}`}>
                        <MapPin className="size-4" aria-hidden />{link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
      );
    }
    case 'products': {
      if (section.products.length === 0) return null;
      return (
        <div className="space-y-6">
          <Title lead={lead}>{section.title}</Title>
          {/* a product card is always on white, as the photos are */}
          <div data-tone="light" className={deep ? 'rounded-surface bg-background p-4 text-foreground lg:p-6' : ''}><ProductGrid products={section.products} /></div>
          {section.collection ? (
            <p><Link to={collectionPath(section.collection)} className={`inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline ${deep ? '' : 'text-brand'}`}>{`همهٔ محصولات کالکشن ${section.collection}`}</Link></p>
          ) : null}
        </div>
      );
    }
    case 'button':
      return !isBlank(section.label) && section.href ? <div className="text-center"><PageButton label={section.label} href={section.href} deep={deep} /></div> : null;
    case 'shippingMethods':
      if (!shipping) return null;
      return (
        <div className="max-w-3xl space-y-4">
          <Title lead={lead}>{isBlank(section.title) ? 'روش‌های ارسال' : section.title}</Title>
          <ShippingMethodsList shipping={shipping} listClassName={deep ? 'text-foreground' : ''} />
        </div>
      );
  }
}

const writesTitle = (section: SitePageSection): boolean => (
  section.kind === 'shippingMethods' || ('title' in section && !isBlank(section.title))
);

/**
 * The sections of a page, top to bottom. The page has one `<h1>`: the title of its first drawn section when that section
 * has one, else `header` (the page's own title), which is then drawn above the sections.
 */
export function PageSections({ sections, shipping, header }: { sections: readonly SitePageSection[]; shipping: ShippingView | null; header: ReactNode }) {
  const drawn = sections.filter(section => body(section, false, shipping) !== null);
  const titled = drawn.length > 0 && writesTitle(drawn[0]);
  return (
    <>
      {titled ? null : header}
      {drawn.map((section, i) => (
        <section key={i} data-page-section={section.kind} data-tone={isDeep(section.background) ? 'deep' : 'light'} className={`${GROUNDS[section.background]} py-10 lg:py-14`}>
          <div className="mx-auto max-w-5xl px-4 lg:px-8">{body(section, titled && i === 0, shipping)}</div>
        </section>
      ))}
    </>
  );
}
