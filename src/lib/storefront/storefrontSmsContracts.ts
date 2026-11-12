import type { SmsKind, SmsMessageStatus, SmsProvider } from './storefrontSmsRules.js';

/**
 * v11 phase 8.4a: the answers of the ERP's «پیامک» section, one contract for the server and the screen (AGENTS.md §6.5).
 * The provider's key is never answered: only whether one is stored and its last four letters.
 */
export const STOREFRONT_SMS_SETTING_KEYS = {
  enabled: 'sf_sms_enabled',
  provider: 'sf_sms_provider',
  apiKey: 'sf_sms_api_key',
  apiKeyHint: 'sf_sms_api_key_hint',
  templates: 'sf_sms_templates',
  hourlyCap: 'sf_sms_hourly_cap',
  orderHourlyCap: 'sf_sms_order_hourly_cap',
  /** v12 phase 8e: the owner's «حالت بی پیامک» switch ('1' = login codes paused) */
  loginPaused: 'sf_sms_login_paused',
  version: 'sf_sms_version',
} as const;

export type SmsTemplates = Partial<Record<SmsKind, string>>;

export interface StorefrontSmsSettingsInput {
  enabled: boolean;
  provider: SmsProvider;
  /** '' keeps the stored key; a new key replaces it */
  apiKey: string;
  /** true removes the stored key (and turns sending off) */
  clearApiKey: boolean;
  templates: SmsTemplates;
  /** v12 phase 8b (site review 2.11): login codes the site sends in an hour; a day holds `SMS_DAILY_CAP_HOURS` times it */
  hourlyCap: number;
  /** v12 phase 8b: order texts the site sends in an hour, a budget of their own; absent keeps the stored one */
  orderHourlyCap?: number;
  /** v12 phase 8e: «حالت بی پیامک», login codes paused by hand; absent keeps the stored one */
  loginPaused?: boolean;
  version: number;
}

export interface StorefrontSmsSettingsView {
  enabled: boolean;
  provider: SmsProvider;
  apiKey: { configured: boolean; hint: string; readable: boolean };
  templates: SmsTemplates;
  hourlyCap: number;
  orderHourlyCap: number;
  /** v12 phase 8e: «حالت بی پیامک» switched on by hand */
  loginPaused: boolean;
  /** v12 phase 8e: the latest login texts all failed, so the site works without SMS until a while has passed */
  autoPaused: boolean;
  version: number;
  /** whether the server can keep a provider key at all (`ERP_SECRETS_KEY` is set) */
  secretsKeyConfigured: boolean;
}

export interface SmsMessageRow {
  id: number;
  kind: SmsKind;
  /** the middle digits hidden */
  phone: string;
  orderNumber: string | null;
  status: SmsMessageStatus;
  attempts: number;
  isTest: boolean;
  error: string;
  createdAt: string;
  sentAt: string | null;
}

export interface SmsMessagePage {
  data: SmsMessageRow[];
  total: number;
  page: number;
  limit: number;
}

export interface SmsTestResult {
  sent: boolean;
  error: string;
}

/** The Storefront API's answers to the site app */
export interface OtpRequestResult {
  /** seconds before the same phone may ask again */
  resendAfter: number;
  /** seconds the code stays valid */
  expiresIn: number;
}

export interface OtpVerifyResult {
  /** a single-use proof that this phone was checked now; the sign-up or sign-in that follows presents it */
  phoneProof: string;
  expiresIn: number;
}
