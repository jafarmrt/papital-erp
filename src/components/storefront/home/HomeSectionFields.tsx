import { useId } from 'react';
import { Plus, X } from 'lucide-react';
import type { MenuLinkOptions } from '../../../lib/storefront/storefrontMenuContracts';
import {
  BUTTON_LABEL_MAX, HOME_KICKER_MAX, PAGE_ICONS, PAGE_ICON_TITLES, SECTION_TEXT_MAX, SECTION_TITLE_MAX, WHY_POINTS_MAX, WHY_POINT_TEXT_MAX, type HomeSection,
  type PageIcon,
} from '../../../lib/storefront/storefrontPageRules';
import { formatPersianNumber } from '../../../utils/persianNumber';
import type { AssetTitles } from '../pages/SectionFields';
import { BannerFields, SliderFields } from './SliderFields';

/**
 * v12 phase 10e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the fields of a part only «صفحهٔ اصلی» takes. The seven
 * parts of the site's own home page hold only their words here; what they show (the categories, the products, the
 * collections) the site reads from the catalog as it does today.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';
const hint = 'text-xs leading-6 text-slate-500';
const small = 'inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-700 disabled:opacity-40';

export function HomeSectionFields({ section, name, assets, options, onChange }: {
  section: HomeSection; name: string; assets: AssetTitles; options: MenuLinkOptions | undefined; onChange: (next: HomeSection) => void;
}) {
  const id = useId();
  const input = (key: string, title: string, value: string, max: number, set: (value: string) => void, ltr = false) => (
    <div>
      <label htmlFor={`${id}-${key}`} className={label}>{title}</label>
      <input id={`${id}-${key}`} dir={ltr ? 'ltr' : undefined} maxLength={max} placeholder={ltr ? '/products یا https://' : undefined} className={field} value={value} onChange={e => set(e.target.value)} />
    </div>
  );
  const button = (key: string, titles: [string, string], value: { label: string; href: string }, set: (patch: { label?: string; href?: string }) => void) => (
    <div className="grid gap-3 md:grid-cols-2">
      {input(`${key}-label`, titles[0], value.label, BUTTON_LABEL_MAX, text => set({ label: text }))}
      {input(`${key}-href`, titles[1], value.href, 300, href => set({ href }), true)}
    </div>
  );
  const fromSite = (what: string) => <p className={hint}>{`${what} را سایت خودش از محصولات روی سایت می‌آورد؛ این‌جا فقط نوشته‌های این بخش را می‌نویسید.`}</p>;

  switch (section.kind) {
    case 'slider':
      return <SliderFields section={section} name={name} assets={assets} options={options} onChange={onChange} />;
    case 'banner':
      return <BannerFields section={section} name={name} assets={assets} options={options} onChange={onChange} />;
    case 'collectionIntro': {
      const collections = Array.isArray(options?.collections) ? options.collections : [];
      return (
        <div className="space-y-3">
          <p className={hint}>متن معرفی، تصویر و پیوند «آشنایی بیشتر» این کالکشن از «کالکشن‌های سایت» می‌آید و چند محصول آن کنارش نشان داده می‌شود. اگر کالکشن کالایی روی سایت نداشته باشد، این بخش نشان داده نمی‌شود.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${id}-collection`} className={label}>کالکشن</label>
              <select id={`${id}-collection`} className={field} value={section.collection} onChange={e => onChange({ ...section, collection: e.target.value })}>
                <option value="">یک کالکشن را برگزینید</option>
                {[...new Set([...(section.collection ? [section.collection] : []), ...collections])].map(collection => <option key={collection} value={collection}>{collection}</option>)}
              </select>
            </div>
            {input('title', 'عنوان بخش (اختیاری)', section.title, SECTION_TITLE_MAX, title => onChange({ ...section, title }))}
          </div>
          <p className={hint}>اگر عنوان خالی بماند، نام کالکشن عنوان بخش می‌شود.</p>
        </div>
      );
    }
    case 'latestNews':
      return (
        <div className="space-y-3">
          <p className={hint}>سه خبر تازهٔ «خبرهای سایت» این‌جا می‌آید. تا «خبرها روی سایت بیایند» روشن نباشد یا خبری منتشر نشده باشد، این بخش نشان داده نمی‌شود.</p>
          {input('title', 'عنوان بخش', section.title, SECTION_TITLE_MAX, title => onChange({ ...section, title }))}
        </div>
      );
    case 'homeIntro':
      return (
        <div className="space-y-3">
          <p className={hint}>سربرگ بالای صفحهٔ اصلی امروز: نوشته‌ها این‌جاست و سایت کنار آن عکس نخستین محصول برگزیده را نشان می‌دهد. اگر اسلایدر می‌گذارید، این بخش را خاموش یا حذف کنید.</p>
          {input('kicker', 'خط بالای تیتر (اختیاری)', section.kicker, HOME_KICKER_MAX, kicker => onChange({ ...section, kicker }))}
          {input('title', 'تیتر', section.title, SECTION_TITLE_MAX, title => onChange({ ...section, title }))}
          {input('text', 'متن کوتاه (اختیاری)', section.text, SECTION_TEXT_MAX, text => onChange({ ...section, text }))}
          {button('button', ['نوشتهٔ دکمه (اختیاری)', 'پیوند دکمه'], { label: section.buttonLabel, href: section.buttonHref }, patch => onChange({ ...section, buttonLabel: patch.label ?? section.buttonLabel, buttonHref: patch.href ?? section.buttonHref }))}
        </div>
      );
    case 'homeCategories':
      return (
        <div className="space-y-3">
          {fromSite('چهار دستهٔ نخست و عکس هر کدام')}
          {input('title', 'عنوان بخش', section.title, SECTION_TITLE_MAX, title => onChange({ ...section, title }))}
        </div>
      );
    case 'homeWhy':
      return (
        <div className="space-y-3">
          <p className={hint}>چند نکتهٔ کوتاه دربارهٔ فروشگاه، هر کدام با یک آیکون. اگر متن نکتهٔ «ارسال» را خالی بگذارید، سایت خودش می‌نویسد: «ارسال رایگان از …» (از تنظیم خود فروشگاه) یا «ارسال به سراسر ایران».</p>
          <ul className="space-y-2">
            {section.points.map((point, index) => {
              const set = (patch: Partial<typeof point>) => onChange({ ...section, points: section.points.map((p, i) => (i === index ? { ...p, ...patch } : p)) });
              const what = `نکتهٔ ${formatPersianNumber(index + 1)}`;
              return (
                <li key={index} className="grid items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[10rem_1fr_auto]">
                  <div>
                    <label htmlFor={`${id}-icon-${index}`} className={label}>{`آیکون ${what}`}</label>
                    <select id={`${id}-icon-${index}`} className={field} value={point.icon} onChange={e => set({ icon: e.target.value as PageIcon })}>
                      {PAGE_ICONS.map(icon => <option key={icon} value={icon}>{PAGE_ICON_TITLES[icon]}</option>)}
                    </select>
                  </div>
                  {input(`point-${index}`, `متن ${what}`, point.text, WHY_POINT_TEXT_MAX, text => set({ text }))}
                  <button type="button" className="rounded-lg p-2 text-rose-600 hover:bg-slate-100" aria-label={`حذف ${what}`} onClick={() => onChange({ ...section, points: section.points.filter((_, i) => i !== index) })}><X className="h-4 w-4" /></button>
                </li>
              );
            })}
          </ul>
          <button type="button" className={small} disabled={section.points.length >= WHY_POINTS_MAX} onClick={() => onChange({ ...section, points: [...section.points, { icon: 'star', text: '' }] })}>
            <Plus className="h-4 w-4" />
            نکتهٔ تازه
          </button>
        </div>
      );
    case 'homeFeatured': case 'homeNewest':
      return (
        <div className="space-y-3">
          {fromSite(section.kind === 'homeFeatured' ? 'هشت محصول نخست به ترتیب «فروشگاه سایت»' : 'چهار محصول تازه')}
          {input('title', 'عنوان بخش', section.title, SECTION_TITLE_MAX, title => onChange({ ...section, title }))}
          {button('button', ['نوشتهٔ پیوند کنار عنوان (اختیاری)', 'پیوند'], { label: section.buttonLabel, href: section.buttonHref }, patch => onChange({ ...section, buttonLabel: patch.label ?? section.buttonLabel, buttonHref: patch.href ?? section.buttonHref }))}
        </div>
      );
    case 'homeCollections':
      return (
        <div className="space-y-3">
          {fromSite('نام کالکشن‌ها و شمار محصول هر کدام')}
          {input('title', 'عنوان بخش', section.title, SECTION_TITLE_MAX, title => onChange({ ...section, title }))}
          {input('text', 'متن کوتاه (اختیاری)', section.text, SECTION_TEXT_MAX, text => onChange({ ...section, text }))}
        </div>
      );
    default:
      return (
        <div className="space-y-3">
          <p className={hint}>کادر پایین صفحهٔ اصلی برای خریدار عمده و سازمانی. پیوند «پرسش در واتس‌اپ» را سایت خودش از شمارهٔ فروشگاه می‌گذارد.</p>
          {input('title', 'عنوان بخش', section.title, SECTION_TITLE_MAX, title => onChange({ ...section, title }))}
          {input('text', 'متن (اختیاری)', section.text, SECTION_TEXT_MAX, text => onChange({ ...section, text }))}
          {button('button', ['نوشتهٔ دکمهٔ نخست (اختیاری)', 'پیوند دکمهٔ نخست'], { label: section.buttonLabel, href: section.buttonHref }, patch => onChange({ ...section, buttonLabel: patch.label ?? section.buttonLabel, buttonHref: patch.href ?? section.buttonHref }))}
          {button('second', ['نوشتهٔ دکمهٔ دوم (اختیاری)', 'پیوند دکمهٔ دوم'], { label: section.secondLabel, href: section.secondHref }, patch => onChange({ ...section, secondLabel: patch.label ?? section.secondLabel, secondHref: patch.href ?? section.secondHref }))}
        </div>
      );
  }
}
