import { Link } from 'react-router';
import type { StorefrontImage, StorefrontProductCard } from '@erp/storefront/storefrontContracts';
import { mediaPath, productPath } from '../lib/brand';
import { formatPrice } from '../lib/format';
import { StockBadge } from './StockBadge';

export function ProductImage({ image, sizes, eager = false, className = '' }: { image: StorefrontImage | null; sizes: string; eager?: boolean; className?: string }) {
  if (!image) return <div className={`aspect-[4/5] bg-card ${className}`} aria-hidden />;
  const lightWidth = image.width ?? 1600;
  return (
    <img
      src={mediaPath(image.sha256, true)}
      srcSet={`${mediaPath(image.sha256, true)} 400w, ${mediaPath(image.sha256)} ${lightWidth}w`}
      sizes={sizes}
      alt={image.alt}
      width={image.width ?? 1280}
      height={image.height ?? 1600}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : undefined}
      decoding="async"
      className={`aspect-[4/5] w-full bg-card object-contain ${className}`}
    />
  );
}

/** One product in a grid: the photo, the name and the price in plain sight (Instagram finding: show the price) */
export function ProductCard({ product, eager = false }: { product: StorefrontProductCard; eager?: boolean }) {
  const out = product.stock.status === 'out';
  return (
    <article className="group relative flex flex-col">
      <div className="relative overflow-hidden rounded-surface border border-border bg-card">
        <ProductImage
          image={product.cover}
          eager={eager}
          sizes="(min-width: 1280px) 300px, (min-width: 1024px) 24vw, (min-width: 640px) 32vw, 48vw"
          className={`transition-transform duration-500 ease-motion group-hover:scale-[1.03] ${out ? 'opacity-50' : ''}`}
        />
        {product.stock.status !== 'in_stock' ? (
          <StockBadge stock={product.stock} className="absolute start-2 top-2" />
        ) : null}
      </div>
      <h3 className="mt-3 line-clamp-2 text-sm font-medium leading-6 sm:text-base">
        <Link to={productPath(product.slug)} className="after:absolute after:inset-0" prefetch="intent">{product.name}</Link>
      </h3>
      <p className="mt-1 font-bold text-foreground sm:text-lg">{formatPrice(product.retailPrice)}</p>
    </article>
  );
}

export function ProductGrid({ products, eagerCount = 0 }: { products: StorefrontProductCard[]; eagerCount?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4">
      {products.map((p, i) => <li key={p.slug}><ProductCard product={p} eager={i < eagerCount} /></li>)}
    </ul>
  );
}
