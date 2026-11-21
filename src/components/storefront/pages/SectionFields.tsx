import { Suspense, lazy, useId } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import type { MenuLinkOptions } from '../../../lib/storefront/storefrontMenuContracts';
import {
  BUTTON_LABEL_MAX, CARD_TEXT_MAX, CARD_TITLE_MAX, GALLERY_MAX, ICON_CARDS_MAX, IMAGE_ALT_MAX, MAP_ADDRESS_MAX, PAGE_ICONS, PAGE_ICON_TITLES, PEOPLE_MAX,
  PERSON_CONTACT_MAX, PERSON_NAME_MAX, PERSON_ROLE_MAX, PRODUCT_ROW_MAX, SECTION_TEXT_MAX, SECTION_TITLE_MAX, type PageIcon, type PageSection,
} from '../../../lib/storefront/storefrontPageRules';
import { formatPersianNumber } from '../../../utils/persianNumber';
import { LibraryImageField } from './LibraryImageField';

/**
 * v12 phase 10b: the fields of one section of a page, by its kind. Every text is plain text; the section's long text is
 * the Tiptap editor, loaded only when a section with a text is on the screen.
 */
const RichTextEditor = lazy(() => import('./RichTextEditor'));

const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';
const hint = 'mt-1 text-xs leading-6 text-slate-500';
const small = 'inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-700 disabled:opacity-40';
const iconButton = 'rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30';

export interface AssetTitles {
  titleOf: (assetId: number | null) => string;
  unusable: (assetId: number | null) => boolean;
  remember: (assetId: number, title: string) => void;
}

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** «بالا», «پایین» and «حذف» of one row of a list inside a section */
function RowTools({ index, count, what, onMove, onRemove }: { index: number; count: number; what: string; onMove: (to: number) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center">
      <button type="button" className={iconButton} disabled={index === 0} aria-label={`${what} بالاتر`} onClick={() => onMove(index - 1)}><ArrowUp className="h-4 w-4" /></button>
      <button type="button" className={iconButton} disabled={index === count - 1} aria-label={`${what} پایین‌تر`} onClick={() => onMove(index + 1)}><ArrowDown className="h-4 w-4" /></button>
      <button type="button" className={`${iconButton} text-rose-600`} aria-label={`حذف ${what}`} onClick={onRemove}><X className="h-4 w-4" /></button>
    </div>
  );
}

export function SectionFields({ section, name, disabled, assets, options, onChange }: {
  section: PageSection;
  /** the section as the builder names it («بخش ۲»), so each text editor and image button has a name of its own */
  name: string;
  disabled: boolean;
  assets: AssetTitles;
  options: MenuLinkOptions | undefined;
  onChange: (next: PageSection) => void;
}) {
  const id = useId();
  const input = (name: string, title: string, value: string, max: number, set: (value: string) => void, extra: { ltr?: boolean; placeholder?: string; note?: string } = {}) => (
    <div>
      <label htmlFor={`${id}-${name}`} className={label}>{title}</label>
      <input id={`${id}-${name}`} dir={extra.ltr ? 'ltr' : undefined} maxLength={max} placeholder={extra.placeholder} className={field} value={value} onChange={e => set(e.target.value)} />
      {extra.note ? <p className={hint}>{extra.note}</p> : null}
    </div>
  );
  const image = (title: string, value: number | null, set: (assetId: number | null) => void) => (
    <LibraryImageField label={title} where={name} value={value} title={assets.titleOf(value)} unusable={assets.unusable(value)}
      onChange={(assetId, pickedTitle) => { if (assetId !== null) assets.remember(assetId, pickedTitle); set(assetId); }} />
  );
  const editor = (title: string, doc: Extract<PageSection, { kind: 'text' }>['doc'], set: (doc: Extract<PageSection, { kind: 'text' }>['doc']) => void) => (
    <div>
      <p className={label}>{title}</p>
      <Suspense fallback={<p className="text-xs text-slate-500">در حال آماده شدن ویرایشگر…</p>}>
        <RichTextEditor label={`${title} ${name}`} value={doc} disabled={disabled} onChange={set} />
      </Suspense>
    </div>
  );
  const button = (buttonLabel: string, buttonHref: string, set: (patch: { buttonLabel?: string; buttonHref?: string }) => void) => (
    <div className="grid gap-3 md:grid-cols-2">
      {input('button-label', 'نوشتهٔ دکمه (اختیاری)', buttonLabel, BUTTON_LABEL_MAX, value => set({ buttonLabel: value }))}
      {input('button-href', 'پیوند دکمه', buttonHref, 300, value => set({ buttonHref: value }), { ltr: true, placeholder: '/products یا https://' })}
    </div>
  );

  switch (section.kind) {
    case 'hero':
      return (
        <div className="space-y-3">
          {input('title', 'عنوان', section.title, SECTION_TITLE_MAX, title => onChange({ ...section, title }))}
          {input('text', 'متن کوتاه (اختیاری)', section.text, SECTION_TEXT_MAX, text => onChange({ ...section, text }))}
          {image('عکس زمینه (اختیاری)', section.imageAssetId, imageAssetId => onChange({ ...section, imageAssetId }))}
          {button(section.buttonLabel, section.buttonHref, patch => onChange({ ...section, ...patch }))}
        </div>
      );
    case 'text':
      return editor('متن', section.doc, doc => onChange({ ...section, doc }));
    case 'textImage':
      return (
        <div className="space-y-3">
          {input('title', 'عنوان (اختیاری)', section.title, SECTION_TITLE_MAX, title => onChange({ ...section, title }))}
          {editor('متن', section.doc, doc => onChange({ ...section, doc }))}
          {image('عکس', section.imageAssetId, imageAssetId => onChange({ ...section, imageAssetId }))}
          <div className="grid gap-3 md:grid-cols-2">
            {input('alt', 'متن جایگزین عکس', section.imageAlt, IMAGE_ALT_MAX, imageAlt => onChange({ ...section, imageAlt }), { note: 'برای کسی که عکس را نمی‌بیند و برای موتور جست‌وجو.' })}
            <div>
              <label htmlFor={`${id}-side`} className={label}>جای عکس</label>
              <select id={`${id}-side`} className={field} value={section.imageSide} onChange={e => onChange({ ...section, imageSide: e.target.value === 'left' ? 'left' : 'right' })}>
                <option value="right">سمت راست</option>
                <option value="left">سمت چپ</option>
              </select>
            </div>
          </div>
          {button(section.buttonLabel, section.buttonHref, patch => onChange({ ...section, ...patch }))}
        </div>
      );
    case 'iconCards':
      return (
        <div className="space-y-3">
          {input('title', 'عنوان بخش (اختیاری)', section.title, SECTION_TITLE_MAX, title => onChange({ ...section, title }))}
          <ul className="space-y-3">
            {section.cards.map((card, index) => (
              <li key={index} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-black text-slate-700">{`کارت ${formatPersianNumber(index + 1)}`}</p>
                  <RowTools index={index} count={section.cards.length} what={`کارت ${formatPersianNumber(index + 1)}`}
                    onMove={to => onChange({ ...section, cards: moved(section.cards, index, to) })} onRemove={() => onChange({ ...section, cards: section.cards.filter((_, i) => i !== index) })} />
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label htmlFor={`${id}-icon-${index}`} className={label}>آیکون</label>
                    <select id={`${id}-icon-${index}`} className={field} value={card.icon}
                      onChange={e => onChange({ ...section, cards: section.cards.map((c, i) => (i === index ? { ...c, icon: e.target.value as PageIcon } : c)) })}>
                      {PAGE_ICONS.map(icon => <option key={icon} value={icon}>{PAGE_ICON_TITLES[icon]}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    {input(`card-title-${index}`, 'عنوان کارت', card.title, CARD_TITLE_MAX, title => onChange({ ...section, cards: section.cards.map((c, i) => (i === index ? { ...c, title } : c)) }))}
                  </div>
                </div>
                {input(`card-text-${index}`, 'متن کارت (اختیاری)', card.text, CARD_TEXT_MAX, text => onChange({ ...section, cards: section.cards.map((c, i) => (i === index ? { ...c, text } : c)) }))}
              </li>
            ))}
          </ul>
          <button type="button" className={small} disabled={section.cards.length >= ICON_CARDS_MAX}
            onClick={() => onChange({ ...section, cards: [...section.cards, { icon: 'star', title: '', text: '' }] })}><Plus className="h-4 w-4" />کارت تازه</button>
        </div>
      );
    case 'gallery':
      return (
        <div className="space-y-3">
          {input('title', 'عنوان بخش (اختیاری)', section.title, SECTION_TITLE_MAX, title => onChange({ ...section, title }))}
          <ul className="space-y-3">
            {section.images.map((item, index) => (
              <li key={`${index}-${item.assetId}`} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-black text-slate-700">{`عکس ${formatPersianNumber(index + 1)}: ${assets.titleOf(item.assetId)}`}</p>
                  <RowTools index={index} count={section.images.length} what={`عکس ${formatPersianNumber(index + 1)}`}
                    onMove={to => onChange({ ...section, images: moved(section.images, index, to) })} onRemove={() => onChange({ ...section, images: section.images.filter((_, i) => i !== index) })} />
                </div>
                {assets.unusable(item.assetId) && <p role="alert" className="text-xs text-rose-700">این عکس دیگر در کتابخانهٔ تصاویر نیست یا نسخهٔ سبک ندارد؛ آن را بردارید.</p>}
                {input(`gallery-alt-${index}`, 'متن جایگزین عکس', item.alt, IMAGE_ALT_MAX, alt => onChange({ ...section, images: section.images.map((g, i) => (i === index ? { ...g, alt } : g)) }))}
              </li>
            ))}
          </ul>
          {section.images.length < GALLERY_MAX && image('افزودن عکس به گالری', null, (assetId) => {
            if (assetId !== null && !section.images.some(g => g.assetId === assetId)) onChange({ ...section, images: [...section.images, { assetId, alt: '' }] });
          })}
        </div>
      );
    case 'people':
      return (
        <div className="space-y-3">
          {input('title', 'عنوان بخش (اختیاری)', section.title, SECTION_TITLE_MAX, title => onChange({ ...section, title }))}
          <ul className="space-y-3">
            {section.people.map((person, index) => {
              const set = (patch: Partial<typeof person>) => onChange({ ...section, people: section.people.map((p, i) => (i === index ? { ...p, ...patch } : p)) });
              return (
                <li key={index} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black text-slate-700">{`نفر ${formatPersianNumber(index + 1)}`}</p>
                    <RowTools index={index} count={section.people.length} what={`نفر ${formatPersianNumber(index + 1)}`}
                      onMove={to => onChange({ ...section, people: moved(section.people, index, to) })} onRemove={() => onChange({ ...section, people: section.people.filter((_, i) => i !== index) })} />
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    {input(`person-name-${index}`, 'نام', person.name, PERSON_NAME_MAX, name => set({ name }))}
                    {input(`person-role-${index}`, 'سمت (اختیاری)', person.role, PERSON_ROLE_MAX, role => set({ role }))}
                    {input(`person-contact-${index}`, 'راه تماس (اختیاری)', person.contact, PERSON_CONTACT_MAX, contact => set({ contact }))}
                  </div>
                  {image('عکس (اختیاری)', person.imageAssetId, imageAssetId => set({ imageAssetId }))}
                </li>
              );
            })}
          </ul>
          <button type="button" className={small} disabled={section.people.length >= PEOPLE_MAX}
            onClick={() => onChange({ ...section, people: [...section.people, { imageAssetId: null, name: '', role: '', contact: '' }] })}><Plus className="h-4 w-4" />نفر تازه</button>
        </div>
      );
    case 'map':
      return (
        <div className="space-y-3">
          <p className={hint}>نقشه یک عکس از نقشه است با دکمه‌های مسیریابی؛ نقشهٔ زنده در صفحه جاسازی نمی‌شود تا صفحه کند نشود و نشانی بازدیدکننده به بیرون نرود.</p>
          {input('title', 'عنوان بخش (اختیاری)', section.title, SECTION_TITLE_MAX, title => onChange({ ...section, title }))}
          {image('عکس نقشه', section.imageAssetId, imageAssetId => onChange({ ...section, imageAssetId }))}
          {input('address', 'نشانی (اختیاری)', section.address, MAP_ADDRESS_MAX, address => onChange({ ...section, address }))}
          <div className="grid gap-3 md:grid-cols-3">
            {input('neshan', 'پیوند نشان', section.neshanUrl, 300, neshanUrl => onChange({ ...section, neshanUrl }), { ltr: true, placeholder: 'https://' })}
            {input('balad', 'پیوند بلد', section.baladUrl, 300, baladUrl => onChange({ ...section, baladUrl }), { ltr: true, placeholder: 'https://' })}
            {input('google', 'پیوند نقشهٔ گوگل', section.googleUrl, 300, googleUrl => onChange({ ...section, googleUrl }), { ltr: true, placeholder: 'https://' })}
          </div>
        </div>
      );
    case 'products': {
      const products = Array.isArray(options?.products) ? options.products : [];
      const collections = Array.isArray(options?.collections) ? options.collections : [];
      const nameOf = (itemId: number) => products.find(p => p.itemId === itemId)?.name ?? 'محصولی که اکنون روی سایت نیست';
      return (
        <div className="space-y-3">
          {input('title', 'عنوان ردیف (اختیاری)', section.title, SECTION_TITLE_MAX, title => onChange({ ...section, title }))}
          <div role="radiogroup" aria-label="منبع ردیف محصولات" className="flex flex-wrap gap-2">
            {([['items', 'محصولات انتخابی'], ['collection', 'یک کالکشن']] as const).map(([source, title]) => (
              <label key={source} className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold ${section.source === source ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700'}`}>
                <input type="radio" className="sr-only" name={`${id}-source`} checked={section.source === source} onChange={() => onChange({ ...section, source })} />
                {title}
              </label>
            ))}
          </div>
          {section.source === 'items' ? (
            <>
              <ul className="space-y-1">
                {section.itemIds.map((itemId, index) => (
                  <li key={itemId} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-1">
                    <span className="min-w-0 truncate text-sm text-slate-700">{nameOf(itemId)}</span>
                    <RowTools index={index} count={section.itemIds.length} what={nameOf(itemId)}
                      onMove={to => onChange({ ...section, itemIds: moved(section.itemIds, index, to) })} onRemove={() => onChange({ ...section, itemIds: section.itemIds.filter(i => i !== itemId) })} />
                  </li>
                ))}
              </ul>
              <div>
                <label htmlFor={`${id}-add-product`} className={label}>{`افزودن محصول (تا ${formatPersianNumber(PRODUCT_ROW_MAX)} محصول)`}</label>
                <select id={`${id}-add-product`} className={field} value="" disabled={section.itemIds.length >= PRODUCT_ROW_MAX}
                  onChange={(e) => { const itemId = Number(e.target.value); if (itemId && !section.itemIds.includes(itemId)) onChange({ ...section, itemIds: [...section.itemIds, itemId] }); }}>
                  <option value="">یک محصول روی سایت را برگزینید</option>
                  {products.filter(p => !section.itemIds.includes(p.itemId)).map(p => <option key={p.itemId} value={p.itemId}>{p.name}</option>)}
                </select>
              </div>
            </>
          ) : (
            <div>
              <label htmlFor={`${id}-collection`} className={label}>کالکشن</label>
              <select id={`${id}-collection`} className={field} value={section.collection} onChange={e => onChange({ ...section, collection: e.target.value })}>
                <option value="">یک کالکشن را برگزینید</option>
                {[...new Set([...(section.collection ? [section.collection] : []), ...collections])].map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          )}
        </div>
      );
    }
    case 'button':
      return (
        <div className="grid gap-3 md:grid-cols-2">
          {input('label', 'نوشتهٔ دکمه', section.label, BUTTON_LABEL_MAX, value => onChange({ ...section, label: value }))}
          {input('href', 'پیوند دکمه', section.href, 300, href => onChange({ ...section, href }), { ltr: true, placeholder: '/products یا https://' })}
        </div>
      );
    case 'shippingMethods':
      return (
        <div className="space-y-3">
          <p className={hint}>روش‌های ارسال، هزینهٔ هر کدام و سقف ارسال رایگان را سایت همیشه زنده از «روش‌های ارسال» و «پرداخت، قیمت و موجودی» می‌خواند؛ اینجا فقط عنوانش نوشته می‌شود.</p>
          {input('title', 'عنوان بخش', section.title, SECTION_TITLE_MAX, title => onChange({ ...section, title }))}
        </div>
      );
    default:
      return null;
  }
}
