import type { PublishBlocker, ShippingPricing, StockDisplay, StockStatus } from './storefrontRules.js';

/**
 * v11 phase 8.1: the answers of the storefront routes, one contract for the server, the ERP settings tab and the
 * storefront app (`AGENTS.md` §6.5). Amounts are rial decimal strings; '' means «not set».
 */

/** The settings keys of package 18 in `app_settings` */
export const STOREFRONT_SETTING_KEYS = {
  cardNumber: 'sf_card_number',
  cardHolder: 'sf_card_holder',
  bankName: 'sf_bank_name',
  iban: 'sf_iban',
  freeShippingThreshold: 'sf_free_shipping_threshold',
  reservationHours: 'sf_reservation_hours',
  retailPriceList: 'sf_retail_price_list',
  wholesalePriceList: 'sf_wholesale_price_list',
  lowStockThreshold: 'sf_low_stock_threshold',
  stockDisplay: 'sf_stock_display',
  warehouseCode: 'sf_warehouse',
  whatsappNumber: 'sf_whatsapp_number',
  whatsappEnabled: 'sf_whatsapp_enabled',
  version: 'sf_settings_version',
  apiKeySha256: 'sf_api_key_sha256',
  apiKeyHint: 'sf_api_key_hint',
  apiKeyCreatedAt: 'sf_api_key_created_at',
  enabled: 'sf_enabled',
  logo: 'sf_logo',
  favicon: 'sf_favicon',
  brandVersion: 'sf_brand_version',
  ordersEnabled: 'sf_orders_enabled',
  treasuryAccountId: 'sf_treasury_account',
  openOrdersPerPhone: 'sf_open_orders_per_phone',
  approvalHours: 'sf_approval_hours',
} as const;

export interface StorefrontSettingsInput {
  cardNumber: string;
  cardHolder: string;
  bankName: string;
  iban: string;
  /** rial; '' = no free shipping */
  freeShippingThreshold: string;
  reservationHours: number;
  retailPriceList: string;
  wholesalePriceList: string;
  /** at most this many units reads «تعداد کم»; 0 = never */
  lowStockThreshold: number;
  stockDisplay: StockDisplay;
  /** the warehouse whose sellable stock the site sells; '' = the WooCommerce shop warehouse (start plan decision 5) */
  warehouseCode: string;
  /** the shop's WhatsApp number, international digits (98…); '' = none */
  whatsappNumber: string;
  /** whether the site shows the «سفارش در واتس‌اپ» button and link (start plan 8.3, owner's answer 2) */
  whatsappEnabled: boolean;
  /** the Storefront API answers only while this is on (default off: nothing of the ERP changes until the owner turns it on) */
  enabled: boolean;
  /** v11 phase 8.2a: the site takes orders only while this is on too (default off, so the catalog can go live first) */
  ordersEnabled: boolean;
  /** the treasury account (bank) a confirmed card-to-card payment is received into; 0 = not chosen (confirming is refused) */
  treasuryAccountId: number;
  /** the unpaid orders one phone number may hold at once */
  openOrdersPerPhone: number;
  /** v12 phase 8b (site review 2.7): the hours an «به حساب» order waits for a colleague's confirmation; absent keeps the stored */
  approvalHours?: number;
  version: number;
}

/** The settings as the server reads them: every value present */
export type StorefrontSettingValues = StorefrontSettingsInput & { approvalHours: number };

export interface StorefrontSettingsView extends StorefrontSettingsInput {
  approvalHours: number;
  /** the configured price lists the two price list fields choose from */
  priceLists: string[];
  /** the active warehouses the warehouse field chooses from */
  warehouses: Array<{ code: string; name: string }>;
  /** the active rial bank accounts with a ledger account the treasury account field chooses from */
  treasuryAccounts: Array<{ id: number; title: string; bankName: string }>;
  /** the warehouse the site sells from now (the setting, or the shop warehouse it falls back to) */
  effectiveWarehouseCode: string;
  apiKey: { configured: boolean; hint: string; createdAt: string | null };
  brand: StorefrontBrandView;
}

/** v11 phase 8.3: the site's own logo and browser icon (data URLs, '' = none) */
export interface StorefrontBrandView {
  logo: string;
  favicon: string;
  /** true while the site has no logo of its own and shows the company logo of the general settings */
  usesCompanyLogo: boolean;
  version: number;
}

/** `GET /api/storefront/v1/brand`: what the site shows; the logo falls back to the company logo */
export interface StorefrontPublicBrand {
  logo: string;
  favicon: string;
}

export interface ShippingRateRow {
  /** '' = every other province */
  province: string;
  /** null = no upper bound */
  maxWeightGrams: number | null;
  rate: string;
}

export interface ShippingMethodInput {
  code: string;
  title: string;
  description: string;
  pricing: ShippingPricing;
  flatRate: string;
  isActive: boolean;
  isFreeShippingEligible: boolean;
  sortOrder: number;
  rates: ShippingRateRow[];
}

export interface ShippingMethodRow extends ShippingMethodInput {
  id: number;
  version: number;
}

export interface StorefrontProductAdminRow {
  itemId: number;
  code: string;
  name: string;
  category: string;
  collections: string[];
  hasCover: boolean;
  retailPrice: string | null;
  sellable: number;
  published: boolean;
  slug: string;
  seoTitle: string;
  seoDescription: string;
  sortOrder: number;
  /** null while the item has no storefront row yet */
  version: number | null;
  blocker: PublishBlocker | null;
}

export interface StorefrontProductAdminPage {
  data: StorefrontProductAdminRow[];
  total: number;
  publishedCount: number;
  page: number;
  limit: number;
}

export interface StorefrontProductInput {
  published: boolean;
  slug: string;
  seoTitle: string;
  seoDescription: string;
  sortOrder: number;
  /** 0 for an item without a storefront row */
  version: number;
}

export interface StorefrontImage {
  /** the file key; the light version is `GET /api/storefront/v1/media/<sha256>.webp`, the thumbnail `…/<sha256>-thumb.webp` */
  sha256: string;
  width: number | null;
  height: number | null;
  alt: string;
  isCover: boolean;
}

export interface StorefrontStock {
  status: StockStatus;
  /**
   * the whole units a buyer may order, only when the settings show the count; null otherwise, so the status display
   * does not give the count away. The order step checks the stock again either way.
   */
  quantity: number | null;
}

export interface StorefrontProductCard {
  slug: string;
  sku: string;
  name: string;
  category: string;
  collections: string[];
  /**
   * the retail price only: the wholesale price is never on the public catalog; it comes with the approved wholesale
   * buyer's sign-in in a later step (start plan, B2B)
   */
  retailPrice: string;
  stock: StorefrontStock;
  cover: StorefrontImage | null;
}

export interface StorefrontProductDetail extends StorefrontProductCard {
  description: string;
  material: string;
  size: string;
  color: string;
  weightGrams: number | null;
  designYear: number | null;
  seoTitle: string;
  seoDescription: string;
  images: StorefrontImage[];
  /**
   * other items on the site with the same design (storefrontDesignKey: the transfer code of the item card, else the third
   * part of the product code), in the shop's order; no separate design field is sent
   */
  sameDesign: StorefrontProductCard[];
}

/**
 * v11 phase 8.5b: `GET /api/storefront/v1/feed`, every item on the site with what a product feed (Google Merchant and the
 * price-comparison sites) needs: the fields its own page already shows, and no more
 */
export interface StorefrontFeedItem extends Omit<StorefrontProductCard, 'cover' | 'stock'> {
  /** the page's description (its search description, else the product description), at most FEED_DESCRIPTION_MAX */
  description: string;
  material: string;
  color: string;
  inStock: boolean;
  /** the cover first, at most FEED_IMAGES_MAX */
  images: StorefrontImage[];
}

export interface StorefrontCatalogPage {
  data: StorefrontProductCard[];
  total: number;
  page: number;
  limit: number;
}

export interface StorefrontFacet {
  name: string;
  count: number;
}

export interface StorefrontPublicSettings {
  currency: 'IRR';
  payment: { cardNumber: string; cardHolder: string; bankName: string; iban: string };
  freeShippingThreshold: string;
  reservationHours: number;
  stockDisplay: StockDisplay;
  /** the WhatsApp number the site links to; '' while the button is off or no number is set */
  whatsapp: string;
  /** v11 phase 8.4b: sign-in and sign-up take an SMS code (the site's texts on with a login code template) */
  smsLogin: boolean;
  /** v11 phase 8.2: the site takes orders («ثبت سفارش» on), so the pages offer the cart and checkout */
  ordering: boolean;
  shippingMethods: Array<Omit<ShippingMethodInput, 'isActive' | 'sortOrder'>>;
}
