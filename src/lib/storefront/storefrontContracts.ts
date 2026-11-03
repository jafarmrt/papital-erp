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
  version: 'sf_settings_version',
  apiKeySha256: 'sf_api_key_sha256',
  apiKeyHint: 'sf_api_key_hint',
  apiKeyCreatedAt: 'sf_api_key_created_at',
  enabled: 'sf_enabled',
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
  /** the Storefront API answers only while this is on (default off: nothing of the ERP changes until the owner turns it on) */
  enabled: boolean;
  version: number;
}

export interface StorefrontSettingsView extends StorefrontSettingsInput {
  /** the configured price lists the two price list fields choose from */
  priceLists: string[];
  /** the active warehouses the warehouse field chooses from */
  warehouses: Array<{ code: string; name: string }>;
  /** the warehouse the site sells from now (the setting, or the shop warehouse it falls back to) */
  effectiveWarehouseCode: string;
  apiKey: { configured: boolean; hint: string; createdAt: string | null };
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
  shippingMethods: Array<Omit<ShippingMethodInput, 'isActive' | 'sortOrder'>>;
}
