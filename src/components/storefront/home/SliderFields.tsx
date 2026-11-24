import { useId } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import type { MenuLinkOptions } from '../../../lib/storefront/storefrontMenuContracts';
import {
  BUTTON_LABEL_MAX, IMAGE_ALT_MAX, SLIDES_MAX, SLIDE_TEXT_MAX, SLIDE_TITLE_MAX, emptySlide, type BannerSection, type Slide, type SliderSection,
} from '../../../lib/storefront/storefrontPageRules';
import { formatPersianNumber } from '../../../utils/persianNumber';
import { JalaliDateInput } from '../../common/JalaliDateInput';
import { LibraryImageField } from '../pages/LibraryImageField';
import type { AssetTitles } from '../pages/SectionFields';
import { SiteLinkField } from './SiteLinkField';

/**
 * v12 phase 10e: the fields of the home page's «اسلایدر» (one to five slides, each an image with another crop for a
 * phone, a title, a text, a button and the days it is shown) and of its «بنر» (an image with a link).
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';
const hint = 'mt-1 text-xs leading-6 text-slate-500';
const small = 'inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-700 disabled:opacity-40';
const iconButton = 'rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30';

function ImagePair({ where, what, value, mobile, assets, onChange }: {
  where: string; what: string; value: number | null; mobile: number | null; assets: AssetTitles;
  onChange: (patch: { imageAssetId?: number | null; mobileImageAssetId?: number | null }) => void;
}) {
  const pick = (title: string, current: number | null, key: 'imageAssetId' | 'mobileImageAssetId') => (
    <LibraryImageField label={title} where={where} value={current} title={assets.titleOf(current)} unusable={assets.unusable(current)}
      onChange={(assetId, picked) => { if (assetId !== null) assets.remember(assetId, picked); onChange({ [key]: assetId }); }} />
  );
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        {pick(`عکس ${what}`, value, 'imageAssetId')}
        <p className={hint}>عکس افقی و پهن (مانند ۱۶۰۰ در ۶۰۰). نوشته‌ای که باید خوانده شود را در تیتر و متن بنویسید، نه روی عکس.</p>
      </div>
      <div>
        {pick(`عکس ${what} برای گوشی (اختیاری)`, mobile, 'mobileImageAssetId')}
        <p className={hint}>برش دیگری از همان عکس برای صفحهٔ ایستادهٔ گوشی (مانند ۸۰۰ در ۱۰۰۰). اگر خالی بماند، همان عکس نشان داده می‌شود.</p>
      </div>
    </div>
  );
}

function SlideFields({ slide, name, assets, options, onChange }: {
  slide: Slide; name: string; assets: AssetTitles; options: MenuLinkOptions | undefined; onChange: (patch: Partial<Slide>) => void;
}) {
  const id = useId();
  const text = (key: 'imageAlt' | 'title' | 'text' | 'buttonLabel', title: string, max: number) => (
    <div>
      <label htmlFor={`${id}-${key}`} className={label}>{title}</label>
      <input id={`${id}-${key}`} className={field} maxLength={max} value={slide[key]} onChange={e => onChange({ [key]: e.target.value })} />
    </div>
  );
  return (
    <div className="space-y-3">
      <ImagePair where={name} what="اسلاید" value={slide.imageAssetId} mobile={slide.mobileImageAssetId} assets={assets} onChange={onChange} />
      <div className="grid gap-3 md:grid-cols-2">
        {text('imageAlt', 'متن جایگزین عکس', IMAGE_ALT_MAX)}
        {text('title', 'تیتر (اختیاری)', SLIDE_TITLE_MAX)}
      </div>
      {text('text', 'متن کوتاه (اختیاری)', SLIDE_TEXT_MAX)}
      {text('buttonLabel', 'نوشتهٔ دکمه (اختیاری)', BUTTON_LABEL_MAX)}
      <SiteLinkField title="دکمه" value={slide.link} options={options} onChange={link => onChange({ link })} />
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={`${id}-from`} className={label}>نمایش از روز (اختیاری)</label>
          <JalaliDateInput id={`${id}-from`} className={field} value={slide.startsOn} onChange={startsOn => onChange({ startsOn })} />
        </div>
        <div>
          <label htmlFor={`${id}-to`} className={label}>تا پایان روز (اختیاری)</label>
          <JalaliDateInput id={`${id}-to`} className={field} value={slide.endsOn} onChange={endsOn => onChange({ endsOn })} />
        </div>
      </div>
      <p className={hint}>اگر روزها خالی بمانند اسلاید همیشه نشان داده می‌شود. بیرون از این روزها اسلاید خودش از سایت کنار می‌رود.</p>
    </div>
  );
}

export function SliderFields({ section, name, assets, options, onChange }: {
  section: SliderSection; name: string; assets: AssetTitles; options: MenuLinkOptions | undefined; onChange: (next: SliderSection) => void;
}) {
  const move = (from: number, to: number) => {
    const slides = [...section.slides];
    const [slide] = slides.splice(from, 1);
    slides.splice(to, 0, slide);
    onChange({ ...section, slides });
  };
  return (
    <div className="space-y-3">
      <p className={hint}>{`تا ${formatPersianNumber(SLIDES_MAX)} اسلاید، به همین ترتیب. اگر بیش از یک اسلاید باشد، بازدیدکننده با پیکان‌ها یا کشیدن میانشان جابه‌جا می‌شود.`}</p>
      <ol className="space-y-3">
        {section.slides.map((slide, index) => {
          const what = `اسلاید ${formatPersianNumber(index + 1)}`;
          return (
            <li key={index} aria-label={`${name}، ${what}`} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black text-slate-700">{what}</p>
                <div className="flex items-center">
                  <button type="button" className={iconButton} disabled={index === 0} aria-label={`${what} بالاتر`} onClick={() => move(index, index - 1)}><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" className={iconButton} disabled={index === section.slides.length - 1} aria-label={`${what} پایین‌تر`} onClick={() => move(index, index + 1)}><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" className={`${iconButton} text-rose-600`} aria-label={`حذف ${what}`} onClick={() => onChange({ ...section, slides: section.slides.filter((_, i) => i !== index) })}><X className="h-4 w-4" /></button>
                </div>
              </div>
              <SlideFields slide={slide} name={`${name}، ${what}`} assets={assets} options={options}
                onChange={patch => onChange({ ...section, slides: section.slides.map((s, i) => (i === index ? { ...s, ...patch } : s)) })} />
            </li>
          );
        })}
      </ol>
      <button type="button" className={small} disabled={section.slides.length >= SLIDES_MAX} onClick={() => onChange({ ...section, slides: [...section.slides, emptySlide()] })}>
        <Plus className="h-4 w-4" />
        اسلاید تازه
      </button>
    </div>
  );
}

export function BannerFields({ section, name, assets, options, onChange }: {
  section: BannerSection; name: string; assets: AssetTitles; options: MenuLinkOptions | undefined; onChange: (next: BannerSection) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-3">
      <ImagePair where={name} what="بنر" value={section.imageAssetId} mobile={section.mobileImageAssetId} assets={assets} onChange={patch => onChange({ ...section, ...patch })} />
      <div>
        <label htmlFor={`${id}-alt`} className={label}>متن جایگزین عکس</label>
        <input id={`${id}-alt`} className={field} maxLength={IMAGE_ALT_MAX} value={section.imageAlt} onChange={e => onChange({ ...section, imageAlt: e.target.value })} />
        <p className={hint}>آنچه در عکس بنر دیده و خوانده می‌شود، برای کسی که عکس را نمی‌بیند و برای موتور جست‌وجو.</p>
      </div>
      <SiteLinkField title="بنر" value={section.link} options={options} onChange={link => onChange({ ...section, link })} />
    </div>
  );
}
