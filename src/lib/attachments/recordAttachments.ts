import type { FinancialAttachment } from '../../types/accounting.types';

/**
 * v11 (owner's decision 7 Aban 1405, after the 1405 replay): «افزودن پیوست» on a recorded warehouse or sales document, a
 * treasury row, a cheque and a voucher. Files only: the record's amounts, lines and status are never touched, and every
 * add and removal is audited with who and when. Before the record is approved (its voucher still a draft) a file is
 * added and removed freely; after approval a file is only added (kept with its name and time) and never removed; once the
 * record's fiscal year is closed nothing is added or removed. One rule for the server and the window.
 */

export const RECORD_ATTACHMENT_ENTITIES = ['document', 'treasury_transaction', 'cheque', 'journal_voucher'] as const;
export type RecordAttachmentEntity = typeof RECORD_ATTACHMENT_ENTITIES[number];

export const RECORD_ATTACHMENT_YEAR_CLOSED = 'RECORD_ATTACHMENT_YEAR_CLOSED';
export const RECORD_ATTACHMENT_APPROVED = 'RECORD_ATTACHMENT_APPROVED';

export interface RecordAttachmentState {
  attachments: FinancialAttachment[];
  /** its voucher (a voucher: itself) is past draft */
  approved: boolean;
  /** its fiscal year is closed */
  yearClosed: boolean;
}

export type RecordAttachmentAction = 'add' | 'remove';

/** Why this action is refused on a record in this state, or null. */
export function recordAttachmentRefusal(state: Pick<RecordAttachmentState, 'approved' | 'yearClosed'>, action: RecordAttachmentAction): string | null {
  if (state.yearClosed) return 'سال مالی این سند بسته شده است؛ پیوست آن دیگر افزوده یا برداشته نمی‌شود.';
  if (action === 'remove' && state.approved) return 'این سند تأیید شده است؛ پس از تأیید فقط می‌توان پیوست افزود و پیوست برداشته نمی‌شود.';
  return null;
}

/** The line the window shows under the files. */
export function recordAttachmentRuleText(state: Pick<RecordAttachmentState, 'approved' | 'yearClosed'>): string {
  if (state.yearClosed) return 'سال مالی این سند بسته شده است؛ پیوست‌ها فقط دیده می‌شوند.';
  if (state.approved) return 'سند تأیید شده است: می‌توانید پیوست بیفزایید (با نام و زمان افزودن نگه داشته می‌شود)، ولی پیوستی برداشته نمی‌شود.';
  return 'تا پیش از تأیید سند می‌توانید پیوست بیفزایید یا بردارید.';
}
