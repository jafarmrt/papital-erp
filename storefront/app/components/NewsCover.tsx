import { mediaPath } from '../lib/brand';
import type { SitePageImage } from '../lib/pages';

/** The main image of a news item: the small version where the box is small, the light one otherwise */
export function NewsCover({ image, sizes, eager = false, className = '' }: { image: SitePageImage; sizes: string; eager?: boolean; className?: string }) {
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
