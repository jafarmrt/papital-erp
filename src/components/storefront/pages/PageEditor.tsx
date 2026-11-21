import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, MoreVertical, Plus, Save, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useDeletePageMutation, usePageActionMutation, useSavePageMutation, type PageAction } from '../../../hooks/queries/useStorefrontPageQueries';
import type { MenuLinkOptions } from '../../../lib/storefront/storefrontMenuContracts';
import { PAGE_STATUS_TITLES, type PageDetail } from '../../../lib/storefront/storefrontPageContracts';
import {
  BASE_PAGES, PAGE_SECTIONS_MAX, PAGE_SEO_DESCRIPTION_MAX, PAGE_SEO_TITLE_MAX, PAGE_SLUG_MAX, PAGE_TITLE_MAX, SECTION_BACKGROUNDS, SECTION_BACKGROUND_TITLES,
  SECTION_KINDS, SECTION_KIND_TITLES, SHIPPING_SECTION_PAGE, checkedPage, emptySection, type BasePageSlug, type PageSection, type PageValues,
  type SectionBackground, type SectionKind,
} from '../../../lib/storefront/storefrontPageRules';
import { formatPersianNumber } from '../../../utils/persianNumber';
import { errorMessageOf } from '../../../utils';
import { LibraryImageField } from './LibraryImageField';
import { SectionFields, type AssetTitles } from './SectionFields';

/**
 * v12 phase 10b (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the builder of one page of the site. A page is a list
 * of «بخش»; each is added from the fixed kinds, filled, moved with «بالا» and «پایین» and removed. «ذخیرهٔ پیش‌نویس» never
 * changes the site; «انتشار» puts the saved draft on the site; «برگرداندن به نسخهٔ روی سایت» throws the draft's changes
 * away. The same rules the server checks with (`checkedPage`) run here first, so a problem is named before a save.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';
const hint = 'mt-1 text-xs leading-6 text-slate-500';
const card = 'rounded-2xl border border-slate-200 bg-white p-5 space-y-3';
const iconButton = 'rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30';

/** the keys of an object in one order, so two copies of a draft compare by what they hold */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, inner: unknown) => (
  inner && typeof inner === 'object' && !Array.isArray(inner)
    ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : inner
));

const baseSlugOf = (detail: PageDetail): BasePageSlug | null => (detail.kind === 'base' ? (BASE_PAGES.find(p => p.slug === detail.slug)?.slug ?? null) : null);

/** a name of its own for every section on the screen, so a section keeps its editor when it is moved (10b review) */
let lastKey = 0;
const newKey = (): string => { lastKey += 1; return `section-${lastKey}`; };

export function PageEditor({ detail, canManage, options, onBack, onDeleted }: {
  detail: PageDetail;
  canManage: boolean;
  options: MenuLinkOptions | undefined;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const id = useId();
  const save = useSavePageMutation(detail.id);
  const act = usePageActionMutation(detail.id);
  const remove = useDeletePageMutation();
  const [draft, setDraft] = useState<PageValues>(detail.draft);
  /** one key per section of the draft, in the same order */
  const [keys, setKeys] = useState<string[]>(() => detail.draft.sections.map(newKey));
  /** the server's copy the edits on the screen started from, and its version: every request goes out under this version */
  const [base, setBase] = useState({ draft: detail.draft, version: detail.version, status: detail.status });
  /** this screen itself asked for the change of version that is on its way (a save, «انتشار», «برگرداندن», «برداشتن») */
  const [own, setOwn] = useState(false);
  const [addKind, setAddKind] = useState<SectionKind>('text');
  const [asking, setAsking] = useState<'none' | 'revert' | 'unpublish' | 'delete'>('none');
  const [pickedTitles, setPickedTitles] = useState<Record<number, string>>({});

  const baseSlug = baseSlugOf(detail);
  const dirty = useMemo(() => canonical(draft) !== canonical(base.draft), [draft, base.draft]);
  const outdated = detail.version !== base.version;
  /**
   * The server's copy replaces the screen's when this screen itself moved the page's version, or when nothing here is
   * unsaved. A newer version from someone else, while there are unsaved edits, never overwrites them: the screen says
   * so, sends nothing under the old version, and waits for the colleague to choose.
   */
  const adopt = () => {
    setOwn(false);
    setBase({ draft: detail.draft, version: detail.version, status: detail.status });
    setDraft(detail.draft);
    // new keys: every section's editor starts again from the server's text
    setKeys(detail.draft.sections.map(newKey));
  };
  const adoptEvent = useEffectEvent(() => { if (outdated && (own || !dirty)) adopt(); });
  useEffect(() => { adoptEvent(); }, [detail.version]);
  /** another colleague changed the page while this screen holds unsaved edits */
  const stale = outdated && dirty && !own;

  const problem = useMemo(() => checkedPage(draft, { forPublish: false, baseSlug }).problem, [draft, baseSlug]);
  const notReady = useMemo(() => checkedPage(base.draft, { forPublish: true, baseSlug }).problem, [base.draft, baseSlug]);
  const busy = save.isPending || act.isPending || remove.isPending;
  const disabled = !canManage || busy;
  const onSite = base.status !== 'draft';

  const assets: AssetTitles = {
    titleOf: assetId => (assetId === null ? '' : (pickedTitles[assetId] ?? detail.assets.find(a => a.assetId === assetId)?.title ?? '')),
    unusable: assetId => assetId !== null && detail.assets.some(a => a.assetId === assetId && !a.usable),
    remember: (assetId, title) => setPickedTitles(titles => ({ ...titles, [assetId]: title })),
  };
  const set = <K extends keyof PageValues>(key: K, value: PageValues[K]) => setDraft(d => ({ ...d, [key]: value }));
  const setSection = (index: number, next: PageSection) => setDraft(d => ({ ...d, sections: d.sections.map((s, i) => (i === index ? next : s)) }));
  const moved = <T,>(list: readonly T[], from: number, to: number): T[] => {
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };
  // a section and its key always move, come and go together
  const moveSection = (from: number, to: number) => {
    setDraft(d => ({ ...d, sections: moved(d.sections, from, to) }));
    setKeys(k => moved(k, from, to));
  };
  const removeSection = (index: number) => {
    setDraft(d => ({ ...d, sections: d.sections.filter((_, i) => i !== index) }));
    setKeys(k => k.filter((_, i) => i !== index));
  };
  const addSection = (kind: SectionKind) => {
    setDraft(d => ({ ...d, sections: [...d.sections, emptySection(kind)] }));
    setKeys(k => [...k, newKey()]);
  };
  const kinds = SECTION_KINDS.filter(kind => kind !== 'shippingMethods' || (baseSlug === SHIPPING_SECTION_PAGE && !draft.sections.some(s => s.kind === 'shippingMethods')));

  // a request started from a button, the form's own submit or a second click runs once (AGENTS.md §6.4)
  const sending = useRef(false);
  const submit = () => {
    if (sending.current || !canManage || !dirty || problem || stale) return;
    sending.current = true;
    setOwn(true);
    save.mutate({ ...draft, version: base.version }, {
      onSuccess: () => toast.success('پیش‌نویس ذخیره شد. سایت تا «انتشار» عوض نمی‌شود.'),
      onError: (err) => { setOwn(false); toast.error(errorMessageOf(err)); },
      onSettled: () => { sending.current = false; },
    });
  };
  const DONE: Readonly<Record<PageAction, string>> = {
    publish: 'صفحه روی سایت منتشر شد.', revert: 'پیش‌نویس به نسخهٔ روی سایت برگشت.', unpublish: 'صفحه از روی سایت برداشته شد.',
  };
  // «انتشار», «برگرداندن» and «برداشتن» act on the saved draft, so they wait for a screen with nothing unsaved and
  // always go out under the version this screen has read
  const run = (action: PageAction) => {
    setAsking('none');
    if (sending.current || dirty || outdated) return;
    sending.current = true;
    setOwn(true);
    act.mutate({ action, version: base.version }, {
      onSuccess: () => toast.success(DONE[action]),
      onError: (err) => { setOwn(false); toast.error(errorMessageOf(err)); },
      onSettled: () => { sending.current = false; },
    });
  };
  const removePage = () => {
    setAsking('none');
    if (sending.current || outdated) return;
    sending.current = true;
    remove.mutate({ id: detail.id, version: base.version }, {
      onSuccess: () => { toast.success('صفحه حذف شد.'); onDeleted(); },
      onError: err => toast.error(errorMessageOf(err)),
      onSettled: () => { sending.current = false; },
    });
  };
  const menu = useRef<HTMLDetailsElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const ask = (what: 'revert' | 'unpublish' | 'delete') => {
    // the menu closes, so it never covers the question it opened
    if (menu.current) menu.current.open = false;
    setAsking(what);
  };
  // the question takes the focus, so a screen reader reads it and the keyboard is on its buttons
  useEffect(() => { if (asking !== 'none') confirmation.current?.focus(); }, [asking]);

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">
          <ArrowRight className="h-4 w-4" />
          همهٔ صفحه‌ها
        </button>
        <h2 className="min-w-0 flex-1 truncate text-base font-black text-slate-800">{detail.title}</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${base.status === 'published' ? 'bg-emerald-50 text-emerald-800' : base.status === 'changed' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
          {PAGE_STATUS_TITLES[base.status]}
        </span>
      </div>

      <fieldset disabled={disabled} className="space-y-5">
        <section aria-label="مشخصات صفحه" className={card}>
          <h3 className="text-sm font-black text-slate-800">مشخصات صفحه</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${id}-title`} className={label}>عنوان صفحه</label>
              <input id={`${id}-title`} className={field} maxLength={PAGE_TITLE_MAX} value={draft.title} onChange={e => set('title', e.target.value)} />
            </div>
            <div>
              <label htmlFor={`${id}-slug`} className={label}>نشانی لاتین</label>
              <input id={`${id}-slug`} dir="ltr" className={field} maxLength={PAGE_SLUG_MAX} value={draft.slug} disabled={detail.kind === 'base' || onSite} onChange={e => set('slug', e.target.value)} />
              <p className={hint}>
                {detail.kind === 'base' ? 'نشانی صفحه‌های پایهٔ سایت عوض نمی‌شود.'
                  : onSite ? 'نشانی صفحه‌ای که روی سایت است عوض نمی‌شود؛ برای عوض کردنش، نخست صفحه را از روی سایت بردارید.'
                    : 'حرف کوچک انگلیسی، رقم و خط تیره، مانند our-story.'}
              </p>
            </div>
            <div>
              <label htmlFor={`${id}-seo-title`} className={label}>عنوان جست‌وجو (اختیاری)</label>
              <input id={`${id}-seo-title`} className={field} maxLength={PAGE_SEO_TITLE_MAX} value={draft.seoTitle} onChange={e => set('seoTitle', e.target.value)} />
              <p className={hint}>اگر خالی بماند، عنوان صفحه در نتیجهٔ موتور جست‌وجو می‌آید.</p>
            </div>
            <div>
              <label htmlFor={`${id}-seo-description`} className={label}>توضیح جست‌وجو (اختیاری)</label>
              <input id={`${id}-seo-description`} className={field} maxLength={PAGE_SEO_DESCRIPTION_MAX} value={draft.seoDescription} onChange={e => set('seoDescription', e.target.value)} />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
            <input type="checkbox" checked={draft.noindex} onChange={e => set('noindex', e.target.checked)} />
            این صفحه در موتور جست‌وجو نیاید
          </label>
          <LibraryImageField label="تصویر اشتراک‌گذاری (اختیاری)" value={draft.shareImageAssetId} title={assets.titleOf(draft.shareImageAssetId)}
            unusable={assets.unusable(draft.shareImageAssetId)}
            onChange={(assetId, title) => { if (assetId !== null) assets.remember(assetId, title); set('shareImageAssetId', assetId); }} />
        </section>

        <section aria-label="بخش‌های صفحه" className="space-y-3">
          <h3 className="text-sm font-black text-slate-800">بخش‌های صفحه</h3>
          {draft.sections.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-xs text-slate-500">این صفحه هنوز بخشی ندارد. نخستین بخش را از پایین بیفزایید.</p>}
          <ol className="space-y-3">
            {draft.sections.map((section, index) => {
              const name = `بخش ${formatPersianNumber(index + 1)}، ${SECTION_KIND_TITLES[section.kind]}`;
              return (
                <li key={keys[index] ?? index} aria-label={name} className={`${card} ${problem?.section === index ? 'border-rose-400' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 text-sm font-black text-slate-800">{name}</p>
                    <label htmlFor={`${id}-background-${index}`} className="text-xs font-bold text-slate-700">زمینه</label>
                    <select id={`${id}-background-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs" value={section.background}
                      onChange={e => setSection(index, { ...section, background: e.target.value as SectionBackground })}>
                      {SECTION_BACKGROUNDS.map(background => <option key={background} value={background}>{SECTION_BACKGROUND_TITLES[background]}</option>)}
                    </select>
                    <button type="button" className={iconButton} disabled={index === 0} aria-label={`${name}: بالا`} onClick={() => moveSection(index, index - 1)}><ArrowUp className="h-4 w-4" /></button>
                    <button type="button" className={iconButton} disabled={index === draft.sections.length - 1} aria-label={`${name}: پایین`} onClick={() => moveSection(index, index + 1)}><ArrowDown className="h-4 w-4" /></button>
                    <button type="button" className={`${iconButton} text-rose-600`} aria-label={`حذف ${name}`} onClick={() => removeSection(index)}><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <SectionFields section={section} name={`بخش ${formatPersianNumber(index + 1)}`} disabled={disabled} assets={assets} options={options} onChange={next => setSection(index, next)} />
                </li>
              );
            })}
          </ol>
          {canManage && (
            <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-3">
              <div>
                <label htmlFor={`${id}-add`} className={label}>بخش تازه</label>
                <select id={`${id}-add`} className={field} value={kinds.includes(addKind) ? addKind : kinds[0]} onChange={e => setAddKind(e.target.value as SectionKind)}>
                  {kinds.map(kind => <option key={kind} value={kind}>{SECTION_KIND_TITLES[kind]}</option>)}
                </select>
              </div>
              <button type="button" disabled={draft.sections.length >= PAGE_SECTIONS_MAX}
                onClick={() => addSection(kinds.includes(addKind) ? addKind : kinds[0])}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-40">
                <Plus className="h-4 w-4" />
                افزودن بخش
              </button>
            </div>
          )}
        </section>
      </fieldset>

      {stale && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="min-w-0 flex-1">همکار دیگری این صفحه را در همین فاصله عوض کرده است. تغییرهای شما ذخیره نشده و روی نسخهٔ پیشین است.</p>
          <button type="button" onClick={adopt} className="rounded-lg bg-amber-800 px-3 py-1.5 font-bold text-white">خواندن نسخهٔ تازه و دور ریختن تغییرهای من</button>
        </div>
      )}
      {problem && <p role="alert" className="text-xs text-rose-700">{problem.section >= 0 ? `بخش ${formatPersianNumber(problem.section + 1)}: ${problem.message}` : problem.message}</p>}
      {canManage && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy || !dirty || Boolean(problem) || stale} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              <Save className="h-4 w-4" />
              {save.isPending ? 'در حال ذخیره…' : 'ذخیرهٔ پیش‌نویس'}
            </button>
            <button type="button" disabled={busy || dirty || outdated || base.status === 'published' || Boolean(notReady)} onClick={() => run('publish')}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              <Send className="h-4 w-4" />
              انتشار روی سایت
            </button>
            <details ref={menu} className="relative">
              <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700" aria-label="کارهای دیگر این صفحه">
                <MoreVertical className="h-4 w-4" />
                کارهای دیگر
              </summary>
              <div className="absolute end-0 z-10 mt-1 w-64 space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                <button type="button" disabled={busy || dirty || outdated || base.status !== 'changed'} onClick={() => ask('revert')} className="block w-full rounded-lg px-3 py-2 text-start text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40">برگرداندن به نسخهٔ روی سایت</button>
                <button type="button" disabled={busy || dirty || outdated || !onSite} onClick={() => ask('unpublish')} className="block w-full rounded-lg px-3 py-2 text-start text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40">برداشتن از روی سایت</button>
                {detail.kind === 'custom' && (
                  <button type="button" disabled={busy || outdated} onClick={() => ask('delete')} className="block w-full rounded-lg px-3 py-2 text-start text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40">حذف صفحه</button>
                )}
              </div>
            </details>
          </div>
          {dirty && <p className="text-xs text-slate-500">تغییرهای این صفحه هنوز ذخیره نشده‌اند؛ «انتشار»، «برگرداندن» و «برداشتن از روی سایت» پس از ذخیرهٔ پیش‌نویس روشن می‌شوند.</p>}
          {!dirty && base.status !== 'published' && notReady && (
            <p className="text-xs text-amber-800">{`برای انتشار: ${notReady.section >= 0 ? `بخش ${formatPersianNumber(notReady.section + 1)}، ` : ''}${notReady.message.replace(/^بخش [۰-۹]+: /, '')}`}</p>
          )}
          {asking !== 'none' && (
            <div ref={confirmation} tabIndex={-1} role="group" aria-label="تأیید این کار" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="min-w-0 flex-1">
                {asking === 'revert' && 'تغییرهای پیش‌نویس دور ریخته می‌شود و پیش‌نویس همان نسخهٔ روی سایت می‌شود.'}
                {asking === 'unpublish' && (detail.kind === 'base' ? 'این صفحه از روی سایت برداشته می‌شود و سایت متن ثابت پیشین خودش را برای آن نشان می‌دهد. پیش‌نویس می‌ماند.' : 'این صفحه از روی سایت برداشته می‌شود و نشانی‌اش «پیدا نشد» می‌شود. پیش‌نویس می‌ماند.')}
                {asking === 'delete' && `این صفحه حذف می‌شود و اگر روی سایت باشد از آن‌جا هم برداشته می‌شود.${dirty ? ' تغییرهای ذخیره‌نشدهٔ آن هم از میان می‌رود.' : ''}`}
              </p>
              <button type="button" disabled={busy} onClick={() => (asking === 'delete' ? removePage() : run(asking))} className="rounded-lg bg-amber-800 px-3 py-1.5 font-bold text-white disabled:opacity-50">بله، انجام شود</button>
              <button type="button" onClick={() => setAsking('none')} className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 font-bold">انصراف</button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
