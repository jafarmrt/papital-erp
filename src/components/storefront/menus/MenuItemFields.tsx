import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { MenuLinkOptions } from '../../../lib/storefront/storefrontMenuContracts';
import {
  MENU_ICONS, MENU_ICON_TITLES, MENU_LINK_KINDS, MENU_LINK_KIND_TITLES, MENU_SITE_PAGES, MENU_SITE_PAGE_KEYS,
  type MenuIcon, type MenuLinkKind, type MenuLocation,
} from '../../../lib/storefront/storefrontMenuRules';
import { formatPersianCode } from '../../../utils/persianNumber';

/** An item of the editor: the saved fields plus a key the list keeps while items move */
export interface DraftItem {
  key: string;
  id: number | null;
  label: string;
  kind: MenuLinkKind;
  target: string;
  itemId: number | null;
  campaignId: number | null;
  icon: MenuIcon | '';
  isActive: boolean;
  children: DraftItem[];
}

const field = 'w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:bg-slate-50';
const label = 'mb-1 block text-xs font-bold text-slate-600';
const iconButton = 'rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30';

function TargetField({ item, options, onChange, id }: {
  item: DraftItem; options: MenuLinkOptions | undefined; onChange: (patch: Partial<DraftItem>) => void; id: string;
}) {
  const pick = (list: string[] | undefined) => {
    const names = Array.isArray(list) ? list : [];
    const shown = item.target && !names.includes(item.target) ? [item.target, ...names] : names;
    return (
      <select id={id} className={field} value={item.target} onChange={e => onChange({ target: e.target.value })}>
        <option value="">برگزینید</option>
        {shown.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
    );
  };
  switch (item.kind) {
    case 'page':
      return (
        <select id={id} className={field} value={item.target} onChange={e => onChange({ target: e.target.value })}>
          <option value="">برگزینید</option>
          {MENU_SITE_PAGE_KEYS.map(k => <option key={k} value={k}>{MENU_SITE_PAGES[k].title}</option>)}
        </select>
      );
    case 'category': return pick(options?.categories);
    case 'collection': return pick(options?.collections);
    case 'campaign': {
      const list = Array.isArray(options?.campaigns) ? options.campaigns : [];
      return (
        <select id={id} className={field} value={item.campaignId ?? ''} onChange={e => onChange({ campaignId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">برگزینید</option>
          {item.campaignId !== null && !list.some(c => c.id === item.campaignId) && <option value={item.campaignId}>صفحهٔ ویژه‌ای که حذف شده است</option>}
          {list.map(c => <option key={c.id} value={c.id}>{c.live ? c.title : `${c.title} (اکنون روی سایت نیست)`}</option>)}
        </select>
      );
    }
    case 'product': {
      const list = Array.isArray(options?.products) ? options.products : [];
      return (
        <select id={id} className={field} value={item.itemId ?? ''} onChange={e => onChange({ itemId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">برگزینید</option>
          {item.itemId !== null && !list.some(p => p.itemId === item.itemId) && <option value={item.itemId}>محصولی که اکنون روی سایت نیست</option>}
          {list.map(p => <option key={p.itemId} value={p.itemId}>{`${p.name} (${formatPersianCode(p.sku)})`}</option>)}
        </select>
      );
    }
    case 'path':
      return <input id={id} dir="ltr" className={field} value={item.target} placeholder="/products?category=…" autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={e => onChange({ target: e.target.value })} />;
    case 'url':
      // 9b review: a phone keyboard would start it with a capital «H», which is refused
      return <input id={id} type="url" dir="ltr" className={field} value={item.target} placeholder="https://" autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={e => onChange({ target: e.target.value })} />;
    default:
      return <p className="py-1.5 text-xs text-slate-500">این گزینه فقط زیرگزینه‌هایش را باز می‌کند.</p>;
  }
}

/** One item's fields with its order buttons; a first-level item of a place with submenus can add a child */
export function MenuItemFields({ item, location, child, options, notOnSite, first, last, onChange, onMove, onRemove, onAddChild, id }: {
  item: DraftItem; location: MenuLocation; child: boolean; options: MenuLinkOptions | undefined; notOnSite: boolean;
  first: boolean; last: boolean; onChange: (patch: Partial<DraftItem>) => void; onMove: (step: -1 | 1) => void;
  onRemove: () => void; onAddChild?: () => void; id: string;
}) {
  const kinds = MENU_LINK_KINDS.filter(k => k !== 'none' || (!child && location !== 'bottom'));
  return (
    <div className={`space-y-2 rounded-xl border p-3 ${child ? 'border-slate-200 bg-slate-50' : 'border-slate-300 bg-white'}`}>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr]">
        <div>
          <label htmlFor={`${id}-label`} className={label}>عنوان</label>
          <input id={`${id}-label`} className={field} value={item.label} onChange={e => onChange({ label: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${id}-kind`} className={label}>پیوند به</label>
          <select id={`${id}-kind`} className={field} value={item.kind}
            onChange={e => onChange({ kind: e.target.value as MenuLinkKind, target: '', itemId: null, campaignId: null })}>
            {kinds.map(k => <option key={k} value={k}>{MENU_LINK_KIND_TITLES[k]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-target`} className={label}>مقصد</label>
          <TargetField item={item} options={options} onChange={onChange} id={`${id}-target`} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {location === 'bottom' && (
          <label className="inline-flex items-center gap-2 text-xs text-slate-700">
            آیکون
            <select className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs" value={item.icon} onChange={e => onChange({ icon: e.target.value as MenuIcon })}>
              <option value="">برگزینید</option>
              {MENU_ICONS.map(icon => <option key={icon} value={icon}>{MENU_ICON_TITLES[icon]}</option>)}
            </select>
          </label>
        )}
        <label className="inline-flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={item.isActive} onChange={e => onChange({ isActive: e.target.checked })} />
          روی سایت دیده شود
        </label>
        {notOnSite && <span className="text-xs text-amber-800">این پیوند اکنون روی سایت نیست و نشان داده نمی‌شود.</span>}
        <span className="ms-auto flex items-center gap-1">
          {onAddChild && (
            <button type="button" onClick={onAddChild} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold text-slate-700">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              زیرگزینه
            </button>
          )}
          <button type="button" className={iconButton} disabled={first} onClick={() => onMove(-1)} aria-label={`بالا بردن «${item.label || 'گزینه'}»`}><ArrowUp className="h-4 w-4" /></button>
          <button type="button" className={iconButton} disabled={last} onClick={() => onMove(1)} aria-label={`پایین بردن «${item.label || 'گزینه'}»`}><ArrowDown className="h-4 w-4" /></button>
          <button type="button" className={`${iconButton} text-rose-600`} onClick={onRemove} aria-label={`حذف «${item.label || 'گزینه'}»`}><Trash2 className="h-4 w-4" /></button>
        </span>
      </div>
    </div>
  );
}
