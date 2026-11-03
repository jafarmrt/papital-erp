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
  /** texts of every kind the site sends in an hour; a day holds `SMS_DAILY_CAP_HOURS` times it */
  hourlyCap: number;
  version: number;
}

export interface StorefrontSmsSettingsView {
  enabled: boolean;
  provider: SmsProvider;
  apiKey: { configured: boolean; hint: string; readable: boolean };
  templates: SmsTemplates;
  hourlyCap: number;
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
