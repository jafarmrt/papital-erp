import { useSearchParams } from 'react-router-dom';
import { useHasPermission } from '../contexts/AuthContext';
import { StorefrontSettingsSections, isStorefrontSection, type StorefrontSection } from '../components/storefront/StorefrontSettingsSections';

/**
 * v12 phase 9a (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §6): «کالاها و تنظیمات سایت», the sections that were the settings
 * tab «فروشگاه سایت», in the sidebar's own «فروشگاه سایت» group. The open section is in the address
 * (`/site-settings?section=sms`), so a bell or a bookmark opens it; an unknown one opens the site's products.
 */
export default function StorefrontSettingsPage() {
  const canManage = useHasPermission('storefront.manage');
  const [params, setParams] = useSearchParams();
  const asked = params.get('section');
  const section: StorefrontSection = isStorefrontSection(asked) ? asked : 'products';
  return (
    <div className="mx-auto max-w-6xl px-3 py-4 sm:px-6">
      <StorefrontSettingsSections canManage={canManage} section={section}
        onSection={(next) => setParams({ section: next }, { replace: true })} />
    </div>
  );
}
