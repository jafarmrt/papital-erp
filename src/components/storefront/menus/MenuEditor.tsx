import { useId, useRef, useState } from 'react';
import { Plus, RotateCcw, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSaveMenuMutation } from '../../../hooks/queries/useStorefrontMenuQueries';
import type { MenuItemRow, MenuLinkOptions, MenuView } from '../../../lib/storefront/storefrontMenuContracts';
import {
  MENU_CHILDREN_MAX, MENU_LOCATION_HINTS, MENU_LOCATION_TITLES, MENU_TOP_MAX, currentSiteMenu, menuProblem, normalizedMenuItem,
  type MenuItemValues,
} from '../../../lib/storefront/storefrontMenuRules';
import { errorMessageOf } from '../../../utils';
import { formatPersianDateTime } from '../../../utils/dateUtils';
import { MenuItemFields, type DraftItem } from './MenuItemFields';

let nextKey = 0;
const keyOf = () => `item-${++nextKey}`;

function draftOf(item: MenuItemValues | MenuItemRow): DraftItem {
  return {
    key: keyOf(), id: item.id || null, label: item.label, kind: item.kind, target: item.target, itemId: item.itemId,
    campaignId: item.campaignId, pageId: item.pageId, targetTitle: 'targetTitle' in item ? item.targetTitle : '', icon: item.icon, isActive: item.isActive,
    children: item.children.map(draftOf),
  };
}

const blank = (): DraftItem => ({
  key: keyOf(), id: null, label: '', kind: 'page', target: '', itemId: null, campaignId: null, pageId: null, icon: '', isActive: true, children: [],
});

function moved<T>(list: T[], index: number, step: -1 | 1): T[] {
  const to = index + step;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** One place of the site's menu, edited whole and saved under its version */
export function MenuEditor({ view, options, canManage }: { view: MenuView; options: MenuLinkOptions | undefined; canManage: boolean }) {
  const id = useId();
  const save = useSaveMenuMutation();
  const saving = useRef(false);
  const [enabled, setEnabledState] = useState(view.enabled);
  const [items, setItemsState] = useState<DraftItem[]>(() => view.items.map(draftOf));
  // 9b review: the draft survives a refetch. `base` is the saved menu this draft started from (its version goes with the
  // save); a newer saved menu replaces an untouched draft, and an edited one keeps it with a notice and a choice.
  const [base, setBase] = useState(view);
  const [dirty, setDirty] = useState(false);
  // only a newer saved menu: right after a save the list still holds the older one until it is read again (9b review)
  if (view !== base && view.version > base.version && !dirty) {
    setBase(view);
    setEnabledState(view.enabled);
    setItemsState(view.items.map(draftOf));
  }
  const newerSaved = view.version > base.version && dirty;
  const setEnabled = (value: boolean) => { setDirty(true); setEnabledState(value); };
  const setItems = (change: (list: DraftItem[]) => DraftItem[]) => { setDirty(true); setItemsState(change); };
  const takeSaved = () => { setDirty(false); setBase(view); setEnabledState(view.enabled); setItemsState(view.items.map(draftOf)); };
  const location = view.location;
  const liveById = new Map(view.items.flatMap(i => [i, ...i.children]).map(i => [i.id, i.live]));

  const setTop = (index: number, patch: Partial<DraftItem>) => setItems(list => list.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  const setChildren = (index: number, change: (children: DraftItem[]) => DraftItem[]) =>
    setItems(list => list.map((it, i) => (i === index ? { ...it, children: change(it.children) } : it)));

  const values = () => items.map(it => normalizedMenuItem(location, it));
  const problem = menuProblem(location, values(), enabled);

  const submit = () => {
    if (saving.current || !canManage) return;
    if (problem) {
      toast.error(problem.message);
      return;
    }
    saving.current = true;
    save.mutate({ location, input: { enabled, version: base.version, items: values().map(({ children, ...it }) => ({ ...it, children: children.map(({ children: _none, ...c }) => c) })) } }, {
      onSuccess: (saved) => {
        setDirty(false);
        setBase(saved);
        setEnabledState(saved.enabled);
        setItemsState(saved.items.map(draftOf));
        toast.success(`${MENU_LOCATION_TITLES[location]} ذخیره شد.`);
      },
      onError: (error) => toast.error(errorMessageOf(error)),
      onSettled: () => { saving.current = false; },
    });
  };

  const startFromSite = () => setItems(() => currentSiteMenu(location, {
    categories: Array.isArray(options?.categories) ? options.categories : [],
    collections: Array.isArray(options?.collections) ? options.collections : [],
  }).map(draftOf));

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <p className="text-xs leading-6 text-slate-600">{MENU_LOCATION_HINTS[location]}</p>
      {newerSaved && (
        <div role="alert" className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p>این منو پس از باز شدن این صفحه در جای دیگری ذخیره شد. تغییرهای شما هنوز اینجاست و ذخیره نشده است.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={takeSaved} className="rounded-lg border border-amber-400 bg-white px-3 py-1 font-bold">کنار گذاشتن تغییرهای من</button>
            <button type="button" onClick={() => setBase(view)} className="rounded-lg bg-amber-700 px-3 py-1 font-bold text-white">نگه داشتن تغییرهای من برای ذخیره به جای آن</button>
          </div>
        </div>
      )}
      <fieldset disabled={!canManage || save.isPending} className="space-y-4">
        <div className={`rounded-2xl border p-4 ${enabled ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
          <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-800">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            این منو روی سایت بیاید
          </label>
          <p className="mt-1 text-xs text-slate-600">
            {view.enabled ? 'اکنون سایت همین منو را نشان می‌دهد.' : 'اکنون سایت منوی ثابت خودش را نشان می‌دهد؛ تا این را روشن و ذخیره نکنید، تغییرها روی سایت نمی‌آیند.'}
            {' '}هر تغییر حداکثر یک دقیقه بعد روی سایت دیده می‌شود.
          </p>
        </div>

        <div className="space-y-3">
          {items.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">هنوز گزینه‌ای ندارد.</p>}
          {items.map((item, index) => (
            <div key={item.key} className="space-y-2">
              <MenuItemFields
                id={`${id}-${item.key}`} item={item} location={location} child={false} options={options}
                notOnSite={item.id !== null && item.isActive && liveById.get(item.id) === false}
                first={index === 0} last={index === items.length - 1}
                onChange={patch => setTop(index, patch)} onMove={step => setItems(list => moved(list, index, step))}
                onRemove={() => setItems(list => list.filter((_, i) => i !== index))}
                onAddChild={location === 'bottom' || item.children.length >= MENU_CHILDREN_MAX ? undefined : () => setChildren(index, c => [...c, blank()])}
              />
              {item.children.length > 0 && (
                <div className="ms-6 space-y-2 border-s-2 border-slate-200 ps-3">
                  {item.children.map((child, childIndex) => (
                    <MenuItemFields
                      key={child.key} id={`${id}-${child.key}`} item={child} location={location} child options={options}
                      notOnSite={child.id !== null && child.isActive && liveById.get(child.id) === false}
                      first={childIndex === 0} last={childIndex === item.children.length - 1}
                      onChange={patch => setChildren(index, c => c.map((it, i) => (i === childIndex ? { ...it, ...patch } : it)))}
                      onMove={step => setChildren(index, c => moved(c, childIndex, step))}
                      onRemove={() => setChildren(index, c => c.filter((_, i) => i !== childIndex))}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={items.length >= MENU_TOP_MAX[location]} onClick={() => setItems(list => [...list, { ...blank(), kind: location === 'footer' ? 'none' : 'page' }])}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-40">
            <Plus className="h-4 w-4" aria-hidden />
            {location === 'footer' ? 'افزودن ستون' : 'افزودن گزینه'}
          </button>
          <button type="button" onClick={startFromSite}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700">
            <RotateCcw className="h-4 w-4" aria-hidden />
            شروع از منوی کنونی سایت
          </button>
          <button type="submit" className="ms-auto inline-flex items-center gap-1 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50">
            <Save className="h-4 w-4" aria-hidden />
            {save.isPending ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </div>
        {canManage && problem && <p className="text-xs text-rose-700" role="status">{problem.message}</p>}
      </fieldset>
      {view.updatedBy && <p className="text-[11px] text-slate-500">{`آخرین ذخیره: ${view.updatedBy}، ${formatPersianDateTime(view.updatedAt)}`}</p>}
    </form>
  );
}
