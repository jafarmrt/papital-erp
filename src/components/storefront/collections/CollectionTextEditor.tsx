import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSaveCollectionTextMutation } from '../../../hooks/queries/useStorefrontCollectionQueries';
import type { CollectionTextList, CollectionTextRow } from '../../../lib/storefront/storefrontCollectionContracts';
import { COLLECTION_INTRO_MAX, checkedCollectionText, type CollectionTextValues } from '../../../lib/storefront/storefrontCollectionRules';
import { IMAGE_ALT_MAX } from '../../../lib/storefront/storefrontPageParts';
import { errorMessageOf } from '../../../utils';
import { formatPersianNumber } from '../../../utils/persianNumber';
import { LibraryImageField } from '../pages/LibraryImageField';

/**
 * v12 phase 10e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the words of one collection of the site: its
 * introduction, its image with an alternative text, and «آشنایی بیشتر», a link to a page of «صفحه‌های سایت». The rules
 * the server checks with (`checkedCollectionText`) run here first, and a save goes out under the version this form read.
 */
const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm';
const label = 'block text-xs font-bold text-slate-700 mb-1';
const hint = 'mt-1 text-xs leading-6 text-slate-500';
const valuesOf = (row: CollectionTextRow): CollectionTextValues => ({ name: row.name, intro: row.intro, imageAssetId: row.imageAssetId, imageAlt: row.imageAlt, morePageId: row.morePageId });
const same = (a: CollectionTextValues, b: CollectionTextValues) => a.intro === b.intro && a.imageAssetId === b.imageAssetId && a.imageAlt === b.imageAlt && a.morePageId === b.morePageId;

export function CollectionTextEditor({ row, pages, canManage }: { row: CollectionTextRow; pages: CollectionTextList['pages']; canManage: boolean }) {
  const id = useId();
  const save = useSaveCollectionTextMutation();
  const [draft, setDraft] = useState<CollectionTextValues>(() => valuesOf(row));
  /** the server's copy the edits started from, and its version */
  const [base, setBase] = useState({ values: valuesOf(row), version: row.version });
  const [pickedTitle, setPickedTitle] = useState('');
  const dirty = useMemo(() => !same(draft, base.values), [draft, base.values]);
  // only a newer copy counts: a list read that started before this form's own save may still arrive after it
  const outdated = row.version > base.version;
  // a newer copy from the server replaces the form only while nothing here is unsaved
  const adopt = () => {
    setBase({ values: valuesOf(row), version: row.version });
    setDraft(valuesOf(row));
    setPickedTitle('');
  };
  const adoptEvent = useEffectEvent(() => { if (outdated && !dirty) adopt(); });
  useEffect(() => { adoptEvent(); }, [row.version]);
  const staleCopy = outdated && dirty;
  const problem = useMemo(() => checkedCollectionText(draft).problem, [draft]);
  const set = <K extends keyof CollectionTextValues>(key: K, value: CollectionTextValues[K]) => setDraft(d => ({ ...d, [key]: value }));
  const pageList = Array.isArray(pages) ? pages : [];

  // a save started from the button, the form's own submit or a second click runs once (AGENTS.md §6.4)
  const sending = useRef(false);
  const submit = () => {
    if (sending.current || !canManage || !dirty || problem || staleCopy) return;
    sending.current = true;
    save.mutate({ ...draft, version: base.version }, {
      onSuccess: (saved) => {
        setBase({ values: valuesOf(saved), version: saved.version });
        setDraft(valuesOf(saved));
        toast.success(`متن و تصویر کالکشن «${row.name}» ذخیره شد.`);
      },
      onError: err => toast.error(errorMessageOf(err)),
      onSettled: () => { sending.current = false; },
    });
  };

  return (
    <form className="space-y-3" aria-label={`متن و تصویر کالکشن ${row.name}`} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <fieldset disabled={!canManage || save.isPending} className="space-y-3">
        <div>
          <label htmlFor={`${id}-intro`} className={label}>متن معرفی (اختیاری)</label>
          <textarea id={`${id}-intro`} rows={5} className={field} maxLength={COLLECTION_INTRO_MAX} value={draft.intro} onChange={e => set('intro', e.target.value)} />
          <p className={hint}>{`چند بند دربارهٔ این کالکشن؛ یک خط خالی بند تازه می‌سازد. حداکثر ${formatPersianNumber(COLLECTION_INTRO_MAX)} نویسه. بالای صفحهٔ کالکشن روی سایت می‌آید.`}</p>
        </div>
        <LibraryImageField label="تصویر کالکشن (اختیاری)" where={`کالکشن ${row.name}`} value={draft.imageAssetId}
          title={draft.imageAssetId === row.imageAssetId ? row.imageTitle : pickedTitle} unusable={draft.imageAssetId !== null && draft.imageAssetId === row.imageAssetId && !row.imageUsable}
          onChange={(assetId, title) => { setPickedTitle(title); setDraft(d => ({ ...d, imageAssetId: assetId, imageAlt: assetId === null ? '' : d.imageAlt })); }} />
        {draft.imageAssetId !== null && (
          <div>
            <label htmlFor={`${id}-alt`} className={label}>متن جایگزین تصویر (اختیاری)</label>
            <input id={`${id}-alt`} className={field} maxLength={IMAGE_ALT_MAX} value={draft.imageAlt} onChange={e => set('imageAlt', e.target.value)} />
            <p className={hint}>آنچه در عکس دیده می‌شود، برای کسی که عکس را نمی‌بیند. اگر خالی بماند، نام کالکشن گفته می‌شود.</p>
          </div>
        )}
        <div>
          <label htmlFor={`${id}-more`} className={label}>پیوند «آشنایی بیشتر» (اختیاری)</label>
          <select id={`${id}-more`} className={field} value={draft.morePageId ?? ''} onChange={e => set('morePageId', e.target.value ? Number(e.target.value) : null)}>
            <option value="">بی پیوند</option>
            {draft.morePageId !== null && !pageList.some(p => p.id === draft.morePageId) && <option value={draft.morePageId}>{row.morePageTitle || 'صفحه‌ای که حذف شده است'}</option>}
            {pageList.map(p => <option key={p.id} value={p.id}>{p.live ? p.title : `${p.title} (اکنون روی سایت نیست)`}</option>)}
          </select>
          <p className={hint}>صفحه‌ای از «صفحه‌های سایت» که دربارهٔ این کالکشن بیشتر می‌گوید. پیوند فقط وقتی روی سایت می‌آید که آن صفحه منتشر باشد.</p>
        </div>
      </fieldset>
      {staleCopy && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="min-w-0 flex-1">همکار دیگری متن این کالکشن را در همین فاصله عوض کرده است. تغییرهای شما ذخیره نشده و روی نسخهٔ پیشین است.</p>
          <button type="button" onClick={adopt} className="rounded-lg bg-amber-800 px-3 py-1.5 font-bold text-white">خواندن نسخهٔ تازه و دور ریختن تغییرهای من</button>
        </div>
      )}
      {problem && <p role="alert" className="text-xs text-rose-700">{problem.message}</p>}
      {canManage && (
        <button type="submit" disabled={save.isPending || !dirty || Boolean(problem) || staleCopy} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          <Save className="h-4 w-4" />
          {save.isPending ? 'در حال ذخیره…' : 'ذخیره'}
        </button>
      )}
    </form>
  );
}
