/**
 * v11 history import, tool 8 (1405 replay): the opening stock entered before the replay (the item form's opening, dated
 * the day the item was defined, with a draft opening voucher) is taken back first, so the replay can enter the stock of
 * 1 Farvardin and every movement after it on its own day. Shared by the server and the stock import window.
 */

/** An item with live opening rows on the Kardex, and whether its opening can be taken back. */
export interface OldOpeningItem {
  itemId: number;
  code: string;
  name: string;
  unit: string;
  /** the opening quantity and value (sum of the opening rows) */
  quantity: string;
  value: string;
  /** the first opening row's day, ISO */
  day: string;
  vouchers: Array<{ id: number; number: string; status: string }>;
  withdrawable: boolean;
  /** why it cannot be taken back */
  reason?: string;
}

export interface OldOpeningList {
  items: OldOpeningItem[];
}

export interface OldOpeningWithdrawResult {
  /** items whose opening was taken back */
  items: number;
  /** draft opening vouchers deleted */
  vouchers: number;
}

/** an item Excel import (up to 5,000 rows) issues one voucher, taken back whole in one request */
export const OLD_OPENING_WITHDRAW_MAX_ITEMS = 5000;
