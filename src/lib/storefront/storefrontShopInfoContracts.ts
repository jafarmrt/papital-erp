import type { ShopInfoField, ShopInfoValues, ShopSocial } from './storefrontShopInfoRules.js';

/**
 * v12 phase 10a: the answers of «اطلاعات فروشگاه», one contract for the ERP server, the «کالاها و تنظیمات سایت» page and
 * the storefront app (`AGENTS.md` §6.5).
 */

/** «اطلاعات فروشگاه» in `app_settings`: a group of its own, under its own version */
export const STOREFRONT_SHOP_INFO_SETTING_KEYS: Readonly<Record<ShopInfoField | 'version', string>> = {
  brandName: 'sf_info_brand_name',
  brandFullName: 'sf_info_brand_full_name',
  brandTagline: 'sf_info_brand_tagline',
  footerNote: 'sf_info_footer_note',
  address: 'sf_info_address',
  postalCode: 'sf_info_postal_code',
  phone: 'sf_info_phone',
  mobile: 'sf_info_mobile',
  email: 'sf_info_email',
  hours: 'sf_info_hours',
  instagram: 'sf_info_instagram',
  telegram: 'sf_info_telegram',
  youtube: 'sf_info_youtube',
  aparat: 'sf_info_aparat',
  linkedin: 'sf_info_linkedin',
  copyright: 'sf_info_copyright',
  shippingTitle: 'sf_info_shipping_title',
  shippingText: 'sf_info_shipping_text',
  alternateSiteLabel: 'sf_info_alternate_site_label',
  enamadLinkUrl: 'sf_info_enamad_link_url',
  enamadImageUrl: 'sf_info_enamad_image_url',
  whatsappFloat: 'sf_info_whatsapp_float',
  version: 'sf_info_version',
};

export interface StorefrontShopInfoInput extends ShopInfoValues {
  version: number;
}

export interface StorefrontShopInfoView extends StorefrontShopInfoInput {
  /** whether «پرداخت، قیمت و موجودی» holds a WhatsApp number (the floating button shows only with one) */
  whatsappNumberSet: boolean;
}

/**
 * `GET /api/storefront/v1/shop-info`: what every page of the site shows of the shop itself. Every text is '' while the
 * owner has not written it (the site then keeps its own); nothing here is a secret, a customer or an amount.
 */
export interface StorefrontPublicShopInfo {
  brand: { name: string; fullName: string; tagline: string };
  footerNote: string;
  contact: { address: string; postalCode: string; phone: string; mobile: string; email: string; hours: string };
  social: Record<ShopSocial, string>;
  copyright: string;
  shipping: { title: string; lines: string[] };
  alternateSiteLabel: string;
  enamad: { linkUrl: string; imageUrl: string };
  /** the shop's WhatsApp number while the floating button is on; '' = no button */
  whatsappFloat: string;
}
