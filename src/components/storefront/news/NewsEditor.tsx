import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, MoreVertical, Plus, Save, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useDeleteNewsMutation, useNewsActionMutation, useSaveNewsMutation, type NewsAction } from '../../../hooks/queries/useStorefrontNewsQueries';
import type { NewsDetail } from '../../../lib/storefront/storefrontNewsContracts';
import { NEWS_SECTION_KINDS, NEWS_SUMMARY_MAX, checkedNews, type NewsValues } from '../../../lib/storefront/storefrontNewsRules';
import { PAGE_STATUS_TITLES } from '../../../lib/storefront/storefrontPageContracts';
import {
  PAGE_SECTIONS_MAX, PAGE_SEO_DESCRIPTION_MAX, PAGE_SEO_TITLE_MAX, PAGE_SLUG_MAX, PAGE_TITLE_MAX, SECTION_KIND_TITLES, emptySection, type PageSection, type SectionKind,
} from '../../../lib/storefront/storefrontPageRules';
import { JalaliDateInput } from '../../common/JalaliDateInput';
import { formatPersianNumber } from '../../../utils/persianNumber';
import { errorMessageOf, formatPersianDate } from '../../../utils';
import { LibraryImageField } from '../pages/LibraryImageField';
import { SectionFields, type AssetTitles } from '../pages/SectionFields';

/**
 * v12 phase 10d (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the editor of one news item of the site. It works as
 * the page builder does (`PageEditor.tsx`): «ذخیرهٔ پیش‌نویس» never changes the site, «انتشار» puts the saved draft on
 * the site, «برگرداندن» throws the draft's changes away, and the rules the server checks with (`checkedNews`) run here
 * first. The body is made of «متن» and «گالری تصاویر» parts. A day to come puts the item on the site that day.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';
const hint = 'mt-1 text-xs leading-6 text-slate-500';
const card = 'rounded-2xl border border-slate-200 bg-white p-5 space-y-3';
const iconButton = 'rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30';
const menuItem = 'block w-full rounded-lg px-3 py-2 text-start text-xs font-bold hover:bg-slate-50 disabled:opacity-40';

/** the keys of an object in one order, so two copies of a draft compare by what they hold */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, inner: unknown) => (
  inner && typeof inner === 'object' && !Array.isArray(inner)
    ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : inner
));
let lastKey = 0;
const newKey = (): string => { lastKey += 1; return `news-part-${lastKey}`; };
const DONE: Readonly<Record<NewsAction, string>> = { publish: 'خبر روی سایت منتشر شد.', revert: 'پیش‌نویس به نسخهٔ روی سایت برگشت.', unpublish: 'خبر از روی سایت برداشته شد.' };
const QUESTION = {
  revert: 'تغییرهای پیش‌نویس دور ریخته می‌شود و پیش‌نویس همان نسخهٔ روی سایت می‌شود.',
  unpublish: 'این خبر از روی سایت برداشته می‌شود و نشانی‌اش «پیدا نشد» می‌شود. پیش‌نویس می‌ماند.',
  delete: 'این خبر حذف می‌شود و اگر روی سایت باشد از آن‌جا هم برداشته می‌شود.',
} as const;

export function NewsEditor({ detail, canManage, onBack, onDeleted }: { detail: NewsDetail; canManage: boolean; onBack: () => void; onDeleted: () => void }) {
  const id = useId();
  const save = useSaveNewsMutation(detail.id);
  const act = useNewsActionMutation(detail.id);
  const remove = useDeleteNewsMutation();
  const [draft, setDraft] = useState<NewsValues>(detail.draft);
  const [keys, setKeys] = useState<string[]>(() => detail.draft.sections.map(newKey));
  /** the server's copy the edits on the screen started from, and its version: every request goes out under this version */
  const [base, setBase] = useState({ draft: detail.draft, version: detail.version, status: detail.status });
  /** this screen itself asked for the change of version that is on its way */
  const [own, setOwn] = useState(false);
  const [addKind, setAddKind] = useState<SectionKind>('text');
  const [asking, setAsking] = useState<'none' | keyof typeof QUESTION>('none');
  const [pickedTitles, setPickedTitles] = useState<Record<number, string>>({});

  const dirty = useMemo(() => canonical(draft) !== canonical(base.draft), [draft, base.draft]);
  const outdated = detail.version !== base.version;
  // the server's copy replaces the screen's when this screen moved the version itself or nothing here is unsaved; a
  // colleague's newer version never overwrites unsaved edits (as in the page builder)
  const adopt = () => {
    setOwn(false);
    setBase({ draft: detail.draft, version: detail.version, status: detail.status });
    setDraft(detail.draft);
    setKeys(detail.draft.sections.map(newKey));
  };
  const adoptEvent = useEffectEvent(() => { if (outdated && (own || !dirty)) adopt(); });
  useEffect(() => { adoptEvent(); }, [detail.version]);
  const stale = outdated && dirty && !own;

  const problem = useMemo(() => checkedNews(draft, { forPublish: false }).problem, [draft]);
  const notReady = useMemo(() => checkedNews(base.draft, { forPublish: true }).problem, [base.draft]);
  const busy = save.isPending || act.isPending || remove.isPending;
  const disabled = !canManage || busy;
  const onSite = base.status !== 'draft';

  const assets: AssetTitles = {
    titleOf: assetId => (assetId === null ? '' : (pickedTitles[assetId] ?? detail.assets.find(a => a.assetId === assetId)?.title ?? '')),
    unusable: assetId => assetId !== null && detail.assets.some(a => a.assetId === assetId && !a.usable),
    remember: (assetId, title) => setPickedTitles(titles => ({ ...titles, [assetId]: title })),
  };
  const set = <K extends keyof NewsValues>(key: K, value: NewsValues[K]) => setDraft(d => ({ ...d, [key]: value }));
  const setSection = (index: number, next: PageSection) => setDraft(d => ({ ...d, sections: d.sections.map((s, i) => (i === index ? next : s)) }));
  const moved = <T,>(list: readonly T[], from: number, to: number): T[] => {
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };
  const moveSection = (from: number, to: number) => { setDraft(d => ({ ...d, sections: moved(d.sections, from, to) })); setKeys(k => moved(k, from, to)); };
  const removeSection = (index: number) => { setDraft(d => ({ ...d, sections: d.sections.filter((_, i) => i !== index) })); setKeys(k => k.filter((_, i) => i !== index)); };
  const addSection = (kind: SectionKind) => { setDraft(d => ({ ...d, sections: [...d.sections, emptySection(kind)] })); setKeys(k => [...k, newKey()]); };

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
  const run = (action: NewsAction) => {
    setAsking('none');
    if (sending.current || dirty || outdated) return;
    sending.current = true;
    setOwn(true);
    act.mutate({ action, version: base.version }, {
      // an action that changed nothing leaves the version as it was: the next version is then not this screen's own
      onSuccess: (after) => {
        if (after.version === base.version) setOwn(false);
        toast.success(action === 'publish' && after.scheduled ? 'خبر منتشر شد و در روز خودش روی سایت می‌آید.' : DONE[action]);
      },
      onError: (err) => { setOwn(false); toast.error(errorMessageOf(err)); },
      onSettled: () => { sending.current = false; },
    });
  };
  const removeNews = () => {
    setAsking('none');
    if (sending.current || outdated) return;
    sending.current = true;
    remove.mutate({ id: detail.id, version: base.version }, {
      onSuccess: () => { toast.success('خبر حذف شد.'); onDeleted(); },
      onError: err => toast.error(errorMessageOf(err)),
      onSettled: () => { sending.current = false; },
    });
  };
  const menu = useRef<HTMLDetailsElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const ask = (what: keyof typeof QUESTION) => {
    if (menu.current) menu.current.open = false;
    setAsking(what);
  };
  useEffect(() => { if (asking !== 'none') confirmation.current?.focus(); }, [asking]);

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">
          <ArrowRight className="h-4 w-4" />
          همهٔ خبرها
        </button>
        <h2 className="min-w-0 flex-1 truncate text-base font-black text-slate-800">{detail.title}</h2>
        {detail.scheduled && <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-800">در نوبت انتشار</span>}
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${base.status === 'published' ? 'bg-emerald-50 text-emerald-800' : base.status === 'changed' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
          {PAGE_STATUS_TITLES[base.status]}
        </span>
      </div>

      <fieldset disabled={disabled} className="space-y-5">
        <section aria-label="مشخصات خبر" className={card}>
          <h3 className="text-sm font-black text-slate-800">مشخصات خبر</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={`${id}-title`} className={label}>عنوان خبر</label>
              <input id={`${id}-title`} className={field} maxLength={PAGE_TITLE_MAX} value={draft.title} onChange={e => set('title', e.target.value)} />
            </div>
            <div>
              <label htmlFor={`${id}-slug`} className={label}>نشانی لاتین</label>
              <input id={`${id}-slug`} dir="ltr" className={field} maxLength={PAGE_SLUG_MAX} value={draft.slug} disabled={onSite} onChange={e => set('slug', e.target.value)} />
              <p className={hint}>{onSite ? 'این خبر روی سایت است؛ نشانی آن تا برداشتن از روی سایت عوض نمی‌شود.' : 'حرف کوچک انگلیسی، رقم و خط تیره، مانند new-collection.'}</p>
            </div>
            <div>
              <label htmlFor={`${id}-date`} className={label}>تاریخ خبر (اختیاری)</label>
              <JalaliDateInput id={`${id}-date`} className={field} value={draft.newsDate} onChange={iso => set('newsDate', iso)} disabled={disabled} />
              <p className={hint}>اگر خالی بماند، روز انتشار نوشته می‌شود. با تاریخی در آینده، خبر پس از «انتشار» در همان روز خودش روی سایت می‌آید.</p>
              {detail.publishedDate && detail.publishedDate !== draft.newsDate && <p className={hint}>{`تاریخ این خبر روی سایت: ${formatPersianDate(detail.publishedDate)}`}</p>}
            </div>
            <div>
              <label htmlFor={`${id}-summary`} className={label}>خلاصه (اختیاری)</label>
              <textarea id={`${id}-summary`} rows={3} className={field} maxLength={NEWS_SUMMARY_MAX} value={draft.summary} onChange={e => set('summary', e.target.value)} />
              <p className={hint}>چند خط برای فهرست خبرها؛ اگر خالی بماند، آغاز متن خبر می‌آید.</p>
            </div>
            <div>
              <label htmlFor={`${id}-seo-title`} className={label}>عنوان جست‌وجو (اختیاری)</label>
              <input id={`${id}-seo-title`} className={field} maxLength={PAGE_SEO_TITLE_MAX} value={draft.seoTitle} onChange={e => set('seoTitle', e.target.value)} />
            </div>
            <div>
              <label htmlFor={`${id}-seo-description`} className={label}>توضیح جست‌وجو (اختیاری)</label>
              <input id={`${id}-seo-description`} className={field} maxLength={PAGE_SEO_DESCRIPTION_MAX} value={draft.seoDescription} onChange={e => set('seoDescription', e.target.value)} />
            </div>
          </div>
          <LibraryImageField label="تصویر شاخص (اختیاری)" value={draft.coverAssetId} title={assets.titleOf(draft.coverAssetId)} unusable={assets.unusable(draft.coverAssetId)}
            onChange={(assetId, title) => { if (assetId !== null) assets.remember(assetId, title); set('coverAssetId', assetId); }} />
        </section>

        <section aria-label="متن خبر" className="space-y-3">
          <h3 className="text-sm font-black text-slate-800">متن خبر</h3>
          {draft.sections.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-xs text-slate-500">این خبر هنوز متنی ندارد. نخستین بخش را از پایین بیفزایید.</p>}
          <ol className="space-y-3">
            {draft.sections.map((section, index) => {
              const name = `بخش ${formatPersianNumber(index + 1)}، ${SECTION_KIND_TITLES[section.kind]}`;
              return (
                <li key={keys[index] ?? index} aria-label={name} className={`${card} ${problem?.section === index ? 'border-rose-400' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 text-sm font-black text-slate-800">{name}</p>
                    <button type="button" className={iconButton} disabled={index === 0} aria-label={`${name}: بالا`} onClick={() => moveSection(index, index - 1)}><ArrowUp className="h-4 w-4" /></button>
                    <button type="button" className={iconButton} disabled={index === draft.sections.length - 1} aria-label={`${name}: پایین`} onClick={() => moveSection(index, index + 1)}><ArrowDown className="h-4 w-4" /></button>
                    <button type="button" className={`${iconButton} text-rose-600`} aria-label={`حذف ${name}`} onClick={() => removeSection(index)}><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <SectionFields section={section} name={`بخش ${formatPersianNumber(index + 1)}`} disabled={disabled} assets={assets} options={undefined} onChange={next => setSection(index, next)} />
                </li>
              );
            })}
          </ol>
          {canManage && (
            <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-3">
              <div>
                <label htmlFor={`${id}-add`} className={label}>بخش تازه</label>
                <select id={`${id}-add`} className={field} value={addKind} onChange={e => setAddKind(e.target.value as SectionKind)}>
                  {NEWS_SECTION_KINDS.map(kind => <option key={kind} value={kind}>{SECTION_KIND_TITLES[kind]}</option>)}
                </select>
              </div>
              <button type="button" disabled={draft.sections.length >= PAGE_SECTIONS_MAX} onClick={() => addSection(addKind)}
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
          <p className="min-w-0 flex-1">همکار دیگری این خبر را در همین فاصله عوض کرده است. تغییرهای شما ذخیره نشده و روی نسخهٔ پیشین است.</p>
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
              <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700" aria-label="کارهای دیگر این خبر">
                <MoreVertical className="h-4 w-4" />
                کارهای دیگر
              </summary>
              <div className="absolute end-0 z-10 mt-1 w-64 space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                <button type="button" disabled={busy || dirty || outdated || base.status !== 'changed'} onClick={() => ask('revert')} className={`${menuItem} text-slate-700`}>برگرداندن به نسخهٔ روی سایت</button>
                <button type="button" disabled={busy || dirty || outdated || !onSite} onClick={() => ask('unpublish')} className={`${menuItem} text-slate-700`}>برداشتن از روی سایت</button>
                <button type="button" disabled={busy || outdated} onClick={() => ask('delete')} className={`${menuItem} text-rose-700`}>حذف خبر</button>
              </div>
            </details>
          </div>
          {dirty && <p className="text-xs text-slate-500">تغییرهای این خبر هنوز ذخیره نشده‌اند؛ «انتشار»، «برگرداندن» و «برداشتن از روی سایت» پس از ذخیرهٔ پیش‌نویس در دسترس‌اند.</p>}
          {!dirty && base.status !== 'published' && notReady && (
            <p className="text-xs text-amber-800">{`برای انتشار: ${notReady.section >= 0 ? `بخش ${formatPersianNumber(notReady.section + 1)}، ` : ''}${notReady.message.replace(/^بخش [۰-۹]+: /, '')}`}</p>
          )}
          {asking !== 'none' && (
            <div ref={confirmation} tabIndex={-1} role="group" aria-label="تأیید این کار" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="min-w-0 flex-1">{`${QUESTION[asking]}${asking === 'delete' && dirty ? ' تغییرهای ذخیره‌نشدهٔ آن هم از میان می‌رود.' : ''}`}</p>
              <button type="button" disabled={busy} onClick={() => (asking === 'delete' ? removeNews() : run(asking))} className="rounded-lg bg-amber-800 px-3 py-1.5 font-bold text-white disabled:opacity-50">بله، انجام شود</button>
              <button type="button" onClick={() => setAsking('none')} className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 font-bold">انصراف</button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
