import type { StorefrontImage } from '@erp/storefront/storefrontContracts';
import { mediaPath } from '../lib/brand';

/**
 * v11 phase 8.5b: the hero image of a «صفحهٔ ویژه», any shape the owner uploaded (a wide banner or a square photo). It
 * keeps its own proportions up to a height, so a tall photo never pushes the title off a phone's first screen.
 */
export function CampaignHeroImage({ image, eager = false, sizes, className = '' }: { image: StorefrontImage; eager?: boolean; sizes: string; className?: string }) {
  const width = image.width ?? 1600;
  const height = image.height ?? 900;
  return (
    <img
      src={mediaPath(image.sha256)}
      srcSet={`${mediaPath(image.sha256, true)} 400w, ${mediaPath(image.sha256)} ${width}w`}
      sizes={sizes}
      alt={image.alt}
      width={width}
      height={height}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : undefined}
      decoding="async"
      className={`max-h-[60vh] w-full bg-card object-cover lg:max-h-[32rem] ${className}`}
    />
  );
}
