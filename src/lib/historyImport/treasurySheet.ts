import { toEnglishDigits } from '../../utils/persianNumber.js';
import type { TreasuryImportRow } from './treasuryHistoryImport.js';
import { purchaseRefKey } from './purchaseRef.js';

/**
 * v11 history import, tool 1: reading the two Excel sheets of past money and turning each row, through the names the user
 * mapped once, into a row the server takes. Pure functions shared by the import window and its tests.
 *
 * Sheet «دریافت و پرداخت»: تاریخ · نوع (دریافت / پرداخت) · حساب نقد و بانک · طرف حساب · مبلغ · شماره مرجع-فاکتور ·
 * مرکز هزینه · شرح سند. Sheet «هزینه‌ها»: تاریخ · شماره مرجع-فاکتور · نوع هزینه · مرکز هزینه · طرف حساب (the seller) ·
 * مبلغ · حساب نقد و بانک (the account that paid) · شرح سند. Either may add «کد حساب مقابل» (an account code for that row).
 * Columns are found by their header, so their order and the extra columns (سال، ماه، روز، تاریخ میلادی) do not matter.
 */

export type TreasurySheetShape = 'moves' | 'expenses';

export interface ParsedTreasuryRow {
  sheet: string;
  rowNo: number;
  shape: TreasurySheetShape;
  date: string;
  /** moves: «دریافت» or «پرداخت»; expenses: the expense type */
  typeText: string;
  bankName: string;
  partyName: string;
  amount: string;
  invoiceRef: string;
  costCenter: string;
  description: string;
  contraCode: string;
}

const HEADERS = {
  date: 'تاریخ',
  type: 'نوع',
  expenseType: 'نوع هزینه',
  bank: 'حساب نقد و بانک',
  party: 'طرف حساب',
  amount: 'مبلغ',
  ref: 'شماره مرجع-فاکتور',
  costCenter: 'مرکز هزینه',
  description: 'شرح سند',
  contraCode: 'کد حساب مقابل',
} as const;

/** Header text compared without spaces, ZWNJ or the Arabic forms of «ی» and «ک». */
export const headerKey = (value: unknown): string => String(value ?? '')
  .replace(/[‌\s]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim();

export function detectTreasurySheet(header: readonly unknown[]): TreasurySheetShape | null {
  const keys = header.map(headerKey);
  const has = (h: string) => keys.includes(headerKey(h));
  if (!has(HEADERS.date) || !has(HEADERS.bank) || !has(HEADERS.party) || !has(HEADERS.amount)) return null;
  if (has(HEADERS.expenseType)) return 'expenses';
  if (has(HEADERS.type)) return 'moves';
  return null;
}

const cellText = (value: unknown): string => (value === null || value === undefined ? '' : String(value).trim());

/**
 * An amount cell: a number as it is, a text with thousands separators («,» or «٬» between groups of three) without them.
 * Anything else is kept as written, so the server names the row whose amount it cannot read.
 */
export function amountText(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = toEnglishDigits(cellText(value));
  if (/^\d{1,3}([,٬]\d{3})+(\.\d+)?$/.test(text)) return text.replace(/[,٬]/g, '');
  return text;
}

/** The rows of one sheet (the first row is the header); a row with no date, account, party and amount is left out. */
export function parseTreasurySheet(sheet: string, rows: readonly (readonly unknown[])[]): ParsedTreasuryRow[] {
  const header = rows[0] ?? [];
  const shape = detectTreasurySheet(header);
  if (!shape) return [];
  const keys = header.map(headerKey);
  const col = (h: string) => keys.indexOf(headerKey(h));
  const at = (row: readonly unknown[], h: string) => {
    const i = col(h);
    return i < 0 ? '' : row[i];
  };
  const parsed: ParsedTreasuryRow[] = [];
  rows.slice(1).forEach((row, i) => {
    const out: ParsedTreasuryRow = {
      sheet,
      rowNo: i + 2,
      shape,
      date: toEnglishDigits(cellText(at(row, HEADERS.date))),
      typeText: cellText(at(row, shape === 'expenses' ? HEADERS.expenseType : HEADERS.type)),
      bankName: cellText(at(row, HEADERS.bank)),
      partyName: cellText(at(row, HEADERS.party)),
      amount: amountText(at(row, HEADERS.amount)),
      invoiceRef: cellText(at(row, HEADERS.ref)),
      costCenter: cellText(at(row, HEADERS.costCenter)),
      description: cellText(at(row, HEADERS.description)),
      contraCode: toEnglishDigits(cellText(at(row, HEADERS.contraCode))),
    };
    if (out.date || out.bankName || out.partyName || out.amount) parsed.push(out);
  });
  return parsed;
}

/** «حساب نقد و بانک»: one of our accounts, or (sheet «هزینه‌ها», tool 4) the colleague who paid from their own pocket */
export type BankTarget = { kind: 'bank'; bankAccountId: number } | { kind: 'personnel'; personnelId: number; name: string } | { kind: 'skip' };
export type PartyTarget =
  | { kind: 'customer' | 'supplier'; partyId: number; name: string }
  | { kind: 'personnel'; personnelId: number; name: string }
  | { kind: 'bank'; bankAccountId: number }
  | { kind: 'account'; accountId: number }
  | { kind: 'skip' };
export type ExpenseTarget = { kind: 'account'; accountId: number } | { kind: 'supplier' } | { kind: 'skip' };
/** tool 5: «مرکز هزینه» → the production project its expenses were spent on, or none (general and office costs) */
export type CostCentreTarget = { kind: 'project'; projectId: number; name: string } | { kind: 'none' };

export interface TreasuryImportMapping {
  banks: Record<string, BankTarget>;
  parties: Record<string, PartyTarget>;
  expenses: Record<string, ExpenseTarget>;
  /** tool 5: each cost centre once (kept by the browser with the rest) */
  costCentres?: Record<string, CostCentreTarget>;
}

export const emptyTreasuryMapping = (): TreasuryImportMapping => ({ banks: {}, parties: {}, expenses: {}, costCentres: {} });

/** Cost centres of the company as a whole, not of one project (the owner's list, 7 Aban 1405): offered as «بدون پروژه». */
export const GENERAL_COST_CENTRES = ['عمومی و مشترک', 'هزینه های دفتر', 'فروش ایران'];

/** The cost centre a later import offers by itself: a general one as none, a project whose code or title is the same text. */
export function suggestCostCentre(name: string, projects: ReadonlyArray<{ id: number; projectCode: string; title: string }>): CostCentreTarget | null {
  const key = headerKey(name);
  if (GENERAL_COST_CENTRES.some(g => headerKey(g) === key)) return { kind: 'none' };
  const project = projects.find(p => headerKey(p.projectCode) === key || headerKey(p.title) === key);
  return project ? { kind: 'project', projectId: project.id, name: `${project.projectCode} - ${project.title}` } : null;
}

/** A row's project from its cost centre: none when the cell is empty or the centre maps to none, `undefined` while unmapped. */
function projectOfRow(parsed: ParsedTreasuryRow, mapping: TreasuryImportMapping): number | null | undefined {
  const centre = parsed.costCenter.trim();
  if (!centre) return null;
  const target = mapping.costCentres?.[centre];
  if (!target) return undefined;
  return target.kind === 'project' ? target.projectId : null;
}

/**
 * What a colleague's row is: wages paid through their payslips, an advance, their running account (petty cash given, their
 * out-of-pocket expenses paid back, money handed back; tool 4), or another payment with a counter account.
 */
export type PersonnelUse = 'payslip' | 'advance' | 'colleague_account' | 'other';

/** The default use of a colleague's row, read from its description; the user can change it row by row. */
export function guessPersonnelUse(row: Pick<ParsedTreasuryRow, 'description' | 'partyName' | 'typeText'>): PersonnelUse {
  // compared without spaces and ZWNJ, so «تن خواه», «خرج‌کرد» and «هزینه کرد» read as written together
  const text = `${row.description} ${row.partyName}`.replace(/[\s‌]+/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  if (text.includes('مساعده')) return 'advance';
  if (row.typeText === 'پرداخت' && /حقوق|دستمزد/.test(text)) return 'payslip';
  // a loan repaid («بازپرداخت وام») is not the running account; such a row waits for the user's choice
  if (/وام|قسط/.test(text)) return 'other';
  if (/تنخواه|بازپرداخت|ازجیب|خرجکرد|هزینهکرد/.test(text)) return 'colleague_account';
  return 'other';
}

/** The key of a row in the per-row choices of the window. */
export const rowKey = (row: Pick<ParsedTreasuryRow, 'sheet' | 'rowNo'>) => `${row.sheet}#${row.rowNo}`;

export type ResolvedTreasuryRow =
  | { status: 'ready'; parsed: ParsedTreasuryRow; row: TreasuryImportRow; personnel: boolean }
  | { status: 'skipped'; parsed: ParsedTreasuryRow; reason: string }
  /** `personnel`: a colleague row held back for its use, so the window still offers the use select on it */
  | { status: 'unresolved'; parsed: ParsedTreasuryRow; reason: string; personnel?: boolean };

/** The names of a set of rows that still need a mapping: banks, parties and expense types. */
export function unmappedNames(rows: readonly ParsedTreasuryRow[], mapping: TreasuryImportMapping) {
  const banks = new Set<string>();
  const parties = new Set<string>();
  const expenses = new Set<string>();
  const costCentres = new Set<string>();
  for (const r of rows) {
    if (r.bankName && !mapping.banks[r.bankName]) banks.add(r.bankName);
    if (r.costCenter.trim() && !mapping.costCentres?.[r.costCenter.trim()] && takesProject(r, mapping)) costCentres.add(r.costCenter.trim());
    if (r.shape === 'expenses') {
      if (r.typeText && !mapping.expenses[r.typeText]) expenses.add(r.typeText);
      if (mapping.expenses[r.typeText]?.kind === 'supplier' && r.partyName && !mapping.parties[r.partyName]) parties.add(r.partyName);
    } else if (r.partyName && !mapping.parties[r.partyName]) {
      parties.add(r.partyName);
    }
  }
  return { banks: [...banks], parties: [...parties], expenses: [...expenses], costCentres: [...costCentres] };
}

/** Whether a row can carry a project: an expense posted to an account (from our account or a colleague's pocket), or a row of
 * «دریافت و پرداخت» whose party is an account. A supplier payment, a customer receipt or a colleague's move carries none. */
function takesProject(r: ParsedTreasuryRow, mapping: TreasuryImportMapping): boolean {
  if (r.shape === 'expenses') return mapping.expenses[r.typeText]?.kind !== 'supplier';
  const party = mapping.parties[r.partyName];
  return !party || party.kind === 'account';
}

const unmappedCentre = (parsed: ParsedTreasuryRow) => `مرکز هزینهٔ «${parsed.costCenter.trim()}» هنوز به پروژه‌ای (یا «بدون پروژه») وصل نشده است.`;
const SKIP = (parsed: ParsedTreasuryRow, reason: string): ResolvedTreasuryRow => ({ status: 'skipped', parsed, reason });
const UNRESOLVED = (parsed: ParsedTreasuryRow, reason: string): ResolvedTreasuryRow => ({ status: 'unresolved', parsed, reason });

/**
 * One Excel row through the mapping. `uses` holds the user's choice for a colleague's row (default `guessPersonnelUse`),
 * `accountIdOfCode` reads the optional «کد حساب مقابل» column, `accepted` the rows the user accepted as not duplicates.
 */
export function resolveTreasuryRow(
  parsed: ParsedTreasuryRow,
  mapping: TreasuryImportMapping,
  options: { uses?: Record<string, PersonnelUse>; accountIdOfCode?: (code: string) => number | null; accepted?: ReadonlySet<string> } = {},
): ResolvedTreasuryRow {
  const bank = mapping.banks[parsed.bankName];
  if (!parsed.bankName) return UNRESOLVED(parsed, 'حساب نقد و بانک ردیف خالی است.');
  if (!bank) return UNRESOLVED(parsed, `حساب «${parsed.bankName}» هنوز به حسابی در برنامه وصل نشده است.`);
  if (bank.kind === 'skip') return SKIP(parsed, `ردیف‌های حساب «${parsed.bankName}» کنار گذاشته شده‌اند.`);
  if (bank.kind === 'personnel' && parsed.shape !== 'expenses') {
    return UNRESOLVED(parsed, `«${parsed.bankName}» همکار است، نه حساب؛ در «دریافت و پرداخت» حساب نقد و بانک باید یکی از حساب‌های شرکت باشد.`);
  }
  let rowContra: number | null = null;
  if (parsed.contraCode) {
    rowContra = options.accountIdOfCode?.(parsed.contraCode) ?? null;
    if (!rowContra) return UNRESOLVED(parsed, `کد حساب مقابل «${parsed.contraCode}» در فهرست حساب‌های قابل انتخاب نیست.`);
  }
  const base = {
    rowNo: parsed.rowNo, sheet: parsed.sheet, date: parsed.date, bankAccountId: bank.kind === 'bank' ? bank.bankAccountId : 0, amount: parsed.amount,
    invoiceRef: parsed.invoiceRef, costCenter: parsed.costCenter, description: parsed.description,
    duplicateAccepted: options.accepted?.has(rowKey(parsed)) || undefined,
  };
  const ready = (row: Omit<TreasuryImportRow, keyof typeof base>, personnel = false): ResolvedTreasuryRow =>
    ({ status: 'ready', parsed, row: { ...base, ...row }, personnel });

  if (parsed.shape === 'expenses') {
    const expense = mapping.expenses[parsed.typeText];
    if (!parsed.typeText) return UNRESOLVED(parsed, 'نوع هزینه ردیف خالی است.');
    if (!expense) return UNRESOLVED(parsed, `نوع هزینه «${parsed.typeText}» هنوز به حسابی وصل نشده است.`);
    if (expense.kind === 'skip') return SKIP(parsed, `ردیف‌های نوع هزینه «${parsed.typeText}» کنار گذاشته شده‌اند.`);
    if (bank.kind === 'personnel') {
      // tool 4: a colleague paid it from their own pocket; the same name as «طرف حساب» is an accrual (wages), not a payment
      if (headerKey(parsed.partyName) === headerKey(parsed.bankName)) {
        return UNRESOLVED(parsed, `«حساب نقد و بانک» و «طرف حساب» هر دو «${parsed.bankName}» است؛ این ردیف پرداخت نیست (حقوق یا بستانکاری). حقوق از فیش ثبت می‌شود: نوع آن را کنار بگذارید یا ردیف را درست کنید.`);
      }
      if (expense.kind !== 'account') {
        return UNRESOLVED(parsed, `خرید از تأمین‌کننده با پول همکار («${parsed.bankName}») از این ابزار ثبت نمی‌شود؛ آن را دستی ثبت کنید یا نوع هزینه را به یک حساب وصل کنید.`);
      }
      const projectId = projectOfRow(parsed, mapping);
      if (projectId === undefined) return UNRESOLVED(parsed, unmappedCentre(parsed));
      return ready({ kind: 'colleague_expense', personnelId: bank.personnelId, partyName: parsed.partyName, contraAccountId: rowContra ?? expense.accountId, projectId });
    }
    if (expense.kind === 'account') {
      const projectId = projectOfRow(parsed, mapping);
      if (projectId === undefined) return UNRESOLVED(parsed, unmappedCentre(parsed));
      return ready({ kind: 'payment', partyType: 'other', partyName: parsed.partyName || parsed.typeText, contraAccountId: rowContra ?? expense.accountId, projectId });
    }
    const seller = mapping.parties[parsed.partyName];
    if (!seller || seller.kind !== 'supplier') return UNRESOLVED(parsed, `فروشندهٔ «${parsed.partyName}» باید به یک تأمین‌کننده وصل شود (خرید مواد، رسید انبار آن را ثبت کرده است).`);
    const purchaseRef = purchaseRefKey(parsed.invoiceRef);
    return ready({ kind: 'payment', partyType: 'supplier', partyId: seller.partyId, partyName: seller.name, settleOldest: true, ...(purchaseRef ? { purchaseRef } : {}) });
  }

  if (bank.kind !== 'bank') return UNRESOLVED(parsed, `«${parsed.bankName}» حساب شرکت نیست.`);
  const kind = parsed.typeText === 'دریافت' ? 'receipt' : parsed.typeText === 'پرداخت' ? 'payment' : null;
  if (!kind) return UNRESOLVED(parsed, `نوع ردیف «${parsed.typeText}» باید «دریافت» یا «پرداخت» باشد.`);
  const party = mapping.parties[parsed.partyName];
  if (!parsed.partyName) return UNRESOLVED(parsed, 'طرف حساب ردیف خالی است.');
  if (!party) return UNRESOLVED(parsed, `طرف حساب «${parsed.partyName}» هنوز به چیزی در برنامه وصل نشده است.`);
  switch (party.kind) {
    case 'skip':
      return SKIP(parsed, `ردیف‌های طرف حساب «${parsed.partyName}» کنار گذاشته شده‌اند.`);
    case 'customer':
    case 'supplier':
      return ready({
        kind, partyType: party.kind, partyId: party.partyId, partyName: party.name,
        settleOldest: (kind === 'receipt') === (party.kind === 'customer'),
      });
    case 'bank':
      if (party.bankAccountId === bank.bankAccountId) return UNRESOLVED(parsed, 'حساب مبدأ و مقصد انتقال یکی است.');
      return kind === 'payment'
        ? ready({ kind: 'transfer', toBankAccountId: party.bankAccountId })
        : { status: 'ready', parsed, personnel: false, row: { ...base, kind: 'transfer', bankAccountId: party.bankAccountId, toBankAccountId: bank.bankAccountId } };
    case 'account': {
      const projectId = projectOfRow(parsed, mapping);
      if (projectId === undefined) return UNRESOLVED(parsed, unmappedCentre(parsed));
      return ready({ kind, partyType: 'other', partyName: parsed.partyName, contraAccountId: rowContra ?? party.accountId, projectId });
    }
    case 'personnel': {
      const use = options.uses?.[rowKey(parsed)] ?? guessPersonnelUse(parsed);
      if (use === 'payslip' && kind === 'payment') return ready({ kind: 'payslip', personnelId: party.personnelId }, true);
      if (use === 'advance') return ready({ kind, partyType: 'personnel', partyId: party.personnelId, partyName: party.name, purpose: 'advance' }, true);
      if (use === 'colleague_account') return ready({ kind, partyType: 'personnel', partyId: party.personnelId, partyName: party.name, purpose: 'colleague_account' }, true);
      // «پرداخت دیگر» to a colleague (a loan, a repayment) takes the account its own row names, never a shared fallback
      if (!rowContra) {
        return { ...UNRESOLVED(parsed, '«پرداخت دیگر» به همکار حساب مقابل خودش را می‌خواهد: «کد حساب مقابل» همین ردیف را در اکسل بنویسید، یا کاربرد ردیف را از فهرست کنارش عوض کنید (حقوق، مساعده یا حساب جاری همکار).'), personnel: true };
      }
      return ready({ kind, partyType: 'personnel', partyId: party.personnelId, partyName: party.name, purpose: 'other', contraAccountId: rowContra }, true);
    }
  }
}

/** Names a later import offers automatically: the same text as a customer, supplier, colleague or account title. */
export function suggestPartyTarget(
  name: string,
  lists: {
    parties: ReadonlyArray<{ id: number; name: string; type: string }>;
    personnel: ReadonlyArray<{ id: number; name: string }>;
    banks: ReadonlyArray<{ id: number; title: string }>;
  },
): PartyTarget | null {
  const key = headerKey(name);
  const advance = /^مساعده\s*-\s*(.+)$/.exec(name.trim());
  const person = lists.personnel.find(p => headerKey(p.name) === headerKey(advance ? advance[1] : name));
  if (person) return { kind: 'personnel', personnelId: person.id, name: person.name };
  const bank = lists.banks.find(b => headerKey(b.title) === key);
  if (bank) return { kind: 'bank', bankAccountId: bank.id };
  const party = lists.parties.find(p => headerKey(p.name) === key);
  if (party) return { kind: party.type === 'supplier' ? 'supplier' : 'customer', partyId: party.id, name: party.name };
  return null;
}
