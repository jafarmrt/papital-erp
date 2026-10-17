import { ImageOff } from 'lucide-react';
import { SafeImage } from '../SafeImage';
import type { MediaFeaturedImage as FeaturedImage } from '../../lib/media/mediaApi';

export const FEATURED_IMAGE_TITLE = 'تصویر شاخص محصول';
export const FEATURED_IMAGE_HELP = 'همان عکسی که هنگام معرفی کالا بارگذاری شده است. همه بخش‌های برنامه، از فهرست کالاها تا سندها و این کتابخانه، همین تصویر را نشان می‌دهند.';
export const FEATURED_IMAGE_CHANGE_HELP = 'برای عوض کردن آن، زیر تصویر دلخواه روی «تصویر شاخص محصول شود» بزنید.';
export const FEATURED_IMAGE_EMPTY = 'این محصول هنوز تصویر شاخص ندارد.';

interface Props {
  name: string;
  image: FeaturedImage;
  canChange: boolean;
}

/** v10.1.70: the product's one featured image (the item's own picture), shown on its media library page */
export function MediaFeaturedImage({ name, image, canChange }: Props) {
  const src = image.thumbnail || image.image;
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4" aria-label={FEATURED_IMAGE_TITLE}>
      <div className="w-24 h-24 shrink-0 rounded-lg overflow-hidden bg-slate-50">
        {src ? (
          <a href={image.image || src} target="_blank" rel="noreferrer" aria-label={`نمایش بزرگ ${FEATURED_IMAGE_TITLE}`}>
            <SafeImage key={src} src={src} alt={`${FEATURED_IMAGE_TITLE} ${name}`} className="w-full h-full object-cover" fallbackIcon={<ImageOff size={28} />} />
          </a>
        ) : (
          <div className="w-full h-full flex items-center justify-center"><ImageOff size={28} className="text-slate-300" /></div>
        )}
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-black text-slate-800">{FEATURED_IMAGE_TITLE}</h2>
        <p className="text-xs text-slate-600 leading-6">{src ? FEATURED_IMAGE_HELP : FEATURED_IMAGE_EMPTY}</p>
        {canChange && <p className="text-xs text-slate-500 leading-6">{FEATURED_IMAGE_CHANGE_HELP}</p>}
      </div>
    </section>
  );
}
