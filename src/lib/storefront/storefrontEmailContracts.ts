import type { EmailSecurity } from './storefrontEmailRules.js';

/**
 * v12 phase 8e: the answers of the ERP's «ایمیل سایت» section, one contract for the server and the screen (AGENTS.md
 * §6.5). The mail server's password is write-only: no answer carries it, only whether one is stored and readable.
 */
export const STOREFRONT_EMAIL_SETTING_KEYS = {
  enabled: 'sf_email_enabled',
  host: 'sf_email_host',
  port: 'sf_email_port',
  security: 'sf_email_security',
  username: 'sf_email_username',
  password: 'sf_email_password',
  fromAddress: 'sf_email_from',
  fromName: 'sf_email_from_name',
  version: 'sf_email_version',
} as const;

export interface StorefrontEmailSettingsInput {
  enabled: boolean;
  host: string;
  port: number;
  security: EmailSecurity;
  /** '' = the server takes mail without signing in */
  username: string;
  /** '' keeps the stored password; a new one replaces it */
  password: string;
  /** true removes the stored password */
  clearPassword: boolean;
  fromAddress: string;
  fromName: string;
  version: number;
}

export interface StorefrontEmailSettingsView {
  enabled: boolean;
  host: string;
  port: number;
  security: EmailSecurity;
  username: string;
  password: { configured: boolean; readable: boolean };
  fromAddress: string;
  fromName: string;
  /** whether the site sends email now: on, and every needed field filled and readable */
  ready: boolean;
  version: number;
  /** whether the server can keep a password at all (`ERP_SECRETS_KEY` is set) */
  secretsKeyConfigured: boolean;
}

/** `POST /api/storefront/email/test` */
export interface StorefrontEmailTestResult {
  sent: boolean;
  /** why it was not sent, in Persian ('' when sent) */
  error: string;
}

/** v12 phase 8e: `POST /api/storefront/v1/auth/email-code/request` */
export interface EmailCodeRequestResult {
  resendAfter: number;
  expiresIn: number;
}

/** `POST /api/storefront/v1/auth/email-code/verify`: a single-use proof of the address for the step that follows */
export interface EmailCodeVerifyResult {
  emailProof: string;
  expiresIn: number;
}
