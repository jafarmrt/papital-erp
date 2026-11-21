import { publicSettings } from './api.server';
import { formatPrice } from './format';
import type { SitePageSection } from './pages';
import type { ShippingView } from '../components/PageSections';

/** What a buyer pays for one method, in their words (never the rate table itself, which the checkout works out) */
function shippingCost(pricing: string, flatRate: string): string {
  switch (pricing) {
    case 'flat': return /^[1-9]\d*$/.test(flatRate) ? `هزینهٔ ارسال ${formatPrice(flatRate)}` : 'بدون هزینهٔ ارسال';
    case 'table': return 'هزینه به وزن بسته و استان مقصد بستگی دارد و هنگام ثبت سفارش نشان داده می‌شود.';
    case 'on_delivery': return 'هزینهٔ ارسال را هنگام تحویل به پیک می‌پردازید.';
    case 'free': return 'بدون هزینهٔ ارسال';
    default: return '';
  }
}

/** The shipping methods of the ERP's live settings, so a method switched off there never shows on a page */
export async function shippingView(): Promise<ShippingView & { reservationHours: number }> {
  const settings = await publicSettings();
  return {
    methods: settings.shippingMethods.map(m => ({ title: m.title, description: m.description, cost: shippingCost(m.pricing, m.flatRate), free: m.isFreeShippingEligible })),
    freeShippingThreshold: settings.freeShippingThreshold,
    reservationHours: settings.reservationHours,
  };
}

/** v12 phase 10c: the live shipping methods, read only for a page that has the «روش‌ها و هزینهٔ ارسال» section */
export async function shippingViewFor(sections: readonly SitePageSection[]): Promise<ShippingView | null> {
  return sections.some(section => section.kind === 'shippingMethods') ? shippingView() : null;
}
