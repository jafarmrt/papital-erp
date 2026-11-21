import { useSearchParams } from 'react-router-dom';
import { PanelTop } from 'lucide-react';
import { useHasPermission } from '../contexts/AuthContext';
import { useMenuLinkOptionsQuery, useMenusQuery } from '../hooks/queries/useStorefrontMenuQueries';
import { MENU_LOCATIONS, MENU_LOCATION_TITLES, isMenuLocation, type MenuLocation } from '../lib/storefront/storefrontMenuRules';
import type { MenuView } from '../lib/storefront/storefrontMenuContracts';
import { MenuEditor } from '../components/storefront/menus/MenuEditor';
import { errorMessageOf } from '../utils';

/** What the place will show, as plain text: the switch's state and the items a visitor would see */
function MenuPreview({ view }: { view: MenuView }) {
  const shown = view.items.filter(i => i.live);
  return (
    <section aria-label="پیش‌نمایش" className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-700">
      <h2 className="mb-2 font-black text-slate-800">آنچه سایت اکنون نشان می‌دهد</h2>
      {!view.enabled ? <p>منوی ثابت سایت (این منو خاموش است).</p> : shown.length === 0 ? <p>هیچ گزینه‌ای.</p> : (
        <ul className="space-y-1">
          {shown.map(item => (
            <li key={item.id}>
              <span className="font-bold">{item.label}</span>
              {item.children.some(c => c.live) && <span className="text-slate-500">{`: ${item.children.filter(c => c.live).map(c => c.label).join('، ')}`}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * v12 phase 9b (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §6, owner's decision 3): «فهرست‌های سایت» (the sidebar's word for a
 * menu, TD-686), the menus of the site's
 * header, phone drawer, footer and bottom bar, in the sidebar's «فروشگاه سایت». `site_content.view` sees, and
 * `site_content.manage` changes; the open place is in the address (`/site-menus?place=bottom`).
 */
export default function StorefrontMenusPage() {
  const canManage = useHasPermission('site_content.manage');
  const [params, setParams] = useSearchParams();
  const asked = params.get('place');
  const place: MenuLocation = isMenuLocation(asked) ? asked : 'header';
  const menus = useMenusQuery();
  const options = useMenuLinkOptionsQuery();
  const view = (Array.isArray(menus.data?.menus) ? menus.data.menus : []).find(m => m.location === place);

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-black text-slate-800">
          <PanelTop className="h-5 w-5 text-violet-600" />
          فهرست‌های سایت
        </h1>
        <p className="text-xs leading-6 text-slate-500">
          منوی بالا، منوی همبرگری، پاورقی و نوار پایین گوشی سایت. هر منو تا روشن نشود روی سایت نمی‌آید.
          {!canManage && ' شما فقط می‌توانید ببینید.'}
        </p>
      </header>
      <div role="tablist" aria-label="جای منو" className="flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-white p-1">
        {MENU_LOCATIONS.map(location => (
          <button key={location} type="button" role="tab" aria-selected={place === location} onClick={() => setParams({ place: location }, { replace: true })}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold ${place === location ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            {MENU_LOCATION_TITLES[location]}
          </button>
        ))}
      </div>
      {menus.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
      {menus.isError && <p className="text-xs text-rose-700">{errorMessageOf(menus.error)}</p>}
      {options.isError && <p className="text-xs text-amber-800">{`فهرست دسته‌ها و محصولات خوانده نشد: ${errorMessageOf(options.error)}`}</p>}
      {view && (
        <>
          <MenuEditor key={`${view.location}-${view.version}`} view={view} options={options.data} canManage={canManage} />
          <MenuPreview view={view} />
        </>
      )}
    </div>
  );
}
