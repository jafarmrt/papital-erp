import { describe, expect, it } from 'vitest';
import {
  emptyWorkLogMapping, monthOfRow, numberText, parseWorkLogSheet, resolveWorkLogRow, suggestWorkLogMapping, unmappedWorkLogNames,
  workLogSkipReason, type WorkLogLookups,
} from '../../lib/historyImport/workLogSheet';
import { workLogImportDate, workLogImportDuplicateKey, workLogMonthBounds } from '../../lib/historyImport/workLogImport';

// v12 work-log import: reading the sheet «کارکرد و پروژه» and resolving its rows through the names mapped once
const HEADER = ['ردیف «حقوق» اکسل اصلی', 'ماه', 'همکار', 'شرح فعالیت', 'تعداد', 'ساعت (اعشاری)', 'فی', 'جمع', 'توضیحات', 'پروژه', 'پروژه از کجا آمد'];

const rows = parseWorkLogSheet([
  HEADER,
  [41, 2, 'علی آقایی', 'برش', 103, '', 100000, 10300000, 'سفارش الف', 'پروژه آلمان 1405-1', 'حدس'],
  [42, 2, 'علي آقايي', 'آموزش', '', 1.3333333333, 600000, 800000, '', 'بدون پروژه (عمومی و مشترک)', ''],
  [43, 2, 'آسیه کیانی', 'حقوق ثابت', '', '', '', 150000000, '', '— (حقوق ثابت اردیبهشت)', ''],
  [44, 3, 'آسیه کیانی', 'برش', '', '', '', '', '', 'پروژه آلمان 1405-1', ''],
  ['', '', '', '', '', '', '', '', '', '', ''],
  [45, '1405/9', 'همکار تازه', 'کار ناشناخته', 2, '', '50,000', '100,000', '', 'پروژه ناشناخته', ''],
]);

const lookups: WorkLogLookups = {
  personnel: [{ id: 7, fullName: 'علی آقایی' }, { id: 8, fullName: 'آسیه کیانی' }],
  tasks: [{ id: 1, title: 'برش', unit: 'عدد' }, { id: 2, title: 'آموزش (هرجلسه)', unit: 'ساعت' }, { id: 3, title: 'آموزش‌دهی', unit: 'عدد' }],
  projects: [{ id: 11, title: 'پروژه آلمان 1405-1', projectCode: 'P-11' }, { id: 12, title: 'پروژه ایتالیا امرجنسی 1405- 1' }],
};

describe('v12 work-log import: the sheet «کارکرد و پروژه»', () => {
  it('reads the rows by their headers, rounds Excel hours to four decimals and drops empty rows', () => {
    expect(rows.map(r => r.rowNo)).toEqual([2, 3, 4, 5, 7]);
    expect(rows[0]).toMatchObject({ sourceRow: '41', monthText: '2', personName: 'علی آقایی', activity: 'برش', count: '103', rate: '100000', total: '10300000', projectName: 'پروژه آلمان 1405-1' });
    expect(rows[1].hours).toBe('1.3333');
    expect(rows[4]).toMatchObject({ rate: '50000', total: '100000' });
    expect(numberText(0.1 + 0.2)).toBe('0.3');
    expect(parseWorkLogSheet([['تاریخ', 'مبلغ'], ['1405-01-01', 1]])).toEqual([]);
  });

  it('leaves out the rows that are not work: fixed salary, eidi and a row with no amount', () => {
    expect(workLogSkipReason(rows[0])).toBeNull();
    expect(workLogSkipReason(rows[2])).toContain('حقوق ثابت');
    expect(workLogSkipReason(rows[3])).toBe('ردیف بی‌مبلغ');
  });

  it('reads the month as a number of the chosen year, `YYYY/M` or its name', () => {
    expect(monthOfRow('2', 1405)).toBe('1405-02');
    expect(monthOfRow('1405/9', 1404)).toBe('1405-09');
    expect(monthOfRow('اردیبهشت', 1405)).toBe('1405-02');
    expect(monthOfRow('13', 1405)).toBe('');
  });

  it('offers the names the app knows: same name (Arabic forms too), a title starting with the activity and a bracket, a project, «بدون پروژه» as none', () => {
    const m = suggestWorkLogMapping(rows, emptyWorkLogMapping(), lookups);
    expect(m.personnel).toEqual({ 'علی آقایی': 7, 'علي آقايي': 7, 'آسیه کیانی': 8 });
    expect(m.tasks).toEqual({ 'برش': 1, 'آموزش': 2 });
    expect(m.projects).toEqual({ 'پروژه آلمان 1405-1': { kind: 'project', projectId: 11 }, 'بدون پروژه (عمومی و مشترک)': { kind: 'none' } });
    const names = unmappedWorkLogNames(rows, m);
    expect(names).toEqual({ personnel: ['همکار تازه'], tasks: ['کار ناشناخته'], projects: ['پروژه ناشناخته'] });
    // a name mapped by the user is kept
    const kept = suggestWorkLogMapping(rows, { ...emptyWorkLogMapping(), tasks: { 'برش': 3 } }, lookups);
    expect(kept.tasks['برش']).toBe(3);
  });

  it('resolves a row: the hours of an hourly task, the count of another, no project for «بدون پروژه», the notes with the payroll row', () => {
    const m = suggestWorkLogMapping(rows, emptyWorkLogMapping(), lookups);
    const piece = resolveWorkLogRow(rows[0], m, { year: 1405, lookups });
    expect(piece).toMatchObject({ status: 'ready', row: { month: '1405-02', personnelId: 7, taskId: 1, projectId: 11, quantity: '103', unitRate: '100000', excelTotal: '10300000' } });
    if (piece.status === 'ready') expect(piece.row.notes).toBe('سفارش الف (ورود از اکسل، ردیف حقوق 41)');
    const hourly = resolveWorkLogRow(rows[1], m, { year: 1405, lookups, accepted: new Set(['row#3']) });
    expect(hourly).toMatchObject({ status: 'ready', row: { taskId: 2, projectId: null, quantity: '1.3333', duplicateAccepted: true } });
    expect(resolveWorkLogRow(rows[2], m, { year: 1405, lookups }).status).toBe('skipped');
    const unknown = resolveWorkLogRow(rows[4], m, { year: 1405, lookups });
    expect(unknown.status).toBe('unresolved');
  });
});

describe('v12 work-log import: the day of a row', () => {
  it('is the last day of the Jalali month, 30 Esfand only in a leap year', () => {
    expect(workLogMonthBounds('1405-02')).toEqual({ firstDay: '2026-04-21', lastDay: '2026-05-21' });
    expect(workLogMonthBounds('1405-07')?.lastDay).toBe('2026-10-22');
    // 1403 is a leap year (30 Esfand 1403 = 2025-03-20); 1404 is not (29 Esfand 1404 = 2026-03-20)
    expect(workLogMonthBounds('1403-12')?.lastDay).toBe('2025-03-20');
    expect(workLogMonthBounds('1404-12')?.lastDay).toBe('2026-03-20');
    expect(workLogMonthBounds('1405-13')).toBeNull();
  });

  it('is the colleague\'s service end when it falls inside the month', () => {
    expect(workLogImportDate('1405-02', null)).toBe('2026-05-21');
    expect(workLogImportDate('1405-02', '2026-04-30')).toBe('2026-04-30');
    expect(workLogImportDate('1405-02', '2026-07-01')).toBe('2026-05-21');
    // a service that ended before the month: the last day, which the hand entry's check refuses with its own message
    expect(workLogImportDate('1405-02', '2026-03-30')).toBe('2026-05-21');
  });

  it('keys a duplicate by colleague, task, project, day, quantity and rate', () => {
    const a = workLogImportDuplicateKey({ personnelId: 1, taskId: 2, projectId: null, date: '2026-05-21', quantity: '3', unitRate: '100' });
    expect(a).toBe(workLogImportDuplicateKey({ personnelId: 1, taskId: 2, projectId: null, date: '2026-05-21', quantity: '3', unitRate: '100' }));
    expect(a).not.toBe(workLogImportDuplicateKey({ personnelId: 1, taskId: 2, projectId: 5, date: '2026-05-21', quantity: '3', unitRate: '100' }));
  });
});
