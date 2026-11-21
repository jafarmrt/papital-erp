import { Store } from 'lucide-react';
import { useStorefrontSettingsQuery } from '../../hooks/queries/useStorefrontQueries';
import { errorMessageOf } from '../../utils';
import { StorefrontSettingsForm } from './StorefrontSettingsForm';
import { StorefrontApiKeyCard } from './StorefrontApiKeyCard';
import { StorefrontBrandCard } from './StorefrontBrandCard';
import { ShippingMethodsSection } from './ShippingMethodsSection';
import { StorefrontProductsSection } from './StorefrontProductsSection';
import { BuyerGroupsSection } from './BuyerGroupsSection';
import { DiscountCodesSection } from './DiscountCodesSection';
import { StorefrontSmsSection } from './StorefrontSmsSection';
import { StorefrontEmailSection } from './StorefrontEmailSection';
import { StorefrontSeoSection } from './StorefrontSeoForm';
import { StorefrontRedirectsSection } from './StorefrontRedirectsSection';
import { StorefrontCampaignsSection } from './StorefrontCampaignsSection';

/**
 * v11 phase 8.1 (docs/roadmap/V11_STOREFRONT_START_PLAN.md): the sections of «فروشگاه سایت» of the new papitalgallery.com,
 * which runs as its own app on the site's domain and reads the ERP through the Storefront API. `storefront.view` sees,
 * `storefront.manage` changes. v12 phase 9a (V12_SITE_NEXT_START_PLAN.md §6): once a settings tab, now the page
 * «کالاها و تنظیمات سایت» (`/site-settings`) of the sidebar's «فروشگاه سایت», with the open section in its address.
 */
export const STOREFRONT_SECTION_IDS = ['products', 'settings', 'brand', 'shipping', 'groups', 'discounts', 'campaigns', 'sms', 'email', 'seo', 'redirects', 'key'] as const;
export type StorefrontSection = typeof STOREFRONT_SECTION_IDS[number];
export const isStorefrontSection = (value: unknown): value is StorefrontSection => (STOREFRONT_SECTION_IDS as readonly unknown[]).includes(value);

const SECTIONS: Array<{ id: StorefrontSection; label: string }> = [
  { id: 'products', label: 'کالاهای سایت' },
  { id: 'settings', label: 'پرداخت، قیمت و موجودی' },
  { id: 'brand', label: 'لوگو و آیکون' },
  { id: 'shipping', label: 'روش‌های ارسال' },
  { id: 'groups', label: 'گروه‌های خریدار' },
  { id: 'discounts', label: 'کدهای تخفیف' },
  { id: 'campaigns', label: 'صفحه‌های ویژه' },
  { id: 'sms', label: 'پیامک' },
  { id: 'email', label: 'ایمیل' },
  { id: 'seo', label: 'جست‌وجو و آمار بازدید' },
  { id: 'redirects', label: 'نشانی‌های سایت قبلی' },
  { id: 'key', label: 'کلید برنامه سایت' },
];

export function StorefrontSettingsSections({ canManage, section, onSection }: {
  canManage: boolean; section: StorefrontSection; onSection: (section: StorefrontSection) => void;
}) {
  const settings = useStorefrontSettingsQuery();
  const setSection = onSection;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-black text-slate-800">
          <Store className="w-5 h-5 text-violet-600" />
          کالاها و تنظیمات سایت
        </h1>
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
      {section === 'discounts' && <DiscountCodesSection canManage={canManage} />}
      {section === 'campaigns' && <StorefrontCampaignsSection canManage={canManage} />}
      {section === 'sms' && <StorefrontSmsSection canManage={canManage} />}
      {section === 'email' && <StorefrontEmailSection canManage={canManage} />}
      {section === 'seo' && <StorefrontSeoSection canManage={canManage} />}
      {section === 'redirects' && <StorefrontRedirectsSection canManage={canManage} />}
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
