/**
 * OBS-R2-96 (decision ت۴۰ item 3): which stored settings `GET /settings` gives each reader. The system admin and holders
 * of `settings.manage` read every setting (secrets masked for everyone but the system admin); any other signed-in user
 * reads only what the shell, the print header, the price lists, the dashboard and the project screens need, and a
 * reader of the WooCommerce tab also its connection settings (keys masked).
 */
export const SHARED_SETTING_KEYS: readonly string[] = [
  'company_name',
  'company_phone',
  'company_address',
  'company_logo',
  'currency',
  'display_timezone',
  'pricing_strategies',
  'fast_moving_days',
  'slow_moving_days',
  'dead_stock_days',
  'project_workflow_presets',
  'inventory_control_preset_sections',
];

/** the WooCommerce tab (`woocommerce.view`) shows the store connection and the shop warehouse */
export const WOOCOMMERCE_SETTING_KEYS: readonly string[] = [
  'wc_store_url',
  'wc_consumer_key',
  'wc_consumer_secret',
  'wc_webhook_secret',
  'wc_shop_warehouse',
];

export const WOOCOMMERCE_SETTING_READ_PERMISSIONS = ['woocommerce.view', 'woocommerce.manage'] as const;

export interface SettingReader {
  /** the system admin or a holder of `settings.manage` */
  allSettings: boolean;
  /** a reader of the WooCommerce tab */
  woocommerce: boolean;
}

export function isSettingReadable(key: string, reader: SettingReader): boolean {
  if (reader.allSettings) return true;
  if (SHARED_SETTING_KEYS.includes(key)) return true;
  return reader.woocommerce && WOOCOMMERCE_SETTING_KEYS.includes(key);
}
