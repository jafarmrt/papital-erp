import { useId } from 'react';
import type { MenuLinkOptions } from '../../../lib/storefront/storefrontMenuContracts';
import { SITE_LINK_KINDS, SITE_LINK_KIND_TITLES, normalizedSiteLink, type SiteLink, type SiteLinkKind } from '../../../lib/storefront/storefrontSiteLinks';
import { TargetField, type DraftItem } from '../menus/MenuItemFields';

/**
 * v12 phase 10e: a link chosen as in «منوهای سایت» (a page of the site, a page of «صفحه‌های سایت», a news item, a
 * category, a collection, a «صفحهٔ ویژه», a product, a path or an outside address), for a slide's button and a banner.
 * The target is chosen with the menu builder's own field, so both screens offer the same choices.
 */
const field = 'w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:bg-slate-50';
const label = 'mb-1 block text-xs font-bold text-slate-600';

export function SiteLinkField({ title, value, options, onChange }: {
  title: string; value: SiteLink | null; options: MenuLinkOptions | undefined; onChange: (next: SiteLink | null) => void;
}) {
  const id = useId();
  const item: DraftItem = {
    key: id, id: null, label: title, kind: value?.kind ?? 'none', target: value?.target ?? '', itemId: value?.itemId ?? null, campaignId: value?.campaignId ?? null,
    pageId: value?.pageId ?? null, newsId: value?.newsId ?? null, icon: '', isActive: true, children: [],
  };
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div>
        <label htmlFor={`${id}-kind`} className={label}>{`${title}: پیوند به`}</label>
        <select id={`${id}-kind`} className={field} value={value?.kind ?? ''}
          onChange={e => onChange(e.target.value ? normalizedSiteLink(e.target.value as SiteLinkKind, {}) : null)}>
          <option value="">بی پیوند</option>
          {SITE_LINK_KINDS.map(kind => <option key={kind} value={kind}>{SITE_LINK_KIND_TITLES[kind]}</option>)}
        </select>
      </div>
      {value && (
        <div>
          <label htmlFor={`${id}-target`} className={label}>{`${title}: مقصد`}</label>
          <TargetField item={item} options={options} id={`${id}-target`}
            onChange={patch => onChange({ ...value, ...Object.fromEntries(Object.entries(patch).filter(([key]) => ['target', 'itemId', 'campaignId', 'pageId', 'newsId'].includes(key))) })} />
        </div>
      )}
    </div>
  );
}
