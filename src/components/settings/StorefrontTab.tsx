import { useState } from 'react';
import { Store } from 'lucide-react';
import { useStorefrontSettingsQuery } from '../../hooks/queries/useStorefrontQueries';
import { errorMessageOf } from '../../utils';
import { StorefrontSettingsForm } from '../storefront/StorefrontSettingsForm';
import { StorefrontApiKeyCard } from '../storefront/StorefrontApiKeyCard';
import { StorefrontBrandCard } from '../storefront/StorefrontBrandCard';
import { ShippingMethodsSection } from '../storefront/ShippingMethodsSection';
import { StorefrontProductsSection } from '../storefront/StorefrontProductsSection';
import { BuyerGroupsSection } from '../storefront/BuyerGroupsSection';
import { StorefrontSmsSection } from '../storefront/StorefrontSmsSection';

/**
 * v11 phase 8.1 (docs/roadmap/V11_STOREFRONT_START_PLAN.md): the settings tab «فروشگاه سایت» of the new papitalgallery.com,
 * which runs as its own app on the site's domain and reads the ERP through the Storefront API. `storefront.view` sees,
 * `storefront.manage` changes.
 */
type Section = 'products' | 'settings' | 'brand' | 'shipping' | 'groups' | 'sms' | 'key';
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'products', label: 'کالاهای سایت' },
  { id: 'settings', label: 'پرداخت، قیمت و موجودی' },
  { id: 'brand', label: 'لوگو و آیکون' },
  { id: 'shipping', label: 'روش‌های ارسال' },
  { id: 'groups', label: 'گروه‌های خریدار' },
  { id: 'sms', label: 'پیامک' },
  { id: 'key', label: 'کلید برنامه سایت' },
];

export function StorefrontTab({ canManage }: { canManage: boolean }) {
  const [section, setSection] = useState<Section>('products');
  const settings = useStorefrontSettingsQuery();

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-black text-slate-800">
          <Store className="w-5 h-5 text-violet-600" />
          فروشگاه سایت
        </h2>
        <p className="text-xs leading-6 text-slate-500">
          سایت تازه papitalgallery.com جدا از ERP بالا می‌آید و کالا، قیمت و موجودی را از همین‌جا می‌خواند.
          {!canManage && ' شما فقط می‌توانید ببینید.'}
        </p>
      </header>
      <div role="tablist" aria-label="بخش‌های فروشگاه سایت" className="flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-white p-1">
        {SECTIONS.map(s => (
          <button key={s.id} type="button" role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold ${section === s.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            {s.label}
          </button>
        ))}
      </div>
      {section === 'products' && <StorefrontProductsSection canManage={canManage} />}
      {section === 'shipping' && <ShippingMethodsSection canManage={canManage} />}
      {section === 'groups' && <BuyerGroupsSection canManage={canManage} />}
      {section === 'sms' && <StorefrontSmsSection canManage={canManage} />}
      {(section === 'settings' || section === 'brand' || section === 'key') && (
        <>
          {settings.isLoading && <p className="text-xs text-slate-500">در حال خواندن…</p>}
          {settings.isError && <p className="text-xs text-rose-700">{errorMessageOf(settings.error)}</p>}
          {settings.data && section === 'settings' && <StorefrontSettingsForm view={settings.data} canManage={canManage} />}
          {settings.data && section === 'brand' && <StorefrontBrandCard brand={settings.data.brand} canManage={canManage} />}
          {settings.data && section === 'key' && <StorefrontApiKeyCard view={settings.data} canManage={canManage} />}
        </>
      )}
    </div>
  );
}
