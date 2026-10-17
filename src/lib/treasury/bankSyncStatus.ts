/**
 * v10.1.63 (OBS-PR-11, decision ت۴۰ item 13): how a treasury account's ledger balance stands against its treasury balance.
 * `pending_approval` is a difference made only by draft vouchers (a new treasury row's voucher before the accountant
 * approves it), told apart from a real difference (`discrepant`), which the card still shows as «مغایرت دفتری».
 */
export const BANK_SYNC_STATUSES = ['synced', 'discrepant', 'pending_approval', 'unlinked'] as const;
export type BankSyncStatus = typeof BANK_SYNC_STATUSES[number];

export const BANK_PENDING_APPROVAL_LABEL = 'در انتظار تأیید سند';
export const BANK_DISCREPANT_LABEL = 'مغایرت دفتری';
