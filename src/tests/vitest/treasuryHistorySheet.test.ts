import { describe, expect, it } from 'vitest';
import {
  amountText, detectTreasurySheet, emptyTreasuryMapping, guessPersonnelUse, parseTreasurySheet, resolveTreasuryRow, suggestCostCentre,
  rowKey, suggestPartyTarget, unmappedNames, type TreasuryImportMapping,
} from '../../lib/historyImport/treasurySheet';
import { treasuryImportDescription, treasuryImportDuplicateKey, treasuryImportOrder } from '../../lib/historyImport/treasuryHistoryImport';

// v11 history import, tool 1: reading the money sheets of the old Excel and resolving their rows through the mapping
const MOVES_HEADER = ['تاریخ', 'سال', 'ماه', 'روز', 'تاریخ میلادی', 'نوع', 'حساب نقد و بانک', 'طرف حساب', 'مبلغ', 'شماره مرجع-فاکتور', 'مرکز هزینه', 'شرح سند', 'مقدار ارزی'];
const EXPENSES_HEADER = ['تاریخ', 'سال', 'ماه', 'روز', 'تاریخ میلادی', 'شماره مرجع-فاکتور', 'نوع هزینه', 'مرکز هزینه', 'طرف حساب', 'مبلغ', 'حساب نقد و بانک', 'شرح سند', 'مقدار ارزی'];

const moves = parseTreasurySheet('دریافت و پرداخت', [
  MOVES_HEADER,
  ['1405-01-05', 1405, 1, 5, '2026-03-25', 'پرداخت', 'بانک الف', 'مساعده - همکار یک', '50,000,000', '255', 'پروژه', 'مساعده'],
  ['1405-01-24', 1405, 1, 24, '', 'پرداخت', 'بانک الف', 'کارمزد بانکی', 21800, '', 'عمومی', 'کارمزد'],
  ['1405-02-12', 1405, 2, 12, '', 'پرداخت', 'بانک ب', 'بانک الف', '531,822,316', 'ACH1', '', 'واریز به حساب الف', '350'],
  ['1405-02-20', 1405, 2, 20, '', 'دریافت', 'بانک الف', 'بانک ب', 1000, '', '', 'برگشت از ب'],
  ['1405-03-02', 1405, 3, 2, '', 'پرداخت', 'بانک ب', 'همکار یک', '436,207,270', '', '', 'حقوق اردیبهشت'],
  ['1405-03-08', 1405, 3, 8, '', 'پرداخت', 'مساعده - همکار یک', 'همکار یک', '329,966,160', '', '', 'مساعده'],
  ['1405-05-09', 1405, 5, 9, '', 'دریافت', 'بانک الف', 'فروشگاه آزمون', '2,160,000', '61', 'فروش ایران', 'واریز فروش فروردین'],
  ['1405-07-29', 1405, 7, 29, '', 'پرداخت', 'بانک الف', 'همکار یک', '24,930,000', '', '', 'هزینه کردهای کارگاه'],
  [],
  ['', '', '', '', '', '', '', '', ''],
]);
const expenses = parseTreasurySheet('هزینه‌ها', [
  EXPENSES_HEADER,
  ['1405-02-04', 1405, 2, 4, '', '1', 'هزینه مواداولیه', 'پروژه', 'فروشگاه رنگ', '3,300,000', 'بانک الف', 'نوار چسب'],
  ['1405-02-05', 1405, 2, 5, '', '2', 'حمل و نقل', 'پروژه', 'باربری', '500000', 'بانک الف', 'ارسال'],
  ['1405-02-06', 1405, 2, 6, '', '3', 'اداری و تشکیلاتی', '', 'همکار یک', '9000000', 'بانک الف', 'حقوق (دوباره ثبت‌شده)'],
]);

const mapping: TreasuryImportMapping = {
  ...emptyTreasuryMapping(),
  banks: { 'بانک الف': { kind: 'bank', bankAccountId: 1 }, 'بانک ب': { kind: 'bank', bankAccountId: 2 }, 'مساعده - همکار یک': { kind: 'skip' } },
  parties: {
    'مساعده - همکار یک': { kind: 'personnel', personnelId: 7, name: 'همکار یک' },
    'همکار یک': { kind: 'personnel', personnelId: 7, name: 'همکار یک' },
    'کارمزد بانکی': { kind: 'account', accountId: 77 },
    'بانک الف': { kind: 'bank', bankAccountId: 1 },
    'بانک ب': { kind: 'bank', bankAccountId: 2 },
    'فروشگاه آزمون': { kind: 'customer', partyId: 30, name: 'فروشگاه آزمون' },
    'فروشگاه رنگ': { kind: 'supplier', partyId: 40, name: 'فروشگاه رنگ' },
  },
  expenses: { 'هزینه مواداولیه': { kind: 'supplier' }, 'حمل و نقل': { kind: 'account', accountId: 75 }, 'اداری و تشکیلاتی': { kind: 'skip' } },
  // tool 5: each cost centre once
  costCentres: { 'پروژه': { kind: 'project', projectId: 5, name: 'PRJ-5' }, 'عمومی': { kind: 'none' }, 'فروش ایران': { kind: 'none' } },
};

describe('treasury history import sheets', () => {
  it('finds both sheets by their headers and reads amounts with or without separators', () => {
    expect(detectTreasurySheet(MOVES_HEADER)).toBe('moves');
    expect(detectTreasurySheet(EXPENSES_HEADER)).toBe('expenses');
    expect(detectTreasurySheet(['تاریخ', 'کد کالا', 'تعداد'])).toBeNull();
    expect(amountText('50,000,000')).toBe('50000000');
    expect(amountText('۲٬۱۶۰٬۰۰۰')).toBe('2160000');
    expect(amountText(21800)).toBe('21800');
    // a misplaced separator is kept as written, so the server refuses the row by name
    expect(amountText('5,00')).toBe('5,00');
    expect(moves).toHaveLength(8);
    expect(moves[0]).toMatchObject({ rowNo: 2, date: '1405-01-05', typeText: 'پرداخت', bankName: 'بانک الف', amount: '50000000', invoiceRef: '255' });
    expect(expenses[0]).toMatchObject({ shape: 'expenses', typeText: 'هزینه مواداولیه', partyName: 'فروشگاه رنگ', amount: '3300000', bankName: 'بانک الف' });
  });

  it('turns each row into what a hand entry would record', () => {
    const r = (i: number, uses = {}) => resolveTreasuryRow(moves[i], mapping, { uses });
    expect(r(0)).toMatchObject({ status: 'ready', row: { kind: 'payment', partyType: 'personnel', partyId: 7, purpose: 'advance', bankAccountId: 1 } });
    expect(r(1)).toMatchObject({ status: 'ready', row: { kind: 'payment', partyType: 'other', contraAccountId: 77, partyName: 'کارمزد بانکی' } });
    // a payment to another of our accounts is a transfer; a receipt from one is the transfer the other way
    expect(r(2)).toMatchObject({ status: 'ready', row: { kind: 'transfer', bankAccountId: 2, toBankAccountId: 1, amount: '531822316' } });
    expect(r(3)).toMatchObject({ status: 'ready', row: { kind: 'transfer', bankAccountId: 2, toBankAccountId: 1 } });
    expect(r(4)).toMatchObject({ status: 'ready', personnel: true, row: { kind: 'payslip', personnelId: 7 } });
    // the second leg of an advance (paid from «مساعده - …») is left out: the advance is recorded once
    expect(r(5)).toMatchObject({ status: 'skipped' });
    expect(r(6)).toMatchObject({ status: 'ready', row: { kind: 'receipt', partyType: 'customer', partyId: 30, settleOldest: true, invoiceRef: '61' } });
    // «هزینه کردهای کارگاه»: the colleague's running account
    expect(r(7)).toMatchObject({ status: 'ready', row: { kind: 'payment', partyType: 'personnel', purpose: 'colleague_account' } });
    expect(r(7, { [rowKey(moves[7])]: 'payslip' })).toMatchObject({ row: { kind: 'payslip' } });
    const e = (i: number) => resolveTreasuryRow(expenses[i], mapping);
    // tool 6: the row's «شماره مرجع-فاکتور» names the warehouse receipt it pays
    expect(e(0)).toMatchObject({ status: 'ready', row: { kind: 'payment', partyType: 'supplier', partyId: 40, settleOldest: true, purchaseRef: '1' } });
    const refOf = (x: ReturnType<typeof resolveTreasuryRow>) => (x.status === 'ready' ? x.row.purchaseRef : 'not ready');
    expect(refOf(resolveTreasuryRow({ ...expenses[0], invoiceRef: '' }, mapping))).toBeUndefined();
    // several numbers reach the server split exactly as the stock import split the receipt's cell (a line break is not lost)
    for (const [cell, keys] of [['9\n10', '9+10'], ['9\r\n10', '9+10'], ['A-100 و B-200', 'a-100+b-200'], ['9‌و‌10', '9+10'], ['۷۱ + 72', '71+72']]) {
      expect(refOf(resolveTreasuryRow({ ...expenses[0], invoiceRef: cell }, mapping))).toBe(keys);
    }
    expect(refOf(e(1))).toBeUndefined();
    expect(e(1)).toMatchObject({ status: 'ready', row: { kind: 'payment', partyType: 'other', partyName: 'باربری', contraAccountId: 75 } });
    expect(e(2)).toMatchObject({ status: 'skipped' });
  });

  it('holds a row back until its names are mapped, and lists those names once', () => {
    const empty = emptyTreasuryMapping();
    expect(resolveTreasuryRow(moves[0], empty).status).toBe('unresolved');
    const names = unmappedNames([...moves, ...expenses], empty);
    expect(names.banks.sort()).toEqual(['بانک الف', 'بانک ب', 'مساعده - همکار یک'].sort());
    expect(names.expenses).toHaveLength(3);
    expect(names.parties).toContain('کارمزد بانکی');
    // the seller of an expense is asked for only when its type is a supplier payment
    expect(names.parties).not.toContain('باربری');
    // «پرداخت دیگر» to a colleague takes its own row's counter account, never a shared fallback, and keeps the use select
    expect(resolveTreasuryRow(moves[7], mapping, { uses: { [rowKey(moves[7])]: 'other' } })).toMatchObject({ status: 'unresolved', personnel: true });
    expect(resolveTreasuryRow({ ...moves[7], contraCode: '3208' }, mapping, { uses: { [rowKey(moves[7])]: 'other' }, accountIdOfCode: () => 99 }))
      .toMatchObject({ status: 'ready', row: { purpose: 'other', contraAccountId: 99 } });
    expect(resolveTreasuryRow({ ...moves[1], contraCode: '7007' }, mapping, { accountIdOfCode: () => null }).status).toBe('unresolved');
    expect(resolveTreasuryRow({ ...moves[1], contraCode: '7007' }, mapping, { accountIdOfCode: () => 707 })).toMatchObject({ row: { contraAccountId: 707 } });
  });

  it('guesses a colleague row from its text and suggests names already in the app', () => {
    expect(guessPersonnelUse({ description: 'حقوق خرداد', partyName: 'x', typeText: 'پرداخت' })).toBe('payslip');
    expect(guessPersonnelUse({ description: 'پرداخت دستمزد', partyName: 'x', typeText: 'پرداخت' })).toBe('payslip');
    expect(guessPersonnelUse({ description: 'تسویه', partyName: 'مساعده - x', typeText: 'پرداخت' })).toBe('advance');
    // «خرج کرد», «هزینه کرد» and «تن خواه», with or without a space or ZWNJ, are the colleague's running account
    for (const description of ['هزینه کرد', 'هزینه‌کرد', 'خرجکرد', 'خرج کرد', 'تن خواه', 'تن‌خواه کارگاه']) {
      expect(guessPersonnelUse({ description, partyName: 'x', typeText: 'پرداخت' })).toBe('colleague_account');
    }
    expect(guessPersonnelUse({ description: 'قرض', partyName: 'x', typeText: 'پرداخت' })).toBe('other');
    // a loan repaid is not the running account; it waits for the user's choice
    expect(guessPersonnelUse({ description: 'بازپرداخت وام', partyName: 'x', typeText: 'دریافت' })).toBe('other');
    expect(guessPersonnelUse({ description: 'بازپرداخت هزینه از جیب', partyName: 'x', typeText: 'پرداخت' })).toBe('colleague_account');
    // a word ending in «و» before one starting with «ام» is not a loan
    expect(guessPersonnelUse({ description: 'تنخواه', partyName: 'خسرو امیری', typeText: 'پرداخت' })).toBe('colleague_account');
    expect(guessPersonnelUse({ description: 'تنخواه و امور دفتر', partyName: 'x', typeText: 'پرداخت' })).toBe('colleague_account');
    expect(guessPersonnelUse({ description: 'قسط‌ وام', partyName: 'x', typeText: 'پرداخت' })).toBe('other');
    const lists = { parties: [{ id: 3, name: 'گالری آزمون', type: 'customer' }, { id: 4, name: 'فروشگاه رنگ', type: 'supplier' }], personnel: [{ id: 9, name: 'همکار يک' }], banks: [{ id: 1, title: 'بانک الف' }] };
    expect(suggestPartyTarget('مساعده - همکار یک', lists)).toEqual({ kind: 'personnel', personnelId: 9, name: 'همکار يک' });
    expect(suggestPartyTarget('بانک الف', lists)).toEqual({ kind: 'bank', bankAccountId: 1 });
    expect(suggestPartyTarget('فروشگاه رنگ', lists)).toEqual({ kind: 'supplier', partyId: 4, name: 'فروشگاه رنگ' });
    expect(suggestPartyTarget('سایر اشخاص', lists)).toBeNull();
  });

  it('turns an expense a colleague paid from their own pocket into a colleague expense, and holds back the same name on both sides', () => {
    const own = parseTreasurySheet('هزینه‌ها', [
      EXPENSES_HEADER,
      ['1405-02-07', 1405, 2, 7, '', '8', 'حمل و نقل', '', 'تاکسی', '400000', 'همکار دو', 'رفت و آمد'],
      ['1405-02-08', 1405, 2, 8, '', '', 'حمل و نقل', '', 'همکار دو', '9000000', 'همکار دو', 'حقوق'],
      ['1405-02-09', 1405, 2, 9, '', '', 'هزینه مواداولیه', '', 'فروشگاه رنگ', '100000', 'همکار دو', 'مواد'],
    ]);
    const paidBy: TreasuryImportMapping = { ...mapping, banks: { ...mapping.banks, 'همکار دو': { kind: 'personnel', personnelId: 8, name: 'همکار دو' } } };
    expect(resolveTreasuryRow(own[0], paidBy)).toMatchObject({
      status: 'ready', row: { kind: 'colleague_expense', bankAccountId: 0, personnelId: 8, contraAccountId: 75, partyName: 'تاکسی', invoiceRef: '8' },
    });
    expect(resolveTreasuryRow(own[1], paidBy).status).toBe('unresolved');
    expect(resolveTreasuryRow(own[2], paidBy).status).toBe('unresolved');
    // a colleague is never the account of a money move
    const move = parseTreasurySheet('دریافت و پرداخت', [MOVES_HEADER, ['1405-02-07', 1405, 2, 7, '', 'پرداخت', 'همکار دو', 'باربری', '1000', '', '', '']]);
    expect(resolveTreasuryRow(move[0], paidBy).status).toBe('unresolved');
    // the running account: petty cash given or a payback, guessed from the text and chosen per row
    const pay = parseTreasurySheet('دریافت و پرداخت', [MOVES_HEADER, ['1405-02-10', 1405, 2, 10, '', 'پرداخت', 'بانک الف', 'همکار یک', '500000', '', '', 'تنخواه']]);
    expect(guessPersonnelUse(pay[0])).toBe('colleague_account');
    expect(resolveTreasuryRow(pay[0], mapping)).toMatchObject({ status: 'ready', row: { kind: 'payment', partyType: 'personnel', partyId: 7, purpose: 'colleague_account' } });
    expect(resolveTreasuryRow(pay[0], mapping, { uses: { [rowKey(pay[0])]: 'other' } })).toMatchObject({ status: 'unresolved', personnel: true });
  });

  it('maps each cost centre once to a project or none, and holds back an expense whose cost centre is not mapped (tool 5)', () => {
    const rows = parseTreasurySheet('هزینه‌ها', [
      EXPENSES_HEADER,
      ['1405-02-07', 1405, 2, 7, '', '', 'حمل و نقل', 'پروژه نیاوران', 'تاکسی', '400000', 'بانک الف', ''],
      ['1405-02-07', 1405, 2, 7, '', '', 'حمل و نقل', 'هزینه های دفتر', 'تاکسی', '1000', 'بانک الف', ''],
      ['1405-02-07', 1405, 2, 7, '', '', 'حمل و نقل', '', 'تاکسی', '2000', 'بانک الف', ''],
    ]);
    expect(unmappedNames(rows, mapping).costCentres).toEqual(['پروژه نیاوران', 'هزینه های دفتر']);
    expect(resolveTreasuryRow(rows[0], mapping).status).toBe('unresolved');
    expect(resolveTreasuryRow(rows[2], mapping)).toMatchObject({ status: 'ready', row: { projectId: null } });
    const projects = [{ id: 5, projectCode: 'PRJ-5', title: 'پروژه نیاوران' }];
    expect(suggestCostCentre('هزینه های دفتر', projects)).toEqual({ kind: 'none' });
    expect(suggestCostCentre('پروژه نیاوران', projects)).toEqual({ kind: 'project', projectId: 5, name: 'PRJ-5 - پروژه نیاوران' });
    expect(suggestCostCentre('کارگاه', projects)).toBeNull();
    const mapped: TreasuryImportMapping = { ...mapping, costCentres: { 'پروژه نیاوران': { kind: 'project', projectId: 5, name: 'PRJ-5' }, 'هزینه های دفتر': { kind: 'none' } } };
    expect(resolveTreasuryRow(rows[0], mapped)).toMatchObject({ status: 'ready', row: { kind: 'payment', partyType: 'other', projectId: 5 } });
    expect(resolveTreasuryRow(rows[1], mapped)).toMatchObject({ status: 'ready', row: { projectId: null } });
  });

  it('orders rows by day, money in before money out, and keeps the reference and cost centre in the description', () => {
    const rows = [
      { isoDate: '2026-05-02', row: { kind: 'payment' as const, rowNo: 2, sheet: 'a' } },
      { isoDate: '2026-05-02', row: { kind: 'transfer' as const, rowNo: 3, sheet: 'a' } },
      { isoDate: '2026-05-01', row: { kind: 'payslip' as const, rowNo: 9, sheet: 'a' } },
      { isoDate: '2026-05-02', row: { kind: 'receipt' as const, rowNo: 4, sheet: 'a' } },
    ];
    expect(treasuryImportOrder(rows).map(r => r.row.rowNo)).toEqual([9, 4, 3, 2]);
    expect(treasuryImportDescription({ description: 'واریز', invoiceRef: '61', costCenter: 'فروش ایران' })).toBe('واریز (مرجع اکسل: 61) (مرکز هزینه: فروش ایران)');
    expect(treasuryImportDescription({ description: '' })).toBe('');
    const key = (amount: string, partyName: string) => treasuryImportDuplicateKey('2026-05-02', { kind: 'payment', bankAccountId: 1, amount, partyName }, amount);
    expect(key('1000', 'الف')).toBe(key('1000', ' الف '));
    expect(key('1000', 'الف')).not.toBe(key('1000', 'ب'));
  });
});
