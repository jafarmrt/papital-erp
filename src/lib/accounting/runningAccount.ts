/**
 * v12 colleague and partner sales (docs/roadmap/V12_COLLEAGUE_SALES_START_PLAN.md, owner's decisions of 6 Azar 1405): a
 * party may stand for a colleague or partner of the personnel. Every final sales invoice of such a party debits that
 * person's running account, on their personnel detail, instead of trade receivables, and is settled from it at once
 * («تسویه از حساب جاری»), so it never stands in the receivables list. Shared by the server and the party form.
 */

export const RUNNING_ACCOUNT_KINDS = ['colleague', 'partner'] as const;
export type RunningAccountKind = typeof RUNNING_ACCOUNT_KINDS[number];
/** '' is an ordinary party: its invoices go to trade receivables */
export type PartyRunningAccount = RunningAccountKind | '';

export const RUNNING_ACCOUNT_LABELS: Record<RunningAccountKind, string> = {
  colleague: 'حساب جاری همکار',
  partner: 'حساب جاری شرکا',
};

/** The account mapping concept each kind posts to (3208 and 4101 by default) */
export const RUNNING_ACCOUNT_MAPPING_KEYS = {
  colleague: 'colleagueCurrentAccountCode',
  partner: 'partnersCurrentAccountCode',
} as const satisfies Record<RunningAccountKind, string>;

export const isRunningAccountKind = (value: unknown): value is RunningAccountKind =>
  typeof value === 'string' && (RUNNING_ACCOUNT_KINDS as readonly string[]).includes(value);

/**
 * v12 colleague sales part B2 (owner's decision of 7 Azar 1405): a partner's debt is fixed in euros, so every invoice of a
 * party linked to a partner is in this currency and the partner's 4101 stays one currency; a colleague's 3208 is in rials.
 */
export const PARTNER_ACCOUNT_CURRENCY = 'EUR';
export const RUNNING_ACCOUNT_CURRENCY: Record<RunningAccountKind, string> = { colleague: 'IRR', partner: PARTNER_ACCOUNT_CURRENCY };

/** The line the settlement of an invoice shows among its receipts and cheques */
export const RUNNING_ACCOUNT_SETTLEMENT_LABEL = 'تسویه از حساب جاری';
