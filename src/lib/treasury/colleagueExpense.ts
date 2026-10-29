import type { PettyCashLineInput } from './pettyCash';

/**
 * v11 (the 1405 replay, tool 4): an expense a colleague paid for the company from their own pocket, shared by the server
 * and the treasury page. Its lines are a petty cash statement's (an expense or cost account, an amount, and optional
 * text), checked with the same rules (`pettyCashStatementError`).
 */

export interface ColleagueExpenseLine {
  lineNo: number;
  accountId: number;
  accountCode: string;
  accountName: string;
  amount: number;
  description: string;
  sellerName: string;
  invoiceNumber: string;
  /** v11 tool 5: the production project of the line, or null */
  projectId: number | null;
  projectTitle: string;
}

export interface ColleagueExpense {
  id: number;
  personnelId: number;
  personnelName: string;
  date: string;
  description: string;
  total: number;
  status: 'active' | 'voided';
  voucherId: number | null;
  voucherNumber: number | null;
  voucherStatus: string | null;
  lines: ColleagueExpenseLine[];
}

export interface ColleagueExpenseList {
  rows: ColleagueExpense[];
  /** what the company owes each colleague of the list now, for the expenses they paid (credit balance of the payable) */
  owed: Array<{ personnelId: number; personnelName: string; owed: number }>;
}

/** the description of a voucher line: who paid, then the line's own text, seller and invoice number when written */
export function colleagueExpenseLineDescription(colleagueName: string, line: Pick<PettyCashLineInput, 'description' | 'sellerName' | 'invoiceNumber'>): string {
  const parts = [`هزینهٔ پرداختی ${colleagueName}`];
  if (line.description?.trim()) parts.push(line.description.trim());
  if (line.sellerName?.trim()) parts.push(`فروشنده: ${line.sellerName.trim()}`);
  if (line.invoiceNumber?.trim()) parts.push(`فاکتور: ${line.invoiceNumber.trim()}`);
  return parts.join(' — ');
}
